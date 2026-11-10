/**
 * 首页白名单。
 *
 * 为什么白名单住在 `packages/metrics` 而不是页面层：
 * CLAUDE.md §架构边界 4 —— "任何一方硬编码指标列表都是 bug"。
 * 白名单放这里，是为了让"首页放哪几个"这件事也由唯一事实源说了算。
 *
 * **行数不设硬上限，但有取舍标准**：一个组里的指标要能互相解释。
 * 价格与市值放一起是因为后者是前者的换算；活跃地址与交易笔数放一起是因为它们
 * 一起回答"链上还有多少人用"。反过来，`block-tx-count` 与 `tx-count` 高度重合
 * （前者是后者的每日均值），两个都放就只是把同一个事实说了两遍，因此只上一个。
 * 注册表里的其余指标一律保留：仍然有详情页，仍然参与规则计算，只是不上首页表格。
 *
 * 展示分组与注册表的 `category` 不是一回事，但**一一对应**——
 * 六组正好用满六个分类底色 token，不需要为分组新增颜色。
 */

import { registry } from './definitions/index.js'

/** 首页展示分组。每组对应一个分类底色 token（见 `globals.css` 的 `--cat-*`）。 */
export const HOME_GROUP_KEYS = [
  'marketOverview',
  'valuationAnchors',
  'exchangeFlows',
  'onchainActivity',
  'feesBlocks',
  'miningSecurity',
] as const
export type HomeGroupKey = (typeof HOME_GROUP_KEYS)[number]

export type HomeGroup = Readonly<{
  key: HomeGroupKey
  metricIds: readonly string[]
}>

/**
 * 首页右侧表格的内容与顺序。
 *
 * 顺序即读者的阅读顺序：现在这个市场处在什么价 → 贵不贵 →
 * 钱往哪走 → 有没有人用 → 用得多不多 → 矿工赚不赚钱。
 */
export const HOME_GROUPS: readonly HomeGroup[] = [
  { key: 'marketOverview', metricIds: ['price', 'price-change-7d', 'supply'] },
  { key: 'valuationAnchors', metricIds: ['market-cap', 'mvrv'] },
  { key: 'exchangeFlows', metricIds: ['exchange-netflow', 'exchange-balance', 'pool-concentration'] },
  { key: 'onchainActivity', metricIds: ['active-addresses', 'tx-count', 'block-count'] },
  { key: 'feesBlocks', metricIds: ['fees-total', 'recommended-fee-rate', 'block-weight'] },
  { key: 'miningSecurity', metricIds: ['hashrate', 'difficulty', 'miner-revenue-usd'] },
]

/** 首页白名单的全部指标 id（去重后的顺序即展示顺序）。 */
export const HOME_METRIC_IDS: readonly string[] = HOME_GROUPS.flatMap((g) => g.metricIds)

/** 首页头条指标。 */
export const HERO_METRIC_ID = 'dca-max-wait-days'

/** 首页走势图用的价格指标。 */
export const SPARKLINE_PRICE_METRIC_ID = 'price'

/**
 * 校验白名单是否与注册表一致。
 *
 * 三个问题必须在这里问出来，而不是等页面上出现空白行：
 * - 有没有写错的 id（拼错会静默变成空行）
 * - 有没有重复（同一指标出现两次）
 * - 头条指标在不在注册表里
 */
export function validateHomeWhitelist(): readonly string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const id of HOME_METRIC_IDS) {
    if (!registry.has(id)) issues.push(`首页白名单里的 "${id}" 没有注册`)
    if (seen.has(id)) issues.push(`首页白名单里的 "${id}" 出现了两次`)
    seen.add(id)
  }
  if (!registry.has(HERO_METRIC_ID)) issues.push(`头条指标 "${HERO_METRIC_ID}" 没有注册`)
  if (!registry.has(SPARKLINE_PRICE_METRIC_ID)) {
    issues.push(`走势图价格指标 "${SPARKLINE_PRICE_METRIC_ID}" 没有注册`)
  }
  return issues
}
