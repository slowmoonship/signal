/**
 * 首页"当前状态"层：把特征表翻译成一句 ≤3 字的判断 + 一个色档。
 *
 * 为什么它住在 `packages/metrics` 而不是页面层：
 * CLAUDE.md §架构边界 4 ——"任何一方硬编码指标列表都是 bug"。
 * 判定依据是**每个指标各自的分布**，"哪个指标算高"这件事只有唯一事实源说了算，
 * 页面层拿到的是一个词和一个色档，仅此而已。
 *
 * 词只有三个来源，全部可核对：
 * 1. **特征分位档**（low / mid / high）——"这个数比过去多少比例的日子高"。
 * 2. **有符号量的方向**（净流入 / 净流出）——事实本身，不是评级。
 * 3. **与价格的方向背离**——两个指标的方向相反时给一个专门的词。
 *
 * 三条不许（CLAUDE.md §数据质量红线）：
 * - 算不出来就返回 `ok: false`，**不许为了让表格好看而填"中性"**；
 * - 不许对已经是变化量的指标再变化一次，也不对有符号水平量取百分比变化（特征层已挡住）；
 * - 状态词是分布位置，**不是投资建议**——"偏强"不等于"该买"。
 *
 * 分位档的阈值沿用特征层的 `BAND_LOW_MAX` / `BAND_HIGH_MIN`：
 * 页面与规则用同一套分档，才不会出现"规则说偏热、页面说中性"。
 */

import type { FeatureBand, FeatureId, FeatureObservation, FeatureTable } from './market/features.js'
import type { Locale } from './types.js'

/** 状态胶囊的三个色档。外加一个"判不了"。 */
export type StatusTone = 'hot' | 'flat' | 'cold' | 'void'

export type LocalizedText = Readonly<{ en: string; zh: string }>

/** 判不了时的词。永远伴随原因，不是一个沉默的"中性"。 */
const UNKNOWN_WORD: LocalizedText = { en: 'no data', zh: '缺数据' }

/**
 * 一个指标的状态判定方式。
 *
 * `featureId` 必须在 `FEATURE_SPECS` 里，且必须算出 `ok`——
 * 特征失败时状态直接判 `unknown`，绝不回退到别的特征凑一个词出来。
 */
export type StatusSpec = Readonly<{
  metricId: string
  featureId: FeatureId
  /**
   * 三档位对应的状态词：索引 0 = low，1 = mid，2 = high。
   *
   * 每个指标用自己的词：费率说"拥堵"、净流入说"净流入"、
   * 活跃地址说"放量"。把它们统一成"高/中/低"会让表格像温度计而不像产品。
   */
  words: readonly [LocalizedText, LocalizedText, LocalizedText]
  /**
   * 可选：有符号量的方向覆盖。存在时**方向优先于分位**——
   * "净流入"是事实，而"净流入很大"才是档位，两件事不能混成一句。
   */
  flow?: Readonly<{
    inflow: LocalizedText
    outflow: LocalizedText
    flat: LocalizedText
  }>
  /**
   * 可选：背离覆盖。
   *
   * 当参考特征（通常是价格）处于 `againstBand`，而本指标方向与之相反时用这个词。
   * 它回答的是"这两个指标说的是同一件事吗"，是单个指标自己的分位给不出来的信息。
   */
  divergence?: Readonly<{
    /** 参考特征 id */
    featureId: FeatureId
    /** 参考特征处于这一档时构成背离 */
    againstBand: FeatureBand
    word: LocalizedText
  }>
}>

/** 判定失败的原因。与特征层的原因一一对应，不另造一套。 */
export type StatusFailureReason =
  | 'missing'
  | 'stale'
  | 'insufficient-history'
  | 'expired'
  | 'uncomputable'

export type MetricStatus =
  | Readonly<{
      ok: true
      metricId: string
      /** 状态词，按 locale 取 */
      word: LocalizedText
      tone: StatusTone
      /** 分位（0–1），说明这个词是怎么来的；`flow` 分支下是 \|值\| 的分位 */
      percentile: number | null
      /** 所依据的特征 id，页面用它回链到判定依据 */
      featureId: FeatureId
      /** 数据时间（UTC 纪元秒） */
      asOf: number
      /** 走了哪条分支，用于审计与测试 */
      via: 'band' | 'flow' | 'divergence'
    }>
  | Readonly<{
      ok: false
      metricId: string
      featureId: FeatureId
      reason: StatusFailureReason
      detail: string
    }>

/**
 * 判定单个指标的状态。
 *
 * 分支顺序是有意义的：**背离 > 方向 > 分位**。
 * 先看两个指标是否在说反话，再说方向，最后才落到分位——
 * 分位是最弱的信息，它只回答"这个数比大多数日子高还是低"。
 */
