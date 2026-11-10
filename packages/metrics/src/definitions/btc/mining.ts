/**
 * BTC 算力与挖矿指标。
 *
 * 矿池集中度依赖 mempool.space 对区块的矿池归属标注，属启发式标注，
 * 因此 labelConfidence 为 heuristic，methodology 只描述计算方式，
 * 不给"矿池"下定义。
 */

import { defineMetric } from '../../defineMetric.js'
import { LABEL_SEMANTICS } from '../../labels.js'
import { cmEndpoint } from './market.js'

const MEMPOOL_HASHRATE_1Y = 'https://mempool.space/api/v1/mining/hashrate/1y'
const MEMPOOL_POOLS_1M = 'https://mempool.space/api/v1/mining/pools/1m'
// 与 fees.ts 同一组 Blockstream 端点：先取链尖哈希，再按哈希取区块详情
const BLOCKSTREAM_BLOCK = 'https://blockstream.info/api/block/{hash}'

export const hashrate = defineMetric({
  id: 'hashrate',
  asset: 'btc',
  category: 'mining',
  name: { en: 'Network Hashrate', zh: '全网算力' },
  description: {
    en: 'The total computing power securing the network, in hashes per second. It rises when hardware is added and decays as older hardware is retired.',
    zh: '维护这条网络所需的总算力，单位为每秒哈希次数。算力随新增硬件上升，随老旧设备退出挖矿而下降。',
  },
  methodology: {
    en: 'Daily mean of the source’s hashrate estimate, converted to hashes per second. The source reports TH/s, so Signal multiplies by 10¹² — the value as published is roughly a billion, and only after conversion is it comparable with other hashrate figures. The estimate itself is model-based: it infers hashrate from the work implied by block difficulty and the observed block interval, so a stretch of unusually lucky or unlucky blocks shifts it. Not the same measure as mempool.space’s difficulty-adjustment projection, which assumes a fixed hashrate over the coming retarget window.',
    zh: '取数据源算力估计的日均值，并换算为每秒哈希次数：该数据源以 TH/s 发布，Signal 乘以 10¹²——原始值大约是十亿这个数量级，只有换算之后才能与其他算力口径比较。该估计本身是模型推导的：由出块难度所隐含的工作量与实际出块间隔反推算力，因此一段运气特别好或特别差的出块会让它偏移。它与 mempool.space 的难度调整预估不是同一口径——后者假设未来一个调整周期内算力恒定。',
  },
  unit: 'hashrate',
  frequency: '1d',
  format: { kind: 'hashrate' },
  contract: {
    unit: 'hashrate',
    // scale 恒为 1：发布出去的数值已经统一换算成 H/s，换算是适配器的职责
    // （主源原始单位是 TH/s，回退源是 H/s，两者都会被规范化后再比较口径）。
    scale: 1,
    aggregation: 'mean',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'HashRate',
      endpoint: cmEndpoint('HashRate'),
      auth: 'none',
      labelConfidence: 'verified',
    },
    {
      // 口径与主源一致（单位、数量级、日均聚合、UTC 自然日窗口），
      // 因此可以作为回退源；`assertContractCompatible` 会在切换前拦下任何不一致。
      provider: 'mempool.space',
      metric: 'mempool.HashRate',
      endpoint: MEMPOOL_HASHRATE_1Y,
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2009-02-01',
    note: {
      en: 'The primary source carries history back to the first BTC day. The mempool.space fallback only serves the trailing 365 days, so a fallback switch would shorten the chart rather than fill a gap.',
      zh: '主源可回溯至最早的 BTC 数据日。回退源 mempool.space 只提供最近 365 天，因此切到回退源会缩短曲线，而不是补齐缺口。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const difficulty = defineMetric({
  id: 'difficulty',
  asset: 'btc',
  category: 'mining',
  name: { en: 'Network Difficulty', zh: '网络难度' },
  description: {
    en: 'The target a block hash has to beat. It steps up roughly every two weeks so blocks keep arriving about ten minutes apart.',
    zh: '区块哈希必须超过的目标值。大约每两周上调一次，用于让出块间隔维持在十分钟左右。',
  },
  methodology: {
    en: 'Difficulty field of the block at the chain tip at the moment of the daily run, read from the block header. The protocol raises or lowers this number in one step at each retarget rather than moving continuously, so the series is a staircase. One point per day.',
    zh: '每日抓取时链尖区块头部的 difficulty 字段。协议在每次难度调整时整体上调或下调该值，而非连续变化，因此这条序列是阶梯形的。每天一个点。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'int' },
  contract: {
    unit: 'index',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Blockstream',
      metric: 'blockstream.Difficulty',
      endpoint: BLOCKSTREAM_BLOCK,
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: null,
    note: {
      en: 'Read from the chain tip once per daily run: history starts on the day Signal began collecting and grows one point per day. Difficulty is reconstructible from block headers, but Signal does not backfill it.',
      zh: '每日从链尖读取一次：历史自 Signal 开始采集之日起累积，每天增加一个点。难度本身可由区块头回溯重建，但 Signal 不做回补。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})

export const poolConcentration = defineMetric({
  id: 'pool-concentration',
  asset: 'btc',
  category: 'mining',
  name: { en: 'Mining Pool Concentration', zh: '矿池集中度' },
  description: {
    en: 'How concentrated block production is across mining pools, as a Herfindahl index over the block shares mempool.space reports for the trailing month. Higher means a small number of pools account for more blocks.',
    zh: '按 mempool.space 报告的区块份额算出的赫芬达尔指数，衡量出块在矿池间的集中程度。数值越高，说明越少的矿池挖出了越多的块。',
  },
  methodology: {
    en: 'HHI = Σ (share_i × 100)², where share_i is each pool’s share of the blocks it mined in the trailing month mempool.space reports. This is share of blocks, not share of hashrate — the two diverge whenever pools have different uptime, and the block counts are what the source actually publishes. The scale runs from 10000 for a single pool down to 10000/n for n equal pools; on mainnet it usually sits between roughly 1500 and 3000. Which pool mined a block comes from miner-claimed tags in coinbase inputs, so it is that service’s labelling rather than a chain-level fact, and blocks with no usable tag are excluded. One point per day, sampled from a rolling window that is itself recomputed upstream.',
    zh: 'HHI = Σ (share_i × 100)²，其中 share_i 为 mempool.space 报告的最近一个月内各矿池的出块份额。这是出块份额而非算力份额——两者在矿池在线率不同时会分叉，而出块数正是该数据源实际发布的口径。取值从单一矿池独占的 10000，到 n 个矿池均分时的 10000/n；主网实际多在 1500–3000 之间。区块归属矿池取自 coinbase 输入中矿工自报的标签，因此属于该服务的标注方式而非链上事实，没有可用标签的区块被排除在外。每天一个点，取自上游自身也会重算的滚动窗口。',
  },
  unit: 'index',
  frequency: '1d',
  format: { kind: 'decimal', maxDecimals: 0 },
  contract: {
    unit: 'index',
    scale: 1,
    aggregation: 'last',
    window: 'point',
    labelSemantics: LABEL_SEMANTICS.poolAttribution,
  },
  // HHI 由 Signal 在本地算出（上游只给各矿池出块数），
  // 但它是单次响应内的分布聚合，不是两条序列的差或比，因此不写进 derivation。
  computedLocally: true,
  sources: [
    {
      provider: 'mempool.space',
      metric: 'mempool.PoolConcentration',
      endpoint: MEMPOOL_POOLS_1M,
      auth: 'none',
      labelConfidence: 'heuristic',
    },
  ],
  history: {
    availableFrom: null,
    note: {
      en: 'Computed from the trailing 30-day window mempool.space publishes, sampled once per daily run: history starts on the day Signal began collecting and grows one point per day.',
      zh: '由 mempool.space 发布的 30 天滚动窗口计算，每日抓取时采样一次：历史自 Signal 开始采集之日起累积，每天增加一个点。',
    },
    mayBeRevised: true,
  },
  missingPolicy: 'null',
  betterWhen: 'lower',
})

export const minerRevenueUsd = defineMetric({
  id: 'miner-revenue-usd',
  asset: 'btc',
  category: 'mining',
  name: { en: 'Miner Revenue (USD)', zh: '矿工收入（美元）' },
  description: {
    en: 'The value of newly issued BTC at that day’s price, in US dollars. Transaction fees are not included.',
    zh: '当日新发行 BTC 按当日价格折算的美元金额。不含交易手续费。',
  },
  methodology: {
    en: 'Issued BTC for the UTC day × the daily mean USD price for the same day, aggregated by the source. It uses the same daily mean price as the Price metric, so it is not a valuation of each block at the moment it was mined.',
    zh: '该 UTC 自然日的发行量 × 同日美元日均价，由数据源聚合给出。这里用的是与"价格"指标相同的日均价，因此并不是逐个区块在其出块时刻的估值。',
  },
  unit: 'usd',
  frequency: '1d',
  format: { kind: 'usd' },
  contract: {
    unit: 'usd',
    scale: 1,
    aggregation: 'sum',
    window: 'calendar-day-utc',
    labelSemantics: LABEL_SEMANTICS.none,
  },
  sources: [
    {
      provider: 'Coin Metrics',
      metric: 'IssTotUSD',
      endpoint: cmEndpoint('IssTotUSD'),
      auth: 'none',
      labelConfidence: 'verified',
    },
  ],
  history: {
    availableFrom: '2010-07-18',
    note: {
      en: 'Needs a price for the same day, so it starts where the free-tier price history does.',
      zh: '需要同一天的价格，因此起点与免费层价格历史一致。',
    },
    mayBeRevised: false,
  },
  missingPolicy: 'null',
  betterWhen: null,
})
