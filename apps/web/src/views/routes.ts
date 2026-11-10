/**
 * 路由元数据与静态参数。
 *
 * 规范地址是 `/` 与 `/metrics/<id>`；`/zh` 与 `/zh/metrics/<id>` 是
 * **历史别名**（ADR-021）：它们必须继续能打开，但不该被当成第二份内容。
 * 因此别名页的 canonical 指向规范地址，并且不进索引——
 * 两份一模一样的页面同时被收录，搜索引擎只会认为站点有重复内容。
 */

import type { Metadata } from 'next'

import { registry, SITE_LOCALE } from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'
import { BASE_PATH } from '@/lib/base-path'

/** 可生成详情页的全部指标 id。 */
export function btcMetricParams(): { id: string }[] {
  return registry.byAsset('btc').map((def) => ({ id: def.id }))
}

/** 别名页要不要声明"不进索引"。 */
type RouteOptions = { readonly legacy: boolean }

/** 首页元数据。 */
export function homeMetadata({ legacy }: RouteOptions): Metadata {
  const t = getDictionary()
  const description = t.tagline
  return {
    title: `${t.siteTitle} — ${description}`,
    description,
    alternates: { canonical: `${BASE_PATH}/` },
    openGraph: {
      title: `${t.siteTitle} — ${description}`,
      description,
      locale: 'zh_CN',
      type: 'website',
    },
    robots: legacy ? { index: false, follow: true } : { index: true, follow: true },
  }
}

/** 指标详情页元数据。 */
export function metricMetadata(id: string, { legacy }: RouteOptions): Metadata {
  const t = getDictionary()
  if (!registry.has(id)) return {}
  const def = registry.get(id)
  return {
    title: `${def.name[SITE_LOCALE]} · ${t.siteTitle}`,
    description: def.description[SITE_LOCALE],
    alternates: { canonical: `${BASE_PATH}/metrics/${id}/` },
    openGraph: { title: `${def.name[SITE_LOCALE]} · ${t.siteTitle}`, description: def.description[SITE_LOCALE] },
    robots: legacy ? { index: false, follow: true } : { index: true, follow: true },
  }
}
