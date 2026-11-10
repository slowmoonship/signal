/**
 * `/robots.txt`。
 *
 * 站点没有登录、没有用户页、没有搜索结果页——**没有需要藏起来的东西**，
 * 所以除了指路 sitemap 之外全部 Allow。
 *
 * `disallow` 真正的用途是别去抓构建产物与快照文件：它们是页面数据，不是内容。
 * 抓 `/data/price.json` 对索引没有价值，却会让 18 份数据文件
 * 反复消耗抓取预算。
 */

import type { MetadataRoute } from 'next'

import { BASE_PATH } from '@/lib/base-path.js'
import { siteUrl } from '@/lib/site-url.js'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/data/', '/_next/'] }],
    ...(base ? { sitemap: new URL(`${BASE_PATH}/sitemap.xml`, base).toString() } : {}),
  }
}
