/**
 * 市场解释器的测试。
 *
 * 这一层最容易出的错是**给出一个像结论的东西**：拿"没有数据"当"中性"、
 * 对一个已经是变化量的指标再变化一次、对有符号的量取百分比。
 * 这几种都不会崩，只会输出一句读者无法核对、却会照着理解的话。
 *
 * 所以测试分三层：
 * 1. 特征层——算出来的量对不对（有没有再做一次不该做的算术）
 * 2. 场景层——每条规则是不是真的能被命中、占位符是不是都填得上
 * 3. 判定层——命中多条时选谁、缺数据时怎么办
 */

import { describe, expect, it } from 'vitest'

import {
  buildFeatureTable,
  computeAllFeatures,
  CORE_FEATURES,
  FEATURE_SPECS,
  marketSentence,
  readMarketScenario,
  SCENARIOS,
  scenarioMatches,
  toneOf,
  type Condition,
  type FeatureBand,
  type FeatureFailureReason,
  type FeatureId,
  type FeatureResult,
  type FeatureSign,
  type FeatureTable,
  type SeriesPoint,
} from '../src/index.js'

const DAY = 86_400

/** 序列最后一个点的时间戳。空序列是测试用例的 bug，不是可容忍的状态。 */
function lastTs(points: readonly SeriesPoint[]): number {
  const last = points[points.length - 1]
  if (!last) throw new Error('序列为空')
  return last.ts
}

// ── 构造特征表 ──────────────────────────────────────────

type FeatureOverrides = Readonly<{
  band?: FeatureBand
  observed?: number
  percentile?: number | null
  sign?: FeatureSign | null
  prevSign?: FeatureSign | null
}>

function feat(id: FeatureId, o: FeatureOverrides = {}): FeatureResult {
  const band = o.band ?? 'mid'
  return {
    ok: true,
    value: {
      id,
      metricId: `metric:${id}`,
      windowDays: 7,
      observed: o.observed ?? 0,
      percentile: o.percentile ?? 0.5,
      band,
      sign: o.sign ?? null,
      prevSign: o.prevSign ?? null,
      asOf: 1_700_000_000,
    },
  }
}

function fail(id: FeatureId, reason: FeatureFailureReason = 'missing'): FeatureResult {
  return { ok: false, reason: { id, metricId: `metric:${id}`, reason, detail: 'test' } }
}

/**
 * 造一张特征表。
 *
 * 默认**所有**特征都不可用——这样每条规则只有在测试显式给出条件时才会命中，
 * 规则之间的相互干扰不会掩盖断言。真实数据里各特征同时存在，
 * 但那种相互干扰应该由"多条同时命中时的优先级"那条测试专门覆盖。
 */
function table(over: Partial<Record<FeatureId, FeatureResult>>): FeatureTable {
  const out = {} as Record<FeatureId, FeatureResult>
  for (const spec of FEATURE_SPECS) out[spec.id] = fail(spec.id)
  for (const [id, result] of Object.entries(over)) {
    if (!result) continue
    out[id as FeatureId] = result
  }
  return out
}

/** 一张只有两个核心特征可用的表，其余全缺。 */
function coreTable(over: Partial<Record<FeatureId, FeatureResult>> = {}): FeatureTable {
  return table({
    'price.7d': feat('price.7d', { band: 'mid' }),
    'onchain.addresses30': feat('onchain.addresses30', { band: 'mid' }),
    ...over,
  })
}

// ── 1. 特征层 ───────────────────────────────────────────

