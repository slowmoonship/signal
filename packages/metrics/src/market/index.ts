/**
 * 市场解释器 —— 把标准化后的特征变成**一句话**。
 *
 * 分工：
 * - `features.ts` 负责"每个维度现在处于什么位置"
 * - `scenarios.ts` 负责"什么条件下对应哪句话"
 * - 本文件负责"条件命中哪一条、命中多条时怎么选、句子怎么填数"
 *
 * 三条不可让步的规则：
 *
 * 1. **判不了就说判不了。**关键特征缺失/过期/历史不足时返回 `unknown`，
 *    绝不退化成"中性"（CLAUDE.md §数据质量红线 8）。
 * 2. **冲突不硬解。**两条方向相反且优先级接近的规则同时命中时，
 *    判为"信号矛盾"，而不是挑一个装作没看见另一个。
 * 3. **只给一个数。**首页只显示这一句话；规则 id、参与指标、数据时间、
 *    排除原因都保留在返回值里，供详情页与审计使用，但不上首页。
 */

import { registry } from '../definitions/index.js'
import { formatSignedPercent, formatValue } from '../format.js'
import type { PublishedMetric } from '../published.js'
import type { Locale, Localized, SeriesPoint } from '../types.js'
import {
  computeAllFeatures,
  FEATURE_SPEC_BY_ID,
  type FeatureFailure,
  type FeatureId,
  type FeatureObservation,
  type FeatureTable,
} from './features.js'
import {
  BAND_PHRASE,
  SCENARIO_BY_ID,
  SCENARIOS,
  toneOf,
  type Condition,
  type MarketScenario,
  type MarketTone,
} from './scenarios.js'

export * from './features.js'
export * from './scenarios.js'

/**
 * 判定结果的状态。
 *
 * `unknown` 不是"中性"的别名：它表示**当前数据不足以支撑任何一句市场判断**。
 */
export type MarketReadStatus = 'known' | 'unknown'

export type MarketRead = Readonly<{
  status: MarketReadStatus
  /** 命中的规则 id。`unknown` 时是 `unknown.insufficient-evidence` */
  scenarioId: string
  /**
   * 展示语义：命中规则说明市场条件在改善、恶化，还是说不清。
   *
   * 页面只拿它选底色，不拿它做别的判断；`unknown` 一律是 `neutral`——
   * "判不了"不是一种市场状态（CLAUDE.md §数据质量红线 8）。
   */
  tone: MarketTone
  /** 一句话结论（双语） */
  sentence: Localized
  /** 参与判定的特征：含底层指标 id 与数据时间 */
  participants: readonly FeatureObservation[]
  /** 被排除的特征与原因（缺失/过期/历史不足/无法计算） */
  exclusions: readonly FeatureFailure[]
  /** 同时命中的其它规则 id，按优先级降序 */
  alsoMatched: readonly string[]
}>

/**
 * 关键特征。
 *
 * 缺了它们就没有任何一句市场判断站得住：
 * 没有价格就没有方向，没有链上活动就无法说"这轮上涨有没有人参与"。
 * 交易所流向不在这里——它缺席时只是相关规则不命中，不影响其余判断。
 */
export const CORE_FEATURES: readonly FeatureId[] = ['price.7d', 'onchain.addresses30']

/**
 * 冲突判定窗口（优先级差）。
 *
 * 差值大于它时，优先级高的那条**压得住**另一条：低优先级的规则讲的是
 * 另一个维度的事，读者看到主句时不会觉得矛盾。
 * 差值小于等于它时，两条都是"方向性"的强信号，读者会问"那到底该听哪个"——
 * 这种时候如实说"信号矛盾"，比硬挑一个更诚实。
 */
export const CONFLICT_PRIORITY_GAP = 15

/**
 * 条件求值。
 *
 * 任何一个条件所依赖的特征不可用，**整条规则就不成立**——
 * 半个条件成立不叫命中，那叫编故事。
 */
