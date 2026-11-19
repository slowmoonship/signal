/**
 * 完整指标库。
 *
 * 和首页不是同一张表拉长：这里没有定投卡片，也没有市场三态。
 * 路由是 `/metrics/`，详情页是 `/metrics/[id]/`，两者不互相覆盖。
 */

import { CATALOG_GROUPS, formatValue, latestKnown, readingAsStatus, registry, SITE_LOCALE, tableName } from '@slowmoonship/metrics'

import { CatalogBrowser, type CatalogRow } from '@/components/CatalogBrowser'
import { loadAll } from '@/data/load'
import { siteRead } from '@/data/read'
import { getDictionary } from '@/i18n/dictionaries'
import { formatUtcDateTime } from '@/lib/format-time'
import { BASE_PATH } from '@/lib/base-path'

export function generateMetadata() {
  const t = getDictionary()
  return {
    title: `${t.catalogTitle} · ${t.siteTitle}`,
    description: t.catalogTitle,
    alternates: { canonical: `${BASE_PATH}/metrics/` },
  }
}

export default function CatalogPage() {
  const data = loadAll()
  const { readings } = siteRead()
  const rows: CatalogRow[] = []
  for (const group of CATALOG_GROUPS) {
    for (const id of group.metricIds) {
      if (!registry.has(id)) continue
      const def = registry.get(id)
      const result = data.get(id)
      const metric = result?.ok === true ? result.value : null
      const latest = metric ? latestKnown(metric.points) : null
      const reading = readings.get(id)
      const value = latest ? formatValue(latest.value, def.format, SITE_LOCALE) : null
      rows.push({
        id,
        name: tableName(def, SITE_LOCALE),
        search: `${tableName(def, SITE_LOCALE)} ${def.name.zh} ${def.name.en} ${def.id}`,
        group: group.key,
        groupLabel: group.label.zh,
        asset: def.asset,
        value: value ?? '—',
        basis: reading?.basis.zh ?? '',
        time: latest ? formatUtcDateTime(new Date(latest.ts * 1000).toISOString()) : '',
        stale: metric?.stale === true,
        missing: value === null,
        status: reading
          ? readingAsStatus(reading)
          : { ok: false, metricId: id, featureId: 'disclosure', reason: 'missing', detail: '没有读数' },
      })
    }
  }
  return <CatalogBrowser rows={rows} />
}
