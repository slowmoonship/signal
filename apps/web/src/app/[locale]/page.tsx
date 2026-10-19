/**
 * 首页：分类 + 极简文字列表（ADR-005）。
 *
 * 不做卡片、不做阴影、不加迷你走势图、不用彩色。
 * 层级靠字重与间距；数值与元信息用等宽字体。
 * 数据全部来自磁盘上的发布 JSON，不发起任何外部请求。
 */

import { notFound } from 'next/navigation'

import { registry, type Locale, type MetricDefinition, type PublishedMetric } from '@slowmoonship/metrics'

import { MetricRow } from '@/components/MetricRow'
import { loadAsset, type LoadResult } from '@/data/load'
import { getDictionary, isLocale } from '@/i18n/dictionaries'
import { formatUtcDateTime } from '@/lib/format-time'

/** 首页变化列的默认窗口。与 PLAN 的示例一致：7 天；定义可单独覆盖或关闭 */
const CHANGE_WINDOW_DAYS = 7

/** 定义声明了 `changeWindowDays` 就听定义的，没声明才用默认值 */
function changeWindowFor(def: MetricDefinition): number | null {
  return def.changeWindowDays === undefined ? CHANGE_WINDOW_DAYS : def.changeWindowDays
}

const ASSET = 'btc' as const

export default async function IndexPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const t = getDictionary(locale)

  const data = loadAsset(ASSET)
  const groups = registry.grouped(ASSET)

  // 全站更新时间：取所有成功快照里最新的来源时间。
  // 用它一个数字概括整站，比给 18 行各写一个时间更接近"每日一个快照"的实际。
  const newest = newestSourceTime(data)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.tagline}</h1>
      <p className="mt-2 font-mono text-xs text-ink-muted">
        {newest
          ? `${t.updatedAt} ${formatUtcDateTime(newest)} UTC`
          : `${t.updatedAt} —`}
      </p>

      {hasFixture(data) ? (
        <p className="mt-6 border border-rule-strong px-3 py-2 font-mono text-xs text-ink-muted">
          {t.fixtureBanner}
        </p>
      ) : null}

      <p className="mt-6 max-w-prose text-sm text-ink-muted">{t.unitNote}</p>

      {groups.map((group) => (
        <section key={group.category} className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-widest text-ink-subtle">
            {t.categories[group.category]}
          </h2>
          <div className="mt-2">
            {group.metrics.map((def) => (
              <Row
                key={def.id}
                def={def}
                locale={locale}
                result={data.get(def.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Row({
  def,
  locale,
  result,
}: {
  def: MetricDefinition
  locale: Locale
  result: LoadResult<PublishedMetric> | undefined
}) {
  const t = getDictionary(locale)
  const href = `/${locale}/metrics/${def.id}`

  if (!result || !result.ok) {
    return (
      <div className="flex flex-col gap-1 border-b border-rule py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <span className="text-ink-muted">{def.name[locale]}</span>
        <span className="font-mono text-xs text-ink-subtle">
          {result?.reason === 'invalid' ? t.invalidFile : t.noData}
        </span>
      </div>
    )
  }

  return (
    <MetricRow
      def={def}
      locale={locale}
      points={result.value.points}
      href={href}
      changeWindowDays={changeWindowFor(def)}
      stale={result.value.stale}
    />
  )
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
