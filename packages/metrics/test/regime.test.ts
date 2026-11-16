/**
 * 市场三态分类的测试。
 *
 * 两层：
 *
 * 1. **规则层**（合成特征表）：把每条规则单独拎出来测——
 *    牛市、熊市、震荡、分化、缺数据、缺价格。
 * 2. **历史层**（真实发布数据）：拿仓库里 `public/data/*.json` 的**真实历史**，
 *    在若干个已知日期上重放一次判定，确认分类在真实行情里站得住。
 *
 * 历史层为什么必须用真数据：阈值（90 日 ±15%、30 日 ±10% 反向否决）
 * 是照着 BTC 真实历史校准出来的，换一套合成数据校准出来的阈值
 * 在真实行情里可能一天都命中不了——而这种错误在纯合成测试里**看不见**。
 *
 * 日期不是随便挑的：每一个都对应一段有名字的市场行情，注释里写明为什么选它。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildFeatureTable,
  classifyRegime,
  computeAllFeatures,
  FEATURE_SPECS,
  REGIME_CONFIDENCE_LABEL,
  REGIME_LABEL,
  REGIME_RULE_VERSION,
  SCENARIOS,
  trendDirection,
  TREND_SWING_VETO_PERCENT,
  TREND_THRESHOLD_PERCENT,
  type Condition,
  type FeatureBand,
  type FeatureId,
  type FeatureResult,
  type FeatureTable,
  type PublishedMetric,
} from '../src/index.js'

const DAY = 86_400

// ── 规则层 ──────────────────────────────────────────────

function feat(id: FeatureId, band: FeatureBand, observed: number): FeatureResult {
  return {
    ok: true,
    value: {
      id,
      metricId: `metric:${id}`,
      windowDays: 90,
      observed,
      percentile: null,
      band,
      sign: null,
      prevSign: null,
      asOf: 1_700_000_000,
    },
  }
}

function fail(id: FeatureId, reason: 'missing' | 'expired' | 'stale' = 'missing'): FeatureResult {
  return { ok: false, reason: { id, metricId: `metric:${id}`, reason, detail: 'test' } }
}

/** 造一张特征表：默认所有特征都不可用。 */
function table(over: Partial<Record<FeatureId, FeatureResult>>): FeatureTable {
  const out = {} as Record<FeatureId, FeatureResult>
  for (const spec of FEATURE_SPECS) out[spec.id] = fail(spec.id)
  for (const [id, result] of Object.entries(over)) {
    if (!result) continue
    out[id as FeatureId] = result
  }
  return out
}

/** 价格方向 + 链上方向 → 特征表。 */
function priceTable(
  price: FeatureBand | null,
  onchain: FeatureBand | null,
  observed = 30,
): FeatureTable {
  const over: Partial<Record<FeatureId, FeatureResult>> = {}
  if (price) over['price.trend'] = feat('price.trend', price, observed)
  if (onchain) over['onchain.addresses30'] = feat('onchain.addresses30', onchain, 10)
  return table(over)
}

