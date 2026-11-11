/**
 * 市场三态分类层：牛市 / 熊市 / 震荡。
 *
 * ## 它与场景规则层是两个东西，不许互相顶替
 *
 * - `scenarios.ts` 回答"**为什么**是现在这样"：67 条规则给出具体解释
 *   （"价格上涨的同时链上活跃度走强"）。
 * - 本文件回答"**现在处于什么方向**"：只有三档，供卡片底色使用。
 *
 * 之前的实现把"改善 / 恶化 / 中性"当方向，那其实是**条件变化**，
 * 不是市场周期：一条讲"价格仍在近一年高位"的规则是**位置**，
 * 它既不改善也不恶化。ADR-022 因此被本文件取代。
 *
 * ## 为什么方向要自己判，不能从 `family` 或 `tone` 推
 *
 * - `family`（bull / bear / neutral / mixed）的用途只有一个：**发现互相矛盾的信号**。
 *   它描述的是"这条信号的方向"，规则之间可以同时命中一个 bull 和一个 bear。
 * - `tone`（improving / deteriorating / neutral）描述的是"条件在变好还是变差"。
 *
 * 两者都不是市场周期。把 `family === 'bull'` 直接当作牛市，
 * 等于把"有一条规则是看多的"读成"现在是牛市"——而实际命中的可能只有
 * "交易所净流入刚刚转正"这一条，其它的周期证据一概没参与。
 * 所以本文件**独立**从特征算出方向，不复用那两个字段。
 *
 * ## 三条不可让步的规则（CLAUDE.md §数据质量红线 8）
 *
 * 1. **判不了就说判不了。** 价格是核心：价格数据缺失或严重过期时返回
 *    `status: 'unknown'`，**绝不伪造一个"震荡"**。三态是正常数据条件下的分类，
 *    不是数据错误的替身。
 * 2. **缺的不填零。** 链上数据缺失时退回"仅依据价格趋势"，
 *    并把置信度标成 `low`——不是把链上当成"中性"来凑一个三态。
 * 3. **冲突归入震荡，但不因此说价格横盘。** 价格与链上方向相反时判"震荡"，
 *    解释文案仍然由场景规则给出（"价格上涨但链上活跃度没有跟上"），
 *    绝不改写成"价格在横盘"——那句话会是一个事实错误。
 *
 * ## 价格方向为什么要看多个窗口
 *
 * 单日涨跌说明不了任何事。趋势判定必须同时看：
 *
 * - **90 日（锚）**：中期趋势。绝对变化达到 ±15% 才算"有趋势"，
 *   否则那只是区间内的正常波动。
 * - **30 日（摆动）**：最近一个月的反向幅度。90 日还在涨、但 30 日已经反向
 *   超过 10% 时，那不是牛市而是**一次回撤**；反过来同理。
 *
 * 阈值不是随手挑的：把 BTC 真实历史的 90 日与 30 日变化分布跑一遍，
 * ±15% / ±10% 这一组把全历史分成牛 43.5% / 熊 21.0% / 震荡 35.4%，
 * 三档都有足够样本，又不会让日常波动天天翻档。
 *
 * 7 日变化只作为**证据**展示，不参与分类：把它算进去等于让市场状态
 * 跟着上周的波动走，而三态要回答的是"现在处在什么周期位置"。
 */

import {
  TREND_SWING_VETO_PERCENT,
  TREND_THRESHOLD_PERCENT,
  type FeatureBand,
  type FeatureFailure,
  type FeatureId,
  type FeatureObservation,
  type FeatureTable,
} from './features.js'
import type { Localized } from '../types.js'

/** 市场方向三态。 */
export type MarketRegime = 'bull' | 'bear' | 'range'

/**
 * 置信度。**不是**概率，也不是投资建议强度，
 * 只回答"这个方向有多少证据在支撑"。
 *
 * - `high`：价格与链上两个维度同向。
 * - `medium`：只有价格在说话（链上在常态区间），或者价格与链上分化。
 * - `low`：只有价格可用（链上数据缺失/过期），或价格本身就没有趋势。
 */
export type RegimeConfidence = 'high' | 'medium' | 'low'

/** 判定状态。`unknown` 表示**数据故障**，不是一种市场状态。 */
export type RegimeStatus = 'known' | 'unknown'

/** 规则的稳定 id。发布后不改：详情页要列出它，改名等于换了一条规则。 */
export type RegimeRuleId =
  | 'regime.bull.confirmed'
  | 'regime.bull.price-led'
  | 'regime.bull.price-only'
  | 'regime.bear.confirmed'
  | 'regime.bear.price-led'
  | 'regime.bear.price-only'
  | 'regime.range.divergence'
  | 'regime.range.flat'
  | 'regime.unknown.data'

