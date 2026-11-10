/**
 * 场景规则表 —— 市场解释器的"知识"部分。
 *
 * 为什么是"场景"而不是"冷热打分"：
 * 早先的原型把 7 个指标各算一个变化率，超过阈值就投一票，
 * 最后得出"偏热/偏冷"三个字。这种结论有三个毛病：
 *
 * 1. **它对指标的变化率做了它不该做的算术。**`price-change-7d` 的值本身就是
 *    7 日涨跌幅，再对它算一次百分比变化，得到的是"涨跌幅的涨跌幅"，读者无从核对。
 * 2. **它对有符号的量取了百分比。**交易所净流入从 +837 变成 −163，
 *    百分比变化算出 −119%，读起来却像"某个正数跌了 119%"，与事实相反。
 * 3. **"偏冷 = 适合定投"是编的。**冷热是描述，估值判断是另一回事，
 *    两者之间没有推导关系，所以那句话必须删掉（CLAUDE.md §数据质量红线 8、9）。
 *
 * 现在的做法：先把每个维度标准化成"相对自己近一年处在什么位置"（`features.ts`），
 * 再用**场景**去匹配。场景 = 一组条件 + 一句可核对的事实陈述。
 * 条件全部满足才命中，命中多条时按**显式优先级**取最高的那条；
 * 两条方向相反且优先级接近时，判为"信号冲突"，而不是硬挑一个。
 *
 * 场景的句子只陈述**事实**，不给出"该买还是该卖"的建议。
 */

import type { Localized } from '../types.js'
import type { FeatureBand, FeatureId, FeatureSign } from './features.js'

/** 场景所属维度。用于识别"两个不同维度的信号互相矛盾"。 */
export type ScenarioDimension =
  | 'price'
  | 'onchain'
  | 'exchange'
  | 'fees'
  | 'mining'
  | 'volatility'
  | 'composite'

/**
 * 场景的"方向族"。
 *
 * 用途只有一个：**发现互相矛盾的信号**。
 * 它不是"偏热/偏冷"那种读者看不懂的评级，也不会出现在页面上。
 */
export type ScenarioFamily = 'bull' | 'bear' | 'neutral' | 'mixed'

/**
 * 展示语义：命中的这条规则说明**市场条件**变好了、变差了，还是说不清。
 *
 * 它与 `family` 是两件事，混淆这两者是本文件最容易犯的错：
 *
 * - `family` 只用来**发现互相矛盾的信号**（bull 撞上 bear 就报"信号冲突"）。
 *   它描述的是"这条信号的方向"，从不出现���页面上。
 * - `tone` 描述的是"市场条件在变好还是在变差"，**只用于市场状态卡片的底色**
 *   （CLAUDE.md §市场状态卡片）。
 *
 * 两者不一定同向。`exchange.crossing-in` 讲的是"交易所净流入刚刚转正"：
 * 方向族标成 bull（用于冲突判定），但代币流向交易所意味着流向卖方，
 * 因此展示语义是 deteriorating——否则同一件事在 `exchange.inflow-spike`
 * （deteriorating）里是红底，在这一条里却是绿底，读者会以为规则自己打架。
 *
 * 判据（写在这里是为了让每一条都能被核对）：
 *
 * - `improving` / `deteriorating`：这句话断言的是**条件的变化**，
 *   而且判据里带时间序列比较——变化量、方向反转，或相对自身历史的变化幅度。
 *   "当前处在近一年高位"是**位置**，不是变化，不算改善。
 * - `neutral`：其它全部。包括位置陈述（`price.near-high`）、分化（mixed）、
 *   信号冲突、常态兜底，以及判不了。
 */
export type MarketTone = 'improving' | 'deteriorating' | 'neutral'

/** 匹配条件。 */
export type Condition =
  /** 特征落在某个档位 */
  | Readonly<{ kind: 'band'; feature: FeatureId; band: FeatureBand }>
  /** 有符号特征的方向 */
  | Readonly<{ kind: 'sign'; feature: FeatureId; sign: FeatureSign }>
  /** 有符号特征穿越零点（上一个窗口方向相反） */
  | Readonly<{ kind: 'crossedZero'; feature: FeatureId; to: 'inflow' | 'outflow' }>
  /** 观测量高于阈值 */
  | Readonly<{ kind: 'above'; feature: FeatureId; value: number }>
  /** 观测量低于阈值 */
  | Readonly<{ kind: 'below'; feature: FeatureId; value: number }>

/** 场景类型。 */
export type ScenarioKind =
  /** 普通规则：条件全中即命中 */
  | 'rule'
  /** 冲突兜底：多个方向相反的信号同时命中时使用 */
  | 'conflict'
  /** 中性兜底：条件都算得出来，但没有场景命中 */
  | 'fallback'
  /** 判不了：关键数据缺失/过期/历史不足 */
  | 'unknown'

export type MarketScenario = Readonly<{
  /** 稳定 id。发布后不改——改了等于换了一条规则，读者无从对照 */
  id: string
  kind: ScenarioKind
  /** 优先级。数值越大越优先；冲突判定也用它衡量"是否接近" */
  priority: number
  dimension: ScenarioDimension
  family: ScenarioFamily
  /** 命中条件。全部满足才算命中 */
  conditions: readonly Condition[]
  /** 一句话。模板里可以放 `{特征id}`（取观测量）或 `{特征id.band}`（取档位措辞） */
  sentence: Localized
}>

