/**
 * 404。
 *
 * 挂在 app 根上，因此覆盖全站所有匹配不到的地址——
 * 包括 `/en`（V0.1 起不再生成英文页面）与任何不存在的指标 id。
 *
 * 页面由根布局包裹，`<html lang="zh-CN">` 依然正确。
 */

import Link from 'next/link'

import { getDictionary } from '@/i18n/dictionaries'

export default function NotFound() {
  const t = getDictionary()

  return (
    <div className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t.notFoundBody}</p>
      <Link href="/" className="mt-6 inline-block text-sm text-ink-muted hover:text-ink hover:underline">
        ← {t.backToIndex}
      </Link>
    </div>
  )
}
