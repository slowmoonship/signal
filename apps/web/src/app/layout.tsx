/**
 * 站点根布局。
 *
 * V0.1 起只有中文界面（ADR-021），因此：
 *
 * - `<html lang>` 固定为 `zh-CN`。读屏软件据此选发音，猜错比不写更糟。
 * - 页头没有语言切换入口，`/en` 也不再生成。
 * - 站点根路径 `/` 直接就是中文首页，**不依赖服务端重定向**：
 *   静态导出到 GitHub Pages 之后打开域名根路径也能落到首页。
 *
 * 以前这里没有 `app/layout.tsx`，根布局是 `app/[locale]/layout.tsx`——
 * 那样做是为了让 `lang` 随语言变化。只有一种语言之后，这个理由不成立，
 * 把根布局放回 `app/layout.tsx` 才能让 `/` 与 `/zh` 共用同一棵布局。
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { SiteFooter } from '@/components/SiteFooter'
import { getDictionary } from '@/i18n/dictionaries'
import { BASE_PATH } from '@/lib/base-path'
import { fontVariables } from '@/lib/fonts'
import { siteUrl } from '@/lib/site-url'

import './globals.css'

export function generateMetadata(): Metadata {
  const t = getDictionary()
  const description = t.tagline
  // 域名未定（Phase 5），未配置 SIGNAL_SITE_URL 时不写死一个占位域名：
  // canonical / OG 的绝对 URL 都从这里推导，写错比留空更难发现。
  const base = siteUrl()
  return {
    title: `${t.siteTitle} — ${description}`,
    description,
    ...(base ? { metadataBase: base } : {}),
    // 只有一种语言，不需要 hreflang 互指（ADR-021）。
    // 规范地址指向 `/signal/`：`/zh` 是同一页面的历史别名，它自己也这么声明。
    // 路径里带上 BASE_PATH——站点挂在项目子路径下，写成 `/` 会指向域名根目录。
    alternates: { canonical: `${BASE_PATH}/` },
    openGraph: {
      title: `${t.siteTitle} — ${description}`,
      description,
      locale: 'zh_CN',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${t.siteTitle} — ${description}`,
      description,
    },
    // 日更快照：允许被抓取缓存，不允许被实时刷新（ADR-004 无实时性）
    robots: { index: true, follow: true },
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const t = getDictionary()

  return (
    /*
     * `fontVariables` 必须挂在 <html> 上，不能挂 <body>。
     *
     * Tailwind 把 `--font-sans: var(--font-inter), …` 声明在 `:root`（即 <html>），
     * 而 CSS 自定义属性的 `var()` **在声明处替换**：那一刻 `--font-inter`
     * 必须在 <html> 上有值，否则 `--font-sans` 直接变成 guaranteed-invalid，
     * 而且这个 invalid 状态会原样继承给所有后代，**不会**在 <body> 上重新求值。
     * 于是 body 上的 `font-sans` 整条失效，web font 一个都不加载，
     * 页面静悄悄地退回系统字体——构建产物 CSS 完全正确，肉眼看不出哪里错了。
     */
    <html lang="zh-CN" className={fontVariables} suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* max-w-6xl：首页要并排放"摘要 + 5 列表格"，768px 下两栏都读不了。
            详情页自己再收窄（见 metrics/[id] 视图的 max-w-prose），
            因为散文在 1152px 上每行超过 100 个字符反而更难读。 */}
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-5 sm:px-6">
          {/* 首页有十几行链接，键盘用户每翻一页都要 Tab 过它们；
              跳过链接是唯一便宜的解法——不加它就只能靠用户自己按 Tab 到吐。 */}
          <a className="skip-link" href="#content">
            {t.skipToContent}
          </a>
          {/* 字标放大、副标题退居其次：品牌是这一站的名字，说明性标题只是注解。
              上下留白收紧——页头到正文之间不需要一段"空白页边距"，
              读者往下滚一屏才开始读内容，而首屏能放下多少内容才是关键。 */}
          <header className="flex items-center pt-6 pb-3">
            <span className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {t.siteTitle}
            </span>
          </header>
          <main id="content" className="flex-1 pb-16">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
