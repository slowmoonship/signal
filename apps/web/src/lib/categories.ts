/**
 * 分类 → 底色类名。
 *
 * 唯一允许出现"颜色字样"的地方，而它其实只是工具类的名字：
 * 真实色值全部锁在 `globals.css` 的 `--cat-*` token 里（CLAUDE.md §分类底色）。
 * 组件拿到的是 `bg-cat-market` 这样的字符串，不知道背后是什么颜色。
 *
 * 类型写成 `Record<MetricCategory, string>` 而不是索引签名：
 * 新增一个分类时这个文件编译不过，而不是静默渲染成"没有底色的组"——
 * 那会让读者看不出分组边界，而分组边界正是这个颜色的唯一职责。
 */

import type { HomeGroupKey, MetricCategory } from '@slowmoonship/metrics'

export const CATEGORY_TINT: Readonly<Record<MetricCategory, string>> = {
  market: 'bg-cat-market',
  onchain: 'bg-cat-onchain',
  exchange: 'bg-cat-exchange',
  fees: 'bg-cat-fees',
  mining: 'bg-cat-mining',
  valuation: 'bg-cat-valuation',
}

/**
 * 首页展示分组 → 底色类名。
 *
 * 展示分组与注册表分类不是一回事：`market-cap` 在注册表里属于 `valuation`，
 * 首页却把它和价格分在两组，因此首页表格按展示分组上色，而不是按注册表分类。
 *
 * 费用与挖矿已经离开首页，所以「牛熊周期」复用 `--cat-fees`。
 * 这个色相在表格上不再和另一组相邻，不必为第五组再加一个色相。
 *
 * 底色仍然只承担"分组"这一个职责（CLAUDE.md §分类底色）。
 */
export const HOME_GROUP_TINT: Readonly<Record<HomeGroupKey, string>> = {
  marketOverview: 'bg-cat-market',
  valuationAnchors: 'bg-cat-valuation',
  cycle: 'bg-cat-fees',
  exchangeFlows: 'bg-cat-exchange',
  onchainActivity: 'bg-cat-onchain',
}

/** 分组底色之外还要用的类：组标题的左侧色条与分组之间的留白节奏 */
export function tintFor(category: MetricCategory): string {
  return CATEGORY_TINT[category]
}

/** 首页分组的底色。 */
export function homeTintFor(group: HomeGroupKey): string {
  return HOME_GROUP_TINT[group]
}
