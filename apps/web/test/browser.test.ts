/**
 * 真实浏览器验收测试。
 *
 * 这一组是**真的点**：真的加载页面、真的点、真的看 URL 变了没有。
 *
 * 为什么要它：V0.1 上线前最严重的一个问题是
 * "点击页面任意位置都会跳到矿工收入详情页"——
 * 那类 bug 在源码断言与单元测试里都是全绿的，
 * 只有把指针放到页面上按下去才会现形。
 *
 * **可用性**：本文件在缺浏览器或缺预览服务时**整体跳过**，
 * 不会让 CI 变红。因此 `npm run test` 仍然是自包含的；
 * 想要这组断言生效，需要：
 *   - 一个可用的 Chromium（`CHROMIUM_PATH` 环境变量，或下面的候选路径）；
 *   - 一个跑着的预览服务（`SIGNAL_BASE_URL`，默认 http://127.0.0.1:4310）。
 *   - playwright-core（`PLAYWRIGHT_CORE_PATH`，或 node_modules 里的常规位置）。
 *
 * 页面内的取数用**字符串**形式的表达式传给 `page.evaluate`：
 * 本测试工程没有 DOM lib，写成 TS 回调会引入一堆 `document` 类型错误，
 * 而那段代码本来就是在浏览器里跑的，字符串反而更贴近它的运行环境。
 */

import { existsSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BASE_PATH } from '../src/lib/base-path.js'

const BASE_URL = process.env['SIGNAL_BASE_URL'] ?? 'http://127.0.0.1:4310'
/**
 * 站点挂在子路径下（GitHub Pages 项目站点）。
 *
 * 预览服务器把 out/ 挂在 /signal 上，与线上部署的形状一致——
 * 在这里测根路径，等于测了一个线上不存在的地址。
 */
const SITE = `${BASE_URL}${BASE_PATH}`

/** playwright-core 的候选位置。装在项目里最省事，其次是机器上已有的位置。 */
const PLAYWRIGHT_CANDIDATES = [
  process.env['PLAYWRIGHT_CORE_PATH'],
  '/home/alex/.local/share/paseo-server-browser/node_modules/playwright-core/index.mjs',
].filter((p): p is string => typeof p === 'string' && p.length > 0)

