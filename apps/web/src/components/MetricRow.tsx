/**
 * 首页的一行：一行一条，名称 · 数值 · 变化。
 *
 * 视觉红线：不做卡片、不加阴影、不用彩色、不加迷你走势图。
 * 层级靠字重与间距；数值与元信息用等宽字体。
 * 涨跌**不染色**——灰色主题里靠 + / − 符号表达即可，
 * 而且"涨"对不同指标含义相反（矿工收入涨是好，费率涨不是），
 * 染成红绿等于替读者下判断。
 */

import Link from 'next/link'

import {
  formatSignedPercent,
  formatValue,
  latestChange,
  latestKnown,
  MISSING,
  type Locale,
  type MetricDefinition,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'

export type MetricRowProps = {
  readonly def: MetricDefinition
  readonly locale: Locale
  readonly points: readonly SeriesPoint[] | null
  readonly href: string
  readonly changeWindowDays: number | null
  readonly stale: boolean
}

export function MetricRow({
  def,
  locale,
  points,
  href,
  changeWindowDays,
  stale,
}: MetricRowProps) {
  const latest = points ? latestKnown(points) : null
  const value = latest ? formatValue(latest.value, def.format, locale) : null
  // 窗口为 null 表示这个指标本身就是变化量（见 MetricDefinition.changeWindowDays）
  const change = points && changeWindowDays !== null ? latestChange(points, changeWindowDays) : null
  const t = getDictionary(locale)

  return (
    <Link
      href={href}
      className="group flex items-baseline justify-between gap-4 border-b border-zinc-200 py-2.5 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <span className="min-w-0">
        <span className="text-zinc-900 group-hover:underline dark:text-zinc-100">
          {def.name[locale]}
        </span>
        {stale ? (
          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">{t.stale}</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-baseline gap-4 font-mono text-sm tabular-nums">
        <span
          className="min-w-[7rem] text-right text-zinc-900 dark:text-zinc-100"
          title={latest ? String(latest.value) : undefined}
        >
          {value ?? MISSING}
        </span>
        <span className="min-w-[4.5rem] text-right text-zinc-500 dark:text-zinc-500">
          {formatSignedPercent(change, locale) ?? ''}
        </span>
      </span>
    </Link>
  )
}
