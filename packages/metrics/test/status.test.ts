/**
 * "当前状态"列的测试。
 *
 * 这一列是全站唯一允许染色的数据含义，也是最容易悄悄说错话的地方：
 * 一个词从"净流入"变成"该卖"、或者在算不出来的时候悄悄变成"中性"，
 * 页面上都只是一次颜色变化，运行时不会有任何报错。
 *
 * 所以这里守的不是渲染，是**判定与用词**：
 * - 每个状态词 ≤ 3 个汉字，且不含投资建议；
 * - 每个词的判定依据存在、能算得出、且三档都真的打得到；
 * - 有符号的量先说方向，方向与价格相反时才说背离；
 * - 算不出来就是"缺数据"，带原因，不许降级成"中性"。
 */

import { describe, expect, it } from 'vitest'

import {
  deriveAllStatuses,
  deriveStatus,
  FEATURE_SPEC_BY_ID,
  HOME_METRIC_IDS,
  statusBasis,
  statusReason,
  statusWord,
  STATUS_SPECS,
  type FeatureBand,
  type FeatureId,
  type FeatureObservation,
  type FeatureResult,
  type FeatureSign,
  type FeatureTable,
  type MetricStatus,
} from '../src/index.js'

/** 造一条成功的观测值。 */
function val(overrides: Partial<FeatureObservation> = {}): FeatureObservation {
  return {
    id: 'price.level365',
    metricId: 'price',
    windowDays: 1,
    observed: 1,
    percentile: 0.5,
    band: 'mid',
    sign: null,
    prevSign: null,
    asOf: 1_700_000_000,
    ...overrides,
  }
}

/** 造一个成功的结果，用于把分支逐个走到。 */
function obs(overrides: Partial<FeatureObservation> = {}): FeatureResult {
  return { ok: true, value: val(overrides) }
}

function table(entries: Partial<Record<FeatureId, FeatureResult>>): FeatureTable {
  const out = {} as Record<FeatureId, FeatureResult>
  for (const id of Object.keys(FEATURE_SPEC_BY_ID) as FeatureId[]) out[id] = obs({ id })
  for (const [id, result] of Object.entries(entries)) {
    out[id as FeatureId] = result
  }
  return out
}

/** 只保留指定的键，其余特征一律标为失败——这样测到的就是"这个分支真的被走到了"。 */
function only(entries: Record<string, FeatureResult | undefined>): FeatureTable {
  const out = {} as Record<FeatureId, FeatureResult>
  for (const id of Object.keys(FEATURE_SPEC_BY_ID) as FeatureId[]) {
    out[id] = {
      ok: false,
      reason: { id, metricId: 'x', reason: 'missing', detail: '本用例不关心这个特征' },
    }
  }
  for (const [id, result] of Object.entries(entries)) {
    if (result) out[id as FeatureId] = result
  }
  return out
}

const BANDS: readonly FeatureBand[] = ['low', 'mid', 'high']