describe('特征层：不再做不该做的算术', () => {
  /**
   * 造一条足够长的日频序列。
   *
   * 必须够长（≥ 365 天）：分位标准化要拿"近一年"的历史做参照系，
   * 历史不够时特征会直接判 unknown——那是对的，但这里要测的是算术。
   */
  function longSeries(values: readonly number[], start = 1_600_000_000): SeriesPoint[] {
    return values.map((value, i) => ({ ts: start + i * DAY, value }))
  }

  it('price.7d 直接用 7 日涨跌幅本身，不再对它变化一次', () => {
    // 回归：早先的原型对 price-change-7d 又算了一次百分比变化，
    // 于是"7 日涨了 10%"被读成"涨跌幅本身比上次涨了 100%"。
    const values = [...Array.from({ length: 399 }, () => 5), 10]
    const points = longSeries(values)
    const result = computeAllFeatures({
      series: { 'price-change-7d': points },
      stale: {},
      referenceTs: lastTs(points),
    })
    const feature = result['price.7d']
    expect(feature.ok).toBe(true)
    if (!feature.ok) return
    // 观测量必须就是那个 10（%），而不是 (10/5 − 1) × 100
    expect(feature.value.observed).toBe(10)
    // 且窗口是 7 天
    expect(feature.value.windowDays).toBe(7)
  })

  it('exchange.flow7 保留符号：净流入变负不会变成"某个正数跌了百分之几"', () => {
    // 回归：早先的原型对净流入取百分比变化。+100 → −50 的百分比变化是 −150%，
    // 读起来却像"某个正数跌了 150%"，与事实相反。
    const values = [...Array.from({ length: 393 }, () => 100), ...Array.from({ length: 7 }, () => -50)]
    const points = longSeries(values)
    const result = computeAllFeatures({
      series: { 'exchange-netflow': points },
      stale: {},
      referenceTs: lastTs(points),
    })
    const feature = result['exchange.flow7']
    expect(feature.ok).toBe(true)
    if (!feature.ok) return
    // 观测量是窗口内的累计（带符号），不是百分比
    expect(feature.value.observed).toBe(-350)
    expect(feature.value.sign).toBe('outflow')
    // 绝不能是百分比变化的量级
    expect(Math.abs(feature.value.observed)).toBeLessThan(1000)
  })

  it('exchange.flow7 能识别穿越零点：方向从流出翻转为流入', () => {
    // 前 393 天净流出，最近 7 天净流入
    const values = [...Array.from({ length: 393 }, () => -100), ...Array.from({ length: 7 }, () => 100)]
    const points = longSeries(values)
    const result = computeAllFeatures({
      series: { 'exchange-netflow': points },
      stale: {},
      referenceTs: lastTs(points),
    })
    const feature = result['exchange.flow7']
    expect(feature.ok).toBe(true)
    if (!feature.ok) return
    expect(feature.value.sign).toBe('inflow')
    expect(feature.value.prevSign).toBe('outflow')
  })

  it('exchange.flow7 的分位是跟"同样口径的 7 日累计"比，不是跟每日流量比', () => {
    // 口径错了会怎样：7 日累计的量级天然是每日流量的 7 倍，
    // 拿它跟每日流量比分位，结果几乎永远是"高"——那不是市场状态，是量纲。
    const values = [...Array.from({ length: 393 }, () => 10), ...Array.from({ length: 7 }, () => 10)]
    const points = longSeries(values)
    const result = computeAllFeatures({
      series: { 'exchange-netflow': points },
      stale: {},
      referenceTs: lastTs(points),
    })
    const feature = result['exchange.flow7']
    expect(feature.ok).toBe(true)
    if (!feature.ok) return
    // 每日流量 10、7 日累计 70——但历史里的 7 日累计也是 70，
    // 所以分位应当落在常态区间，而不是"历史高位"
    expect(feature.value.observed).toBe(70)
    expect(feature.value.band).toBe('mid')
  })

  it('历史不足时判 unknown，而不是给一个"中性"分位', () => {
    const points: SeriesPoint[] = Array.from({ length: 10 }, (_, i) => ({
      ts: 1_600_000_000 + i * DAY,
      value: 100,
    }))
    const result = computeAllFeatures({
      series: { 'active-addresses': points },
      stale: {},
      referenceTs: lastTs(points),
    })
    const feature = result['onchain.addresses30']
    expect(feature.ok).toBe(false)
    if (feature.ok) return
    expect(feature.reason.reason).toBe('insufficient-history')
  })

  it('数据比参考时刻落后太多时判过期', () => {
    const points: SeriesPoint[] = Array.from({ length: 400 }, (_, i) => ({
      ts: 1_600_000_000 + i * DAY,
      value: 100 + i,
    }))
    const result = computeAllFeatures({
      series: { 'active-addresses': points },
      stale: {},
      // 参考时刻比最新数据晚 10 天
      referenceTs: lastTs(points) + 10 * DAY,
    })
    const feature = result['onchain.addresses30']
    expect(feature.ok).toBe(false)
    if (feature.ok) return
    expect(feature.reason.reason).toBe('expired')
  })

  it('stale 的指标不参与判定', () => {
    const points: SeriesPoint[] = Array.from({ length: 400 }, (_, i) => ({
      ts: 1_600_000_000 + i * DAY,
      value: 100 + i,
    }))
    const result = computeAllFeatures({
      series: { 'active-addresses': points },
      stale: { 'active-addresses': true },
      referenceTs: lastTs(points),
    })
    const feature = result['onchain.addresses30']
    expect(feature.ok).toBe(false)
    if (feature.ok) return
    expect(feature.reason.reason).toBe('stale')
  })
})

