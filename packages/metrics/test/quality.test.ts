import { describe, expect, it } from 'vitest'

import {
  ContractMismatchError,
  MetricValidationError,
  assertContractCompatible,
  createRegistry,
  defineMetric,
  findDefinitionalLanguage,
  isPlausibleUtcSeconds,
  toUtcSeconds,
  validateMetric,
  type MetricContract,
  type MetricDefinition,
} from '../src/index.js'

/** 合规定义的最小样本，测试里按需局部改写以制造违规 */
const validMetric: MetricDefinition = {
  id: 'active-addresses',
  asset: 'btc',
  category: 'onchain',
  name: { en: 'Active Addresses', zh: '活跃地址数' },
  description: {
    en: 'Unique addresses that were active on the network in a day.',
    zh: '当日在网络上发生过交易行为的去重地址数量。',
  },
  methodology: {
    en: 'Sum of unique addresses with at least one transaction in the UTC calendar day, per the provider.',
    zh: '按 UTC 自然日统计当日至少发生一笔交易的去重地址数量之和。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'count',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: 'n/a',
  },
  sources: [
    {
      provider: 'coin-metrics',
      metric: 'AdrActCnt',
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2009-01-03',
    note: { en: 'Available from source inception.', zh: '自来源上线起可得。' },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
}

const baseContract: MetricContract = validMetric.contract

describe('defineMetric 校验', () => {
  it('接受合规定义', () => {
    expect(() => defineMetric(validMetric)).not.toThrow()
  })

  it('拒绝缺失双语文案', () => {
    const bad: MetricDefinition = {
      ...validMetric,
      methodology: { en: 'x', zh: '' } as typeof validMetric.methodology,
    }
    expect(() => defineMetric(bad)).toThrow(MetricValidationError)
    const err = (() => {
      try {
        defineMetric(bad)
        return null
      } catch (e) {
        return e as MetricValidationError
      }
    })()
    expect(err?.issues.some((i) => i.code === 'localized.methodology.missing')).toBe(true)
  })

  it('拒绝 contract.unit 与 unit 不一致', () => {
    const bad = { ...validMetric, contract: { ...baseContract, unit: 'btc' as const } }
    expect(() => defineMetric(bad)).toThrow(/contract.unit/)
  })

  it('拒绝非法 id 格式', () => {
    expect(() => defineMetric({ ...validMetric, id: 'Active_Addresses' })).toThrow(/id/)
  })

  it('拒绝缺少来源', () => {
    expect(() => defineMetric({ ...validMetric, sources: [] })).toThrow(/来源/)
  })

  it('拒绝非法 availableFrom 格式', () => {
    const bad = {
      ...validMetric,
      history: { ...validMetric.history, availableFrom: '2009/01/03' },
    }
    expect(() => defineMetric(bad)).toThrow(/ISO-8601/)
  })

  it('allowMissingHistory 缺失起点只警告不报错', () => {
    const issues = validateMetric({
      ...validMetric,
      history: { ...validMetric.history, availableFrom: null },
    })
    expect(issues.some((i) => i.code === 'history.availableFrom.unknown' && i.level === 'warning')).toBe(
      true,
    )
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0)
  })
})

describe('实体标签可信度约束', () => {
  it('中文"指的是"被识别为下定义表述', () => {
    const hits = findDefinitionalLanguage({ en: 'x', zh: '本指标指的是巨鲸地址的持仓' })
    expect(hits.some((h) => h.locale === 'zh')).toBe(true)
  })

  it('中文"指标"一词不误报', () => {
    expect(findDefinitionalLanguage({ en: 'x', zh: '该指标统计每日活跃地址数' })).toHaveLength(0)
  })

  it('英文 refers to / defined as 被识别', () => {
    expect(
      findDefinitionalLanguage({ en: 'This refers to cluster labels', zh: 'x' }).length,
    ).toBeGreaterThan(0)
  })

  it('heuristic 来源下出现下定义表述即报错', () => {
    const bad: MetricDefinition = {
      ...validMetric,
      sources: [
        {
          provider: 'coin-metrics',
          metric: 'SplyExNtv',
          auth: 'none',
          labelConfidence: 'heuristic',
        },
      ],
      methodology: {
        en: 'Addresses labeled as exchange by the provider.',
        zh: '本指标指的是交易所地址的持币量。',
      },
    }
    expect(() => defineMetric(bad)).toThrow(/下定义式表述/)
  })

  it('heuristic 来源下合规表述可以通过', () => {
    const ok: MetricDefinition = {
      ...validMetric,
      id: 'exchange-balance',
      unit: 'btc',
      contract: { ...baseContract, unit: 'btc', labelSemantics: 'provider cluster labels' },
      sources: [
        {
          provider: 'coin-metrics',
          metric: 'SplyExNtv',
          auth: 'none',
          labelConfidence: 'heuristic',
        },
      ],
      methodology: {
        en: 'Per the provider cluster labels, sum of balance held by addresses labeled as exchange.',
        zh: '按该数据源的聚类标注口径，统计被标注为交易所地址的持币量之和。',
      },
    }
    expect(() => defineMetric(ok)).not.toThrow()
  })
})

describe('口径契约兼容性', () => {
  it('完全一致时通过', () => {
    expect(() =>
      assertContractCompatible('m', baseContract, { ...baseContract }),
    ).not.toThrow()
  })

  it('单位不同即拒绝', () => {
    expect(() =>
      assertContractCompatible('m', baseContract, { ...baseContract, unit: 'btc' }),
    ).toThrow(ContractMismatchError)
  })

  it('量级不同即拒绝（聪 vs BTC）', () => {
    expect(() =>
      assertContractCompatible('m', baseContract, { ...baseContract, scale: 1e-8 }),
    ).toThrow(/scale/)
  })

  it('时间窗口径不同即拒绝', () => {
    expect(() =>
      assertContractCompatible('m', baseContract, { ...baseContract, window: 'rolling-24h' }),
    ).toThrow(/window/)
  })

  it('标注口径不同即拒绝，且错误信息列出双方', () => {
    try {
      assertContractCompatible('exchange-balance', baseContract, {
        ...baseContract,
        labelSemantics: 'another clustering algorithm',
      })
      expect.unreachable('应当抛出 ContractMismatchError')
    } catch (e) {
      expect(e).toBeInstanceOf(ContractMismatchError)
      expect((e as Error).message).toContain('n/a')
      expect((e as Error).message).toContain('another clustering algorithm')
    }
  })

  it('仅空白/大小写差异视为一致', () => {
    expect(() =>
      assertContractCompatible('m', baseContract, { ...baseContract, labelSemantics: '  N/A ' }),
    ).not.toThrow()
  })
})

describe('注册表', () => {
  it('拒绝重复 id', () => {
    const r = createRegistry([validMetric])
    expect(() => r.register(validMetric)).toThrow(/重复/)
  })

  it('未注册指标访问即失败', () => {
    expect(() => createRegistry([]).get('nope')).toThrow(/未注册/)
  })

  it('检出悬空的 deriveFrom 引用', () => {
    const derived = defineMetric({ ...validMetric, id: 'netflow', deriveFrom: ['missing-metric'] })
    const issues = createRegistry([derived]).validate()
    expect(issues.some((i) => i.code === 'deriveFrom.unknown')).toBe(true)
  })

  it('检出跨资产的派生引用', () => {
    const btc = defineMetric(validMetric)
    const eth = defineMetric({ ...validMetric, id: 'eth-metric', asset: 'eth' })
    const derived = defineMetric({
      ...validMetric,
      id: 'netflow',
      deriveFrom: ['active-addresses', 'eth-metric'],
    })
    const issues = createRegistry([btc, eth, derived]).validate()
    expect(issues.some((i) => i.code === 'deriveFrom.asset')).toBe(true)
  })
})

describe('UTC 时间归一', () => {
  /** 2026-10-19T00:00:00Z 的纪元秒 */
  const OCT_19_2026 = Date.parse('2026-10-19T00:00:00Z') / 1000

  it('接受带 Z 的 ISO 串', () => {
    expect(toUtcSeconds('2026-10-19T00:00:00Z')).toBe(OCT_19_2026)
  })

  it('无时区后缀按 UTC 解析，不落到本地时区', () => {
    expect(toUtcSeconds('2026-10-19T00:00:00')).toBe(OCT_19_2026)
  })

  it('拒绝秒/毫秒混用造成的越界值', () => {
    expect(() => toUtcSeconds(OCT_19_2026 * 1000)).toThrow(/毫秒/)
  })

  it('拒绝无法解析的时间', () => {
    expect(() => toUtcSeconds('not-a-date')).toThrow()
  })

  it('合理性检查覆盖创世区块至今', () => {
    expect(isPlausibleUtcSeconds(1230768000)).toBe(true)
    expect(isPlausibleUtcSeconds(0)).toBe(false)
    expect(isPlausibleUtcSeconds(Number.NaN)).toBe(false)
  })
})
