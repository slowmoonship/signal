/**
 * BTC 指标定义集合。
 *
 * 加 ETH / SOL = 新建同级目录并在此模式下导出，页面层零改动（ADR-006）。
 */

import type { MetricDefinition } from '../../types.js'
import { drawdownAth, price, priceChange7d, supply } from './market.js'
import { btcPriceUsClose } from './us-close.js'
import {
  activeAddresses,
  blockCount,
  exchangeBalance,
  exchangeNetflow,
  txCount,
} from './onchain.js'
import {
  blockTxCount,
  blockWeight,
  feesTotal,
  minerRevenue,
  recommendedFeeRate,
} from './fees.js'
import { difficulty, hashrate, minerRevenueUsd, poolConcentration } from './mining.js'
import { dcaMaxWaitDays, marketCap, mvrv } from './valuation.js'
import {
  ahr999,
  hashRibbons,
  ma2y,
  mayerMultiple,
  mvrvZscore,
  nupl,
  piCycleTop,
  puellMultiple,
  rainbowZone,
  sma200w,
} from './cycle.js'

/**
 * 顺序按分类（market → onchain → exchange → fees → mining → valuation）排列，
 * 与 METRIC_CATEGORIES 一致。首页分组由 registry.grouped 决定，与此顺序无关；
 * 抓取顺序按依赖关系另行排序（派生指标必须晚于其父指标）。
 *
 * 算力丝带留在 mining：它的输入是算力。首页把它放进「牛熊周期」只是展示分组。
 */
export const btcMetrics: readonly MetricDefinition[] = [
  // 市场 Market（5）
  price,
  supply,
  priceChange7d,
  drawdownAth,
  btcPriceUsClose,
  // 链上活动 On-chain（3）
  activeAddresses,
  txCount,
  blockCount,
  // 交易所 / 持仓 Exchange（2）
  exchangeNetflow,
  exchangeBalance,
  // 费用与区块 Fees（5）
  feesTotal,
  minerRevenue,
  recommendedFeeRate,
  blockTxCount,
  blockWeight,
  // 算力与挖矿 Mining（5）
  hashrate,
  difficulty,
  poolConcentration,
  minerRevenueUsd,
  hashRibbons,
  // 估值 / 周期 Valuation（12）
  marketCap,
  mvrv,
  dcaMaxWaitDays,
  ahr999,
  rainbowZone,
  piCycleTop,
  puellMultiple,
  mayerMultiple,
  nupl,
  mvrvZscore,
  sma200w,
  ma2y,
]

export {
  activeAddresses,
  ahr999,
  blockCount,
  blockTxCount,
  blockWeight,
  dcaMaxWaitDays,
  difficulty,
  drawdownAth,
  exchangeBalance,
  exchangeNetflow,
  feesTotal,
  hashRibbons,
  hashrate,
  ma2y,
  marketCap,
  mayerMultiple,
  minerRevenue,
  minerRevenueUsd,
  mvrv,
  mvrvZscore,
  nupl,
  piCycleTop,
  poolConcentration,
  btcPriceUsClose,
  price,
  priceChange7d,
  puellMultiple,
  rainbowZone,
  recommendedFeeRate,
  sma200w,
  supply,
  txCount,
}
