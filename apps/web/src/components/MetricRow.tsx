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
  type SiteLocale,
  type MetricDefinition,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'

export type MetricRowProps = {
  readonly def: MetricDefinition
  readonly locale: SiteLocale
  readonly points: readonly SeriesPoint[] | null
  readonly href: string
  readonly changeWindowDays: number | null
  readonly stale: boolean
}

export function MetricRow({
  def,
  points,
  locale,
  href,
  changeWindowDays,
  stale,
}: MetricRowProps) {
  const latest = points ? latestKnown(points) : null
  const value = latest ? formatValue(latest.value, def.format, locale) : null
  // 窗口为 null 表示这个指标本身就是变化量（见 MetricDefinition.changeWindowDays）
  const change = points && changeWindowDays !== null ? latestChange(points, changeWindowDays) : null
  const t = getDictionary()

  return (
    <Link
      href={href}
      // 320px 上并排放不下：市值 `$1,646,907,492,049.81` 有 21 个字符，
      // 等宽 14px 下就要 176px，再加变化列就把指标名挤没。
      // 所以窄屏竖排、宽屏才回到一行——不是加滚动条，是换排版。
      className="group flex flex-col gap-1 border-b border-rule py-2.5 transition-colors last:border-b-0 hover:bg-surface-sunken sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
    >
      <span className="min-w-0 text-ink group-hover:underline">
        {def.name[locale]}
        {stale ? <span className="ml-2 text-xs text-ink-subtle">{t.stale}</span> : null}
      </span>

      <span className="flex shrink-0 items-baseline justify-between gap-4 font-mono text-sm tabular-nums sm:justify-end">
        <span className="text-right text-ink" title={latest ? String(latest.value) : undefined}>
          {value ?? MISSING}
        </span>
        <span className="w-[4.5rem] shrink-0 text-right text-ink-subtle">
          {formatSignedPercent(change, locale) ?? ''}
        </span>
      </span>
    </Link>
  )
}