/**
 * 规则版本。
 *
 * 阈值或组合方式变了就升版本号：读者手里的旧结论要能被追溯到当时的规则，
 * 否则"上周说是牛市、这周说是震荡"就变成一个无法解释的事。
 */
export const REGIME_RULE_VERSION = 'regime-v1'

/**
 * 参与判定的特征。
 *
 * `price.trend` 是**方向的唯一定义**：三态分类用它，67 条场景规则也用它。
 * 两边共用一个定义，就不可能对同一天一个说"牛市"、另一个说"价格横盘"。
 */
export const REGIME_PRICE_TREND: FeatureId = 'price.trend'
export const REGIME_PRICE_ANCHOR: FeatureId = 'price.90d'
export const REGIME_PRICE_SWING: FeatureId = 'price.30d'
export const REGIME_PRICE_MOMENTUM: FeatureId = 'price.7d'
export const REGIME_ONCHAIN_ACTIVITY: FeatureId = 'onchain.addresses30'

/** 方向阈值住在特征层（那里才是算它的地方），这里只是转出去方便引用。 */
export const REGIME_TREND_THRESHOLD_PERCENT = TREND_THRESHOLD_PERCENT
export const REGIME_SWING_VETO_PERCENT = TREND_SWING_VETO_PERCENT

/** 一条判定证据。 */
export type RegimeEvidence = Readonly<{
  featureId: FeatureId
  /** 该证据在判定中的角色 */
  role: 'anchor' | 'swing' | 'momentum' | 'onchain'
  /** 观测量（百分比或特征原值） */
  observed: number
  /** 档位（仅分位类特征有） */
  band: FeatureBand | null
  /** 数据时间（UTC 纪元秒） */
  asOf: number
}>

export type RegimeRead = Readonly<{
  status: RegimeStatus
  /** 三态方向。`unknown` 时为 null */
  regime: MarketRegime | null
  /** 置信度。`unknown` 时为 null */
  confidence: RegimeConfidence | null
  /** 命中的规则 id */
  ruleId: RegimeRuleId
  /** 规则版本 */
  ruleVersion: string
  /** 方向判定的依据（一句话，双语）。由数据生成，不是写死的 */
  basis: Localized
  /** 参与判定的证据 */
  evidence: readonly RegimeEvidence[]
  /** 数据质量问题：关键特征缺失 / 过期 / 历史不足 */
  dataIssues: readonly FeatureFailure[]
  /** 判定所依据的数据时间（UTC 纪元秒）：参与判定的最新数据点 */
  asOf: number
}>

/** 方向（价格或链上）。`unknown` = 判不出来，与 `flat`（判出来是平的）不同。 */
type Direction = 'up' | 'down' | 'flat' | 'unknown'

/** 三态的中文名。 */
export const REGIME_LABEL: Readonly<Record<MarketRegime, Localized>> = {
  bull: { en: 'Bull', zh: '牛市' },
  bear: { en: 'Bear', zh: '熊市' },
  range: { en: 'Range', zh: '震荡' },
}

/** 置信度的中文名。 */
export const REGIME_CONFIDENCE_LABEL: Readonly<Record<RegimeConfidence, Localized>> = {
  high: { en: 'high confidence', zh: '置信度高' },
  medium: { en: 'medium confidence', zh: '置信度中等' },
  low: { en: 'low confidence', zh: '置信度低' },
}

/** 特征失败原因 → 人话。与状态层用的是同一套原因，不另造一套。 */
const ISSUE_TEXT: Readonly<Record<FeatureFailure['reason'], Localized>> = {
  missing: { en: 'no data', zh: '数据缺失' },
  stale: { en: 'stale', zh: '数据过期' },
  'insufficient-history': { en: 'short history', zh: '历史不足' },
  expired: { en: 'expired', zh: '数据过期' },
  uncomputable: { en: 'not computable', zh: '无法计算' },
}

/**
 * 链上方向：用活跃地址 30 日变化的**分位档**。
 *
 * 用档位而不是绝对变化量，是因为活跃地址的绝对水平随时间漂移
 * （用户基数在变），而"这个数比过去 80% 的日子高"是可跨时期比较的说法。
 */
function onchainDirection(band: FeatureBand): Direction {
  if (band === 'high') return 'up'
  if (band === 'low') return 'down'
  return 'flat'
}

/** 百分数，带正负号与一位小数。 */
function pct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

/**
 * 判定市场三态。
 *
 * @param features 全部特征的结果（算得出与算不出的都在里面）
 */
