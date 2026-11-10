/**
 * BTC 估值 / 周期类指标。
 *
 * 这一类的共同点：都不是链上某个计数器，而是**用价格序列推出来的结论**。
 * 因此它们的口径说明比数字本身更重要——读者必须知道结论建立在哪些假设上，
 * 否则"412 天"会被当成一个客观事实，而它其实是一个模型的输出（ADR-014）。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import { cmEndpoint } from './market.js'

export const marketCap = defineMetric({
  id: 'market-cap',
  asset: 'btc',
  category: 'valuation',
  name: { en: 'Market Cap', zh: '市值' },
  description: {
    en: 'The circulating BTC supply valued at the price of the same day.',
    zh: '按当日价格计算的流通中 BTC 总量市值。',
  },
  methodology: {
    en: 'Published by Coin Metrics as circulating supply × price at the last observation of the UTC day. Shown here unmodified: Signal does not recompute it from its own supply and price series, so it may differ in the last digits from Supply × Price.',
    zh: '由 Coin Metrics 给出，为流通量 × 该 UTC 自然日最后观测价格。此处原样展示：Signal 不用自己的供应量与价格序列重算，因此末位数字可能与"流通量 × 价格"略有出入。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  contract: {
    unit: 'usd',
    scale: 1,
    aggregation: 'last',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'CapMrktCurUSD',
      endpoint: cmEndpoint('CapMrktCurUSD'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Free-tier history starts 2010-07-18, the first day the source carries a BTC price.',
      zh: '免费层历史自 2010-07-18 起，与价格指标同一起点。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

/** 回测窗口：10 年。日频 × 3653 天，起点枚举的规模就是这个数。 */
export const DCA_WINDOW_DAYS = 3650

/**
 * MVRV（市值 / 已实现市值）。
 *
 * 散户看得最多的估值指标，含义直白：大于 1 表示当前价格高于"这批币平均花多少钱买的"，
 * 小于 1 表示低于。**它不是收益率预测**，只是把"贵不贵"换算成一个可比的比值。
 *
 * 口径上必须说清一件事：免 key 层只给当前市值口径（`CapMVRVCur`），
 * 同族的已实现市值（`CapRealUSD`）与 MVRV 地板价口径（`CapMVRVFF`）都是付费墙。
 * 因此这个指标**不能被反推回去算出已实现价格**——读者若要那个数，得自己上付费源。
 */