/**
 * 档位措辞。
 *
 * 用"近一年高位/低位"而不是"高/低"，是因为读者必须知道这是**相对什么**。
 * 一个孤零零的"高"在加密市场里没有信息量——BTC 的活跃地址永远是"高"的。
 */
export const BAND_PHRASE: Readonly<Record<FeatureBand, Localized>> = {
  high: { en: 'near a one-year high', zh: '处于近一年高位' },
  low: { en: 'near a one-year low', zh: '处于近一年低位' },
  mid: { en: 'within its usual one-year range', zh: '处于近一年常态区间' },
}

/**
 * 优先级分层。
 *
 * 分层本身就是冲突消解规则：越具体的场景（组合越多）优先级越高，
 * 因为"价格涨 + 链上同步走强"比"价格涨"多说了一件事，也更值得被读者核对。
 */
const P = {
  /** 方向反转这类一次性事件：最具体 */
  crossing: 120,
  /** 价格 × 链上活动：读者最常问的组合 */
  priceOnchain: 115,
  /** 价格 × 交易所流向 */
  priceExchange: 105,
  /** 价格 × 费用 */
  priceFees: 95,
  /** 价格 × 波动率 */
  priceVol: 90,
  /** 价格 × 矿工 */
  priceMining: 85,
  /** 单一维度：价格 */
  price: 80,
  /** 单一维度：链上活动 */
  onchain: 62,
  /** 单一维度：交易所 */
  exchange: 50,
  /** 单一维度：费用 */
  fees: 42,
  /** 单一维度：矿工 */
  mining: 35,
  /** 单一维度：波动率 */
  volatility: 30,
  /** 冲突兜底 */
  conflict: 20,
  /** 中性兜底 */
  fallback: 10,
} as const

/**
 * 场景表。
 *
 * 编号规则：`维度.现象`。id 一旦发布不再修改——
 * 详情页会列出命中的规则 id，改名等于让读者手里的旧链接对不上。
 */