// ── 2. 场景层 ───────────────────────────────────────────

describe('场景层', () => {
  it('每条规则的 id 唯一', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('规则必须有条件：没有条件的规则等于没有规则', () => {
    // kind='rule' 的场景如果没有条件，它会永远命中——那是一条假规则。
    for (const scenario of SCENARIOS) {
      if (scenario.kind !== 'rule') continue
      expect(scenario.conditions.length, `${scenario.id} 没有条件`).toBeGreaterThan(0)
    }
  })

  it('条件只引用已注册的特征', () => {
    const known = new Set(FEATURE_SPECS.map((s) => s.id))
    for (const scenario of SCENARIOS) {
      for (const condition of scenario.conditions) {
        expect(known.has(condition.feature), `${scenario.id} 引用了未知特征`).toBe(true)
      }
    }
  })

  it('每条规则都能被真的命中——没有永远触发不了的死规则', () => {
    // 为每条规则造一张恰好满足它全部条件的特征表，再问一次
    // "这条规则命中吗"。命中不了，就说明它写了等于没写。
    for (const scenario of SCENARIOS) {
      if (scenario.kind !== 'rule') continue
      const over: Partial<Record<FeatureId, FeatureResult>> = {}
      for (const condition of scenario.conditions) {
        const current = over[condition.feature]
        const base = current?.ok === true ? current.value : null
        over[condition.feature] = feat(condition.feature, {
          band: base?.band ?? 'mid',
          sign: base?.sign ?? 'flat',
          prevSign: base?.prevSign ?? 'flat',
          observed: base?.observed ?? 0,
          ...conditionOverrides(condition),
        })
      }
      const built = table(over)
      expect(scenarioMatches(scenario, built), `${scenario.id} 无法被命中`).toBe(true)
    }
  })

  it('每条规则的句子都填得上数——没有解不开的占位符', () => {
    for (const scenario of SCENARIOS) {
      const over: Partial<Record<FeatureId, FeatureResult>> = {
        // 兜底规则没有条件，但句子引用了两个核心特征——它们必须在表里
        'price.7d': feat('price.7d', { band: 'mid', observed: 1 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'mid', observed: 1 }),
      }
      for (const condition of scenario.conditions) {
        const current = over[condition.feature]
        const base = current?.ok === true ? current.value : null
        over[condition.feature] = feat(condition.feature, {
          band: base?.band ?? 'mid',
          sign: base?.sign ?? 'flat',
          prevSign: base?.prevSign ?? 'flat',
          observed: base?.observed ?? 0,
          ...conditionOverrides(condition),
        })
      }
      const built = table(over)
      const sentence = marketSentence(
        { status: 'known', scenarioId: scenario.id, tone: 'neutral', sentence: scenario.sentence, participants: [], exclusions: [], alsoMatched: [] },
        built,
        'en',
      )
      expect(sentence, `${scenario.id} 的句子有占位符没填上`).not.toMatch(/\{[a-zA-Z0-9._-]+\}/)
      expect(sentence.length).toBeGreaterThan(0)
    }
  })
})

/** 把一条条件翻译成"要让这条规则命中，特征得长什么样" */
function conditionOverrides(condition: Condition): FeatureOverrides {
  switch (condition.kind) {
    case 'band':
      return { band: condition.band }
    case 'sign':
      return { sign: condition.sign }
    case 'crossedZero':
      return {
        sign: condition.to,
        prevSign: condition.to === 'inflow' ? 'outflow' : 'inflow',
      }
    case 'above':
      return { observed: condition.value + 1 }
    case 'below':
      return { observed: condition.value - 1 }
  }
}

// ── 3. 判定层 ───────────────────────────────────────────

describe('判定层：命中哪一条', () => {
  it('(1) 价格上涨 + 链上走强', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'high', observed: 12 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('combo.price-up-onchain-strong')
  })

  it('(2) 价格上涨 + 链上背离', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'high', observed: 12 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'low', observed: -15 }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('combo.price-up-onchain-diverging')
  })

  it('(3) 价格下跌 + 链上走强', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'low', observed: -12 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('combo.price-down-onchain-strong')
  })

  it('(4) 价格横盘 + 链上低迷', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'mid', observed: 1 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'low', observed: -15 }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('combo.price-sideways-onchain-weak')
  })

  it('(5) 交易所净流入穿越零点', () => {
    const read = readMarketScenario(
      coreTable({
        'exchange.flow7': feat('exchange.flow7', {
          sign: 'inflow',
          prevSign: 'outflow',
          observed: 420,
        }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('exchange.crossing-in')
  })

  it('(6) 多信号互相矛盾时如实说矛盾，不硬挑一个', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'low', observed: -12 }),
        'price.30d': feat('price.30d', { band: 'low', observed: -30 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
        'onchain.tx30': feat('onchain.tx30', { band: 'high', observed: 25 }),
      }),
    )
    expect(read.status).toBe('known')
    expect(read.scenarioId).toBe('conflict.signals-disagree')
    // 冲突时两条信号都要披露，不能只留一条
    expect(read.alsoMatched).toContain('price.decline')
    expect(read.alsoMatched).toContain('onchain.surging')
  })

  it('(7) 关键数据缺失 → unknown，而不是中性', () => {
    const read = readMarketScenario(
      table({
        'price.7d': fail('price.7d', 'missing'),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'mid' }),
      }),
    )
    expect(read.status).toBe('unknown')
    expect(read.scenarioId).toBe('unknown.insufficient-evidence')
    // 关键不是"没有中性结论"，而是别把 fallback 当答案
    expect(read.scenarioId).not.toBe('fallback.no-clear-signal')
    expect(read.exclusions.length).toBeGreaterThan(0)
  })

  it('(8) 数据过期 → unknown', () => {
    const read = readMarketScenario(
      table({
        'price.7d': feat('price.7d', { band: 'high' }),
        'onchain.addresses30': fail('onchain.addresses30', 'expired'),
      }),
    )
    expect(read.status).toBe('unknown')
    expect(read.exclusions.some((e) => e.reason === 'expired')).toBe(true)
  })

  it('(9) 只有一天历史 → unknown', () => {
    const read = readMarketScenario(
      table({
        'price.7d': feat('price.7d', { band: 'high' }),
        'onchain.addresses30': fail('onchain.addresses30', 'insufficient-history'),
      }),
    )
    expect(read.status).toBe('unknown')
    expect(read.exclusions.some((e) => e.reason === 'insufficient-history')).toBe(true)
  })

  it('(10) 多条规则同时命中时按显式优先级取最高的那条', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'high', observed: 12 }),
        'price.30d': feat('price.30d', { band: 'high', observed: 30 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
        'onchain.tx30': feat('onchain.tx30', { band: 'high', observed: 25 }),
      }),
    )
    // 组合场景比单一维度场景更具体，优先级更高
    expect(read.scenarioId).toBe('combo.price-up-onchain-strong')
    // 其余命中的规则也要留着，供详情页与审计核对
    expect(read.alsoMatched).toContain('price.surge')
    expect(read.alsoMatched).toContain('onchain.surging')
  })

  it('一句话里填的是真实观测值', () => {
    const features = coreTable({
      'price.7d': feat('price.7d', { band: 'high', observed: 12.3 }),
      'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
    })
    const read = readMarketScenario(features)
    const zh = marketSentence(read, features, 'zh')
    const en = marketSentence(read, features, 'en')
    expect(zh).toContain('+12.3%')
    expect(en).toContain('+12.3%')
    expect(zh).not.toMatch(/\{/)
  })

  it('参与判定的特征与数据时间都留痕', () => {
    const features = coreTable({
      'price.7d': feat('price.7d', { band: 'high', observed: 12 }),
      'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
    })
    const read = readMarketScenario(features)
    expect(read.participants.length).toBe(2)
    for (const participant of read.participants) {
      expect(participant.asOf).toBeGreaterThan(0)
      expect(participant.metricId).not.toBe('')
    }
  })

  it('两个核心特征缺一个就判不了', () => {
    expect(CORE_FEATURES.length).toBeGreaterThan(0)
    for (const id of CORE_FEATURES) {
      const over: Partial<Record<FeatureId, FeatureResult>> = {}
      for (const core of CORE_FEATURES) {
        over[core] = core === id ? fail(core, 'missing') : feat(core, { band: 'mid' })
      }
      const read = readMarketScenario(table(over))
      expect(read.status, `${id} 缺失时不该给出结论`).toBe('unknown')
    }
  })
})

