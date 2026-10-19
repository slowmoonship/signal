/**
 * 指标定义回归测试。
 *
 * 这些断言看起来琐碎，但每一条都对应一次真实的翻车方式：
 * 漏一种语言、拼错上游指标名、把启发式标注写成事实、
 * 派生指标排在父指标前面导致抓到空序列。
 */

import { describe, expect, it } from 'vitest'

import {
  btcMetrics,
  findDefinitionalLanguage,
  LABEL_SEMANTICS,
  registry,
  UNIT_LABELS,
  type MetricDefinition,
} from '../src/index.js'

const byId = new Map(btcMetrics.map((d) => [d.id, d]))

describe('注册表', () => {
  it('BTC 指标共 18 个（PLAN §2.2）', () => {
    expect(registry.byAsset('btc')).toHaveLength(18)
  })

  it('id 唯一且全部为小写连字符', () => {
    const ids = btcMetrics.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('全表校验无 error', () => {
    const errors = registry.validate().filter((i) => i.level === 'error')
    expect(errors).toEqual([])
  })

  it('分类分布为 market 4 / onchain 5 / fees 5 / mining 4', () => {
    const counts = Object.fromEntries(
      registry.grouped('btc').map((g) => [g.category, g.metrics.length]),
    )
    expect(counts).toEqual({ market: 4, onchain: 5, fees: 5, mining: 4 })
  })

  it('未注册 ETH / SOL 指标', () => {
    expect(registry.byAsset('eth')).toHaveLength(0)
    expect(registry.byAsset('sol')).toHaveLength(0)
  })
})

describe('双语文案齐全', () => {
  const LOCALIZED_FIELDS = ['name', 'description', 'methodology'] as const

  it('name / description / methodology 均中英双语且非空', () => {
    for (const def of btcMetrics) {
      for (const field of LOCALIZED_FIELDS) {
        expect(def[field].en.trim(), `${def.id}.${field}.en`).not.toBe('')
        expect(def[field].zh.trim(), `${def.id}.${field}.zh`).not.toBe('')
      }
    }
  })

  it('中英文案不是互相抄写的同一句', () => {
    for (const def of btcMetrics) {
      expect(def.name.zh, `${def.id} 中英文名相同`).not.toBe(def.name.en)
    }
  })

  it('历史说明双语齐全', () => {
    for (const def of btcMetrics) {
      expect(def.history.note.en.trim(), def.id).not.toBe('')
      expect(def.history.note.zh.trim(), def.id).not.toBe('')
    }
  })
})

describe('实体标签不得写成事实', () => {
  /** 依赖交易所 / 矿池等实体标注的指标 */
  const heuristicIds = btcMetrics
    .filter((d) => d.sources.some((s) => s.labelConfidence === 'heuristic'))
    .map((d) => d.id)

  it('至少覆盖交易所与矿池两类', () => {
    expect(heuristicIds).toContain('exchange-netflow')
    expect(heuristicIds).toContain('pool-concentration')
  })

  it('每个 heuristic 指标的来源都声明了 heuristic 置信度', () => {
    for (const id of heuristicIds) {
      const def = byId.get(id)
      expect(def, id).toBeDefined()
      for (const src of def?.sources ?? []) {
        expect(src.labelConfidence, `${id}/${src.metric ?? '?'}`).toBe('heuristic')
      }
    }
  })

  it('heuristic 指标的文案说明来源是数据源自己的标注', () => {
    // 校验器只拦"下定义式"表述；这里补上正面要求：
    // 读者必须能看出这是谁的归类。
    for (const id of heuristicIds) {
      const def = byId.get(id)
      expect(def, id).toBeDefined()
      for (const locale of ['en', 'zh'] as const) {
        const text = def ? `${def.description[locale]} ${def.methodology[locale]}` : ''
        expect(text.length, `${id}.${locale}`).toBeGreaterThan(50)
      }
    }
  })

  it('无 heuristic 标注的指标不出现下定义式表述', () => {
    // 反向检查：客观统计类指标即使写了"指的是"也是错的表述，
    // 因为它会暗示来源在给概念下定义。
    for (const def of btcMetrics) {
      const isHeuristic = def.sources.some((s) => s.labelConfidence === 'heuristic')
      if (isHeuristic) continue
      expect(findDefinitionalLanguage(def.methodology), def.id).toEqual([])
    }
  })
})

describe('派生指标', () => {
  it('price-change-7d 声明了父指标与推导方式', () => {
    const def = byId.get('price-change-7d')
    expect(def?.deriveFrom).toEqual(['price'])
    expect(def?.derivation).toEqual({ kind: 'percentChange', base: 'price', windowDays: 7 })
  })

  it('exchange-netflow 的两条上游序列都写进了 sources', () => {
    const def = byId.get('exchange-netflow')
    const metrics = (def?.sources ?? []).map((s) => s.metric)
    expect(metrics).toContain('FlowInExNtv')
    expect(metrics).toContain('FlowOutExNtv')
    expect(def?.derivation).toEqual({
      kind: 'difference',
      left: 'FlowInExNtv',
      right: 'FlowOutExNtv',
    })
  })

  it('父指标在派生指标之前排列（抓取按注册顺序执行）', () => {
    const order = new Map(btcMetrics.map((d, i) => [d.id, i]))
    for (const def of btcMetrics) {
      for (const parent of def.deriveFrom ?? []) {
        const at = order.get(parent)
        expect(at, `未注册的父指标 ${parent}`).toBeDefined()
        expect(at as number).toBeLessThan(order.get(def.id) as number)
      }
    }
  })

  it('声明了派生就必须说清依赖哪些序列', () => {
    for (const def of btcMetrics) {
      if (!def.derivation) continue
      // 依赖本注册表内的指标 → 写进 deriveFrom；
      // 依赖同源的两条上游序列 → sources 必须把它们都列出来。
      const parents = def.deriveFrom ?? []
      const upstream = def.sources.map((s) => s.metric)
      const covered =
        (parents.length > 0 && def.derivation.kind === 'percentChange') ||
        (upstream.length > 1 && def.derivation.kind === 'difference')
      expect(covered, `${def.id} 的 derivation 没有对应依赖声明`).toBe(true)
    }
  })
})

describe('来源与口径', () => {
  it('每个指标至少一个来源，且写明上游指标名以便核查', () => {
    for (const def of btcMetrics) {
      expect(def.sources.length, def.id).toBeGreaterThan(0)
      for (const src of def.sources) {
        expect(src.provider.trim(), def.id).not.toBe('')
        expect(src.metric?.trim(), `${def.id} 的来源缺少上游指标名`).not.toBe('')
      }
    }
  })

  it('免费来源不得声明需要 key（未配置 key 时会降级）', () => {
    for (const def of btcMetrics) {
      for (const src of def.sources) {
        expect(src.auth, `${def.id}/${src.metric ?? '?'}`).toBe('none')
      }
    }
  })

  it('所有指标的 labelSemantics 都取自语表', () => {
    // 词表本身也要合法：适配器与定义都从这里取，漏登记就意味着
    // 某处手写了字符串，契约全等比对会因此中止抓取。
    const known: ReadonlySet<string> = new Set<string>(Object.values(LABEL_SEMANTICS))
    for (const def of btcMetrics) {
      expect(known.has(def.contract.labelSemantics), `${def.id} 的 labelSemantics 未登记`).toBe(
        true,
      )
    }
  })

  it('exchange 指标的契约语义与 heuristic 来源一致', () => {
    for (const id of ['exchange-netflow', 'exchange-balance']) {
      const def = byId.get(id) as MetricDefinition
      expect(def.sources.every((s) => s.labelConfidence === 'heuristic'), id).toBe(true)
      expect(def.contract.labelSemantics, id).not.toBe('n/a')
    }
  })

  it('缺数据策略只能是 null（禁止隐式填零）', () => {
    for (const def of btcMetrics) expect(def.missingPolicy).toBe('null')
  })

  it('全部为日频（ADR-004）', () => {
    for (const def of btcMetrics) expect(def.frequency).toBe('1d')
  })
})

describe('单位', () => {
  it('每个 unit 都有双语标签', () => {
    for (const def of btcMetrics) {
      const labels = UNIT_LABELS[def.unit]
      expect(labels, `unit ${def.unit} 缺少标签`).toBeDefined()
      expect(typeof labels.en).toBe('string')
      expect(typeof labels.zh).toBe('string')
    }
  })

  it('unit 与 contract.unit 一致', () => {
    for (const def of btcMetrics) expect(def.contract.unit).toBe(def.unit)
  })
})

describe('变化列窗口', () => {
  it('只能是省略、正整数或 null', () => {
    for (const def of btcMetrics) {
      const w = def.changeWindowDays
      if (w === undefined || w === null) continue
      expect(Number.isInteger(w), `${def.id} 的 changeWindowDays 非整数`).toBe(true)
      expect(w, `${def.id} 的 changeWindowDays 非正数`).toBeGreaterThanOrEqual(1)
    }
  })

  it('本身就是变化量的指标必须关掉变化列', () => {
    // 对"7 日变化"再算一次变化，得到的是读者没问的问题
    for (const def of btcMetrics) {
      if (def.derivation?.kind !== 'percentChange') continue
      expect(def.changeWindowDays, `${def.id} 应对变化列置 null`).toBeNull()
    }
  })

  it('关闭变化列的只有两种理由：本身就是变化量，或会取负值', () => {
    for (const def of btcMetrics) {
      if (def.changeWindowDays !== null) continue
      const justified =
        def.derivation?.kind === 'percentChange' || def.canBeNegative === true
      expect(justified, `${def.id} 无理由关闭变化列`).toBe(true)
    }
  })

  it('会取负值的指标一律关闭变化列（符号翻转时百分比没有含义）', () => {
    for (const def of btcMetrics) {
      if (def.canBeNegative !== true) continue
      expect(def.changeWindowDays, `${def.id} 会取负值却仍在展示变化列`).toBeNull()
    }
  })
})
