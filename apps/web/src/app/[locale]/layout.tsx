/**
 * 站点根布局。
 *
 * 刻意**没有** `app/layout.tsx`：`[locale]` 这一层自己就是根布局。
 * 只有这样 `<html lang>` 才能随语言变化——D1 要求中英双语各自正确，
 * 而把 lang 写死在根布局会让读屏软件用错发音。
 * 代价是 `/` 没有对应路由，它由 middleware 重定向到 `/en` 或 `/zh`。
 */

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { LOCALES } from '@slowmoonship/metrics'

import { LocaleSwitch } from '@/components/LocaleSwitch'
import { getDictionary, isLocale } from '@/i18n/dictionaries'
import { fontVariables } from '@/lib/fonts'

import '../globals.css'

export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = isLocale(locale) ? getDictionary(locale) : null
  const description = t?.tagline ?? 'Bitcoin market and on-chain metrics'
  return {
    title: `${t?.siteTitle ?? 'Signal'} — ${description}`,
    description,
    alternates: {
      canonical: `/${locale}`,
      languages: { en: '/en', zh: '/zh' },
    },
    openGraph: {
      title: `${t?.siteTitle ?? 'Signal'} — ${description}`,
      description,
      locale,
      type: 'website',
    },
    // 日更快照：允许被抓取缓存，不允许被实时刷新（ADR-004 无实时性）
    robots: { index: true, follow: true },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()

  const t = getDictionary(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${fontVariables} font-sans antialiased`}>
        <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 sm:px-6">
          {/* 首页有 18 行链接，键盘用户每翻一页都要 Tab 过它们；
              跳过链接是唯一便宜的解法——不加它就只能靠用户自己按 Tab 到吐。 */}
          <a className="skip-link" href="#content">
            {t.skipToContent}
          </a>
          <header className="flex items-baseline justify-between py-6">
            <span className="text-sm font-semibold tracking-tight">{t.siteTitle}</span>
            <LocaleSwitch locale={locale} path={`/${locale}`} />
          </header>
          <main id="content" className="flex-1 pb-16">
            {children}
          </main>
          <footer className="border-t border-rule py-6 text-xs text-ink-subtle">{t.footerNote}</footer>
        </div>
      </body>
    </html>
  )
}
