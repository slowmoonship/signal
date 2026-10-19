/**
 * 详情页的历史曲线。
 *
 * 为什么是手写 SVG 而不是 lightweight-charts：
 * - 页面是构建期静态生成的（ADR-004），交互式图表库带来的客户端 JS 没有用武之地；
 * - 只有一条折线、一组刻度，第三方库的重型能力用不上；
 * - 视觉红线要求纯灰阶、1px 线、无渐变无阴影，自绘最容易保证。
 *
 * 缺失值画成**断线**，而不是连线或填零：
 * 连起来等于声称"缺失那天也有这个数"，填零等于断言当天是零。
 */

import {
  formatAxisTick,
  formatValue,
  type Locale,
  type MetricDefinition,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { getDictionary } from '@/i18n/dictionaries'
import { formatUtcDay } from '@/lib/format-time'

const VIEW_W = 760
const VIEW_H = 220
const PAD = { top: 12, right: 56, bottom: 24, left: 8 }

type Props = {
  readonly def: MetricDefinition
  readonly locale: Locale
  readonly points: readonly SeriesPoint[]
}

export function MetricChart({ def, locale, points }: Props) {
  const t = getDictionary(locale)
  const known = points.filter((p) => p.value !== null)

  if (known.length === 0) {
    return <p className="py-8 text-sm text-ink-muted">{t.chartNoData}</p>
  }

  if (known.length === 1) {
    const only = known[0]
    const value = only ? formatValue(only.value, def.format, locale) : null
    return (
      <div className="py-8">
        <p className="font-mono text-2xl tabular-nums">
          {value ?? '—'}
          <span className="ml-3 text-xs text-ink-subtle">
            {only ? formatUtcDay(only.ts) : ''}
          </span>
        </p>
        <p className="mt-3 max-w-prose text-sm text-ink-muted">{t.chartSinglePoint}</p>
      </div>
    )
  }

  const firstTs = points[0]?.ts ?? 0
  const lastTs = points[points.length - 1]?.ts ?? 1
  const span = Math.max(1, lastTs - firstTs)

  const values = known.map((p) => p.value ?? 0)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  // 常量序列（真实存在，例如连续多日净流入恰好为 0）不该被除零放大，
  // 也不该画成一条贴边的直线假装有波动：给它一个人造量程并在轴上体现。
  const flat = rawMax === rawMin
  const pad = flat ? Math.max(1, Math.abs(rawMax) * 0.1) : (rawMax - rawMin) * 0.08
  const min = rawMin - pad
  const max = rawMax + pad

  const x = (ts: number): number => PAD.left + ((ts - firstTs) / span) * (VIEW_W - PAD.left - PAD.right)
  const y = (v: number): number =>
    PAD.top + (1 - (v - min) / (max - min || 1)) * (VIEW_H - PAD.top - PAD.bottom)

  // 缺失处断开：按连续的非空片段分组，每段一条 polyline
  const segments: string[] = []
  let current: string[] = []
  for (const p of points) {
    if (p.value === null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      continue
    }
    current.push(`${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
  }
  if (current.length > 1) segments.push(current.join(' '))

  const ticks = [min, min + (max - min) / 2, max]
  const last = latestKnownPoint(known)
  const firstDate = formatUtcDay(firstTs)
  const lastDate = formatUtcDay(lastTs)

  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        role="img"
        aria-label={`${def.name[locale]} — ${t.chartWindow} ${firstDate} – ${lastDate}`}
      >
        {/* 网格线最弱、数据线最重：同一张图里两者用同一套语义 token，
            明暗两态只切换取值，不切换层级关系。 */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={VIEW_W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-rule"
              strokeWidth="1"
              strokeDasharray="2 4"
            />
            <text
              x={VIEW_W - PAD.right + 6}
              y={y(tick) + 3}
              className="fill-ink-subtle font-mono text-[10px]"
            >
              {formatAxisTick(tick, locale)}
            </text>
          </g>
        ))}

        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg}
            fill="none"
            className="stroke-ink"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        ))}

        {last ? <circle cx={x(last.ts)} cy={y(last.value ?? 0)} r="2" className="fill-ink" /> : null}

        <text x={PAD.left} y={VIEW_H - 6} className="fill-ink-subtle font-mono text-[10px]">
          {firstDate}
        </text>
        <text
          x={VIEW_W - PAD.right}
          y={VIEW_H - 6}
          textAnchor="end"
          className="fill-ink-subtle font-mono text-[10px]"
        >
          {lastDate}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-ink-muted">
        <span>
          {t.chartWindow}: {firstDate} – {lastDate}
        </span>
        <span className="font-mono">
          {t.chartLatest}:{' '}
          {last ? (formatValue(last.value, def.format, locale) ?? '—') : '—'} @{' '}
          {last ? formatUtcDay(last.ts) : '—'}
        </span>
      </figcaption>
    </figure>
  )
}

function latestKnownPoint(points: readonly SeriesPoint[]): SeriesPoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]
    if (p !== undefined && p.value !== null) return p
  }
  return null
}