export function classifyRegime(features: FeatureTable): RegimeRead {
  const trend = features[REGIME_PRICE_TREND]
  const swing = features[REGIME_PRICE_SWING]
  const momentum = features[REGIME_PRICE_MOMENTUM]
  const onchain = features[REGIME_ONCHAIN_ACTIVITY]

  // 价格是核心：拿不到价格就没有任何方向可言，如实报数据故障。
  if (!trend?.ok) {
    const issues: FeatureFailure[] = []
    if (trend && !trend.ok) issues.push(trend.reason)
    return {
      status: 'unknown',
      regime: null,
      confidence: null,
      ruleId: 'regime.unknown.data',
      ruleVersion: REGIME_RULE_VERSION,
      basis: {
        en: 'Price data is missing or too stale to classify the market.',
        zh: '价格数据缺失或严重过期，无法判定市场方向。',
      },
      evidence: [],
      dataIssues: issues,
      asOf: 0,
    }
  }

  // 方向的唯一来源：`price.trend` 的档位。
  // 锚数字取自同一个特征（它的 observed 就是 90 日变化），
  // 因此文案里的数与判定用的数不可能对不上。
  const pAnchor = trend.value.observed
  const pSwing = swing?.ok ? swing.value.observed : null
  const pDirection: Direction =
    trend.value.band === 'high' ? 'up' : trend.value.band === 'low' ? 'down' : 'flat'

  // 链上缺失不算故障：它只是"少了一个维度"，退回仅价格判定并降低置信度。
  const oDirection: Direction = onchain?.ok ? onchainDirection(onchain.value.band) : 'unknown'

  const evidence: RegimeEvidence[] = [
    {
      featureId: REGIME_PRICE_TREND,
      role: 'anchor',
      observed: pAnchor,
      band: trend.value.band,
      asOf: trend.value.asOf,
    },
  ]
  if (swing?.ok) {
    evidence.push({
      featureId: REGIME_PRICE_SWING,
      role: 'swing',
      observed: swing.value.observed,
      band: swing.value.band,
      asOf: swing.value.asOf,
    })
  }
  if (momentum?.ok) {
    evidence.push({
      featureId: REGIME_PRICE_MOMENTUM,
      role: 'momentum',
      observed: momentum.value.observed,
      band: momentum.value.band,
      asOf: momentum.value.asOf,
    })
  }
  if (onchain?.ok) {
    evidence.push({
      featureId: REGIME_ONCHAIN_ACTIVITY,
      role: 'onchain',
      observed: onchain.value.observed,
      band: onchain.value.band,
      asOf: onchain.value.asOf,
    })
  }

  const asOf = evidence.reduce((max, e) => Math.max(max, e.asOf), 0)
  const decided = decide(pDirection, oDirection)

  return {
    status: 'known',
    regime: decided.regime,
    confidence: decided.confidence,
    ruleId: decided.ruleId,
    ruleVersion: REGIME_RULE_VERSION,
    basis: basisOf(
      decided,
      pDirection,
      oDirection,
      pAnchor,
      pSwing,
      momentum?.ok ? momentum.value : undefined,
      onchain?.ok ? onchain.value : undefined,
    ),
    evidence,
    dataIssues: onchain && !onchain.ok ? [onchain.reason] : [],
    asOf,
  }
}

/** 组合表。价格是主，链上是确认；两者相反即分化。 */
function decide(
  price: Direction,
  onchain: Direction,
): { regime: MarketRegime; confidence: RegimeConfidence; ruleId: RegimeRuleId } {
  switch (price) {
    case 'up':
      if (onchain === 'up') return { regime: 'bull', confidence: 'high', ruleId: 'regime.bull.confirmed' }
      if (onchain === 'flat') return { regime: 'bull', confidence: 'medium', ruleId: 'regime.bull.price-led' }
      if (onchain === 'unknown') return { regime: 'bull', confidence: 'low', ruleId: 'regime.bull.price-only' }
      return { regime: 'range', confidence: 'medium', ruleId: 'regime.range.divergence' }
    case 'down':
      if (onchain === 'down') return { regime: 'bear', confidence: 'high', ruleId: 'regime.bear.confirmed' }
      if (onchain === 'flat') return { regime: 'bear', confidence: 'medium', ruleId: 'regime.bear.price-led' }
      if (onchain === 'unknown') return { regime: 'bear', confidence: 'low', ruleId: 'regime.bear.price-only' }
      return { regime: 'range', confidence: 'medium', ruleId: 'regime.range.divergence' }
    default:
      // 价格本身没有趋势：震荡。链上也在常态区间时置信度最高——
      // 两个维度都说"没什么特别"，那确实就是震荡。
      if (onchain === 'flat') return { regime: 'range', confidence: 'high', ruleId: 'regime.range.flat' }
      if (onchain === 'unknown') return { regime: 'range', confidence: 'low', ruleId: 'regime.range.flat' }
      return { regime: 'range', confidence: 'medium', ruleId: 'regime.range.flat' }
  }
}

/**
 * 依据文案。**由数据生成**：写死的解释迟早和数值对不上，
 * 而这一句必须与底色一致（同一个词出现在卡片上）。
 */