// ── 4. 从发布快照建表 ───────────────────────────────────

describe('从发布快照建特征表', () => {
  it('参考时刻取所有指标里最新的数据点', () => {
    const now = 1_700_000_000
    const { referenceTs } = buildFeatureTable([
      {
        metricId: 'price',
        points: [
          { ts: now - 2 * DAY, value: 100 },
          { ts: now, value: 110 },
        ],
      } as never,
      {
        metricId: 'active-addresses',
        points: [{ ts: now - DAY, value: 5 }],
      } as never,
    ])
    expect(referenceTs).toBe(now)
  })

  it('最新数据比参考时刻落后太多的指标被判过期，而不是拿旧数讲现在的市场', () => {
    const now = 1_700_000_000
    // 活跃地址停在 30 天前；参考时刻由另一个更新的指标决定
    const points: SeriesPoint[] = Array.from({ length: 400 }, (_, i) => ({
      ts: now - 430 * DAY + i * DAY,
      value: 100 + i,
    }))
    const { features } = buildFeatureTable([
      { metricId: 'active-addresses', points } as never,
      {
        metricId: 'price-change-7d',
        points: [{ ts: now, value: 1 }],
      } as never,
    ])
    const addresses = features['onchain.addresses30']
    expect(addresses.ok).toBe(false)
    if (addresses.ok) return
    expect(addresses.reason.reason).toBe('expired')
  })
})