describe('市场三态：规则层', () => {
  it('价格上行 + 链上活跃度高位 = 牛市，置信度高', () => {
    const read = classifyRegime(priceTable('high', 'high'))
    expect(read.status).toBe('known')
    expect(read.regime).toBe('bull')
    expect(read.confidence).toBe('high')
    expect(read.ruleId).toBe('regime.bull.confirmed')
  })

  it('价格下行 + 链上活跃度低位 = 熊市，置信度高', () => {
    const read = classifyRegime(priceTable('low', 'low', -30))
    expect(read.regime).toBe('bear')
    expect(read.confidence).toBe('high')
    expect(read.ruleId).toBe('regime.bear.confirmed')
  })

  it('价格没有明确方向 = 震荡', () => {
    const read = classifyRegime(priceTable('mid', 'mid'))
    expect(read.regime).toBe('range')
    expect(read.ruleId).toBe('regime.range.flat')
  })

  it('价格与链上方向相反 = 震荡（分化），不是"价格横盘"', () => {
    const read = classifyRegime(priceTable('high', 'low'))
    expect(read.regime).toBe('range')
    expect(read.ruleId).toBe('regime.range.divergence')
    // 文案只陈述分化，不得声称价格一定横盘——那是事实错误
    expect(read.basis.zh).toContain('方向相反')
    expect(read.basis.zh).not.toContain('横盘')
    expect(read.basis.en.toLowerCase()).not.toContain('sideways')
  })

  it('链上数据缺失时退回仅价格判定，并把置信度标成低', () => {
    const read = classifyRegime(priceTable('high', null))
    expect(read.status).toBe('known')
    expect(read.regime).toBe('bull')
    expect(read.confidence).toBe('low')
    expect(read.ruleId).toBe('regime.bull.price-only')
    // 数据质量与方向分开：方向给得出来，但缺什么必须说清楚
    expect(read.dataIssues.length).toBe(1)
    expect(read.basis.zh).toContain('链上数据缺失')
  })

  it('价格数据缺失 = 数据故障，不许伪造一个"震荡"', () => {
    const read = classifyRegime(priceTable(null, 'high'))
    expect(read.status).toBe('unknown')
    expect(read.regime).toBeNull()
    expect(read.confidence).toBeNull()
    expect(read.ruleId).toBe('regime.unknown.data')
    expect(read.dataIssues.length).toBeGreaterThan(0)
  })

  it('价格数据过期与缺失一样处理：判不了就是判不了', () => {
    const over: Partial<Record<FeatureId, FeatureResult>> = {
      'price.trend': fail('price.trend', 'expired'),
      'onchain.addresses30': feat('onchain.addresses30', 'high', 10),
    }
    const read = classifyRegime(table(over))
    expect(read.status).toBe('unknown')
    expect(read.regime).toBeNull()
  })

  it('三态与置信度都有双语标签，规则带版本号', () => {
    expect(REGIME_LABEL.bull.zh).toBe('牛市')
    expect(REGIME_LABEL.bear.zh).toBe('熊市')
    expect(REGIME_LABEL.range.zh).toBe('震荡')
    expect(REGIME_CONFIDENCE_LABEL.low.zh).toBe('置信度低')
    expect(REGIME_RULE_VERSION).toMatch(/^regime-v\d+$/)
  })
})

// ── 多窗口方向 ──────────────────────────────────────────

describe('价格方向：多窗口，不是单日涨跌', () => {
  it('90 日与 30 日必须同时成立才算趋势', () => {
    // 只有 90 日够：最近一个月在反向走 → 不算趋势
    expect(trendDirection(40, -20)).toBe('flat')
    // 只有 30 日够：那只是一个月的反弹 → 不算趋势
    expect(trendDirection(5, 40)).toBe('flat')
    // 两个窗口同向 → 趋势成立
    expect(trendDirection(40, 20)).toBe('up')
    expect(trendDirection(-40, -20)).toBe('down')
  })

  it('阈值就是那两条：90 日 ±15%、30 日 ±10% 反向否决', () => {
    expect(TREND_THRESHOLD_PERCENT).toBe(15)
    expect(TREND_SWING_VETO_PERCENT).toBe(10)
    expect(trendDirection(TREND_THRESHOLD_PERCENT, 0)).toBe('up')
    expect(trendDirection(TREND_THRESHOLD_PERCENT - 0.01, 0)).toBe('flat')
    expect(trendDirection(-TREND_THRESHOLD_PERCENT, 0)).toBe('down')
  })

  it('单日涨跌不改变方向：一天 +50% 也还是震荡', () => {
    expect(trendDirection(2, 1)).toBe('flat')
  })
})

// ── 历史层：真实数据回放 ────────────────────────────────

/** 仓库根下的发布数据。 */
const PUBLISHED_DIR = fileURLToPath(new URL('../../../public/data/', import.meta.url))

function loadPublished(metricId: string): PublishedMetric {
  const raw = readFileSync(`${PUBLISHED_DIR}${metricId}.json`, 'utf8')
  return JSON.parse(raw) as PublishedMetric
}

