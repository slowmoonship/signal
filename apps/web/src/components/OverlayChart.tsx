/**
 * 详情页的叠加图：均线、参考线、分区、交叉点。
 *
 * 几何全部来自 `buildDetailChart`。这里不知道指标 id，也不写色值。
 * 彩虹的九个填色是语义类，色值在 globals.css。其余线条仍是灰阶。
 */

import {
  formatAxisTick,
  formatHashRate,
  formatLogTick,
  logMajorTicks,
  type DetailChart,
  type ChartPaint,
  type ChartPoint,
  type SiteLocale,
} from '@slowmoonship/metrics'

import { TimeAxis } from './TimeAxis'

const VIEW_W = 760
const VIEW_H = 280
const PAD = { top: 16, right: 64, bottom: 28, left: 8 }

const FILL: Readonly<Record<ChartPaint, string>> = {
  ink: 'fill-ink',
  muted: 'fill-ink-muted',
  faint: 'fill-ink-subtle',
  'rainbow-1': 'fill-rainbow-1',
  'rainbow-2': 'fill-rainbow-2',
  'rainbow-3': 'fill-rainbow-3',
  'rainbow-4': 'fill-rainbow-4',
  'rainbow-5': 'fill-rainbow-5',
  'rainbow-6': 'fill-rainbow-6',
  'rainbow-7': 'fill-rainbow-7',
  'rainbow-8': 'fill-rainbow-8',
  'rainbow-9': 'fill-rainbow-9',
}

const STROKE: Readonly<Record<ChartPaint, string>> = {
  ink: 'stroke-ink',
  muted: 'stroke-ink-muted',
  faint: 'stroke-ink-subtle',
  'rainbow-1': 'stroke-rainbow-1',
  'rainbow-2': 'stroke-rainbow-2',
  'rainbow-3': 'stroke-rainbow-3',
  'rainbow-4': 'stroke-rainbow-4',
  'rainbow-5': 'stroke-rainbow-5',
  'rainbow-6': 'stroke-rainbow-6',
  'rainbow-7': 'stroke-rainbow-7',
  'rainbow-8': 'stroke-rainbow-8',
  'rainbow-9': 'stroke-rainbow-9',
}

const SWATCH: Readonly<Record<ChartPaint, string>> = {
  ink: 'bg-ink',
  muted: 'bg-ink-muted',
  faint: 'bg-ink-subtle',
  'rainbow-1': 'bg-rainbow-1',
  'rainbow-2': 'bg-rainbow-2',
  'rainbow-3': 'bg-rainbow-3',
  'rainbow-4': 'bg-rainbow-4',
  'rainbow-5': 'bg-rainbow-5',
  'rainbow-6': 'bg-rainbow-6',
  'rainbow-7': 'bg-rainbow-7',
  'rainbow-8': 'bg-rainbow-8',
  'rainbow-9': 'bg-rainbow-9',
}

