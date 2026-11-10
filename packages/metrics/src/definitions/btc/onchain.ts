/**
 * BTC 链上活动指标。
 *
 * 前三个是客观计数；后两个依赖数据商的交易所地址聚类，
 * 因此 labelConfidence 为 heuristic，文案里不给出"交易所"的下定义式表述
 * （见 `docs/METRIC_AUTHORING.md` §标签可信度）。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import { cmEndpoint } from './market.js'

const GENESIS_HISTORY = {
  availableFrom: '2009-02-01',
  note: {
    en: 'Available from the source’s first BTC day.',
    zh: '自数据源最早的 BTC 数据日起可得。',
  },
  mayBeRevised: false,
} as const

export const activeAddresses = defineMetric({
  id: 'active-addresses',
  asset: 'btc',
  category: 'onchain',
  name: { en: 'Active Addresses', zh: '活跃地址数' },
  description: {
    en: 'Distinct addresses that sent or received a transaction that day. A rough read on how many independent parties used the network.',
    zh: '当日有发送或接收交易的去重地址数量，用来粗略反映当天有多少独立参与方在使用这条链。',
  },
  methodology: {
    en: 'Distinct address count per UTC day: an address counts once for the day if it appears as an input or an output address in any transaction confirmed that day. Reported by the source as a daily count. One address is still one address whether it moved one satoshi or a large balance.',
    zh: '按 UTC 自然日统计的去重地址数：某地址当日只要出现在任一确认交易的输入或输出中，当天就计一次。它不区分该地址当日转的是 1 聪还是一大笔余额。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'count',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'AdrActCnt',
      endpoint: cmEndpoint('AdrActCnt'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    ...GENESIS_HISTORY,
    note: {
      en: 'Available from the source’s first BTC day. The source may restate past values when its address coverage changes, so early history is less stable than recent history.',
      zh: '自数据源最早的 BTC 数据日起可得。数据源在调整地址覆盖范围时可能重述历史值，因此越早的历史越不稳定。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const txCount = defineMetric({
  id: 'tx-count',
  asset: 'btc',
  category: 'onchain',
  name: { en: 'Transaction Count', zh: '交易笔数' },
  description: {
    en: 'Transactions confirmed that day. A count of records, not of coins moved.',
    zh: '当日确认的交易笔数。这里数的是交易条数，不是转账的币量。',
  },
  methodology: {
    en: 'Count of transactions whose confirmation falls inside the UTC day. Excludes unconfirmed transactions and transactions that were dropped from the mempool. Not transaction volume in BTC, and not the number of unspent outputs.',
    zh: '确认时间落在该 UTC 自然日内的交易笔数。不含未确认交易，也不含被内存池丢弃的交易。它不是 BTC 转账量，也不是未花费输出个数。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'count',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'TxCnt',
      endpoint: cmEndpoint('TxCnt'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...GENESIS_HISTORY },
  missingPolicy: 'null',
  betterWhen: null,
})

export const blockCount = defineMetric({
  id: 'block-count',
  asset: 'btc',
  category: 'onchain',
  name: { en: 'Blocks', zh: '出块数' },
  description: {
    en: 'Blocks mined that day.',
    zh: '当日挖出的区块数。',
  },
  methodology: {
    en: 'Count of blocks whose block timestamp falls inside the UTC day. Long-run this sits near 144 per day; a shortfall means blocks were missed or the day was cut short at the boundary.',
    zh: '区块时间戳落在该 UTC 自然日内的区块数。长期来看每天接近 144 个；偏低说明有区块没挖出来，或该日在边界处被截断。',
  },
  unit: 'blocks',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'blocks',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'BlkCnt',
      endpoint: cmEndpoint('BlkCnt'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...GENESIS_HISTORY },
  missingPolicy: 'null',
  betterWhen: null,
})

export const exchangeNetflow = defineMetric({
  id: 'exchange-netflow',
  asset: 'btc',
  category: 'exchange',
  name: { en: 'Exchange Netflow', zh: '交易所净流入' },
  description: {
    en: 'BTC moving into addresses the source labels as exchanges, minus BTC moving out, per day. Positive means net movement onto exchanges under that labelling.',
    zh: '按数据源标注为交易所的地址流入的 BTC，减去流出的部分。净值为正表示按该标注口径有 BTC 净流入交易所。',
  },
  methodology: {
    en: 'FlowInExNtv(t) − FlowOutExNtv(t), summed over the UTC day, in BTC. Computed by Signal from two published source series. Which addresses count as exchange addresses is the source provider’s own clustering, so the split between "exchange" and "other holder" follows that provider’s classification rather than anything the chain itself records. Where either series is missing a day, that day is null.',
    zh: 'FlowInExNtv(t) − FlowOutExNtv(t)，按 UTC 自然日求和，单位 BTC，由 Signal 用两条已发布的上游序列相减得到。哪些地址算交易所地址，由数据商自己的聚类决定，因此"交易所"与"其他持有者"的划分沿用该数据商的归类方式，而非链上可查的事实。任一序列当天缺失，该天记为 null。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  contract: {
    unit: 'btc',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.exchangeCluster,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'FlowInExNtv',
      endpoint: cmEndpoint('FlowInExNtv'),
      auth: 'none',
      labelConfidence: 'heuristic',
    },
    {
      provider: 'Coin Metrics',
      metric: 'FlowOutExNtv',
      endpoint: cmEndpoint('FlowOutExNtv'),
      auth: 'none',
      labelConfidence: 'heuristic',
    },
  ],
  derivation: { kind: 'difference', left: 'FlowInExNtv', right: 'FlowOutExNtv' },
  // 净流入可以为负（流出大于流入），因此不展示"较 7 天前变化了 %"：
  // 从 +837 变成 −163 算出来是 −119%，与读者看到的事实正好相反。
  canBeNegative: true,
  changeWindowDays: null,
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Exchange flow series start with the source’s exchange-labelled address set, which grows over time; early history therefore covers fewer addresses than recent history.',
      zh: '交易所流量序列随数据源标注的交易所地址集合增长而变长，因此早期历史覆盖的地址少于近期历史。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const exchangeBalance = defineMetric({
  id: 'exchange-balance',
  asset: 'btc',
  category: 'exchange',
  name: { en: 'Exchange Balance', zh: '交易所持币量' },
  description: {
    en: 'BTC held by the addresses the source labels as exchanges, as of each day. A common way to watch how much of the float sits in exchange custody.',
    zh: '数据源标注为交易所的地址所持有的 BTC 存量。常见用法是观察有多少流通筹码放在交易所托管。',
  },
  methodology: {
    en: 'Sum of the balances of the source’s exchange-labelled addresses, as the last observation of each UTC day, in BTC. Address-to-exchange attribution comes from the provider’s cluster labels; it changes when the provider revises its address list, and such revisions also restate earlier values.',
    zh: '数据源标注为交易所的地址余额之和，取每个 UTC 自然日的最后观测值，单位 BTC。地址归属来自数据商的聚类标注；数据商修订地址表时归属会变，早期数值也会被一并重述。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  contract: {
    unit: 'btc',
    scale: 1,
    aggregation: 'last',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.exchangeCluster,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'SplyExNtv',
      endpoint: cmEndpoint('SplyExNtv'),
      auth: 'none',
      labelConfidence: 'heuristic',
    },
  ],
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Depends on the source’s exchange address list, which extends backwards over time; values before that list reaches back are absent rather than zero.',
      zh: '取决于数据源的交易所地址表，该表会随时间向前追溯补全；覆盖不到的历史区间为缺失，而不是零。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