export const mvrv = defineMetric({
  id: 'mvrv',
  asset: 'btc',
  category: 'valuation',
  // 表格里指标名要能占一行。"MVRV（市值 / 已实现市值）"在 1366 宽度下要 180px，
  // 而指标列只有 124px —— 名字一长，撑开的是行高而不是信息量。
  // 括号里的口径说明留在 description 与详情页里，表格那一格只留名字。
  name: { en: 'MVRV Ratio', zh: 'MVRV 比值' },
  description: {
    en: 'Circulating market cap divided by realised market cap. Above 1 means the current price is above what the coins in circulation cost, on average, to acquire; below 1 means it is below. It is a valuation ratio, not a return forecast.',
    zh: '流通市值除以已实现市值。大于 1 表示当前价格高于现存这批币平均的取得成本，小于 1 表示低于。这是个估值比值，不是收益预测。',
  },
  methodology: {
    en: 'Published by Coin Metrics as CapMVRVCur: circulating supply × current price, divided by realised cap. Realised cap is accumulated as supply times price at the time each coin is last moved, so the ratio answers "how far is today’s price from what holders actually paid", not "how high can price go". Only the current-cap numerator is available on the free tier — the realised-cap series itself (CapRealUSD) and the floor-price variant (CapMVRVFF) are behind a paid key — so the realised price cannot be recovered from this figure.',
    zh: '由 Coin Metrics 以 CapMVRVCur 给出：流通量 × 当前价格，除以已实现市值。已实现市值按"每枚币最后一次移动时的价格"逐枚累加，因此这个比值回答的是"今天的价格离持有者实际付出的成本有多远"，而不是"价格还能涨到多高"。免 key 层只有分子：已实现市值序列（CapRealUSD）与地板价口径（CapMVRVFF）都在付费墙之后，因此无法由这个数反推已实现价格。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 2 },
  contract: {
    unit: 'index',
    scale: 1,
    aggregation: 'last',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'CapMVRVCur',
      endpoint: cmEndpoint('CapMVRVCur'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Free-tier history starts 2010-07-18. Realised cap needs a price for every earlier day, so the series cannot extend beyond what the free price history covers.',
      zh: '免费层历史自 2010-07-18 起。已实现市值依赖此前每一天的价格，因此该序列的长度不可能超过免费价格历史的长度。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

/**
 * 定投首次达到 +5% 的最长等待期。
 *
 * 为什么值得做成首页头条：它是这批指标里唯一一个**直接回答"我要等多久"**的数。
 * 波动率、算力、费率描述的是当下状态，只有它描述的是"从现在开始做这件事"的时间成本。
 *
 * 口径上的两个必须说清楚的地方：
 * 1. 它是**已达标样本**里的最大值。窗口内还有一批起点至今没达到 +5%，
 *    它们被单独计数（右删失），不参与取最大值——"还没答案"不是"答案是零"。
 * 2. 它**不是收益承诺**。它描述的是历史，不是未来，也不构成任何买卖建议。
 */
export const dcaMaxWaitDays = defineMetric({
  id: 'dca-max-wait-days',
  asset: 'btc',
  category: 'valuation',
  name: {
    en: 'Longest Wait to +5% (Reached Start Days)',
    zh: '定投 +5%：已达标样本中的最长等待期',
  },
  description: {
    en: 'Among the start days in the last ten years whose daily-investment position did reach +5%, the longest wait before it got there. Some start days have still not reached +5% and are not part of this figure. Fees, slippage and taxes are not included.',
    zh: '在过去十年的起点日里，那些定投组合确实达到过 +5% 的样本中，最长的一次等待用了多少天。仍有部分起点至今尚未达到 +5%，它们不计入这个数字。未计入手续费、滑点与税。',
  },
  methodology: {
    en: 'For each start day s in the last 3,650 days, buy 1 USD of BTC every day from s onward at that day’s published price, holding fractional BTC. On day k the position is worth shares × price, where shares accumulates 1/price per day, and cumulative cost is k + 1 USD; the return is shares × price / (k + 1) − 1. The first day that return exceeds +5% is that start day’s wait. The headline number is the largest such wait over the start days that reached the target. Start days whose path never exceeds +5% within the available data are excluded and counted separately — they are right-censored, not “zero”, and the count is published alongside the value. Start days whose path crosses a day with no published price are counted separately as void for a missing price. The history series repeats this whole computation as of each day, so the chart shows how the worst case moved, not a flat line. Fees, slippage and taxes are excluded, so a real-world position would reach the target later than this figure.',
    zh: '对最近 3650 天内的每一个起始日 s，自 s 起每天按当日公布价格买入 1 美元的 BTC，允许持有小数份额。到第 k 天时持仓市值为 shares × price，其中 shares 按每天累加 1/price，累计投入为 k + 1 美元，收益率即 shares × price / (k + 1) − 1。收益率首次超过 +5% 的那一天，就是该起始日的等待天数。首页头条显示的数字，是达到过标的那些起点里最长的等待。路径上始终未超过 +5% 的起始日会被排除并单独计数——它们是右删失观测，不是"零"，该计数与数值一并发布；路径上穿过缺价日的起始日则单独计为"因缺价作废"。历史序列对每一天都把整套计算重做一遍，因此曲线展示的是"最坏情况"如何变化，而不是一条平线。未计入手续费、滑点与税，因此实际持仓达标的时间会比这个数更晚。',
  },
  unit: 'days',
  frequency: '1d',
  format: { kind: 'days' },
  contract: {
    unit: 'days',
    scale: 1,
    aggregation: 'last',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'PriceUSD',
      endpoint: cmEndpoint('PriceUSD'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  deriveFrom: ['price'],
  derivation: {
    kind: 'dcaMaxWait',
    base: 'price',
    thresholdPercent: 5,
    windowDays: DCA_WINDOW_DAYS,
  },
  // 保留 7 日变化列：这个数本身是"最长等待"，读者关心的是它有没有在变坏。
  // 它没有歧义（恒为非负整数），不像净流入那样符号一翻就失去百分比含义。
  changeWindowDays: 7,
  computedLocally: true,
  history: {
    availableFrom: '2020-07-14',
    note: {
      en: 'The series starts once ten years of daily prices exist. Free-tier price history begins 2010-07-18, so the first day that can fill a 3,650-day start-day window is 2020-07-14; before that there is not enough history behind the window.',
      zh: '序列自攒够十年日频价格之后才开始。免费层价格历史始于 2010-07-18，因此最早能填满 3650 天起点窗口的那一天是 2020-07-14；在此之前窗口背后没有足够的历史。',
    },
    // 窗口每日前移一格，最坏起点可能整体换人：同一根柱子下
    // "哪一天开始投"这个答案会被后加入的数据改写。
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
