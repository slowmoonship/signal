/**
 * BTC 指标定义集合（19 个）。
 *
 * 加 ETH / SOL = 新建同级目录并在此模式下导出，页面层零改动（ADR-006）。
 */

import type { MetricDefinition } from '../../types.js'
import { price, priceChange7d, supply } from './market.js'
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

/**
 * 顺序按分类（market → onchain → exchange → fees → mining → valuation）排列，
 * 与 METRIC_CATEGORIES 一致。首页分组由 registry.grouped 决定，与此顺序无关；
 * 抓取顺序按依赖关系另行排序（派生指标必须晚于其父指标）。
 */
export const btcMetrics: readonly MetricDefinition[] = [
  // 市场 Market（3）
  price,
  supply,
  priceChange7d,
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
  // 算力与挖矿 Mining（4）
  hashrate,
  difficulty,
  poolConcentration,
  minerRevenueUsd,
  // 估值 / 周期 Valuation（3）
  marketCap,
  mvrv,
  dcaMaxWaitDays,
]

export {
  activeAddresses,
  blockCount,
  blockTxCount,
  blockWeight,
  dcaMaxWaitDays,
  difficulty,
  exchangeBalance,
  exchangeNetflow,
  feesTotal,
  hashrate,
  marketCap,
  minerRevenue,
  minerRevenueUsd,
  mvrv,
  poolConcentration,
  price,
  priceChange7d,
  recommendedFeeRate,
  supply,
  txCount,
}
