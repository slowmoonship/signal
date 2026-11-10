/**
 * SEO 产物的形状（Phase 4）。
 *
 * sitemap / robots / OG 都是构建期生成的东西，出错时不会报红，
 * 只会安静地产出一份搜索引擎用不了的文件。这里的断言都在守那类失败。
 */

import { afterEach, describe, expect, it } from 'vitest'

import sitemap from '../src/app/sitemap.js'
import robots from '../src/app/robots.js'
import { siteUrl } from '../src/lib/site-url.js'
import { registry } from '@slowmoonship/metrics'

const ENV_KEY = 'SIGNAL_SITE_URL'

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('siteUrl', () => {
  it('未配置时返回 null，而不是编一个占位域名', () => {
    // 域名是 Phase 5 才定的。现在写死一个占位符，等于假装部署目标已定，
    // 而且换域名时会漏改——写出来的 canonical 指向一个不存在的站点，
    // 比"没写 canonical"更难排查。
    expect(siteUrl()).toBeNull()
  })

  it('空串与纯空白等同于未配置', () => {
    process.env[ENV_KEY] = ''
    expect(siteUrl()).toBeNull()
    process.env[ENV_KEY] = '   '
    expect(siteUrl()).toBeNull()
  })

  it('合法 URL 原样返回', () => {
    process.env[ENV_KEY] = 'https://signal.example/'
    expect(siteUrl()?.toString()).toBe('https://signal.example/')
  })

  it('非法值降级为 null 并给出警告，而不是让整个构建崩掉', () => {
    process.env[ENV_KEY] = 'not a url'
    expect(siteUrl()).toBeNull()
  })
})

describe('sitemap', () => {
  it('未配置域名时为空——不给爬虫一份全是相对 URL 的假 sitemap', () => {
    expect(sitemap()).toEqual([])
  })

  it('配置域名后覆盖首页与全部指标，且每条 URL 都是绝对的', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    const entries = sitemap()
    // 18 个指标 + 1 个首页（V0.1 只有中文，不再有第二个语言版本）
    expect(entries).toHaveLength(registry.byAsset('btc').length + 1)

    for (const entry of entries) {
      expect(entry.url.startsWith('https://signal.example/')).toBe(true)
      expect(URL.canParse(entry.url)).toBe(true)
    }
  })

  it('没有 hreflang 互指——只有一种语言，互指没有对象', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    for (const entry of sitemap()) {
      expect(entry.alternates).toBeUndefined()
    }
  })

  it('只列规范地址：没有 /en，也没有 /zh 别名', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    for (const entry of sitemap()) {
      expect(entry.url).not.toContain('/en')
      // /zh 是历史别名，它自己的 canonical 指向规范地址；进了 sitemap 就是两份正式地址
      expect(entry.url).not.toContain('/zh')
    }
    const urls = sitemap().map((e) => e.url)
    expect(urls).toContain('https://signal.example/signal/')
    expect(urls).toContain('https://signal.example/signal/metrics/price/')
  })
})

describe('robots', () => {
  it('允许抓取内容，但不去碰快照数据与构建产物', () => {
    const r = robots()
    // 18 份 JSON × 每次抓取，对索引没有价值，只会吃抓取预算
    expect(r.rules).toEqual([{ userAgent: '*', allow: '/', disallow: ['/data/', '/_next/'] }])
  })

  it('未配置域名时不写 sitemap 指针，避免指向一个不存在的地址', () => {
    expect(robots().sitemap).toBeUndefined()
    process.env[ENV_KEY] = 'https://signal.example'
    // 站点挂在项目子路径下：sitemap 指针也要带 /signal
    expect(robots().sitemap).toBe('https://signal.example/signal/sitemap.xml')
  })
})