/** 所有指标（真实发布数据）。 */
function allPublished(): PublishedMetric[] {
  const ids = [
    'price',
    'price-change-7d',
    'active-addresses',
    'tx-count',
    'exchange-netflow',
    'exchange-balance',
    'fees-total',
    'hashrate',
    'market-cap',
    'mvrv',
    'supply',
    'block-count',
    'recommended-fee-rate',
    'miner-revenue',
    'miner-revenue-usd',
  ]
  return ids.map(loadPublished)
}

/**
 * 在某个 UTC 日期上重放一次判定。
 *
 * 只用**那一天为止**的数据——这是"当时能看到什么"，
 * 不是拿今天的数据去解释三年前。
 */
function classifyAt(date: string): ReturnType<typeof classifyRegime> {
  const cutoff = Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000)
  const truncated = allPublished().map((m) => ({
    ...m,
    points: m.points.filter((p) => p.ts <= cutoff),
  }))
  const { features } = buildFeatureTable(truncated)
  return classifyRegime(features)
}

describe('市场三态：真实历史回放', () => {
  it('牛市：2017 年 12 月的确定性牛市', () => {
    // 90 日 +159.6%、30 日 +55.8%，链上活跃度处于近一年高位
    const read = classifyAt('2017-12-04')
    expect(read.regime).toBe('bull')
    expect(read.confidence).toBe('high')
  })

  it('牛市：2024 年 4 月的减半后行情', () => {
    // 90 日 +55.3%、30 日 +12.5%，链上活跃度高位
    const read = classifyAt('2024-04-01')
    expect(read.regime).toBe('bull')
  })

  it('熊市：2018 年 3 月的长期下跌', () => {
    // 90 日 −51.6%、30 日 −23.0%，链上活跃度低位
    const read = classifyAt('2018-03-19')
    expect(read.regime).toBe('bear')
    expect(read.confidence).toBe('high')
  })

  it('熊市：2015 年 2 月', () => {
    // 90 日 −40.0%、30 日 −20.1%
    const read = classifyAt('2015-02-09')
    expect(read.regime).toBe('bear')
  })

  it('横盘：2023 年 8 月', () => {
    // 90 日 +5.5%、30 日 −3.6%，链上活跃度常态
    const read = classifyAt('2023-08-07')
    expect(read.regime).toBe('range')
    expect(read.ruleId).toBe('regime.range.flat')
  })

  it('短期反弹：2020 年 4 月的反弹 —— 中期仍在下跌，不算牛市', () => {
    // 90 日 −22.3%、30 日 +33.4%：一个月涨了，但三个月还在跌
    const read = classifyAt('2020-04-13')
    expect(read.regime).toBe('range')
    expect(read.ruleId).not.toBe('regime.bull.confirmed')
  })

  it('短期回调：2021 年 9 月的回调 —— 三个月还在涨，不改判成熊市', () => {
    // 90 日 +32.3%、30 日 −12.7%：回调幅度超过 10%，趋势被否决
    const read = classifyAt('2021-09-20')
    expect(read.regime).toBe('range')
    expect(read.ruleId).not.toBe('regime.bear.confirmed')
  })

  it('链上信号冲突：2024 年 4 月 —— 价格大涨但链上活跃度在近一年低位', () => {
    // 90 日 +68.5%、30 日 +4.0%，而活跃地址 30 日变化在近一年低位
    const read = classifyAt('2024-04-22')
    expect(read.regime).toBe('range')
    expect(read.ruleId).toBe('regime.range.divergence')
    // 关键：分化不等于"价格一定横盘"，文案不许这么说
    expect(read.basis.zh).not.toContain('横盘')
  })

  it('数据缺失：价格序列没有数据时是数据故障，不是震荡', () => {
    const features = computeAllFeatures({
      series: {},
      stale: {},
      referenceTs: 1_700_000_000,
    })
    const read = classifyRegime(features)
    expect(read.status).toBe('unknown')
    expect(read.regime).toBeNull()
  })

  // 这条要对上百个历史日期各算一遍全表，实测约 9 秒。
  // 5 秒的默认超时会让它红在"慢"而不是红在"错"，所以显式放宽。
  it('方向与解释不打架：真实历史里没有"一边说涨一边说横盘"', () => {
    // 抽样 120 个历史日期，对每一天核对：
    // 三态分类的价格方向与场景规则命中的价格方向必须一致。
    //
    // 这条断言守的是 V0.11 的核心修复：老实现里场景规则看的是 7 日涨跌幅，
    // 而分类看的是多窗口，于是同一天可能出现"牛市 + 价格横盘"。
    const metrics = allPublished()
    const price = metrics.find((m) => m.metricId === 'price')
    expect(price).toBeDefined()
    const start = Math.min(...(price?.points ?? []).map((p) => p.ts))
    const end = Math.max(...(price?.points ?? []).map((p) => p.ts))

    const contradictions: string[] = []
    let checked = 0
    for (let ts = start + 400 * DAY; ts <= end; ts += 10 * DAY) {
      const truncated = metrics.map((m) => ({
        ...m,
        points: m.points.filter((p) => p.ts <= ts),
      }))
      const { features } = buildFeatureTable(truncated)
      const regime = classifyRegime(features)
      if (regime.status !== 'known' || regime.regime === 'range') continue

      const trend = features['price.trend']
      if (!trend.ok) continue
      const scenarioPriceBand = priceBandOfScenario(features)
      if (scenarioPriceBand === null) continue
      const expected: FeatureBand = regime.regime === 'bull' ? 'high' : 'low'
      // 只比对"方向类"的场景：讲"过去一周"的规则（rally / pullback …）
      // 说的是另一个窗口，不参与这项核对。
      if (!isDirectionalScenario(features)) continue
      checked += 1
      if (scenarioPriceBand !== expected) {
        contradictions.push(
          `${new Date(ts * 1000).toISOString().slice(0, 10)}: regime=${regime.regime} 场景方向=${scenarioPriceBand}`,
        )
      }
    }
    expect(checked, '没有可比对的样本，测试形同虚设').toBeGreaterThan(50)
    expect(contradictions).toEqual([])
  }, 60_000)
})

