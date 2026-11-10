/**
 * BTC 费用类指标。
 *
 * 全部以原生单位（BTC / sat）计价：Coin Metrics 免费层把美元计价的费用指标
 * 整族锁在付费墙后（ADR-002）。需要美元值时由 Signal 用自抓的价格换算，
 * 并在 methodology 中写出乘式。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import { cmEndpoint } from './market.js'

const MEMPOOL_FEES = 'https://mempool.space/api/v1/fees/recommended'
// Blockstream 的接口没有 `/api/block/tip`（那是 mempool 的路径），实测可用的是两步：
// 先取链尖哈希，再按哈希取区块详情——tx_count / weight / difficulty 都在那一个响应里。
// 这里只登记第二条：适配器负责第一步，定义只声明"这条数据来自哪个端点"。
const BLOCKSTREAM_BLOCK = 'https://blockstream.info/api/block/{hash}'

const GENESIS_HISTORY = {
  availableFrom: '2009-02-01',
  note: {
    en: 'Available from the source’s first BTC day.',
    zh: '自数据源最早的 BTC 数据日起可得。',
  },
  mayBeRevised: false,
} as const

/**
 * 时点类指标的共用历史说明。
 *
 * 这类指标的数值来自"每日一次采样"，历史是我们自己从上线那天起累积的，
 * 上游并没有历史序列可回溯。因此 availableFrom 为 null，
 * 页面必须显式说明数据自 Signal 开始采集起才存在（METRIC_AUTHORING §历史口径）。
 */
const selfCollected = {
  availableFrom: null,
  note: {
    en: 'Sampled once per daily run: history starts on the day Signal began collecting, and grows one point per day. No earlier values exist to backfill.',
    zh: '每日抓取时采样一次：历史从 Signal 开始采集之日起累积，每天增加一个点。更早的数值不存在，也无法补齐。',
  },
  mayBeRevised: false,
} as const

