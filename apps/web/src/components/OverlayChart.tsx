/**
 * 详情页的叠加图：均线、参考线、分区、交叉点。
 *
 * 几何全部来自 `buildDetailChart`。这里不知道指标 id，也不写色值。
 * 彩虹的九个填色是语义类，色值在 globals.css。其余线条仍是灰阶。
 */

import {
  formatAxisTick,
  formatHashRate,
  type DetailChart,
  type ChartPaint,
  type ChartPoint,
  type SiteLocale,
} from '@slowmoonship/metrics'

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

const DAY = 86_400

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
    for (const p of series.points) if (usable(p.value, chart.yScale)) values.push(p.value)
  }
  for (const rule of chart.rules) if (usable(rule.value, chart.yScale)) values.push(rule.value)
  const domain = yDomain(values, chart.yScale, chart.floorAtZero)
  if (!domain) return null

  const times: number[] = []
  for (const series of chart.lines) {
    for (const p of series.points) times.push(p.ts)
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

  const ticks = chart.yScale === 'log'
    ? [domain.min, Math.pow(10, (Math.log10(domain.min) + Math.log10(domain.max)) / 2), domain.max]
    : [domain.min, (domain.min + domain.max) / 2, domain.max]

  return (
    <figure className="mt-8">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={chart.legend.map((item) => item.label).join(' / ')}
        className="w-full"
      >
        {chart.bands.map((band) => (
          <polygon
            key={band.paint}
            points={polygon(band.lower, band.upper, x, y)}
            className={FILL[band.paint]}
          />
        ))}
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
          segments(series.points).map((seg) => (
            <polyline
              key={`${series.paint}-${seg[0]?.ts ?? 0}`}
              points={seg.map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
              fill="none"
              className={STROKE[series.paint]}
              strokeWidth={series.width}
              strokeDasharray={series.dash ? '5 3' : undefined}
            />
          )),
        )}
        {chart.markers.map((marker) => (
          <circle
            key={marker.ts}
            cx={x(marker.ts)}
            cy={y(marker.y)}
            r="2.6"
            className="fill-ink"
          />
        ))}
      </svg>
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
  const label = formatAxisTick(value, locale)
  // 对数轴的下沿常常是一个很小的正数。两位小数会把它收成「0」，
  // 读起来像价格曾经为零。那种刻度改用科学计数。
  if (chart.yScale === 'log' && value > 0 && (label === '0' || label === '-0')) {
    return value.toExponential(0)
  }
  return label
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
): string {
  const fwd = upper.map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
  const back = [...lower].reverse().map((p) => `${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`)
  return [...fwd, ...back].join(' ')
}

function segments(points: readonly ChartPoint[]): ChartPoint[][] {
  const out: ChartPoint[][] = []
  let cur: ChartPoint[] = []
  // 画之前会把日序列抽稀到几百个点，相邻点本来就隔着好几天。
  // 按「超过 1.5 天就断开」来切，整条线会被切成孤立的点，图上就什么都没有。
  // 只有明显大于抽稀步长的缺口才是真缺数据。
  const limit = gapLimit(points)
  for (const p of points) {
    const prev = cur[cur.length - 1]
    if (prev && p.ts - prev.ts > limit) {
      if (cur.length > 1) out.push(cur)
      cur = [p]
      continue
    }
    cur.push(p)
  }
  if (cur.length > 1) out.push(cur)
  return out
}

function gapLimit(points: readonly ChartPoint[]): number {
  if (points.length < 3) return DAY * 1.5
  const gaps: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1]
    const right = points[i]
    if (left && right) gaps.push(right.ts - left.ts)
  }
  gaps.sort((a, b) => a - b)
  const mid = gaps[Math.floor(gaps.length / 2)] ?? DAY
  return Math.max(DAY * 1.5, mid * 3)
}
