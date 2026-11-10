/**
 * 首页：双栏摘要 + 指标总表。
 *
 * 左栏只回答一个问题——"现在是什么情况"，因此只放一个头条大指标、
 * 一句市场状态、一条十年价格走势和更新时间。右栏回答"具体每个数是多少"。
 *
 * 布局在 1024px 以下降级为上下堆叠：窄屏上并排两栏等于把每一栏都压到读不了。
 * 移动端不横向滚动（CLAUDE.md），靠收起列而不是加滚动条来解决。
 *
 * 数据全部来自磁盘上的发布 JSON，不发起任何外部请求；
 * 指标清单一律来自 `packages/metrics`（注册表与首页白名单），
 * 页面层不硬编码任何一个 id（CLAUDE.md 架构边界）。
 *
 * 这是一个**视图**而不是路由：`/` 与 `/zh` 渲染的是同一份内容
 * （ADR-021，`/zh` 是历史别名），所以页面主体放在这里，由两个路由文件引用。
 */

import {
  buildFeatureTable,
  deriveAllStatuses,
  HERO_METRIC_ID,
  HOME_GROUPS,
  readMarketScenario,
  registry,
  SITE_LOCALE,
  SPARKLINE_PRICE_METRIC_ID,
  STATUS_SPECS,
  type MetricDefinition,
  type PublishedMetric,
} from '@slowmoonship/metrics'

import { HeroMetric, MarketRead } from '@/components/HeroMetric'
import { MetricTable, type MetricGroup } from '@/components/MetricTable'
import { loadAsset, type LoadResult } from '@/data/load'
import { getDictionary } from '@/i18n/dictionaries'
import { formatAge, formatUtcDateTime } from '@/lib/format-time'

/** 首页变化列的默认窗口。与定义一致：7 天；定义可单独覆盖或关闭 */
const CHANGE_WINDOW_DAYS = 7

/** 定义声明了 `changeWindowDays` 就听定义的，没声明才用默认值 */
function changeWindowFor(def: MetricDefinition): number | null {
  return def.changeWindowDays === undefined ? CHANGE_WINDOW_DAYS : def.changeWindowDays
}

const ASSET = 'btc' as const

