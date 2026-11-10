/**
 * 每个指标的状态词表。
 *
 * 为什么逐个指标写词，而不是统一成"高 / 中 / 低"：
 * 统一之后表格会读成一支温度计，而不是产品。费率说"拥堵"、
 * 净流入说"净流入"、活跃地址说"放量"——**词本身就是这个指标特有的那句话**，
 * 读者不用点进详情页就知道这一行在说什么。
 *
 * 三条约束（CLAUDE.md §视觉红线 §状态色）：
 *
 * 1. **中文不超过 3 个字。** 状态列要能被一眼扫完。
 *    `packages/metrics/test/status.test.ts` 逐条断言字数上限。
 * 2. **词只描述"相对自身历史的位置"，不含投资建议。**
 *    "偏强"= 比过去 80% 的日子高，**不等于"该买"**。
 *    禁止词（适合定投 / 该买 / 底部 / 超买 …）由 `copy.test.ts` 守着。
 * 3. **每个词都要有真实数据可依。** 判不出来时显示"缺数据"并说明原因，
 *    不许为了让表格好看而填一个词。
 *
 * 为什么不出现"超买 / 超卖"：那是从 RSI 一路传下来的技术分析用语，
 * 而本站没有 RSI、MVRV 之外也没有任何振荡器。把一个分位档叫成"超买"，
 * 等于借了一个读者已经内建好的结论，而那个结论并不来自我们的计算。
 * 所以这里用"拥堵 / 正常 / 宽松"这类**可从数值本身读懂**的词。
 */

import type { LocalizedText, StatusSpec } from './status.js'

/** 便捷构造：一组三档位词。索引 0 = low，1 = mid，2 = high。 */
function band(
  low: readonly [string, string],
  mid: readonly [string, string],
  high: readonly [string, string],
): readonly [LocalizedText, LocalizedText, LocalizedText] {
  return [
    { en: low[0], zh: low[1] },
    { en: mid[0], zh: mid[1] },
    { en: high[0], zh: high[1] },
  ]
}

/**
 * 全部状态判定。
 *
 * `featureId` 一律指向 `market/features.ts` 里已注册的特征，
 * 且 `status.test.ts` 会断言这里的每个 id 都真实存在——
 * 写错一个 id 会静默变成"永远判不出来"，而不是编译报错。
 */
export const STATUS_SPECS: readonly StatusSpec[] = [
  {
    metricId: 'price',
    featureId: 'price.level365',
    // 价格是个水平量，"低位 / 偏高"说的是它在近一年里的位置，
    // 不是"便宜 / 贵"——后者需要拿 MVRV 之类与持有成本比的东西才成立。
    words: band(['low', '低位'], ['mid', '中性'], ['high', '偏高']),
  },
  {
    metricId: 'price-change-7d',
    featureId: 'price.7d',
    // 指标本身就是七日涨跌幅（ADR-016），分位说的是"这轮涨跌在历史上算大还是小"
    words: band(['pullback', '回落'], ['flat', '横盘'], ['up', '上行']),
  },
  {
    metricId: 'supply',
    featureId: 'supply.supply90',
    // 看的是**发行速度**而不是供应量本身：供应量单调递增，
    // 对它取水平分位永远是"高位"，那句话就没有信息量。
    words: band(['slow', '低速'], ['normal', '平稳'], ['issuance', '增发']),
  },
  {
    metricId: 'market-cap',
    featureId: 'price.level365',
    // 市值 = 流通量 × 价格，量几乎不动，因此它与价格同档。
    // 仍然单列一行：读者关心市值口径，而不只是价格。
    words: band(['low', '低位'], ['mid', '中性'], ['high', '偏高']),
  },
  {
    metricId: 'mvrv',
    featureId: 'valuation.mvrv',
    words: band(['discount', '折价'], ['fair', '合理'], ['premium', '溢价']),
  },
  {
    metricId: 'exchange-netflow',
    featureId: 'exchange.flow7',
    // 带符号的量走下面的 `flow` 分支，这组词只在符号算不出来时兜底，
    // 因此它描述的是**量的大小**而不是方向。
    words: band(['small', '少量'], ['normal', '平稳'], ['large', '大量']),
    flow: {
      inflow: { en: 'inflow', zh: '净流入' },
      outflow: { en: 'outflow', zh: '净流出' },
      flat: { en: 'flat', zh: '持平' },
    },
    // 涨价 + 币在离开交易所，是"手上有币的人不急着卖"的一个可核对事实。
    // 它不是背离的"好/坏"判断，只是两个指标的方向相反这件事本身。
    divergence: { featureId: 'price.7d', againstBand: 'high', word: { en: 'diverging', zh: '背离' } },
  },
  {
    metricId: 'exchange-balance',
    featureId: 'exchange.balance30',
    words: band(['falling', '减少'], ['flat', '平稳'], ['rising', '增加']),
  },
  {
    metricId: 'pool-concentration',
    featureId: 'mining.pool30',
    words: band(['spread', '分散'], ['flat', '平稳'], ['concentrated', '集中']),
  },
  {
    metricId: 'active-addresses',
    featureId: 'onchain.addresses30',
    words: band(['cooling', '转冷'], ['normal', '平稳'], ['active', '活跃']),
  },
  {
    metricId: 'tx-count',
    featureId: 'onchain.tx30',
    words: band(['falling', '缩量'], ['normal', '平稳'], ['busy', '放量']),
  },
  {
    metricId: 'block-count',
    featureId: 'onchain.blocks7',
    words: band(['low', '偏低'], ['normal', '平稳'], ['high', '偏高']),
  },
  {
    metricId: 'fees-total',
    featureId: 'fees.total7',
    words: band(['low', '低位'], ['normal', '平稳'], ['high', '高位']),
  },
  {
    metricId: 'recommended-fee-rate',
    featureId: 'fees.rate7',
    // 费率是**拥堵的度量**：费率低 = 区块空间不紧张。
    words: band(['loose', '宽松'], ['normal', '正常'], ['congested', '拥堵']),
  },
  {
    metricId: 'block-weight',
    featureId: 'fees.weight7',
    words: band(['light', '偏轻'], ['normal', '平稳'], ['heavy', '偏重']),
  },
  {
    metricId: 'hashrate',
    featureId: 'mining.hashrate90',
    words: band(['falling', '回落'], ['flat', '平稳'], ['rising', '上升']),
  },
  {
    metricId: 'difficulty',
    featureId: 'mining.difficulty90',
    words: band(['easing', '回调'], ['flat', '平稳'], ['rising', '上调']),
  },
  {
    metricId: 'miner-revenue-usd',
    featureId: 'mining.revenue30',
    words: band(['falling', '回落'], ['flat', '平稳'], ['rising', '上升']),
  },
]

export const STATUS_SPEC_BY_METRIC: ReadonlyMap<string, StatusSpec> = new Map(
  STATUS_SPECS.map((s) => [s.metricId, s]),
)