describe('状态词表本身', () => {
  it('每个判定的依据特征都真实存在', () => {
    for (const spec of STATUS_SPECS) {
      expect(FEATURE_SPEC_BY_ID[spec.featureId], `${spec.metricId} 指向了不存在的特征`).toBeDefined()
    }
  })

  it('metricId 不重复', () => {
    const ids = STATUS_SPECS.map((s) => s.metricId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('中文状态词不超过 3 个字', () => {
    for (const spec of STATUS_SPECS) {
      const words = [spec.words[0], spec.words[1], spec.words[2]]
      if (spec.flow) words.push(spec.flow.inflow, spec.flow.outflow, spec.flow.flat)
      if (spec.divergence) words.push(spec.divergence.word)
      for (const w of words) {
        // 用码点数算长度：汉字与标点都算一个字，"—" 也是一个
        expect([...w.zh].length, `${spec.metricId} 的 "${w.zh}" 超过 3 字`).toBeLessThanOrEqual(3)
        expect(w.zh.length, `${spec.metricId} 的 "${w.zh}" 为空`).toBeGreaterThan(0)
        expect(w.en.length, `${spec.metricId} 的英文状态词为空`).toBeGreaterThan(0)
      }
    }
  })

  it('状态词不是投资建议，也不含评级式的结论', () => {
    const banned = [/适合定投/, /该定投/, /该买/, /该卖/, /可以买/, /底部/, /顶部/, /超买/, /超卖/, /good time to buy/]
    for (const spec of STATUS_SPECS) {
      const words = [spec.words[0], spec.words[1], spec.words[2]]
      if (spec.flow) words.push(spec.flow.inflow, spec.flow.outflow, spec.flow.flat)
      if (spec.divergence) words.push(spec.divergence.word)
      for (const w of words) {
        for (const re of banned) {
          expect(`${w.zh} ${w.en}`, `${spec.metricId} 的状态词出现了 ${re}`).not.toMatch(re)
        }
      }
    }
  })

  it('有符号的量声明了方向词，无符号的量不声明', () => {
    const signed = ['exchange.flow7', 'exchange.flow30']
    for (const spec of STATUS_SPECS) {
      if (signed.includes(spec.featureId)) {
        expect(spec.flow, `${spec.metricId} 是有符号量，却没有方向词`).toBeDefined()
      }
    }
    // 净流入必须有方向词，且三个方向互不相同
    const flow = STATUS_SPECS.find((s) => s.metricId === 'exchange-netflow')?.flow
    expect(flow).toBeDefined()
    expect(new Set([flow?.inflow.zh, flow?.outflow.zh, flow?.flat.zh]).size).toBe(3)
  })
})

describe('分位 → 状态词', () => {
  it('三档都打得到，且色档随档位走', () => {
    const spec = STATUS_SPECS.find((s) => s.metricId === 'price')
    expect(spec).toBeDefined()
    if (!spec) return

    const tones: string[] = []
    for (const band of BANDS) {
      const status = deriveStatus(spec, only({ [spec.featureId]: obs({ band, percentile: 0.1 }) }))
      expect(status.ok).toBe(true)
      if (!status.ok) return
      expect(status.via).toBe('band')
      tones.push(status.tone)
      // 分位必须跟着档位一起落在解释里，否则"这个词是怎么来的"无从核对
      expect(statusBasis(status, val({ band, percentile: 0.9 }), 'zh')).toMatch(/P90/)
    }
    expect(tones).toEqual(['cold', 'flat', 'hot'])
  })

  it('"中性"只会由算出来的中档产生，不会由缺失降级而来', () => {
    // 特征失败 → ok:false，页面显示"缺数据"，**不是**"中性"
    const spec = STATUS_SPECS.find((s) => s.metricId === 'tx-count')
    expect(spec).toBeDefined()
    if (!spec) return

    for (const reason of ['missing', 'stale', 'insufficient-history', 'expired', 'uncomputable'] as const) {
      const failed: FeatureResult = {
        ok: false,
        reason: { id: spec.featureId, metricId: spec.metricId, reason, detail: `模拟 ${reason}` },
      }
      const status = deriveStatus(spec, only({ [spec.featureId]: failed }))
      expect(status.ok, `${reason} 竟然算出了状态`).toBe(false)
      if (status.ok) return
      expect(status.reason).toBe(reason)
      expect(status.detail).toBe(`模拟 ${reason}`)
      expect(statusWord(status, 'zh')).toBe('缺数据')
      expect(statusWord(status, 'en')).toBe('no data')
      // 判不出来时解释列说**短原因**，不说一个编出来的分位，
      // 也不把内部 metric id 与长错误信息摆到首页上
      const basis = statusBasis(status, undefined, 'zh')
      expect(basis).toBe(statusReason(status, 'zh'))
      expect(basis).not.toContain(spec.metricId)
      expect(basis).not.toContain('模拟')
      expect(basis.length, `判定依据过长：${basis}`).toBeLessThanOrEqual(6)
    }
  })

  it('判定依据永远短到能放进表格的一行', () => {
    // 判定依据是表格的一列，不是一段话。长的版本会把行高撑成两行，
    // 而首页表格的行高就是这张表的密度。
    const features = only({
      'exchange.flow7': obs({ id: 'exchange.flow7', metricId: 'exchange-netflow', observed: -163, sign: 'outflow', band: 'mid', windowDays: 7 }),
      'price.7d': obs({ id: 'price.7d', observed: 12.3, band: 'high' }),
      'price.level365': obs({ id: 'price.level365', band: 'low', percentile: 0.04 }),
    })
    for (const spec of STATUS_SPECS) {
      const status = deriveStatus(spec, features)
      for (const locale of ['zh', 'en'] as const) {
        const basis = statusBasis(status, undefined, locale)
        // 一行放得下：中文 24 字符 / 英文 40 字符封顶
        const limit = locale === 'zh' ? 24 : 40
        expect(basis.length, `${spec.metricId}/${locale} 的判定依据过长：${basis}`).toBeLessThanOrEqual(limit)
        expect(basis, `${spec.metricId}/${locale} 的判定依据不该是整句`).not.toMatch(/[。；]/)
        // 内部标识与计算口径说明不该出现在首页的一格里
        expect(basis, `${spec.metricId}/${locale} 泄露了内部 metric id`).not.toMatch(/[a-z]+-[a-z]+/)
      }
    }
  })
})

describe('方向 → 状态词', () => {
  const spec = STATUS_SPECS.find((s) => s.metricId === 'exchange-netflow')
  const withFlow = (sign: FeatureSign, observed: number, band: FeatureBand = 'mid'): FeatureTable =>
    only({
      'exchange.flow7': obs({ id: 'exchange.flow7', metricId: 'exchange-netflow', band, observed, sign, percentile: 0.5, windowDays: 7 }),
      // 价格在中间档 → 不构成背离
      'price.7d': obs({ id: 'price.7d', metricId: 'price-change-7d', band: 'mid', observed: 0 }),
    })

  it('净流入与净流出分别给出自己的词', () => {
    expect(spec).toBeDefined()
    if (!spec) return

    const inflow = deriveStatus(spec, withFlow('inflow', 1173))
    expect(inflow.ok && inflow.via).toBe('flow')
    expect(statusWord(inflow, 'zh')).toBe('净流入')
    expect(inflow.ok && inflow.tone).toBe('hot')

    const outflow = deriveStatus(spec, withFlow('outflow', -163))
    expect(statusWord(outflow, 'zh')).toBe('净流出')
    expect(outflow.ok && outflow.tone).toBe('cold')
  })

  it('接近零是"持平"，落在中性而不是冷色', () => {
    expect(spec).toBeDefined()
    if (!spec) return
    const flat = deriveStatus(spec, withFlow('flat', 0))
    expect(statusWord(flat, 'zh')).toBe('持平')
    // 凭空造一个"流出"方向判断，比显示中性更糟
    expect(flat.ok && flat.tone).toBe('flat')
  })

  it('带符号指标的判定依据是"N 日净流入/净流出多少"', () => {
    expect(spec).toBeDefined()
    if (!spec) return
    const status = deriveStatus(spec, withFlow('inflow', 1173))
    expect(statusBasis(status, val({ windowDays: 7, observed: 1173, sign: 'inflow' }), 'zh')).toBe(
      '7日净流入 1,173 BTC',
    )
    expect(statusBasis(status, val({ windowDays: 7, observed: 1173, sign: 'inflow' }), 'en')).toBe(
      '7d inflow 1,173 BTC',
    )
    const out = deriveStatus(spec, withFlow('outflow', -163))
    expect(statusBasis(out, val({ windowDays: 7, observed: -163, sign: 'outflow' }), 'zh')).toBe(
      '7日净流出 163 BTC',
    )
    // 方向靠词表达，不靠正负号——负号在等宽数字里容易被读成"减少"
    expect(statusBasis(out, val({ windowDays: 7, observed: -163, sign: 'outflow' }), 'zh')).not.toContain('−')
  })
})

describe('背离', () => {
  it('涨价 + 币在离开交易所 → 背离，而不是净流出', () => {
    const spec = STATUS_SPECS.find((s) => s.metricId === 'exchange-netflow')
    expect(spec).toBeDefined()
    if (!spec) return

    const features = only({
      'exchange.flow7': obs({ id: 'exchange.flow7', observed: -163, sign: 'outflow', band: 'mid' }),
      // 价格 7 日变化处于高位档 —— 正是 spec 里声明的 againstBand
      'price.7d': obs({ id: 'price.7d', observed: 12.3, band: 'high' }),
    })
    const status = deriveStatus(spec, features)
    expect(status.ok && status.via).toBe('divergence')
    expect(statusWord(status, 'zh')).toBe('背离')
  })

  it('价格不在高位档时，不构成背离', () => {
    const spec = STATUS_SPECS.find((s) => s.metricId === 'exchange-netflow')
    expect(spec).toBeDefined()
    if (!spec) return

    const features = only({
      'exchange.flow7': obs({ id: 'exchange.flow7', observed: -163, sign: 'outflow', band: 'mid' }),
      'price.7d': obs({ id: 'price.7d', observed: 0.1, band: 'mid' }),
    })
    expect(statusWord(deriveStatus(spec, features), 'zh')).toBe('净流出')
  })

  it('参考特征算不出来时，退回方向词而不是猜一个背离', () => {
    const spec = STATUS_SPECS.find((s) => s.metricId === 'exchange-netflow')
    expect(spec).toBeDefined()
    if (!spec) return

    const features = only({
      'exchange.flow7': obs({ id: 'exchange.flow7', observed: -163, sign: 'outflow', band: 'mid' }),
      // price.7d 保持 only() 给的失败结果
    })
    expect(statusWord(deriveStatus(spec, features), 'zh')).toBe('净流出')
  })
})

describe('整表', () => {
  it('首页每个指标都拿到一个状态（此刻全算得出来时）', () => {
    // 用真实长度构造：特征全部落在中间档
    const features = table({})
    const statuses = deriveAllStatuses(STATUS_SPECS, features)
    for (const id of HOME_METRIC_IDS) {
      expect(statuses.has(id), `${id} 没有状态`).toBe(true)
      const status = statuses.get(id)
      expect(status).toBeDefined()
    }
  })

  it('特征全挂时，全表都是"缺数据"而不是"中性"', () => {
    const statuses = deriveAllStatuses(STATUS_SPECS, only({}))
    for (const [id, status] of statuses) {
      expect(status.ok, `${id} 在无数据时给出了状态`).toBe(false)
      expect(statusWord(status as MetricStatus, 'zh')).toBe('缺数据')
    }
  })
})