export const feesTotal = defineMetric({
  id: 'fees-total',
  asset: 'btc',
  category: 'fees',
  name: { en: 'Total Fees', zh: '手续费总额' },
  description: {
    en: 'Fees paid by all users in a day, in BTC. Fees go to whoever mines the block, so this is the part of miner revenue that depends on demand rather than on the subsidy.',
    zh: '当日全部用户支付的交易手续费总额，单位 BTC。手续费归出块方所有，是矿工收入中取决于需求而非补贴的那一部分。',
  },
  methodology: {
    en: 'Sum of the fee field of every transaction confirmed that UTC day, in BTC — the source reports fees in BTC, not satoshis. Counted once per transaction: a transaction with many outputs still pays its fee once. Excludes the block subsidy.',
    zh: '该 UTC 自然日确认的每笔交易 fee 字段求和，单位 BTC（数据源以 BTC 而非聪计价）。按交易计一次：一笔含多个输出的交易也只付一次手续费。不含区块补贴。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  contract: {
    unit: 'btc',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'FeeTotNtv',
      endpoint: cmEndpoint('FeeTotNtv'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...GENESIS_HISTORY },
  missingPolicy: 'null',
  betterWhen: null,
})

export const minerRevenue = defineMetric({
  id: 'miner-revenue',
  asset: 'btc',
  category: 'fees',
  name: { en: 'Miner Issuance Revenue', zh: '矿工发行收入' },
  description: {
    en: 'Newly issued BTC from block rewards in a day, in BTC. Transaction fees are not included; they show up under Total Fees.',
    zh: '当日区块奖励新发行的 BTC，单位 BTC。不含交易手续费，手续费单列在"手续费总额"。',
  },
  methodology: {
    en: 'Sum of the subsidy of every block mined in the UTC day: 50 BTC per block before the 2012-11-28 halving, 25 until 2016-07-09, 12.5 until 2020-05-11, 6.25 until 2024-04-20, and 3.125 since. One subsidy per block no matter how many transactions the block carries.',
    zh: '该 UTC 自然日挖出的每个区块的补贴之和：2012-11-28 减半前每块 50 BTC，其后 25，2016-07-09 后 12.5，2020-05-11 后 6.25，2024-04-20 后 3.125。每个区块只计一次补贴，与其中打包了多少笔交易无关。',
  },
  unit: 'btc',
  frequency: '1d',
  format: { kind: 'btc' },
  contract: {
    unit: 'btc',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'IssTotNtv',
      endpoint: cmEndpoint('IssTotNtv'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...GENESIS_HISTORY },
  missingPolicy: 'null',
  betterWhen: null,
})

export const recommendedFeeRate = defineMetric({
  id: 'recommended-fee-rate',
  asset: 'btc',
  category: 'fees',
  name: { en: 'Recommended Fee Rate', zh: '推荐费率' },
  description: {
    en: 'The fee rate mempool.space recommends for a transaction to get into the next block, in satoshis per virtual byte. Higher means a busier mempool.',
    zh: 'mempool.space 给出的"下一区块成交"所需费率，单位为每虚拟字节多少聪。数值越高说明内存池越繁忙。',
  },
  methodology: {
    en: 'The hourFee field of the mempool.space recommended-fees endpoint, sampled once per daily run. It is that service’s recommendation derived from its view of the mempool — not a rate any transaction actually paid, and not a measurement of how much block space is left. One point per day.',
    zh: '取 mempool.space 推荐费率端点的 hourFee 字段，每日抓取时采样一次。它是该服务根据自身内存池视图给出的建议值，不代表任何交易实际支付的费率，也不是对剩余区块空间的度量。每天一个点。',
  },
  unit: 'sat_per_vbyte',
  frequency: '1d',
  format: { kind: 'satPerVbyte' },
  contract: {
    unit: 'sat_per_vbyte',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'mempool.space',
      metric: 'mempool.RecommendedFee',
      endpoint: MEMPOOL_FEES,
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...selfCollected },
  missingPolicy: 'null',
  betterWhen: 'lower',
})

export const blockTxCount = defineMetric({
  id: 'block-tx-count',
  asset: 'btc',
  category: 'fees',
  name: { en: 'Transactions per Block', zh: '每区块交易笔数' },
  description: {
    en: 'Transactions packed into the most recent block. Moves block to block with fee pressure and the block weight limit.',
    zh: '最新一个区块内打包的交易笔数。会随费率压力与区块权重上限在区块之间波动。',
  },
  methodology: {
    en: 'Transaction count of the block at the chain tip at the moment of the daily run, read from block header data. One point per day, describing that specific block — not a daily average, so a single unusually large or small block moves this line on its own.',
    zh: '每日抓取时链尖区块的交易笔数，取自区块头数据。每天一个点，描述的是那一个具体区块而非当日平均，因此单独一个大块或小块就会让这条线明显跳动。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'count',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Blockstream',
      metric: 'blockstream.BlockTxCount',
      endpoint: BLOCKSTREAM_BLOCK,
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...selfCollected },
  missingPolicy: 'null',
  betterWhen: null,
})

export const blockWeight = defineMetric({
  id: 'block-weight',
  asset: 'btc',
  category: 'fees',
  name: { en: 'Block Weight', zh: '区块权重' },
  description: {
    en: 'Weight of the most recent block against the 4,000,000 consensus limit. Higher means fuller blocks.',
    zh: '最新一个区块的权重，对应共识上限 4,000,000。数值越高说明区块装得越满。',
  },
  methodology: {
    en: 'Weight field of the block at the chain tip at the moment of the daily run, in weight units — four weight units per byte, and a full block is capped at 4,000,000. One point per day.',
    zh: '每日抓取时链尖区块的 weight 字段，单位为权重单位（每字节 4 权重单位，满块上限 4,000,000）。每天一个点。',
  },
  unit: 'count',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'count',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Blockstream',
      metric: 'blockstream.BlockWeight',
      endpoint: BLOCKSTREAM_BLOCK,
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: { ...selfCollected },
  missingPolicy: 'null',
  betterWhen: null,
})
