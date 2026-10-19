/**
 * 语言切换。
 *
 * 用链接而不是按钮：切换语言是一次导航，搜索引擎与阅读器都该能跟随它。
 * `hreflang` alternates 在各页面的 metadata 里给出（见 generateMetadata）。
 */

import Link from 'next/link'

import type { Locale } from '@slowmoonship/metrics'

import { localeLabel, otherLocale } from '@/i18n/dictionaries'

export function LocaleSwitch({ locale, path }: { locale: Locale; path: string }) {
  const next = otherLocale(locale)
  return (
    <Link
      href={path.replace(/^\/(en|zh)(?=\/|$)/, `/${next}`)}
      hrefLang={next}
      className="font-mono text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      {localeLabel(next)}
    </Link>
  )
}
