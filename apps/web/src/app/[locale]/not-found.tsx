/**
 * 404。挂在 [locale] 下，因此同样由根布局包裹（保持 html lang 正确）。
 */

import Link from 'next/link'

import { getDictionary, isLocale } from '@/i18n/dictionaries'

export default async function NotFound({
  params,
}: {
  // Next 在 not-found 页面里仍会传入已匹配到的动态段；没有匹配时 params 为空对象
  params?: Promise<{ locale?: string }>
}) {
  const resolved = await params?.catch(() => undefined)
  const locale = resolved?.locale
  const t = getDictionary(isLocale(locale ?? '') ? (locale as 'en' | 'zh') : 'en')

  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t.notFoundBody}</p>
      <Link
        href={`/${isLocale(locale ?? '') ? locale : 'en'}`}
        className="mt-6 inline-block text-sm text-ink-muted hover:text-ink hover:underline"
      >
        ← {t.backToIndex}
      </Link>
    </div>
  )
}