// ── 5. 展示语义：市场状态卡片的底色 ─────────────────────

/**
 * 底色只跟着**结论**走，不跟着文案走。
 *
 * 这一组断言守的是三件事：
 * 1. 颜色来自规则的结构化结果（方向族 + 写明理由的例外），不是匹配句子里的词；
 * 2. "当前偏强"（位置）与"正在改善"（变化）不是一回事；
 * 3. 判不了与信号冲突都不许被染色。
 */
describe('展示语义：市场状态卡片的底色', () => {
  it('每条规则都有展示语义，且只有三档', () => {
    for (const scenario of SCENARIOS) {
      expect(['improving', 'deteriorating', 'neutral']).toContain(toneOf(scenario))
    }
  })

  it('方向族决定底色，只有两条写明理由的例外', () => {
    // 例外是"交易所净流入的方向反转"：方向族为冲突判定服务，
    // 而流入交易所（代币流向卖方）是恶化，与同族的净流入尖峰一致。
    for (const scenario of SCENARIOS) {
      const expected =
        scenario.id === 'exchange.crossing-in'
          ? 'deteriorating'
          : scenario.id === 'exchange.crossing-out'
            ? 'improving'
            : scenario.family === 'bull'
              ? 'improving'
              : scenario.family === 'bear'
                ? 'deteriorating'
                : 'neutral'
      expect(toneOf(scenario), `${scenario.id} 的展示语义与它的方向族对不上`).toBe(expected)
    }
  })

  it('"当前偏强"不等于"正在改善"：只用水平分位的规则一律中性', () => {
    // 水平分位说的是"这个数现在处在自己历史的什么位置"，
    // 它不包含任何"正在变好/变差"的证据。
    const levelFeatures = FEATURE_SPECS.filter((s) => s.kind === 'levelPercentile').map((s) => s.id)
    expect(levelFeatures.length).toBeGreaterThan(0)
    for (const scenario of SCENARIOS) {
      const usesLevel = scenario.conditions.some((c) => levelFeatures.includes(c.feature))
      if (!usesLevel) continue
      expect(toneOf(scenario), `${scenario.id} 拿位置当依据，不能染色`).toBe('neutral')
    }
  })

  it('染色必须有时间序列比较依据：判据里的特征都得是变化量', () => {
    const changeFeatures = new Set(
      FEATURE_SPECS.filter((s) => s.kind !== 'levelPercentile').map((s) => s.id),
    )
    for (const scenario of SCENARIOS) {
      if (toneOf(scenario) === 'neutral') continue
      for (const condition of scenario.conditions) {
        expect(
          changeFeatures.has(condition.feature),
          `${scenario.id} 的判据 ${condition.feature} 不是变化量，染色的依据不成立`,
        ).toBe(true)
      }
    }
  })

  it('命中改善规则时读数是 improving', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'high', observed: 12 }),
        'price.30d': feat('price.30d', { band: 'high', observed: 30 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
      }),
    )
    expect(read.scenarioId).toBe('combo.price-up-onchain-strong')
    expect(read.tone).toBe('improving')
  })

  it('命中恶化规则时读数是 deteriorating', () => {
    // 价格横盘而链上活跃度低迷：条件本身在变差（方向族 bear）
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'mid', observed: 0.4 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'low', observed: -30 }),
      }),
    )
    expect(read.scenarioId).toBe('combo.price-sideways-onchain-weak')
    expect(read.tone).toBe('deteriorating')
  })

  it('信号冲突是中性：两个方向相反的信号在场时判不出改善还是恶化', () => {
    const read = readMarketScenario(
      coreTable({
        'price.7d': feat('price.7d', { band: 'low', observed: -12 }),
        'price.30d': feat('price.30d', { band: 'low', observed: -30 }),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'high', observed: 20 }),
        'onchain.tx30': feat('onchain.tx30', { band: 'high', observed: 25 }),
      }),
    )
    expect(read.scenarioId).toBe('conflict.signals-disagree')
    expect(read.tone).toBe('neutral')
  })

  it('判不了是中性：没有数据时不能编一个方向出来', () => {
    const read = readMarketScenario(
      table({
        'price.7d': fail('price.7d', 'missing'),
        'onchain.addresses30': feat('onchain.addresses30', { band: 'mid' }),
      }),
    )
    expect(read.status).toBe('unknown')
    expect(read.tone).toBe('neutral')
  })

  it('常态兜底是中性', () => {
    const read = readMarketScenario(coreTable())
    expect(read.scenarioId).toBe('fallback.no-clear-signal')
    expect(read.tone).toBe('neutral')
  })
})
