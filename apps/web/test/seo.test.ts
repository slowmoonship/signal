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

  it('配置域名后覆盖全部指标 × 两种语言，且每条 URL 都是绝对的', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    const entries = sitemap()
    const expected = registry.byAsset('btc').length * 2
    // 18 个指标 × 2 语言 + 2 个首页
    expect(entries).toHaveLength(expected + 2)

    for (const entry of entries) {
      expect(entry.url.startsWith('https://signal.example/')).toBe(true)
      expect(URL.canParse(entry.url)).toBe(true)
    }
  })

  it('hreflang 互指也是绝对 URL——Next 不会替你展开 alternates.languages', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    // 只断言 loc 是绝对地址会漏掉这个坑：Next 会把 url 相对 metadataBase 展开，
    // 却把 alternates.languages 原样输出，于是产物里出现
    // <loc>https://…/en</loc> 配 <xhtml:link href="/en">，互指直接失效。
    for (const entry of sitemap()) {
      const languages = entry.alternates?.languages as Record<string, string> | undefined
      expect(languages).toBeDefined()
      for (const href of Object.values(languages ?? {})) {
        expect(href.startsWith('https://signal.example/')).toBe(true)
      }
    }
  })

  it('首页与详情页的互指指向正确的一对语言路径', () => {
    process.env[ENV_KEY] = 'https://signal.example'
    const entries = sitemap()
    const home = entries.find((e) => e.url.endsWith('/en'))
    expect(home?.alternates?.languages).toMatchObject({
      en: 'https://signal.example/en',
      zh: 'https://signal.example/zh',
    })

    const price = entries.find((e) => e.url.endsWith('/en/metrics/price'))
    expect(price?.alternates?.languages).toMatchObject({
      en: 'https://signal.example/en/metrics/price',
      zh: 'https://signal.example/zh/metrics/price',
    })
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
    expect(robots().sitemap).toBe('https://signal.example/sitemap.xml')
  })
})