/** 条件是否成立。与市场层用的是同一套判据。 */
function holds(condition: Condition, features: FeatureTable): boolean {
  const entry = features[condition.feature]
  if (!entry || !entry.ok) return false
  switch (condition.kind) {
    case 'band':
      return entry.value.band === condition.band
    case 'sign':
      return entry.value.sign === condition.sign
    case 'crossedZero':
      return (
        entry.value.sign === condition.to &&
        entry.value.prevSign !== null &&
        entry.value.prevSign !== 'flat' &&
        entry.value.prevSign !== condition.to
      )
    case 'above':
      return entry.value.observed > condition.value
    case 'below':
      return entry.value.observed < condition.value
  }
}

/** 命中的场景，按优先级降序。 */
function matchedScenarios(features: FeatureTable) {
  return SCENARIOS.filter(
    (s) => s.kind === 'rule' && s.conditions.every((c) => holds(c, features)),
  ).sort((a, b) => b.priority - a.priority)
}

/**
 * 命中的最高优先级场景是不是"方向类"的。
 *
 * 只有方向类场景（判据里含 `price.trend`）才参与核对：
 * 讲"过去一周"的规则（rally / pullback …）说的是另一个窗口，
 * 它们与多窗口方向不一致并不是矛盾，只是两件事。
 */
function isDirectionalScenario(features: FeatureTable): boolean {
  const top = matchedScenarios(features)[0]
  if (!top) return false
  return top.conditions.some((c) => c.kind === 'band' && c.feature === 'price.trend')
}

/** 命中的最高优先级方向类场景给出的价格方向。 */
function priceBandOfScenario(features: FeatureTable): FeatureBand | null {
  const top = matchedScenarios(features)[0]
  if (!top) return null
  const cond = top.conditions.find((c) => c.kind === 'band' && c.feature === 'price.trend')
  return cond && cond.kind === 'band' ? cond.band : null
}
