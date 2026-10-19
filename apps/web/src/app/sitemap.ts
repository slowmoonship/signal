/**
 * `/sitemap.xml`。
 *
 * 内容完全由指标注册表生成：站点新增指标不需要改这里，
 * 少写一条就等于少一个页面被收录，所以宁可从事实源推导也不手写清单。
 *
 * `lastModified` 取磁盘上那份快照的 `sourceTime`（抓取失败时会保留旧值，
 * 所以它可能早于今天的构建时间——那正是这份文件该表达的事实）。
 */

import type { MetadataRoute } from 'next'

import { LOCALES, registry } from '@slowmoonship/metrics'

import { loadAsset } from '@/data/load.js'
import { siteUrl } from '@/lib/site-url.js'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  const data = loadAsset('btc')

  // 没有域名就输出空 sitemap：sitemap 规范要求 URL 是绝对的，
  // 产出一份填着相对路径的"看起来有、其实没用"的文件比空文件更糟——
  // 空文件一眼看得出还没配域名，配错的文件会被当成已部署的证据。
  if (!base) return []

  /**
   * hreflang 互指也必须是绝对 URL。
   *
   * Next 只把 `url` 字段相对 metadataBase 展开，`alternates.languages` 里的值
   * 原样输出——实测产物是 `<loc>https://…/en</loc>` 配 `<xhtml:link href="/en">`，
   * 搜索引擎会直接丢弃这条互指，语言关联等于没写。所以这里自己拼绝对地址。
   */
  const abs = (path: string): string => new URL(path, base).toString()

  const out: MetadataRoute.Sitemap = []

  for (const locale of LOCALES) {
    out.push({
      url: abs(`/${locale}`),
      changeFrequency: 'daily',
      // 优先级是给搜索引擎的相对提示，不是承诺。这里首页最高、
      // 详情页一律相同——它们对读者没有先后之分。
      priority: locale === 'en' ? 1 : 0.9,
      alternates: { languages: { en: abs('/en'), zh: abs('/zh') } },
    })

    for (const def of registry.byAsset('btc')) {
      const snapshot = data.get(def.id)
      const sourceTime =
        snapshot?.ok === true ? Date.parse(snapshot.value.sourceTime) : Number.NaN
      const enPath = `/en/metrics/${def.id}`
      const zhPath = `/zh/metrics/${def.id}`
      out.push({
        url: abs(`/${locale}/metrics/${def.id}`),
        lastModified: Number.isNaN(sourceTime) ? undefined : new Date(sourceTime),
        changeFrequency: 'daily',
        priority: 0.7,
        alternates: { languages: { en: abs(enPath), zh: abs(zhPath) } },
      })
    }
  }

  return out
}
