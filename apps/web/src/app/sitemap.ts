/**
 * `/sitemap.xml`。
 *
 * 内容完全由指标注册表生成：站点新增指标不需要改这里，
 * 少写一条就等于少一个页面被收录，所以宁可从事实源推导也不手写清单。
 *
 * `lastModified` 取磁盘上那份快照的 `sourceTime`（抓取失败时会保留旧值，
 * 所以它可能早于今天的构建时间——那正是这份文件该表达的事实）。
 *
 * **只列规范地址**（ADR-021）：站点只有中文一种语言，不再有 hreflang 互指；
 * `/zh` 与 `/zh/metrics/<id>` 是历史别名，它们各自的 canonical 指向这里列出的
 * 那些地址——把别名也列进 sitemap，等于告诉搜索引擎同一页有两个正式地址。
 */

import type { MetadataRoute } from 'next'

import { registry } from '@slowmoonship/metrics'

import { loadAsset } from '@/data/load.js'
import { BASE_PATH } from '@/lib/base-path.js'
import { siteUrl } from '@/lib/site-url.js'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  const data = loadAsset('btc')

  // 没有域名就输出空 sitemap：sitemap 规范要求 URL 是绝对的，
  // 产出一份填着相对路径的"看起来有、其实没用"的文件比空文件更糟——
  // 空文件一眼看得出还没配域名，配错的文件会被当成已部署的证据。
  if (!base) return []

  const abs = (path: string): string => new URL(path, base).toString()

  const out: MetadataRoute.Sitemap = []

  out.push({
    url: abs(`${BASE_PATH}/`),
    changeFrequency: 'daily',
    // 优先级是给搜索引擎的相对提示，不是承诺。这里首页最高、
    // 详情页一律相同——它们对读者没有先后之分。
    priority: 1,
  })

  for (const def of registry.byAsset('btc')) {
    const snapshot = data.get(def.id)
    const sourceTime = snapshot?.ok === true ? Date.parse(snapshot.value.sourceTime) : Number.NaN
    out.push({
      url: abs(`${BASE_PATH}/metrics/${def.id}/`),
      lastModified: Number.isNaN(sourceTime) ? undefined : new Date(sourceTime),
      changeFrequency: 'daily',
      priority: 0.7,
    })
  }

  return out
}