export const SCENARIOS: readonly MarketScenario[] = [
  // ── 交易所：方向反转 ──────────────────────────────────
  {
    id: 'exchange.crossing-in',
    kind: 'rule',
    priority: P.crossing,
    dimension: 'exchange',
    family: 'bull',
    conditions: [{ kind: 'crossedZero', feature: 'exchange.flow7', to: 'inflow' }],
    sentence: {
      en: 'Exchange net flow has just turned positive: the 7-day total flipped to {exchange.flow7}.',
      zh: '交易所净流入刚刚转为正数：近 7 日累计从流出翻转为 {exchange.flow7}。',
    },
  },
  {
    id: 'exchange.crossing-out',
    kind: 'rule',
    priority: P.crossing,
    dimension: 'exchange',
    family: 'bear',
    conditions: [{ kind: 'crossedZero', feature: 'exchange.flow7', to: 'outflow' }],
    sentence: {
      en: 'Exchange net flow has just turned negative: the 7-day total flipped to {exchange.flow7}.',
      zh: '交易所净流入刚刚转为负数：近 7 日累计从流入翻转为 {exchange.flow7}。',
    },
  },

  // ── 价格 × 链上活动 ────────────────────────────────────
  {
    id: 'combo.price-up-onchain-strong',
    kind: 'rule',
    priority: P.priceOnchain,
    dimension: 'composite',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'high' },
    ],
    sentence: {
      en: 'Price rose alongside stronger on-chain activity: 7-day change {price.7d}, active addresses 30-day change {onchain.addresses30.band}.',
      zh: '价格上涨的同时链上活跃度走强：7 日变化 {price.7d}，活跃地址 30 日变化{onchain.addresses30.band}。',
    },
  },
  {
    id: 'combo.price-up-onchain-diverging',
    kind: 'rule',
    priority: P.priceOnchain - 1,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'low' },
    ],
    sentence: {
      en: 'Price rose while on-chain activity stayed weak: 7-day change {price.7d}, active addresses 30-day change {onchain.addresses30.band}.',
      zh: '价格上涨但链上活跃度没有跟上：7 日变化 {price.7d}，活跃地址 30 日变化{onchain.addresses30.band}。',
    },
  },
  {
    id: 'combo.price-down-onchain-strong',
    kind: 'rule',
    priority: P.priceOnchain - 2,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'high' },
    ],
    sentence: {
      en: 'Price fell while on-chain activity strengthened: 7-day change {price.7d}, active addresses 30-day change {onchain.addresses30.band}.',
      zh: '价格下跌但链上活跃度走强：7 日变化 {price.7d}，活跃地址 30 日变化{onchain.addresses30.band}。',
    },
  },
  {
    id: 'combo.price-sideways-onchain-weak',
    kind: 'rule',
    priority: P.priceOnchain - 3,
    dimension: 'composite',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'low' },
    ],
    sentence: {
      en: 'Price is flat while on-chain activity is depressed: 7-day change {price.7d}, active addresses 30-day change {onchain.addresses30.band}.',
      zh: '价格横盘而链上活跃度低迷：7 日变化 {price.7d}，活跃地址 30 日变化{onchain.addresses30.band}。',
    },
  },
  {
    id: 'combo.price-up-onchain-flat',
    kind: 'rule',
    priority: P.priceOnchain - 4,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'mid' },
    ],
    sentence: {
      en: 'Price rose, but on-chain activity stayed in its usual range: 7-day change {price.7d}.',
      zh: '价格上涨，但链上活跃度仍在常态区间：7 日变化 {price.7d}。',
    },
  },
  {
    id: 'combo.price-down-onchain-flat',
    kind: 'rule',
    priority: P.priceOnchain - 5,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'onchain.addresses30', band: 'mid' },
    ],
    sentence: {
      en: 'Price fell, but on-chain activity stayed in its usual range: 7-day change {price.7d}.',
      zh: '价格下跌，但链上活跃度仍在常态区间：7 日变化 {price.7d}。',
    },
  },

  // ── 价格 × 交易所流向 ──────────────────────────────────
  {
    id: 'combo.price-up-exchange-outflow',
    kind: 'rule',
    priority: P.priceExchange,
    dimension: 'composite',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'outflow' },
    ],
    sentence: {
      en: 'Price rose while coins left exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格上涨的同时代币流出交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },
  {
    id: 'combo.price-up-exchange-inflow',
    kind: 'rule',
    priority: P.priceExchange - 1,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'inflow' },
    ],
    sentence: {
      en: 'Price rose even as coins moved onto exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格上涨的同时代币流入交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },
  {
    id: 'combo.price-down-exchange-inflow',
    kind: 'rule',
    priority: P.priceExchange - 2,
    dimension: 'composite',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'inflow' },
    ],
    sentence: {
      en: 'Price fell while coins moved onto exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格下跌的同时代币流入交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },
  {
    id: 'combo.price-down-exchange-outflow',
    kind: 'rule',
    priority: P.priceExchange - 3,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'outflow' },
    ],
    sentence: {
      en: 'Price fell even as coins left exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格下跌的同时代币仍在流出交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },
  {
    id: 'combo.price-sideways-exchange-inflow',
    kind: 'rule',
    priority: P.priceExchange - 4,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'inflow' },
    ],
    sentence: {
      en: 'Price is flat while coins move onto exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格横盘而代币持续流入交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },
  {
    id: 'combo.price-sideways-exchange-outflow',
    kind: 'rule',
    priority: P.priceExchange - 5,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'sign', feature: 'exchange.flow7', sign: 'outflow' },
    ],
    sentence: {
      en: 'Price is flat while coins leave exchanges: 7-day change {price.7d}, 7-day exchange net flow {exchange.flow7}.',
      zh: '价格横盘而代币持续流出交易所：7 日变化 {price.7d}，近 7 日交易所净流入 {exchange.flow7}。',
    },
  },

  // ── 价格 × 费用 ────────────────────────────────────────
  {
    id: 'combo.price-up-fee-spike',
    kind: 'rule',
    priority: P.priceFees,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'fees.rate7', band: 'high' },
    ],
    sentence: {
      en: 'Price rose alongside a surge in transaction fees: 7-day change {price.7d}, recommended fee rate 7-day change {fees.rate7}.',
      zh: '价格上涨的同时手续费明显走高：7 日变化 {price.7d}，推荐费率 7 日变化 {fees.rate7}。',
    },
  },
  {
    id: 'combo.price-down-fee-spike',
    kind: 'rule',
    priority: P.priceFees - 1,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'fees.rate7', band: 'high' },
    ],
    sentence: {
      en: 'Price fell while transaction fees stayed high: 7-day change {price.7d}, recommended fee rate 7-day change {fees.rate7}.',
      zh: '价格下跌而手续费仍处高位：7 日变化 {price.7d}，推荐费率 7 日变化 {fees.rate7}。',
    },
  },
  {
    id: 'combo.price-up-fee-calm',
    kind: 'rule',
    priority: P.priceFees - 2,
    dimension: 'composite',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'fees.rate7', band: 'low' },
    ],
    sentence: {
      en: 'Price rose with transaction fees still quiet: 7-day change {price.7d}, recommended fee rate 7-day change {fees.rate7}.',
      zh: '价格上涨而手续费仍处低位：7 日变化 {price.7d}，推荐费率 7 日变化 {fees.rate7}。',
    },
  },
  {
    id: 'combo.price-sideways-fee-spike',
    kind: 'rule',
    priority: P.priceFees - 3,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'fees.rate7', band: 'high' },
    ],
    sentence: {
      en: 'Price is flat while transaction fees are elevated: 7-day change {price.7d}, recommended fee rate 7-day change {fees.rate7}.',
      zh: '价格横盘而手续费处于高位：7 日变化 {price.7d}，推荐费率 7 日变化 {fees.rate7}。',
    },
  },

  // ── 价格 × 波动率 ──────────────────────────────────────
  {
    id: 'combo.price-up-vol-high',
    kind: 'rule',
    priority: P.priceVol,
    dimension: 'composite',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'price.vol30', band: 'high' },
    ],
    sentence: {
      en: 'Price rose in an unusually volatile market: 7-day change {price.7d}, 30-day realised volatility {price.vol30}.',
      zh: '价格在一个异常高波动的市场中上涨：7 日变化 {price.7d}，30 日已实现波动率 {price.vol30}。',
    },
  },
  {
    id: 'combo.price-down-vol-high',
    kind: 'rule',
    priority: P.priceVol - 1,
    dimension: 'composite',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'price.vol30', band: 'high' },
    ],
    sentence: {
      en: 'Price fell in an unusually volatile market: 7-day change {price.7d}, 30-day realised volatility {price.vol30}.',
      zh: '价格在一个异常高波动的市场中下跌：7 日变化 {price.7d}，30 日已实现波动率 {price.vol30}。',
    },
  },
  {
    id: 'combo.price-sideways-vol-high',
    kind: 'rule',
    priority: P.priceVol - 2,
    dimension: 'composite',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'price.vol30', band: 'high' },
    ],
    sentence: {
      en: 'Price is flat but volatility is elevated: 7-day change {price.7d}, 30-day realised volatility {price.vol30}.',
      zh: '价格横盘但波动率处于高位：7 日变化 {price.7d}，30 日已实现波动率 {price.vol30}。',
    },
  },

  // ── 价格 × 矿工 ────────────────────────────────────────
  {
    id: 'combo.price-up-hashrate-up',
    kind: 'rule',
    priority: P.priceMining,
    dimension: 'composite',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'mining.hashrate90', band: 'high' },
    ],
    sentence: {
      en: 'Price rose as hashpower kept expanding: 7-day change {price.7d}, 90-day hash rate change {mining.hashrate90}.',
      zh: '价格上涨的同时算力继续扩张：7 日变化 {price.7d}，90 日算力变化 {mining.hashrate90}。',
    },
  },
  {
    id: 'combo.price-down-hashrate-collapse',
    kind: 'rule',
    priority: P.priceMining - 1,
    dimension: 'composite',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'mining.hashrate90', band: 'low' },
    ],
    sentence: {
      en: 'Price fell alongside a contraction in hashpower: 7-day change {price.7d}, 90-day hash rate change {mining.hashrate90}.',
      zh: '价格下跌的同时算力收缩：7 日变化 {price.7d}，90 日算力变化 {mining.hashrate90}。',
    },
  },

  // ── 单一维度：价格 ─────────────────────────────────────
  {
    id: 'price.surge',
    kind: 'rule',
    priority: P.price,
    dimension: 'price',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'price.30d', band: 'high' },
    ],
    sentence: {
      en: 'Price is up strongly on both short and medium horizons: 7-day change {price.7d}, 30-day change {price.30d}.',
      zh: '价格在短中期同时明显上行：7 日变化 {price.7d}，30 日变化 {price.30d}。',
    },
  },
  {
    id: 'price.grind-up',
    kind: 'rule',
    priority: P.price - 1,
    dimension: 'price',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'price.30d', band: 'high' },
    ],
    sentence: {
      en: 'Price is grinding higher over the past month: 30-day change {price.30d}, 7-day change {price.7d}.',
      zh: '价格过去一个月持续抬升：30 日变化 {price.30d}，7 日变化 {price.7d}。',
    },
  },
  {
    id: 'price.rally',
    kind: 'rule',
    priority: P.price - 2,
    dimension: 'price',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'price.30d', band: 'mid' },
    ],
    sentence: {
      en: 'Price jumped over the past week: 7-day change {price.7d}, 30-day change {price.30d}.',
      zh: '价格在过去一周明显跳升：7 日变化 {price.7d}，30 日变化 {price.30d}。',
    },
  },
  {
    id: 'price.rebound',
    kind: 'rule',
    priority: P.price - 3,
    dimension: 'price',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'high' },
      { kind: 'band', feature: 'price.30d', band: 'low' },
    ],
    sentence: {
      en: 'Price is rebounding from a weak month: 7-day change {price.7d}, 30-day change {price.30d}.',
      zh: '价格自弱势的一个月后反弹：7 日变化 {price.7d}，30 日变化 {price.30d}。',
    },
  },
  {
    id: 'price.trend-up',
    kind: 'rule',
    priority: P.price - 4,
    dimension: 'price',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'price.30d', band: 'high' },
      { kind: 'band', feature: 'price.90d', band: 'high' },
    ],
    sentence: {
      en: 'The upward trend holds across one and three months: 30-day change {price.30d}, 90-day change {price.90d}.',
      zh: '一个月与三个月尺度上的上行趋势都还在：30 日变化 {price.30d}，90 日变化 {price.90d}。',
    },
  },
  {
    id: 'price.pullback',
    kind: 'rule',
    priority: P.price - 5,
    dimension: 'price',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'price.30d', band: 'mid' },
    ],
    sentence: {
      en: 'Price is pulling back over the past week: 7-day change {price.7d}, 30-day change {price.30d}.',
      zh: '价格在过去一周回调：7 日变化 {price.7d}，30 日变化 {price.30d}。',
    },
  },
  {
    id: 'price.decline',
    kind: 'rule',
    priority: P.price - 6,
    dimension: 'price',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'low' },
      { kind: 'band', feature: 'price.30d', band: 'low' },
    ],
    sentence: {
      en: 'Price is down on both short and medium horizons: 7-day change {price.7d}, 30-day change {price.30d}.',
      zh: '价格在短期与中期同时下行：7 日变化 {price.7d}，30 日变化 {price.30d}。',
    },
  },
  {
    id: 'price.trend-down',
    kind: 'rule',
    priority: P.price - 7,
    dimension: 'price',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'price.30d', band: 'low' },
      { kind: 'band', feature: 'price.90d', band: 'low' },
    ],
    sentence: {
      en: 'The downward trend holds across one and three months: 30-day change {price.30d}, 90-day change {price.90d}.',
      zh: '一个月与三个月尺度上的下行趋势都还在：30 日变化 {price.30d}，90 日变化 {price.90d}。',
    },
  },
  {
    id: 'price.plateau',
    kind: 'rule',
    priority: P.price - 8,
    dimension: 'price',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'price.30d', band: 'mid' },
      { kind: 'band', feature: 'price.90d', band: 'mid' },
    ],
    sentence: {
      en: 'Price is holding steady: 7-day change {price.7d}, 30-day change {price.30d}, 90-day change {price.90d}.',
      zh: '价格横盘震荡：7 日变化 {price.7d}，30 日变化 {price.30d}，90 日变化 {price.90d}。',
    },
  },
  {
    id: 'price.near-high',
    kind: 'rule',
    priority: P.price - 9,
    dimension: 'price',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'price.30d', band: 'mid' },
      { kind: 'band', feature: 'price.level365', band: 'high' },
    ],
    sentence: {
      en: 'Price is flat but still near a one-year high, {price.level365}.',
      zh: '价格横盘，但仍处于近一年高位：{price.level365}。',
    },
  },
  {
    id: 'price.near-low',
    kind: 'rule',
    priority: P.price - 10,
    dimension: 'price',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'price.7d', band: 'mid' },
      { kind: 'band', feature: 'price.30d', band: 'mid' },
      { kind: 'band', feature: 'price.level365', band: 'low' },
    ],
    sentence: {
      en: 'Price is flat and still near a one-year low, {price.level365}.',
      zh: '价格横盘，且仍处于近一年低位：{price.level365}。',
    },
  },
  {
    id: 'price.deep-drawdown',
    kind: 'rule',
    priority: P.price - 11,
    dimension: 'price',
    family: 'bear',
    conditions: [{ kind: 'below', feature: 'price.drawdown90', value: -30 }],
    sentence: {
      en: 'Price is {price.drawdown90} below its 90-day high.',
      zh: '价格较 90 日高点回撤 {price.drawdown90}。',
    },
  },
  {
    id: 'price.shallow-drawdown',
    kind: 'rule',
    priority: P.price - 12,
    dimension: 'price',
    family: 'neutral',
    conditions: [{ kind: 'above', feature: 'price.drawdown90', value: -5 }],
    sentence: {
      en: 'Price is only {price.drawdown90} below its 90-day high.',
      zh: '价格较 90 日高点仅回撤 {price.drawdown90}。',
    },
  },

  // ── 单一维度：链上活动 ─────────────────────────────────
  {
    id: 'onchain.surging',
    kind: 'rule',
    priority: P.onchain,
    dimension: 'onchain',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'high' },
      { kind: 'band', feature: 'onchain.tx30', band: 'high' },
    ],
    sentence: {
      en: 'On-chain activity is elevated on both measures: active addresses 30-day change {onchain.addresses30}, transaction count 30-day change {onchain.tx30}.',
      zh: '链上活动在两个口径上同时走高：活跃地址 30 日变化 {onchain.addresses30}，交易笔数 30 日变化 {onchain.tx30}。',
    },
  },
  {
    id: 'onchain.addresses-strong',
    kind: 'rule',
    priority: P.onchain - 1,
    dimension: 'onchain',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'high' },
      { kind: 'band', feature: 'onchain.tx30', band: 'mid' },
    ],
    sentence: {
      en: 'More addresses are active, while transaction count stayed in its usual range: 30-day change {onchain.addresses30}.',
      zh: '活跃地址增加，交易笔数仍在常态区间：活跃地址 30 日变化 {onchain.addresses30}。',
    },
  },
  {
    id: 'onchain.tx-strong',
    kind: 'rule',
    priority: P.onchain - 2,
    dimension: 'onchain',
    family: 'bull',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'mid' },
      { kind: 'band', feature: 'onchain.tx30', band: 'high' },
    ],
    sentence: {
      en: 'Transaction count rose while active addresses stayed in its usual range: 30-day change {onchain.tx30}.',
      zh: '交易笔数上升，活跃地址仍在常态区间：交易笔数 30 日变化 {onchain.tx30}。',
    },
  },
  {
    id: 'onchain.diverging',
    kind: 'rule',
    priority: P.onchain - 3,
    dimension: 'onchain',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'high' },
      { kind: 'band', feature: 'onchain.tx30', band: 'low' },
    ],
    sentence: {
      en: 'More addresses are active but fewer transactions are being made: active addresses 30-day change {onchain.addresses30}, transaction count 30-day change {onchain.tx30}.',
      zh: '活跃地址增加但交易笔数减少：活跃地址 30 日变化 {onchain.addresses30}，交易笔数 30 日变化 {onchain.tx30}。',
    },
  },
  {
    id: 'onchain.weak',
    kind: 'rule',
    priority: P.onchain - 4,
    dimension: 'onchain',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'low' },
      { kind: 'band', feature: 'onchain.tx30', band: 'low' },
    ],
    sentence: {
      en: 'On-chain activity is depressed on both measures: active addresses 30-day change {onchain.addresses30}, transaction count 30-day change {onchain.tx30}.',
      zh: '链上活动在两个口径上同时低迷：活跃地址 30 日变化 {onchain.addresses30}，交易笔数 30 日变化 {onchain.tx30}。',
    },
  },
  {
    id: 'onchain.addresses-weak',
    kind: 'rule',
    priority: P.onchain - 5,
    dimension: 'onchain',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'low' },
      { kind: 'band', feature: 'onchain.tx30', band: 'mid' },
    ],
    sentence: {
      en: 'Fewer addresses are active, while transaction count stayed in its usual range: 30-day change {onchain.addresses30}.',
      zh: '活跃地址减少，交易笔数仍在常态区间：活跃地址 30 日变化 {onchain.addresses30}。',
    },
  },
  {
    id: 'onchain.tx-weak',
    kind: 'rule',
    priority: P.onchain - 6,
    dimension: 'onchain',
    family: 'bear',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'mid' },
      { kind: 'band', feature: 'onchain.tx30', band: 'low' },
    ],
    sentence: {
      en: 'Fewer transactions are being made, while active addresses stayed in its usual range: 30-day change {onchain.tx30}.',
      zh: '交易笔数减少，活跃地址仍在常态区间：交易笔数 30 日变化 {onchain.tx30}。',
    },
  },
  {
    id: 'onchain.flat',
    kind: 'rule',
    priority: P.onchain - 7,
    dimension: 'onchain',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'onchain.addresses30', band: 'mid' },
      { kind: 'band', feature: 'onchain.tx30', band: 'mid' },
    ],
    sentence: {
      en: 'On-chain activity is in its usual range: active addresses 30-day change {onchain.addresses30}, transaction count 30-day change {onchain.tx30}.',
      zh: '链上活动处于常态区间：活跃地址 30 日变化 {onchain.addresses30}，交易笔数 30 日变化 {onchain.tx30}。',
    },
  },

  // ── 单一维度：交易所 ───────────────────────────────────
  {
    id: 'exchange.inflow-spike',
    kind: 'rule',
    priority: P.exchange,
    dimension: 'exchange',
    family: 'bear',
    conditions: [
      { kind: 'sign', feature: 'exchange.flow7', sign: 'inflow' },
      { kind: 'band', feature: 'exchange.flow7', band: 'high' },
    ],
    sentence: {
      en: 'Coins are flowing onto exchanges: the 7-day net flow is {exchange.flow7}, {exchange.flow7.band} for its own history.',
      zh: '代币正在流入交易所：近 7 日净流入 {exchange.flow7}，在自身历史上{exchange.flow7.band}。',
    },
  },
  {
    id: 'exchange.outflow-spike',
    kind: 'rule',
    priority: P.exchange - 1,
    dimension: 'exchange',
    family: 'bull',
    conditions: [
      { kind: 'sign', feature: 'exchange.flow7', sign: 'outflow' },
      { kind: 'band', feature: 'exchange.flow7', band: 'high' },
    ],
    sentence: {
      en: 'Coins are leaving exchanges: the 7-day net flow is {exchange.flow7}, {exchange.flow7.band} for its own history.',
      zh: '代币正在离开交易所：近 7 日净流入 {exchange.flow7}，在自身历史上{exchange.flow7.band}。',
    },
  },
  {
    id: 'exchange.sustained-inflow',
    kind: 'rule',
    priority: P.exchange - 2,
    dimension: 'exchange',
    family: 'bear',
    conditions: [
      { kind: 'sign', feature: 'exchange.flow30', sign: 'inflow' },
      { kind: 'band', feature: 'exchange.flow30', band: 'high' },
    ],
    sentence: {
      en: 'Inflows have persisted over the past month: 30-day net flow {exchange.flow30}.',
      zh: '流入已持续一个月：30 日净流入 {exchange.flow30}。',
    },
  },
  {
    id: 'exchange.sustained-outflow',
    kind: 'rule',
    priority: P.exchange - 3,
    dimension: 'exchange',
    family: 'bull',
    conditions: [
      { kind: 'sign', feature: 'exchange.flow30', sign: 'outflow' },
      { kind: 'band', feature: 'exchange.flow30', band: 'high' },
    ],
    sentence: {
      en: 'Outflows have persisted over the past month: 30-day net flow {exchange.flow30}.',
      zh: '流出已持续一个月：30 日净流入 {exchange.flow30}。',
    },
  },
  {
    id: 'exchange.balance-rising',
    kind: 'rule',
    priority: P.exchange - 4,
    dimension: 'exchange',
    family: 'bear',
    conditions: [{ kind: 'band', feature: 'exchange.balance30', band: 'high' }],
    sentence: {
      en: 'Exchange holdings of BTC are {exchange.balance30} over 30 days, {exchange.balance30.band} for their own history.',
      zh: '交易所持有的 BTC 30 日变化 {exchange.balance30}，在自身历史上{exchange.balance30.band}。',
    },
  },
  {
    id: 'exchange.balance-falling',
    kind: 'rule',
    priority: P.exchange - 5,
    dimension: 'exchange',
    family: 'bull',
    conditions: [{ kind: 'band', feature: 'exchange.balance30', band: 'low' }],
    sentence: {
      en: 'Exchange holdings of BTC are {exchange.balance30} over 30 days, {exchange.balance30.band} for their own history.',
      zh: '交易所持有的 BTC 30 日变化 {exchange.balance30}，在自身历史上{exchange.balance30.band}。',
    },
  },
  {
    id: 'exchange.flat',
    kind: 'rule',
    priority: P.exchange - 6,
    dimension: 'exchange',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'exchange.flow7', band: 'mid' },
      { kind: 'band', feature: 'exchange.balance30', band: 'mid' },
    ],
    sentence: {
      en: 'Exchange flows are unremarkable: 7-day net flow {exchange.flow7}, holdings 30-day change {exchange.balance30}.',
      zh: '交易所流向平淡：近 7 日净流入 {exchange.flow7}，持有量 30 日变化 {exchange.balance30}。',
    },
  },

  // ── 单一维度：费用 ─────────────────────────────────────
  {
    id: 'fees.spike',
    kind: 'rule',
    priority: P.fees,
    dimension: 'fees',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'high' },
      { kind: 'band', feature: 'fees.total7', band: 'high' },
    ],
    sentence: {
      en: 'Block space is in demand: recommended fee rate 7-day change {fees.rate7}, network fees 7-day change {fees.total7}.',
      zh: '区块空间趋紧：推荐费率 7 日变化 {fees.rate7}，全网手续费 7 日变化 {fees.total7}。',
    },
  },
  {
    id: 'fees.rate-only-high',
    kind: 'rule',
    priority: P.fees - 1,
    dimension: 'fees',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'high' },
      { kind: 'band', feature: 'fees.total7', band: 'mid' },
    ],
    sentence: {
      en: 'The recommended fee rate is elevated while total fees stayed in their usual range: 7-day change {fees.rate7}.',
      zh: '推荐费率偏高而全网手续费仍在常态区间：7 日变化 {fees.rate7}。',
    },
  },
  {
    id: 'fees.total-only-high',
    kind: 'rule',
    priority: P.fees - 2,
    dimension: 'fees',
    family: 'mixed',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'mid' },
      { kind: 'band', feature: 'fees.total7', band: 'high' },
    ],
    sentence: {
      en: 'Total network fees are elevated while the recommended rate stayed in its usual range: 7-day change {fees.total7}.',
      zh: '全网手续费偏高而推荐费率仍在常态区间：7 日变化 {fees.total7}。',
    },
  },
  {
    id: 'fees.calm',
    kind: 'rule',
    priority: P.fees - 3,
    dimension: 'fees',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'low' },
      { kind: 'band', feature: 'fees.total7', band: 'low' },
    ],
    sentence: {
      en: 'Block space is quiet: recommended fee rate 7-day change {fees.rate7}, network fees 7-day change {fees.total7}.',
      zh: '区块空间宽松：推荐费率 7 日变化 {fees.rate7}，全网手续费 7 日变化 {fees.total7}。',
    },
  },
  {
    id: 'fees.rate-only-low',
    kind: 'rule',
    priority: P.fees - 4,
    dimension: 'fees',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'low' },
      { kind: 'band', feature: 'fees.total7', band: 'mid' },
    ],
    sentence: {
      en: 'The recommended fee rate is low while total fees stayed in their usual range: 7-day change {fees.rate7}.',
      zh: '推荐费率偏低而全网手续费仍在常态区间：7 日变化 {fees.rate7}。',
    },
  },
  {
    id: 'fees.total-only-low',
    kind: 'rule',
    priority: P.fees - 5,
    dimension: 'fees',
    family: 'neutral',
    conditions: [
      { kind: 'band', feature: 'fees.rate7', band: 'mid' },
      { kind: 'band', feature: 'fees.total7', band: 'low' },
    ],
    sentence: {
      en: 'Total network fees are low while the recommended rate stayed in its usual range: 7-day change {fees.total7}.',
      zh: '全网手续费偏低而推荐费率仍在常态区间：7 日变化 {fees.total7}。',
    },
  },

  // ── 单一维度：矿工 ─────────────────────────────────────
  {
    id: 'mining.hashrate-collapse',
    kind: 'rule',
    priority: P.mining,
    dimension: 'mining',
    family: 'bear',
    conditions: [{ kind: 'band', feature: 'mining.hashrate90', band: 'low' }],
    sentence: {
      en: 'Hashpower contracted: 90-day change {mining.hashrate90}, {mining.hashrate90.band} for its own history.',
      zh: '算力出现收缩：90 日变化 {mining.hashrate90}，在自身历史上{mining.hashrate90.band}。',
    },
  },
  {
    id: 'mining.hashrate-boom',
    kind: 'rule',
    priority: P.mining - 1,
    dimension: 'mining',
    family: 'bull',
    conditions: [{ kind: 'band', feature: 'mining.hashrate90', band: 'high' }],
    sentence: {
      en: 'Hashpower expanded quickly: 90-day change {mining.hashrate90}, {mining.hashrate90.band} for its own history.',
      zh: '算力快速扩张：90 日变化 {mining.hashrate90}，在自身历史上{mining.hashrate90.band}。',
    },
  },
  {
    id: 'mining.concentration-high',
    kind: 'rule',
    priority: P.mining - 2,
    dimension: 'mining',
    family: 'bear',
    conditions: [{ kind: 'band', feature: 'mining.pool30', band: 'high' }],
    sentence: {
      en: 'Block production is concentrated in fewer pools: the Herfindahl index 30-day change is {mining.pool30}.',
      zh: '出块集中于更少的矿池：赫芬达尔指数 30 日变化 {mining.pool30}。',
    },
  },
  {
    id: 'mining.concentration-low',
    kind: 'rule',
    priority: P.mining - 3,
    dimension: 'mining',
    family: 'neutral',
    conditions: [{ kind: 'band', feature: 'mining.pool30', band: 'low' }],
    sentence: {
      en: 'Block production is spread more evenly across pools: the Herfindahl index 30-day change is {mining.pool30}.',
      zh: '出块在矿池之间分布更均匀：赫芬达尔指数 30 日变化 {mining.pool30}。',
    },
  },

  // ── 单一维度：波动率 ───────────────────────────────────
  {
    id: 'volatility.high',
    kind: 'rule',
    priority: P.volatility,
    dimension: 'volatility',
    family: 'neutral',
    conditions: [{ kind: 'band', feature: 'price.vol30', band: 'high' }],
    sentence: {
      en: 'Realised volatility is high: 30-day annualised volatility {price.vol30}.',
      zh: '已实现波动率处于高位：30 日年化波动率 {price.vol30}。',
    },
  },
  {
    id: 'volatility.low',
    kind: 'rule',
    priority: P.volatility - 1,
    dimension: 'volatility',
    family: 'neutral',
    conditions: [{ kind: 'band', feature: 'price.vol30', band: 'low' }],
    sentence: {
      en: 'Realised volatility is low: 30-day annualised volatility {price.vol30}.',
      zh: '已实现波动率处于低位：30 日年化波动率 {price.vol30}。',
    },
  },
  {
    id: 'volatility.calm',
    kind: 'rule',
    priority: P.volatility - 2,
    dimension: 'volatility',
    family: 'neutral',
    conditions: [{ kind: 'band', feature: 'price.vol30', band: 'mid' }],
    sentence: {
      en: 'Realised volatility is in its usual range: 30-day annualised volatility {price.vol30}.',
      zh: '已实现波动率处于常态区间：30 日年化波动率 {price.vol30}。',
    },
  },

  // ── 兜底 ───────────────────────────────────────────────
  {
    id: 'conflict.signals-disagree',
    kind: 'conflict',
    priority: P.conflict,
    dimension: 'composite',
    family: 'mixed',
    conditions: [],
    sentence: {
      en: 'Signals from different dimensions point in opposite directions, so no single reading is supported.',
      zh: '不同维度的信号方向相反，因此无法给出单一的读数。',
    },
  },
  {
    id: 'fallback.no-clear-signal',
    kind: 'fallback',
    priority: P.fallback,
    dimension: 'composite',
    family: 'neutral',
    conditions: [],
    sentence: {
      en: 'No dimension is deviating from its usual range: 7-day change {price.7d}, active addresses 30-day change {onchain.addresses30}.',
      zh: '各维度都未偏离常态区间：7 日变化 {price.7d}，活跃地址 30 日变化 {onchain.addresses30}。',
    },
  },
  {
    id: 'unknown.insufficient-evidence',
    kind: 'unknown',
    priority: 0,
    dimension: 'composite',
    family: 'neutral',
    conditions: [],
    sentence: {
      en: 'There is not enough usable data to describe the market right now.',
      zh: '当前可用数据不足以描述市场状况。',
    },
  },
]