function conditionHolds(condition: Condition, features: FeatureTable): boolean {
  const entry = features[condition.feature]
  if (!entry || !entry.ok) return false
  const value = entry.value

  switch (condition.kind) {
    case 'band':
      return value.band === condition.band
    case 'sign':
      return value.sign === condition.sign
    case 'crossedZero':
      // 穿越零点 = 方向与上一个窗口相反，且两个方向都不是"平"
      return (
        value.sign === condition.to &&
        value.prevSign !== null &&
        value.prevSign !== 'flat' &&
        value.prevSign !== condition.to
      )
    case 'above':
      return value.observed > condition.value
    case 'below':
      return value.observed < condition.value
  }
}

/** 一条规则是否命中。 */
export function scenarioMatches(scenario: MarketScenario, features: FeatureTable): boolean {
  return scenario.conditions.every((c) => conditionHolds(c, features))
}

/**
 * 读出市场状态。
 *
 * @param features 全部特征的结果（算得出与算不出的都在里面）
 */
export function readMarketScenario(features: FeatureTable): MarketRead {
  const exclusions: FeatureFailure[] = []
  for (const entry of Object.values(features)) {
    if (!entry.ok) exclusions.push(entry.reason)
  }

  // 关键特征缺一个就判不了
  for (const id of CORE_FEATURES) {
    const entry = features[id]
    if (!entry || !entry.ok) {
      return unknownRead(exclusions)
    }
  }

  const matched = SCENARIOS.filter((s) => s.kind === 'rule' && scenarioMatches(s, features)).sort(
    (a, b) => b.priority - a.priority,
  )

  // 方向相反且优先级接近 → 冲突
  const bestBull = matched.find((s) => s.family === 'bull')
  const bestBear = matched.find((s) => s.family === 'bear')
  if (
    bestBull &&
    bestBear &&
    Math.abs(bestBull.priority - bestBear.priority) <= CONFLICT_PRIORITY_GAP
  ) {
    const conflict = SCENARIO_BY_ID['conflict.signals-disagree']
    if (conflict) {
      return {
        status: 'known',
        scenarioId: conflict.id,
        // 冲突就是冲突：两个方向相反的信号同时在场，判不出改善还是恶化。
        tone: 'neutral',
        sentence: conflict.sentence,
        participants: participantsOf([bestBull, bestBear], features),
        exclusions,
        alsoMatched: matched.map((s) => s.id).filter((id) => id !== conflict.id),
      }
    }
  }

  if (matched.length > 0) {
    const winner = matched[0]
    if (winner) {
      return {
        status: 'known',
        scenarioId: winner.id,
        tone: toneOf(winner),
        sentence: winner.sentence,
        participants: participantsOf([winner], features),
        exclusions,
        alsoMatched: matched.slice(1).map((s) => s.id),
      }
    }
  }

  // 条件都算得出来，但没有任何规则命中 → 常态区间
  const fallback = SCENARIO_BY_ID['fallback.no-clear-signal']
  if (fallback) {
    return {
      status: 'known',
      scenarioId: fallback.id,
      tone: 'neutral',
      sentence: fallback.sentence,
      participants: participantsOf([fallback], features),
      exclusions,
      alsoMatched: [],
    }
  }

  return unknownRead(exclusions)
}

function unknownRead(exclusions: readonly FeatureFailure[]): MarketRead {
  const scenario = SCENARIO_BY_ID['unknown.insufficient-evidence']
  if (!scenario) throw new Error('场景表缺少 unknown.insufficient-evidence')
  return {
    status: 'unknown',
    scenarioId: scenario.id,
    // 判不了就保持中性："没有数据"不是一种市场状态（CLAUDE.md §数据质量红线 8）
    tone: 'neutral',
    sentence: scenario.sentence,
    participants: [],
    exclusions: [...exclusions],
    alsoMatched: [],
  }
}