/** Chromium 可执行文件的候选位置。 */
const CHROMIUM_CANDIDATES = [
  process.env['CHROMIUM_PATH'],
  '/home/alex/.cache/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => typeof p === 'string' && p.length > 0)

function firstExisting(paths: readonly string[]): string | null {
  for (const p of paths) if (existsSync(p)) return p
  return null
}

const playwrightPath = firstExisting(PLAYWRIGHT_CANDIDATES)
const chromiumPath = firstExisting(CHROMIUM_CANDIDATES)

/** 预览服务在不在。用一个短超时的请求探一下。 */
async function serverReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SITE}/`, { signal: AbortSignal.timeout(4000) })
    return res.status === 200
  } catch {
    return false
  }
}

const reachable = await serverReachable()
const available = Boolean(playwrightPath && chromiumPath) && reachable

if (!available) {
  // 说清楚缺什么，别让人以为"测试通过"就是"浏览器里点过了"
  const missing = [
    playwrightPath ? null : 'playwright-core',
    chromiumPath ? null : 'chromium',
    reachable ? null : `preview server (${BASE_URL})`,
  ].filter((x): x is string => x !== null)
  console.warn(`[browser.test] 跳过真实浏览器测试，缺少：${missing.join(', ')}`)
}

type Box = { x: number; y: number; width: number; height: number }

type Locator = {
  first: () => Locator
  innerText: () => Promise<string>
  count: () => Promise<number>
  boundingBox: () => Promise<Box | null>
  click: (opts?: { timeout?: number }) => Promise<void>
}

type ResponseLike = { status: () => number; url: () => string }

type Page = {
  on: (event: 'response', handler: (res: ResponseLike) => void) => void
  waitForTimeout: (ms: number) => Promise<void>
  goto: (
    url: string,
    opts?: { waitUntil?: string; timeout?: number },
  ) => Promise<{ status: () => number } | null>
  locator: (sel: string) => Locator
  url: () => string
  evaluate: (expression: string) => Promise<unknown>
  mouse: { click: (x: number, y: number) => Promise<void> }
  waitForURL: (url: string, opts?: { timeout?: number }) => Promise<void>
  close: () => Promise<void>
}

type Browser = {
  newPage: (opts?: { viewport?: { width: number; height: number } }) => Promise<Page>
  close: () => Promise<void>
}

async function launch(): Promise<Browser> {
  const mod = (await import(playwrightPath as string)) as {
    chromium: { launch: (o: unknown) => Promise<Browser> }
  }
  return mod.chromium.launch({ executablePath: chromiumPath as string })
}

const TIMEOUT = 60_000

/** 打开首页。 */
async function openHome(browser: Browser, width = 1366): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 768 } })
  await page.goto(`${SITE}/`, { waitUntil: 'networkidle', timeout: TIMEOUT })
  return page
}

/**
 * 点一个链接并等地址真的变了。
 *
 * Next 的 `<Link>` 走客户端路由：click 事件派发完，地址还没变——
 * 真正的跳转要等 RSC payload 回来。点完立刻读 `page.url()` 会读到旧地址，
 * 于是"点 A 却停在原页"会被误判成"链接坏了"。
 */
async function clickAndWait(page: Page, selector: string, expected: string): Promise<void> {
  await page.locator(selector).first().click({ timeout: TIMEOUT })
  await page.waitForURL(expected, { timeout: TIMEOUT })
}

describe.skipIf(!available)('真实浏览器：首页导航', () => {
  it('点击「价格」进入价格详情页', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      await clickAndWait(page, `a[href="${BASE_PATH}/metrics/price/"]`, '**/metrics/price/')
      expect(page.url()).toContain('/metrics/price')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('点击「MVRV」进入 MVRV 详情页', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      await clickAndWait(page, `a[href="${BASE_PATH}/metrics/mvrv/"]`, '**/metrics/mvrv/')
      expect(page.url()).toContain('/metrics/mvrv')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('点击「矿工收入」进入矿工收入详情页', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      await clickAndWait(
        page,
        `a[href="${BASE_PATH}/metrics/miner-revenue-usd/"]`,
        '**/metrics/miner-revenue-usd/',
      )
      expect(page.url()).toContain('/metrics/miner-revenue-usd')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('页头没有语言切换入口', async () => {
    // V0.1 只有中文（ADR-021）：页头不得出现任何指向另一种语言的链接
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const links = (await page.evaluate(
        `Array.from(document.querySelectorAll('header a')).map((a) => a.getAttribute('href'))`,
      )) as string[]
      expect(links.filter((h) => h && h.includes('/en'))).toEqual([])
      const text = (await page.evaluate(`document.querySelector('header').textContent || ''`)) as string
      expect(text).not.toContain('English')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('/en 不再是公开页面，返回 404', async () => {
    const browser = await launch()
    try {
      for (const path of ['/en', '/en/']) {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
        const res = await page.goto(`${SITE}${path}`, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUT,
        })
        expect(res?.status(), `${path} 应当 404`).toBe(404)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('/zh 仍然能打开中文首页', async () => {
    // 历史地址不能变成 404：站外已经发出去的链接都指着它
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      const res = await page.goto(`${SITE}/zh/`, { waitUntil: 'networkidle', timeout: TIMEOUT })
      expect(res?.status()).toBe(200)
      const html = (await page.evaluate(`document.documentElement.lang`)) as string
      expect(html).toBe('zh-CN')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('点击页面空白区域不发生任何跳转', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const before = page.url()
      // 三个位置：页脚附近、左边距、正文上方的空白。
      // 旧版的拉伸链接会把整页盖住，这三下全都会跳走。
      await page.mouse.click(20, 700)
      await page.mouse.click(1300, 700)
      await page.mouse.click(700, 120)
      expect(page.url()).toBe(before)
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('指标链接的点击区域不会盖住表格之外的区域', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const box = await page.locator(`a[href="${BASE_PATH}/metrics/price/"]`).first().boundingBox()
      expect(box).not.toBeNull()
      if (!box) return
      // 链接框应该紧贴指标名那几个字，而不是横跨整行甚至整页
      expect(box.width).toBeLessThan(220)
      expect(box.height).toBeLessThan(40)
    } finally {
      await browser.close()
    }
  }, TIMEOUT)
})

describe.skipIf(!available)('真实浏览器：排版', () => {
  it('判定依据在 1366 宽度下是单行', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const rows = (await page.evaluate(`(() => {
        const cells = Array.from(document.querySelectorAll('td'))
        return cells
          .filter((c) => String(c.className).includes('whitespace-nowrap'))
          .map((c) => {
            const range = document.createRange()
            range.selectNodeContents(c)
            const rects = Array.from(range.getClientRects())
            // 行数 = 不同的 y 坐标个数。
            // 直接数 rect 会把同一个行盒数两遍（Chrome 对单个 inline 元素
            // 会同时返回元素框与文本框），一行也会被数成两行。
            const ys = Array.from(new Set(rects.map((r) => Math.round(r.top))))
            return { text: (c.textContent || '').trim(), lines: ys.length }
          })
      })()`)) as { text: string; lines: number }[]
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) {
        expect(r.lines, `判定依据换行了：${r.text}`).toBeLessThanOrEqual(1)
      }
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('1366×768 与 375px 都不横向溢出', async () => {
    const browser = await launch()
    try {
      for (const width of [1366, 375]) {
        const page = await openHome(browser, width)
        const overflow = (await page.evaluate(
          'document.documentElement.scrollWidth - document.documentElement.clientWidth',
        )) as number
        expect(overflow, `${width}px 下出现了横向溢出`).toBeLessThanOrEqual(1)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('绿色区间背景带存在、贯穿绘图区，且图注是真实日期', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const band = (await page.evaluate(`(() => {
        const rect = document.querySelector('svg rect.fill-highlight')
        if (!rect) return null
        const fig = rect.closest('figure')
        return {
          width: Number(rect.getAttribute('width')),
          height: Number(rect.getAttribute('height')),
          y: Number(rect.getAttribute('y')),
          caption: ((fig && fig.querySelector('figcaption')) || {}).textContent || '',
        }
      })()`)) as { width: number; height: number; y: number; caption: string } | null
      expect(band, '页面上没有找到绿色背景带').not.toBeNull()
      if (!band) return
      // 带子必须有面积、有高度（贯穿绘图区），不是一条线
      expect(band.width).toBeGreaterThan(5)
      expect(band.height).toBeGreaterThan(20)
      // 图注里的起止日期必须是真实日期，不能是硬编码的占位
      expect(band.caption).toMatch(/\d{4}-\d{2}-\d{2}/)
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('价格详情的纵轴不出现负刻度', async () => {
    // 价格从 0.086 涨到 134,000，8% 的下边距会把轴推到 −10,000，
    // 于是图上出现一个负价格刻度——那是图在替数据说假话。
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
      await page.goto(`${SITE}/metrics/price/`, {
        waitUntil: 'networkidle',
        timeout: TIMEOUT,
      })
      const ticks = (await page.evaluate(`(() => {
        return Array.from(document.querySelectorAll('svg text'))
          .map((t) => (t.textContent || '').trim())
          .filter((s) => s.length > 0)
      })()`)) as string[]
      // 图上的刻度与两个日期；负号只可能出现在日期里的连字符上
      const numeric = ticks.filter((s) => /^[-\d.,\sKMB]+$/i.test(s) && /\d/.test(s))
      expect(numeric.length).toBeGreaterThan(0)
      for (const t of numeric) {
        expect(t, `纵轴出现了负刻度：${t}`).not.toMatch(/^\s*-/)
      }
    } finally {
      await browser.close()
    }
  }, TIMEOUT)
})

describe.skipIf(!available)('真实浏览器：市场状态与页脚', () => {
  it('市场状态卡片带着三档之一的中性/改善/恶化底色', async () => {
    // 颜色必须由规则结果决定，而不是文案里有没有"上涨"两个字。
    // 这里只断言"三档之一"，具体落在哪一档由当时的快照决定。
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const cls = (await page.evaluate(`(() => {
        const section = Array.from(document.querySelectorAll('section')).find((s) =>
          (s.textContent || '').includes('市场状态'),
        )
        return section ? String(section.className) : ''
      })()`)) as string
      expect(cls).toMatch(/bg-market-(improving|deteriorating|neutral)/)
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('页脚写着品牌署名，两个社交按钮指向真实账号', async () => {
    const browser = await launch()
    try {
      const page = await openHome(browser)
      const footer = (await page.evaluate(`(() => {
        const f = document.querySelector('footer')
        if (!f) return null
        return {
          text: (f.textContent || '').trim(),
          links: Array.from(f.querySelectorAll('a')).map((a) => ({
            href: a.getAttribute('href'),
            target: a.getAttribute('target'),
            rel: a.getAttribute('rel'),
          })),
        }
      })()`)) as { text: string; links: { href: string | null; target: string | null; rel: string | null }[] } | null
      expect(footer, '页面上没有页脚').not.toBeNull()
      if (!footer) return
      expect(footer.text).toContain('slowmoonship-慢月船')

      const github = footer.links.find((l) => (l.href ?? '').startsWith('https://github.com/'))
      const x = footer.links.find((l) => (l.href ?? '').startsWith('https://x.com/'))
      expect(github?.href).toBe('https://github.com/slowmoonship')
      expect(x?.href).toBe('https://x.com/slowmoonship')
      for (const link of footer.links) {
        expect(link.target).toBe('_blank')
        expect(link.rel).toContain('noopener')
        expect(link.rel).toContain('noreferrer')
      }
    } finally {
      await browser.close()
    }
  }, TIMEOUT)
})

describe.skipIf(!available)('真实浏览器：静态导出', () => {
  it('页面引用的每一个资源都能加载（子路径前缀正确）', async () => {
    // 静态导出最典型的故障是资源 URL 少了 basePath：
    // 页面 HTML 出来了，样式和脚本全 404，页面看起来像"没样式"。
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      const failed: string[] = []
      page.on('response', (res) => {
        const status = res.status()
        if (status >= 400) failed.push(`${status} ${res.url()}`)
      })
      await page.goto(`${SITE}/`, { waitUntil: 'networkidle', timeout: TIMEOUT })
      await page.waitForTimeout(1000)
      expect(failed).toEqual([])
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('原始数据 JSON 可下载', async () => {
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      const res = await page.goto(`${SITE}/data/price.json`, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT,
      })
      expect(res?.status()).toBe(200)
      const body = (await page.evaluate('document.body.innerText')) as string
      expect(body).toContain('"metricId"')
      expect(body).toContain('"price"')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('sitemap 与 robots 可访问，且 sitemap 只列规范地址', async () => {
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      const res = await page.goto(`${SITE}/sitemap.xml`, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT,
      })
      expect(res?.status()).toBe(200)
      const body = (await page.evaluate('document.body.innerText')) as string
      expect(body).toContain('<urlset')
      expect(body).not.toContain('/en')
    } finally {
      await browser.close()
    }
  }, TIMEOUT)

  it('canonical 指向带子路径的规范地址', async () => {
    const browser = await launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      await page.goto(`${SITE}/`, { waitUntil: 'networkidle', timeout: TIMEOUT })
      const canonical = (await page.evaluate(
        `document.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''`,
      )) as string
      expect(canonical).toContain(`${BASE_PATH}/`)
    } finally {
      await browser.close()
    }
  }, TIMEOUT)
})
