/**
 * BTC 指标定义集合（18 个）。
 *
 * 加 ETH / SOL = 新建同级目录并在此模式下导出，页面层零改动（ADR-006）。
 */

import type { MetricDefinition } from '../../types.js'
import { marketCap, price, priceChange7d, supply } from './market.js'
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

/**
 * 顺序按分类（market → onchain → fees → mining）排列。
 * 首页分组由 registry.grouped 决定，与此顺序无关；
 * 抓取顺序按依赖关系另行排序（派生指标必须晚于其父指标）。
 */
export const btcMetrics: readonly MetricDefinition[] = [
  // 市场 Market（4）
  price,
  marketCap,
  supply,
  priceChange7d,
  // 链上活动 On-chain（5）
  activeAddresses,
  txCount,
  blockCount,
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
]

export {
  activeAddresses,
  blockCount,
  blockTxCount,
  blockWeight,
  difficulty,
  exchangeBalance,
  exchangeNetflow,
  feesTotal,
  hashrate,
  marketCap,
  minerRevenue,
  minerRevenueUsd,
  poolConcentration,
  price,
  priceChange7d,
  recommendedFeeRate,
  supply,
  txCount,
}
