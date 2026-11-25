/**
 * 首页白名单。
 *
 * 为什么白名单住在 `packages/metrics` 而不是页面层：
 * CLAUDE.md §架构边界 4 —— "任何一方硬编码指标列表都是 bug"。
 * 白名单放这里，是为了让"首页放哪几个"这件事也由唯一事实源说了算。
 *
 * **行数不设硬上限，但有取舍标准**：一个组里的指标要能互相解释。
 * 估值组里的 AHR999、彩虹、MVRV、NUPL、Mayer 都从价格或市值写出来，
 * 放在一起是为了让读者看见它们是同一类问题的不同口径，而不是五张独立的选票。
 * 它们不进入三态分类（ADR-029）。
 *
 * 注册表里的其余指标一律保留：仍然有详情页，只是不上首页表格。
 * 出块数、区块权重、网络难度留在目录里，不再占比估值指标更显眼的位置。
 */

import { registry } from './definitions/index.js'
import type { FeatureId } from './market/features.js'

/**
 * 首页展示分组。
 *
 * `cycle` 复用 `--cat-fees`：费用与挖矿两组已经离开首页，
 * 这个色相在表格上不再和另一组相邻。不为第五组再发明第七个色相。
 */
export const HOME_GROUP_KEYS = [
  'marketOverview',
  'valuationAnchors',
  'cycle',
  'exchangeFlows',
  'onchainActivity',
  'strategy',
] as const
export type HomeGroupKey = (typeof HOME_GROUP_KEYS)[number]

export type HomeGroup = Readonly<{
  key: HomeGroupKey
  metricIds: readonly string[]
}>

/**
 * 首页右侧表格的内容与顺序。
 *
 * 顺序即读者的阅读顺序：价格到了哪 → 估值口径怎么说 →
 * 周期位置在哪 → 交易所里的币怎么流 → 链上还有没有人用。
 */
export const HOME_GROUPS: readonly HomeGroup[] = [
  { key: 'marketOverview', metricIds: ['price', 'drawdown-ath'] },
  {
    key: 'valuationAnchors',
    metricIds: [
      'ahr999',
      'rainbow-zone',
      'mvrv',
      'mvrv-zscore',
      'nupl',
      'mayer-multiple',
      'btc-realized-price',
      'btc-realized-premium',
    ],
  },
  { key: 'cycle', metricIds: ['pi-cycle-top', 'sma-200w', 'ma-2y', 'puell-multiple'] },
  { key: 'exchangeFlows', metricIds: ['exchange-netflow', 'exchange-balance'] },
  { key: 'onchainActivity', metricIds: ['active-addresses'] },
  {
    key: 'strategy',
    metricIds: [
      'mstr-price',
      'strategy-btc-holdings',
      'strategy-btc-cost',
      'strategy-btc-per-share',
      'strategy-btc-unrealized',
    ],
  },
]

/** 首页白名单的全部指标 id（去重后的顺序即展示顺序）。 */
export const HOME_METRIC_IDS: readonly string[] = HOME_GROUPS.flatMap((g) => g.metricIds)

/** 首页头条指标。 */
export const HERO_METRIC_ID = 'dca-max-wait-days'

/** 首页走势图用的价格指标。 */
export const SPARKLINE_PRICE_METRIC_ID = 'price'

/**
 * 分享海报用到的已注册指标。
 *
 * 这不是新指标，也不改口径。30 日和 90 日价格变化不是独立指标，
 * 海报读特征层已经算好的 `price.30d` / `price.90d`。
 * `price-change-7d` 在指标库里，不在首页表格：顶部已经放了距高点和 90 日，
 * 行情面板改放 7 日，避免同一张图上同一个数出现两次。
 * 定投等待期是首页头条，不是表格行。
 */
export const SHARE_HOME_METRIC_IDS = [
  'price',
  'drawdown-ath',
  'price-change-7d',
  'active-addresses',
  'ahr999',
  'rainbow-zone',
  'mvrv-zscore',
  'btc-realized-price',
  'pi-cycle-top',
  'sma-200w',
  'puell-multiple',
  'ma-2y',
  'strategy-btc-holdings',
  'strategy-btc-cost',
  'strategy-btc-per-share',
  'dca-max-wait-days',
] as const

/** 海报上的价格窗口。值来自特征表，绘制层不再算一遍百分比。 */
export const SHARE_POSTER_FEATURES = {
  change30: 'price.30d',
  change90: 'price.90d',
} as const satisfies Record<string, FeatureId>

export const SHARE_POSTER_GROUPS = [
  { id: 'market', metricIds: ['price-change-7d', 'active-addresses'] },
  { id: 'valuation', metricIds: ['ahr999', 'rainbow-zone', 'mvrv-zscore', 'btc-realized-price'] },
  { id: 'cycle', metricIds: ['pi-cycle-top', 'sma-200w', 'puell-multiple', 'ma-2y'] },
  { id: 'strategy', metricIds: ['strategy-btc-holdings', 'strategy-btc-cost', 'strategy-btc-per-share'] },
] as const

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
  const shareSeen = new Set<string>()
  for (const id of SHARE_HOME_METRIC_IDS) {
    if (!registry.has(id)) issues.push(`分享海报指标 "${id}" 没有注册`)
    if (shareSeen.has(id)) issues.push(`分享海报指标 "${id}" 出现了两次`)
    shareSeen.add(id)
  }
  const grouped = new Set<string>()
  for (const group of SHARE_POSTER_GROUPS) {
    for (const id of group.metricIds) {
      if (!shareSeen.has(id)) issues.push(`分享海报分组 "${group.id}" 里的 "${id}" 不在海报指标清单里`)
      if (grouped.has(id)) issues.push(`分享海报分组里的 "${id}" 出现了两次`)
      grouped.add(id)
    }
  }
  return issues
}