function basisOf(
  decided: { regime: MarketRegime; confidence: RegimeConfidence; ruleId: RegimeRuleId },
  price: Direction,
  onchain: Direction,
  pAnchor: number,
  pSwing: number | null,
  momentum: FeatureObservation | undefined,
  onchainObs: FeatureObservation | undefined,
): Localized {
  // 窗口数字按语言各拼一次：中英文的分隔符不同，
  // 混着拼会得到"90 日 +18.3%, 30 日 −9.4%"这种夹生的句子。
  const windows = (locale: 'en' | 'zh'): string => {
    const parts: string[] = []
    const label = (d: number): string => (locale === 'zh' ? `${d} 日` : `${d}d`)
    parts.push(`${label(90)} ${pct(pAnchor)}`)
    if (pSwing !== null) parts.push(`${label(30)} ${pct(pSwing)}`)
    if (momentum) parts.push(`${label(7)} ${pct(momentum.observed)}`)
    return locale === 'zh' ? parts.join('、') : parts.join(', ')
  }
  const band = onchainObs?.band ?? 'mid'
  const onchainEn =
    onchain === 'unknown'
      ? 'on-chain data is missing'
      : `on-chain activity is ${bandPhraseEn(band)}`
  const onchainZh =
    onchain === 'unknown' ? '链上数据缺失' : `链上活跃度${bandPhrase(band)}`

  switch (decided.ruleId) {
    case 'regime.bull.confirmed':
    case 'regime.bear.confirmed':
      return {
        en: `Price trend and on-chain activity agree: ${windows('en')}; ${onchainEn}.`,
        zh: `价格趋势与链上活跃度同向：${windows('zh')}；${onchainZh}。`,
      }
    case 'regime.bull.price-led':
      return {
        en: `Price is in an uptrend while on-chain activity stays in its usual range: ${windows('en')}.`,
        zh: `价格处于上行趋势，链上活跃度仍在常态区间：${windows('zh')}。`,
      }
    case 'regime.bull.price-only':
      return {
        en: `Price is in an uptrend, but on-chain data is missing, so this rests on price alone: ${windows('en')}.`,
        zh: `价格处于上行趋势，但链上数据缺失，本次判定仅依据价格：${windows('zh')}。`,
      }
    case 'regime.bear.price-led':
      return {
        en: `Price is in a downtrend while on-chain activity stays in its usual range: ${windows('en')}.`,
        zh: `价格处于下行趋势，链上活跃度仍在常态区间：${windows('zh')}。`,
      }
    case 'regime.bear.price-only':
      return {
        en: `Price is in a downtrend, but on-chain data is missing, so this rests on price alone: ${windows('en')}.`,
        zh: `价格处于下行趋势，但链上数据缺失，本次判定仅依据价格：${windows('zh')}。`,
      }
    case 'regime.range.divergence':
      // 只陈述**分化**这个事实。注意这里不能写"因此无法给出单一方向"——
      // 那正是 V0.11 要去掉的说法：方向分类已经给出了"震荡"，
      // 文案要做的是解释为什么，而不是否定分类本身。
      return {
        en: `Price and on-chain activity point in opposite directions: ${windows('en')}; ${onchainEn}.`,
        zh: `价格与链上活跃度方向相反：${windows('zh')}；${onchainZh}。`,
      }
    default:
      return {
        en: `No clear multi-week trend in either direction: ${windows('en')}.`,
        zh: `价格没有形成多周级别的明确方向：${windows('zh')}。`,
      }
  }
}

/** 英文档位措辞。与中文版一一对应。 */
function bandPhraseEn(band: FeatureBand): string {
  switch (band) {
    case 'high':
      return 'near a one-year high'
    case 'low':
      return 'near a one-year low'
    default:
      return 'within its usual one-year range'
  }
}

/** 档位措辞。与场景层用同一套说法，避免同一件事有两种讲法。 */
function bandPhrase(band: FeatureBand): string {
  switch (band) {
    case 'high':
      return '处于近一年高位'
    case 'low':
      return '处于近一年低位'
    default:
      return '处于近一年常态区间'
  }
}

/** 数据质量说明：把关键特征的失败原因翻成人话。 */
export function regimeDataIssueText(issue: FeatureFailure, locale: 'en' | 'zh'): string {
  return ISSUE_TEXT[issue.reason][locale]
}

/**
 * 数据故障时的完整说明。
 *
 * 三态是正常数据条件下的市场分类，**不是数据错误的替身**——
 * 价格数据坏了就说坏了，绝不显示一个"震荡"让人以为市场真的没方向。
 */
export const REGIME_DATA_FAULT: Readonly<Record<'en' | 'zh', string>> = {
  en: 'Data fault: price history is missing or too stale, so the market direction cannot be classified.',
  zh: '数据故障：价格历史缺失或严重过期，无法判定市场方向。',
}