export function OverlayChart({
  chart,
  locale,
}: {
  readonly chart: DetailChart
  readonly locale: SiteLocale
}) {
  const values: number[] = []
  for (const band of chart.bands) {
    for (const p of band.lower) if (usable(p.value, chart.yScale)) values.push(p.value)
    for (const p of band.upper) if (usable(p.value, chart.yScale)) values.push(p.value)
  }
  for (const series of chart.lines) {
    for (const segment of series.segments) {
      for (const p of segment) if (usable(p.value, chart.yScale)) values.push(p.value)
    }
  }
  for (const rule of chart.rules) if (usable(rule.value, chart.yScale)) values.push(rule.value)
  const domain = chart.yDomain ?? yDomain(values, chart.yScale, chart.floorAtZero)
  if (!domain) return null

  const times: number[] = []
  for (const series of chart.lines) {
    for (const segment of series.segments) {
      for (const p of segment) times.push(p.ts)
    }
  }
  for (const band of chart.bands) {
    for (const p of band.lower) times.push(p.ts)
  }
  if (times.length < 2) return null
  const firstTs = Math.min(...times)
  const lastTs = Math.max(...times)
  const span = Math.max(1, lastTs - firstTs)

  const x = (ts: number): number =>
    PAD.left + ((ts - firstTs) / span) * (VIEW_W - PAD.left - PAD.right)
  const y = (v: number): number => {
    const top = chart.yScale === 'log' ? Math.log10(domain.max) : domain.max
    const bot = chart.yScale === 'log' ? Math.log10(domain.min) : domain.min
    const vv = chart.yScale === 'log' ? Math.log10(v) : v
    return PAD.top + (1 - (vv - bot) / (top - bot || 1)) * (VIEW_H - PAD.top - PAD.bottom)
  }

  const ticks = (
    chart.yScale === 'log'
      ? logMajorTicks(domain.min, domain.max)
      : [domain.min, (domain.min + domain.max) / 2, domain.max]
  ).filter((tick) => tickLabel(tick, chart, locale) !== '')

  return (
    <figure className="mt-8">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={chart.legend.map((item) => item.label).join(' / ')}
        className="w-full overflow-hidden"
      >
        {chart.bands.map((band, index) => {
          const points = polygon(band.lower, band.upper, x, y, domain)
          if (points === null) return null
          return (
            <polygon
              key={`${band.paint}-${band.lower[0]?.ts ?? index}-${index}`}
              points={points}
              className={FILL[band.paint]}
            />
          )
        })}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={VIEW_W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="stroke-rule"
              strokeWidth="1"
            />
            <text
              x={VIEW_W - PAD.right + 6}
              y={y(tick) + 3}
              className="fill-ink-subtle"
              fontSize="10"
            >
              {tickLabel(tick, chart, locale)}
            </text>
          </g>
        ))}
        {chart.rules.map((rule) =>
          usable(rule.value, chart.yScale) && rule.value >= domain.min && rule.value <= domain.max ? (
            <g key={rule.label}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={y(rule.value)}
                y2={y(rule.value)}
                className="stroke-rule-strong"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
              <text
                x={PAD.left + 4}
                y={y(rule.value) - 4}
                className="fill-ink-subtle"
                fontSize="10"
              >
                {rule.label}
              </text>
            </g>
          ) : null,
        )}
        {chart.lines.map((series) =>
          series.segments.map((seg) =>
            seg.length < 2 ? null : (
              <polyline
                key={`${series.paint}-${seg[0]?.ts ?? 0}`}
                data-chart-line=""
                points={seg
                  .filter((p) => Number.isFinite(y(p.value)))
                  .map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
                  .join(' ')}
                fill="none"
                className={STROKE[series.paint]}
                strokeWidth={series.width}
                strokeLinejoin="round"
                strokeDasharray={series.dash ? '5 3' : undefined}
              />
            ),
          ),
        )}
        {chart.markers.map((marker) => (
          <circle
            key={marker.ts}
            cx={x(marker.ts)}
            cy={y(marker.y)}
            r={chart.markerRadius ?? 2.6}
            className="fill-ink"
          />
        ))}
      </svg>
      <TimeAxis firstTs={firstTs} lastTs={lastTs} />
      <figcaption className="mt-3 space-y-2">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {chart.legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 font-mono text-xs text-ink-muted">
              <span
                className={`inline-block h-2 w-3 ${SWATCH[item.paint]}`}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-xs leading-relaxed text-ink-subtle">{chart.caption}</p>
      </figcaption>
    </figure>
  )
}

function tickLabel(value: number, chart: DetailChart, locale: SiteLocale): string {
  if (chart.tick === 'hashrate') return formatHashRate(value, locale)
  if (chart.yScale === 'log') return formatLogTick(value, locale, chart.tick === 'usd' ? 'usd' : 'plain')
  return formatAxisTick(value, locale)
}

function usable(value: number, scale: 'linear' | 'log'): boolean {
  return Number.isFinite(value) && (scale === 'linear' || value > 0)
}

function yDomain(
  values: readonly number[],
  scale: 'linear' | 'log',
  floorAtZero: boolean,
): { min: number; max: number } | null {
  if (values.length === 0) return null
  const min0 = Math.min(...values)
  const max0 = Math.max(...values)
  if (scale === 'log') {
    const lo = Math.log10(min0)
    const hi = Math.log10(max0)
    const span = Math.max(hi - lo, 0.05)
    const pad = span * 0.06
    return { min: 10 ** (lo - pad), max: 10 ** (hi + pad) }
  }
  const span = Math.max(max0 - min0, Math.abs(max0) * 0.02, 1e-6)
  const pad = span * 0.08
  let min = min0 >= 0 && floorAtZero ? min0 : min0 - pad
  if (floorAtZero && min < 0) min = 0
  const max = max0 + pad
  if (min === max) return { min: min - 1, max: max + 1 }
  return { min, max }
}

function polygon(
  lower: readonly ChartPoint[],
  upper: readonly ChartPoint[],
  x: (ts: number) => number,
  y: (v: number) => number,
  domain: { min: number; max: number },
): string | null {
  // 整段都在画面外就别画。跨出画面的边收到轴上，真实区间数值仍留在数据里。
  let seen = false
  for (let i = 0; i < lower.length; i += 1) {
    const lo = lower[i]?.value
    const hi = upper[i]?.value
    if (lo === undefined || hi === undefined) continue
    if (hi > domain.min && lo < domain.max) seen = true
  }
  if (!seen) return null
  const clamp = (value: number): number => Math.min(domain.max, Math.max(domain.min, value))
  const place = (point: ChartPoint): string | null => {
    const yy = y(clamp(point.value))
    if (!Number.isFinite(yy)) return null
    return `${x(point.ts).toFixed(1)},${yy.toFixed(1)}`
  }
  const fwd = upper.map(place).filter((part): part is string => part !== null)
  const back = [...lower].reverse().map(place).filter((part): part is string => part !== null)
  if (fwd.length < 2 || back.length < 2) return null
  return [...fwd, ...back].join(' ')
}
