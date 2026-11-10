/**
 * BTC 市场类指标。
 *
 * 全部来自 Coin Metrics Community API（免 key，实测可用）。
 * 付费墙内的美元费用类指标整族不可用，见 ADR-002。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'

/** 上游端点拼装。写进 sources 供读者自行核查，不靠"来源可信"这种空话。 */
export const cmEndpoint = (metric: string): string =>
  `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=${metric}&frequency=1d`

export const price = defineMetric({
  id: 'price',
  asset: 'btc',
  category: 'market',
  name: { en: 'Price', zh: '价格' },
  description: {
    en: 'Daily average BTC price in US dollars, one point per UTC day.',
    zh: 'BTC 以美元计的日均价，每个 UTC 自然日一个点。',
  },
  methodology: {
    en: 'Arithmetic mean of the reference-exchange USD quotes within 00:00–24:00 UTC, aggregated by Coin Metrics from its reference exchange feed. It is not a closing price and not a volume-weighted average.',
    zh: 'Coin Metrics 依据其参考交易所行情聚合出的 00:00–24:00 UTC 区间内全部美元报价的算术平均。既不是收盘价，也不是成交量加权价。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  contract: {
    unit: 'usd',
    scale: 1,
    aggregation: 'mean',
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
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Free-tier history starts 2010-07-18, the first day the source carries a BTC reference price.',
      zh: '免费层历史自 2010-07-18 起，那是数据源最早有 BTC 参考价的日期。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const supply = defineMetric({
  id: 'supply',
  asset: 'btc',
  category: 'market',
  name: { en: 'Circulating Supply', zh: '流通量' },
  description: {
    en: 'The total BTC mined so far, as tracked by the source.',
    zh: '截至当日已挖出的 BTC 总量，由数据源统计。',
  },
  methodology: {
    en: 'Cumulative count of block subsidy outputs, taken from the source’s daily series and reported as the last observation of each UTC day. This is a count of coins that exist, not a valuation.',
    zh: '区块补贴产出的累计计数，取自数据源的日频序列，按每个 UTC 自然日的最后观测值记录。这是"存在多少枚币"的计数，不是估值。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  contract: {
    unit: 'btc',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'SplyCur',
      endpoint: cmEndpoint('SplyCur'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2009-02-01',
    note: {
      en: 'Available from the source’s first BTC day. The BTC supply is fixed by the halving schedule up to mined decimals.',
      zh: '自数据源最早的 BTC 数据日起可得。BTC 供应量由减半计划决定，仅有挖出的小数部分是浮动的。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const priceChange7d = defineMetric({
  id: 'price-change-7d',
  asset: 'btc',
  category: 'market',
  name: { en: '7-Day Price Change', zh: '7 日价格变化' },
  description: {
    en: 'How far the daily BTC price moved over the last seven days, as a percentage.',
    zh: 'BTC 日均价在最近七天内的变化幅度，以百分比表示。',
  },
  methodology: {
    en: '(P_t / P_t−7 − 1) × 100, where P_t is the latest daily price and P_t−7 the price seven UTC days earlier, both from the Price series. Days are aligned on the calendar; if either day is missing the point is null and nothing is interpolated.',
    zh: '（P_t / P_t−7 − 1）× 100，其中 P_t 为最新日均价，P_t−7 为 7 个 UTC 日前的日均价，两点均取自价格序列。按日历日对齐；任一天缺失则该点记为 null，不做插值。',
  },
  unit: 'percent',
  frequency: '1d',
  format: { kind: 'percent', maxDecimals: 1 },
  contract: {
    unit: 'percent',
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
  derivation: { kind: 'percentChange', base: 'price', windowDays: 7 },
  // 它本身就是"7 天变化"，再对它算一次变化只会给读者一个无意义的百分比
  changeWindowDays: null,
  history: {
    availableFrom: '2010-07-25',
    note: {
      en: 'Needs seven days of price history, so it starts one week after the Price series does.',
      zh: '需要连续 7 天的价格历史，因此比价格指标晚一周开始。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