export function HomeView() {
  const locale = SITE_LOCALE
  const t = getDictionary()

  const data = loadAsset(ASSET)
  const groups = homeGroups()
  const heroDef = registry.has(HERO_METRIC_ID) ? registry.get(HERO_METRIC_ID) : null
  const hero = heroDef ? ok(data.get(heroDef.id)) : null
  const price = ok(data.get(SPARKLINE_PRICE_METRIC_ID))

  // 全站更新时间：取所有成功快照里最新的来源时间。
  // 用它一个数字概括整站，比给每一行各写一个时间更接近"每日一个快照"的实际。
  const newest = newestSourceTime(data)

  // 快照是否过期。判据是**数据自己的时间戳**与构建时刻的差距，
  // 不是构建时间与构建时间的差距（那永远是 0）。
  // 阈值取 3 天：日更站点漏跑一次就该提示，漏跑两次就该当回事。
  const nowMs = Date.now()
  const outdated = newest !== null && nowMs - Date.parse(newest) > 3 * 24 * 3_600_000

  // 市场解释与状态列：特征标准化 → 场景匹配 / 分位分档 → 一句话或一个词。
  // 全部住在 packages/metrics，页面层只取结论（CLAUDE.md §架构边界）。
  const { features } = buildFeatureTable(publishedOf(data))
  const read = readMarketScenario(features)
  const statuses = deriveAllStatuses(STATUS_SPECS, features)

  return (
    <div>
      {/* 副标题退居其次：品牌字标（布局里的 siteTitle）才是这一屏的视觉锚点，
          这里只做一句注解，所以用小字号与弱色，不用标题级字号。 */}
      <h1 className="text-base text-ink-muted sm:text-lg">{t.tagline}</h1>

      {hasFixture(data) ? (
        <p className="mt-6 border border-rule-strong px-3 py-2 font-mono text-xs text-ink-muted">
          {t.fixtureBanner}
        </p>
      ) : null}

      {/* 快照过期横幅。
          本站是"每日抓取 → 静态生成"的日更站，不提供实时数据。
          快照过期时必须自己说出来——否则"当前状态"那一列会被读成实时行情，
          而它其实只是上一份快照在当时的读数。
          判定用的是**数据自带的时间戳**，不是构建时间：构建时间永远是"现在"。 */}
      {outdated ? (
        <p className="mt-6 border border-rule-strong px-3 py-2 text-xs text-ink-muted">
          <span className="font-medium text-ink">{t.snapshotOutdated}</span>
          {' — '}
          {t.snapshotOutdatedNote}
          {newest ? <span className="ml-1 font-mono">({formatAge(newest, nowMs)})</span> : null}
        </p>
      ) : null}

      <div className="mt-5 gap-8 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start">
        {/* 左栏：窄屏在最上面，宽屏 sticky。
            sticky 而不是普通流——表格滚过去之后，"最坏要等多久"这句话
            就该留在视线里，它是读者来这个站点的首要理由。 */}
        <div className="lg:sticky lg:top-6">
          {heroDef ? (
            <HeroMetric
              def={heroDef}
              locale={locale}
              metric={hero}
              stale={hero?.stale ?? false}
              pricePoints={price?.points ?? []}
              worstCase={hero?.worstCase ?? null}
              distribution={hero?.distribution ?? null}
            />
          ) : null}

          <MarketRead locale={locale} read={read} features={features} />

          <p className="mt-4 font-mono text-xs text-ink-subtle tabular-nums">
            {newest
              ? `${t.updatedAt} ${formatUtcDateTime(newest)} UTC (${formatAge(newest, nowMs)})`
              : `${t.updatedAt} —`}
          </p>

          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{t.unitNote}</p>
        </div>

        {/* 右栏：表格 */}
        <div className="mt-10 lg:mt-0">
          <MetricTable
            groups={groups}
            locale={locale}
            data={data}
            changeWindowFor={changeWindowFor}
            statuses={statuses}
            features={features}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 首页展示分组。
 *
 * 白名单住在 `packages/metrics`（CLAUDE.md §架构边界 4），
 * 这里只负责把 id 换成定义——注册表里没有的 id 直接跳过，不静默留一行空白。
 */
function homeGroups(): MetricGroup[] {
  const out: MetricGroup[] = []
  for (const group of HOME_GROUPS) {
    const metrics = group.metricIds
      .filter((id) => registry.has(id))
      .map((id) => registry.get(id))
    if (metrics.length > 0) out.push({ key: group.key, metrics })
  }
  return out
}

/** 一条成功的结果；失败或缺失一律归一成 null，页面不该处理第三种状态 */
function ok(result: LoadResult<PublishedMetric> | undefined): PublishedMetric | null {
  return result?.ok === true ? result.value : null
}

/** 成功加载的快照。缺失的自动退出判定。 */
function publishedOf(
  data: ReadonlyMap<string, LoadResult<PublishedMetric>>,
): PublishedMetric[] {
  const out: PublishedMetric[] = []
  for (const result of data.values()) {
    if (result.ok) out.push(result.value)
  }
  return out
}

function newestSourceTime(data: ReadonlyMap<string, LoadResult<PublishedMetric>>): string | null {
  let best: number | null = null
  for (const result of data.values()) {
    if (!result.ok) continue
    const ms = Date.parse(result.value.sourceTime)
    if (Number.isNaN(ms)) continue
    if (best === null || ms > best) best = ms
  }
  return best === null ? null : new Date(best).toISOString()
}

function hasFixture(data: ReadonlyMap<string, LoadResult<PublishedMetric>>): boolean {
  for (const result of data.values()) {
    if (result.ok && result.value.fixture === true) return true
  }
  return false
}