export const SCENARIO_BY_ID: Readonly<Record<string, MarketScenario>> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
)

/**
 * 方向族 → 展示语义的默认映射。
 *
 * 规则表里绝大多数条目本来就是"条件明显变好"或"条件明显变差"，
 * 因此默认跟随方向族；只有少数几条需要单独说明（见 TONE_OVERRIDE）。
 */
const FAMILY_TONE: Readonly<Record<ScenarioFamily, MarketTone>> = {
  bull: 'improving',
  bear: 'deteriorating',
  neutral: 'neutral',
  mixed: 'neutral',
}

/**
 * 与方向族不同的少数几条。每条都必须写得出理由，否则不许进这张表。
 *
 * 目前只有交易所流向的两条"方向反转"：
 * 它们的方向族是为冲突判定服务的（与同族的净流入/净流出尖峰保持一致），
 * 而展示语义要按"代币是流向交易所还是离开交易所"来读——
 * 流入交易所是 deteriorating，离开交易所是 improving。
 */
const TONE_OVERRIDE: Readonly<Record<string, MarketTone>> = {
  'exchange.crossing-in': 'deteriorating',
  'exchange.crossing-out': 'improving',
}

/**
 * 一条规则的展示语义。
 *
 * 页面层只拿这个结论去选底色，不去读规则表——
 * 否则"哪个指标算好"的知识又会长到页面里（CLAUDE.md §架构边界 4）。
 */
export function toneOf(scenario: MarketScenario): MarketTone {
  return TONE_OVERRIDE[scenario.id] ?? FAMILY_TONE[scenario.family]
}