/** 命中规则用到的特征。 */
function participantsOf(
  scenarios: readonly MarketScenario[],
  features: FeatureTable,
): FeatureObservation[] {
  const ids = new Set<FeatureId>()
  for (const scenario of scenarios) {
    for (const condition of scenario.conditions) ids.add(condition.feature)
  }
  // 兜底规则没有条件，但它的句子里引用了关键特征——
  // 参与判定的就是那几个，不披露就等于凭空多了一个数。
  if (ids.size === 0) for (const id of CORE_FEATURES) ids.add(id)
  const out: FeatureObservation[] = []
  for (const id of ids) {
    const entry = features[id]
    if (entry && entry.ok) out.push(entry.value)
  }
  return out
}

/** 模板占位符：`{price.7d}` 取观测量，`{price.7d.band}` 取档位措辞。 */
const PLACEHOLDER = /\{([a-zA-Z0-9._-]+)\}/g

/**
 * 把句子里的占位符换成实数。
 *
 * 换不出来的占位符**原样留下**——宁可让页面上出现一个 `{price.7d}`，
 * 也不要塞一个编出来的数进去。
 */
export function renderSentence(
  template: string,
  features: FeatureTable,
  locale: Locale,
): string {
  return template.replace(PLACEHOLDER, (whole, raw: string) => {
    const isBand = raw.endsWith('.band')
    const id = (isBand ? raw.slice(0, -'.band'.length) : raw) as FeatureId
    const entry = features[id]
    if (!entry || !entry.ok) return whole
    if (isBand) return BAND_PHRASE[entry.value.band][locale]
    return formatFeatureValue(id, entry.value, locale)
  })
}

/** 按特征的计算方式决定怎么把观测量写成一句话里的一个数。 */
function formatFeatureValue(id: FeatureId, value: FeatureObservation, locale: Locale): string {
  const spec = FEATURE_SPEC_BY_ID[id]
  if (!spec) return String(value.observed)
  switch (spec.kind) {
    case 'signedSum': {
      const sign = value.observed > 0 ? '+' : value.observed < 0 ? '−' : ''
      const abs = Math.abs(value.observed)
      return `${sign}${abs.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        maximumFractionDigits: 0,
      })} BTC`
    }
    case 'levelPercentile': {
      // 水平值按它自己指标的格式显示（价格是美元，别的可能是计数）
      const def = registry.has(value.metricId) ? registry.get(value.metricId) : null
      const formatted = def ? formatValue(value.observed, def.format, locale) : null
      return formatted ?? String(value.observed)
    }
    default:
      return formatSignedPercent(value.observed, locale, 1) ?? String(value.observed)
  }
}

/** 渲染成当前语言的一句话。 */
export function marketSentence(read: MarketRead, features: FeatureTable, locale: Locale): string {
  return renderSentence(read.sentence[locale], features, locale)
}

/**
 * 从已发布的快照算出特征表。
 *
 * 放在 metrics 包而不是页面层，是为了让"参考时刻"这个概念只有一处定义：
 * 它取所有已加载指标里**最新的那一个数据点**。
 * 用别的口径（比如服务器当前时间）会让免费源的 T+1 结算被误判成"过期"，
 * 而用单指标自己的最新点则会让"这一条很旧但别的很新"的情况看不出来。
 */
export function buildFeatureTable(metrics: Iterable<PublishedMetric>): {
  readonly features: FeatureTable
  readonly referenceTs: number
} {
  const series: Record<string, readonly SeriesPoint[]> = {}
  const stale: Record<string, boolean> = {}
  let referenceTs = 0

  for (const metric of metrics) {
    series[metric.metricId] = metric.points
    stale[metric.metricId] = metric.stale
    for (const p of metric.points) {
      if (p.value !== null && p.ts > referenceTs) referenceTs = p.ts
    }
  }

  const features = computeAllFeatures({ series, stale, referenceTs })
  return { features, referenceTs }
}