export function deriveStatus(spec: StatusSpec, features: FeatureTable): MetricStatus {
  const result = features[spec.featureId]
  if (!result || !result.ok) {
    return {
      ok: false,
      metricId: spec.metricId,
      featureId: spec.featureId,
      reason: result ? result.reason.reason : 'missing',
      detail: result ? result.reason.detail : `指标 ${spec.metricId} 的判定特征没有计算结果`,
    }
  }

  const obs = result.value
  const asOf: number = obs.asOf

  // 1. 背离：参考特征在反向档位，而本指标方向与之相反
  if (spec.divergence && spec.flow && obs.sign !== null && obs.sign !== 'flat') {
    const ref = features[spec.divergence.featureId]
    if (ref && ref.ok && ref.value.band === spec.divergence.againstBand) {
      return {
        ok: true,
        metricId: spec.metricId,
        word: spec.divergence.word,
        tone: toneForFlow(obs.sign),
        percentile: obs.percentile,
        featureId: spec.featureId,
        asOf,
        via: 'divergence',
      }
    }
  }

  // 2. 方向：有符号的量先说方向
  if (spec.flow && obs.sign !== null) {
    const word =
      obs.sign === 'inflow' ? spec.flow.inflow : obs.sign === 'outflow' ? spec.flow.outflow : spec.flow.flat
    return {
      ok: true,
      metricId: spec.metricId,
      word,
      tone: toneForFlow(obs.sign),
      percentile: obs.percentile,
      featureId: spec.featureId,
      asOf,
      via: 'flow',
    }
  }

  // 3. 分位：最弱的信息，最后兜底
  return {
    ok: true,
    metricId: spec.metricId,
    word: spec.words[bandIndex(obs.band)],
    tone: toneForBand(obs.band),
    percentile: obs.percentile,
    featureId: spec.featureId,
    asOf,
    via: 'band',
  }
}

function bandIndex(band: FeatureBand): 0 | 1 | 2 {
  if (band === 'low') return 0
  if (band === 'high') return 2
  return 1
}

function toneForBand(band: FeatureBand): StatusTone {
  if (band === 'high') return 'hot'
  if (band === 'low') return 'cold'
  return 'flat'
}

/**
 * 方向 → 色档。
 *
 * `flat` 落在中性而不是冷：**接近零**是一个真实的观察结果（"这段时间基本没有净流入"），
 * 不是数据缺失，把它渲染成"冷"会凭空造出一个方向判断。
 */
function toneForFlow(sign: FeatureObservation['sign']): StatusTone {
  if (sign === 'inflow') return 'hot'
  if (sign === 'outflow') return 'cold'
  return 'flat'
}

/** 按 locale 取状态词。判不出来时一律"缺数据"。 */
export function statusWord(status: MetricStatus, locale: Locale): string {
  return status.ok ? status.word[locale] : UNKNOWN_WORD[locale]
}

/**
 * 判定失败时的短标签。
 *
 * 首页表格只放这种级别的词。完整原因（"指标 pool-concentration 的历史不足 365 天…"）
 * 属于详情页与悬停提示的内容——把它放进表格的一格里，行高会被撑成两行，
 * 而 metric id 这种内部标识本来就不该出现在首页上。
 */
export function statusReason(
  status: Extract<MetricStatus, { ok: false }>,
  locale: Locale,
): string {
  const words: Readonly<Record<StatusFailureReason, LocalizedText>> = {
    missing: { en: 'no data', zh: '数据不足' },
    stale: { en: 'stale', zh: '数据过期' },
    'insufficient-history': { en: 'short history', zh: '历史不足' },
    expired: { en: 'expired', zh: '数据过期' },
    uncomputable: { en: 'not computable', zh: '数据不足' },
  }
  return words[status.reason][locale]
}

/**
 * 简要解释：状态词是怎么来的。
 *
 * 一律**由数据生成**，不逐个指标写文案——
 * 写死的解释迟早和数值对不上，而这里只需要两句模板：
 * 分位档说"在分布的哪个位置"，有符号的量说"N 日累计多少"。
 * 这样解释与状态词永远一致，也不会变成第二套需要维护的话术。
 *
 * **必须短。** 它是表格的一列，不是一段话：
 * "近1年 P66" / "7日净流入 1,173 BTC" / "历史不足"——一行放得下。
 */
export function statusBasis(
  status: MetricStatus,
  obs: FeatureObservation | undefined,
  locale: Locale,
): string {
  if (!status.ok) return statusReason(status, locale)
  if (!obs) return locale === 'zh' ? '—' : '—'
  if (status.via === 'flow' || status.via === 'divergence') {
    const magnitude = Math.abs(obs.observed).toLocaleString('en-US', { maximumFractionDigits: 0 })
    const direction: LocalizedText =
      obs.sign === 'inflow'
        ? { en: 'inflow', zh: '净流入' }
        : obs.sign === 'outflow'
          ? { en: 'outflow', zh: '净流出' }
          : { en: 'flat', zh: '持平' }
    return locale === 'zh'
      ? `${obs.windowDays}日${direction.zh} ${magnitude} BTC`
      : `${obs.windowDays}d ${direction.en} ${magnitude} BTC`
  }
  if (obs.percentile === null) return locale === 'zh' ? '分位不可算' : 'percentile unavailable'
  const p = Math.round(obs.percentile * 100)
  return locale === 'zh' ? `近1年 P${p}` : `1y P${p}`
}

/** 全部指标的状态，供页面一次性渲染。 */
export function deriveAllStatuses(
  specs: readonly StatusSpec[],
  features: FeatureTable,
): ReadonlyMap<string, MetricStatus> {
  const out = new Map<string, MetricStatus>()
  for (const spec of specs) out.set(spec.metricId, deriveStatus(spec, features))
  return out
}