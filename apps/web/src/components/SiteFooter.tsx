/**
 * 页脚：品牌署名 + 两个社交入口。
 *
 * 页脚原来写的是"每日一个快照。无实时数据，不轮询。"——
 * 那句话在页脚只是复述，首页与详情页都已经把数据时效说清楚了
 * （更新时刻、过期横幅、单位说明）。页脚该留的是"这是谁做的"。
 *
 * 两个社交按钮刻意做得很小：它们是署名的一部分，不是导流位。
 * 图标是单色的（currentColor），跟着文字颜色走——
 * 彩色图标会变成全站第二套配色系统，和视觉红线打架。
 */

import type { ReactNode } from 'react'

import { getDictionary } from '@/i18n/dictionaries'

/** GitHub 主页。真实账号，不是占位地址。 */
const GITHUB_URL = 'https://github.com/slowmoonship'
/** X（Twitter）主页。 */
const X_URL = 'https://x.com/slowmoonship'

export function SiteFooter() {
  const t = getDictionary()

  return (
    <footer className="border-t border-rule py-6 text-xs text-ink-subtle">
      {/* flex-wrap：窄屏上品牌名与两个按钮换行，而不是把页面撑出横向滚动。 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-medium text-ink-muted">{t.footerBrand}</span>

        <SocialLink href={GITHUB_URL} label="GitHub">
          <GitHubMark />
        </SocialLink>

        <SocialLink href={X_URL} label="X">
          <XMark />
        </SocialLink>
      </div>
    </footer>
  )
}

/**
 * 外部链接。
 *
 * `target="_blank"` 必须配 `rel="noopener noreferrer"`：
 * 没有 noopener，新窗口能通过 `window.opener` 反向操纵本页
 * （改地址、读页面），noreferrer 则是不把来源地址带过去。
 */
function SocialLink({
  href,
  label,
  children,
}: {
  readonly href: string
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2 py-1 font-mono text-xs text-ink-muted transition-colors hover:border-rule-strong hover:text-ink"
    >
      {children}
      {label}
    </a>
  )
}

/** GitHub 标记（16×16，currentColor 填充）。 */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  )
}

/** X 标记（16×16，currentColor 填充）。 */
function XMark() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M9.53 6.77 15.5 0h-1.41L8.9 6.02 4.83 0H0l6.26 8.89L0 16h1.41l5.47-6.24L11.17 16H16L9.53 6.77Zm-1.94 2.21-.64-.89L2.02 1.04h2.19l3.9 5.46.64.89 5.31 7.44h-2.19L7.59 8.98Z"
      />
    </svg>
  )
}
