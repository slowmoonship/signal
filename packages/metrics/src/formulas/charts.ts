/**
 * 详情页叠加图的数据，不是 SVG。
 *
 * 页面只负责把这里的点画出来。均线、分区、交叉都调用公式模块，
 * 避免详情页再实现一遍窗口。下采样只影响绘制密度，发布序列仍是日频。
 */

import type { Locale, SeriesPoint } from '../types.js'
import {
  AHR999_REFERENCE_HIGH,
  AHR999_REFERENCE_LOW,
  ageDays,
  fitRainbow,
  hashRibbonLines,
  HASH_RIBBON_VERSION,
  ma2yLines,
  MAYER_REFERENCE,
  MVRV_Z_REFERENCE_HIGH,
  piCycleLines,
  PUELL_REFERENCE_HIGH,
  PUELL_REFERENCE_LOW,
  rainbowBoundaryPrice,
  RAINBOW_EDGES,
  sma200wSeries,
  upwardCrosses,
} from './local.js'

export type ChartPaint =
  | 'ink'
  | 'muted'
  | 'faint'
  | 'rainbow-1'
  | 'rainbow-2'
  | 'rainbow-3'
  | 'rainbow-4'
  | 'rainbow-5'
  | 'rainbow-6'
  | 'rainbow-7'
  | 'rainbow-8'
  | 'rainbow-9'

export type ChartPoint = Readonly<{ ts: number; value: number }>

export type DetailChart = Readonly<{
  yScale: 'linear' | 'log'
  /** 数据本身非负时，纵轴不下探到 0 以下。 */
  floorAtZero: boolean
  tick: 'number' | 'hashrate'
  caption: string
  bands: readonly {
    lower: readonly ChartPoint[]
    upper: readonly ChartPoint[]
    paint: ChartPaint
  }[]
  lines: readonly {
    points: readonly ChartPoint[]
    paint: ChartPaint
    width: number
    dash: boolean
  }[]
  rules: readonly { value: number; label: string }[]
  markers: readonly { ts: number; y: number }[]
  legend: readonly { label: string; paint: ChartPaint; swatch: 'fill' | 'line' }[]
}>

const MAX_POINTS = 720

function text(locale: Locale, zh: string, en: string): string {
  return locale === 'zh' ? zh : en
}

function positive(points: readonly SeriesPoint[]): ChartPoint[] {
  const out: ChartPoint[] = []
  for (const p of points) {
    if (p.value !== null && p.value > 0 && Number.isFinite(p.value)) {
      out.push({ ts: p.ts, value: p.value })
    }
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

function finite(points: readonly SeriesPoint[]): ChartPoint[] {
  const out: ChartPoint[] = []
  for (const p of points) {
    if (p.value !== null && Number.isFinite(p.value)) out.push({ ts: p.ts, value: p.value })
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

/** 抽稀，但最后一点和交叉日必须留下，否则最新读数和事件会从线上消失。 */
function sample(points: readonly ChartPoint[], extra: readonly number[]): ChartPoint[] {
  if (points.length <= MAX_POINTS) return [...points]
  const byTs = new Map(points.map((p) => [p.ts, p]))
  const picked = new Map<number, ChartPoint>()
  const stride = Math.ceil(points.length / MAX_POINTS)
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i]
    if (p) picked.set(p.ts, p)
  }
  const last = points[points.length - 1]
  if (last) picked.set(last.ts, last)
  for (const ts of extra) {
    const p = byTs.get(ts)
    if (p) picked.set(p.ts, p)
  }
  return [...picked.values()].sort((a, b) => a.ts - b.ts)
}

function at(points: readonly ChartPoint[], ts: number): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]
    if (p && p.ts === ts) return p.value
  }
  return null
}

function markersOn(line: readonly ChartPoint[], times: readonly number[]): { ts: number; y: number }[] {
  const out: { ts: number; y: number }[] = []
  for (const ts of times) {
    const y = at(line, ts)
    if (y !== null) out.push({ ts, y })
  }
  return out
}

function line(
  points: readonly ChartPoint[],
  paint: ChartPaint,
  width: number,
  dash = false,
): DetailChart['lines'][number] {
  return { points, paint, width, dash }
}

function rule(value: number, label: string): DetailChart['rules'][number] {
  return { value, label }
}

/**
 * 叠加图需要的父序列。空数组表示只用指标自己的发布值。
 * 页面据此读盘，不在组件里写指标名单之外的路径。
 */
export function detailChartParents(metricId: string): readonly string[] {
  switch (metricId) {
    case 'rainbow-zone':
    case 'pi-cycle-top':
    case 'sma-200w':
    case 'ma-2y':
      return ['price']
    case 'hash-ribbons':
      return ['hashrate']
    default:
      return []
  }
}

export function buildDetailChart(
  metricId: string,
  series: Readonly<Record<string, readonly SeriesPoint[] | undefined>>,
  locale: Locale,
): DetailChart | null {
  switch (metricId) {
    case 'ahr999':
      return indexChart(series[metricId], locale, 'log', [
        rule(AHR999_REFERENCE_LOW, '0.45'),
        rule(AHR999_REFERENCE_HIGH, '1.2'),
      ], text(locale, '对数坐标。横线是历史分布参考，不是操作条件。', 'Log scale. Lines are historical reference levels.'))
    case 'puell-multiple':
      return indexChart(series[metricId], locale, 'log', [
        rule(PUELL_REFERENCE_LOW, '0.5'),
        rule(PUELL_REFERENCE_HIGH, '4'),
      ], text(locale, '对数坐标。分子是发行收入，不含手续费。', 'Log scale. Issuance revenue only, fees excluded.'))
    case 'mayer-multiple':
      return indexChart(series[metricId], locale, 'log', [
        rule(1, text(locale, '均线', 'average')),
        rule(MAYER_REFERENCE, '2.4'),
      ], text(locale, '对数坐标。2.4 是早期样本的参考线。', 'Log scale. 2.4 is a reference from an earlier sample.'))
    case 'nupl':
      return indexChart(series[metricId], locale, 'linear', [
        rule(0, text(locale, '市值等于已实现市值', 'market cap equals realised cap')),
      ], text(locale, '0 线是市值与已实现市值相等。可以小于 0。', 'Zero is market cap equal to realised cap. Values can be negative.'), false)
    case 'mvrv-zscore':
      return indexChart(series[metricId], locale, 'linear', [
        rule(0, '0'),
        rule(MVRV_Z_REFERENCE_HIGH, '7'),
      ], text(locale, '标准差是市值的扩展样本标准差。早期读数会拉开纵轴。', 'Standard deviation is of market cap. Early readings stretch the axis.'), false)
    case 'rainbow-zone':
      return rainbowChart(series['price'], locale)
    case 'pi-cycle-top':
      return piChart(series['price'], locale)
    case 'sma-200w':
      return maChart(series['price'], locale, '200w')
    case 'ma-2y':
      return maChart(series['price'], locale, '2y')
    case 'hash-ribbons':
      return hashChart(series['hashrate'], locale)
    default:
      return null
  }
}

function indexChart(
  points: readonly SeriesPoint[] | undefined,
  locale: Locale,
  yScale: 'linear' | 'log',
  rules: DetailChart['rules'],
  caption: string,
  floorAtZero = true,
): DetailChart | null {
  if (!points) return null
  const known = yScale === 'log' ? positive(points) : finite(points)
  const sampled = sample(known, [])
  if (sampled.length < 2) return null
  return {
    yScale,
    floorAtZero,
    tick: 'number',
    caption,
    bands: [],
    lines: [line(sampled, 'ink', 1.25)],
    rules,
    markers: [],
    legend: [{ label: text(locale, '数值', 'value'), paint: 'ink', swatch: 'line' }],
  }
}

function rainbowChart(price: readonly SeriesPoint[] | undefined, locale: Locale): DetailChart | null {
  if (!price) return null
  const model = fitRainbow(price)
  if (!model) return null
  const px = positive(price)
  const sampled = sample(px, [])
  if (sampled.length < 2) return null

  const edges = RAINBOW_EDGES.map((z) =>
    sampled.map((p) => rainbowBoundaryPrice(ageDays(p.ts), model, z)),
  )
  const bands: DetailChart['bands'][number][] = []
  const paints: ChartPaint[] = [
    'rainbow-1',
    'rainbow-2',
    'rainbow-3',
    'rainbow-4',
    'rainbow-5',
    'rainbow-6',
    'rainbow-7',
    'rainbow-8',
    'rainbow-9',
  ]
  // 第 1 区与第 9 区向外再加半个标准差，好让两端有面积。
  // 分区规则仍然是 ±2σ。按 4 倍去扩会把对数轴拉出很远的空档，九个色带就被挤成一条。
  const floor = sampled.map((p) => rainbowBoundaryPrice(ageDays(p.ts), model, -2.5))
  const cap = sampled.map((p) => rainbowBoundaryPrice(ageDays(p.ts), model, 2.5))
  const levels = [floor, ...edges, cap]
  for (let i = 0; i < 9; i += 1) {
    const lower = levels[i]
    const upper = levels[i + 1]
    const paint = paints[i]
    if (!lower || !upper || !paint) continue
    const lo: ChartPoint[] = []
    const hi: ChartPoint[] = []
    for (let k = 0; k < sampled.length; k += 1) {
      const ts = sampled[k]?.ts
      const a = lower[k]
      const b = upper[k]
      if (ts === undefined || a === null || a === undefined || b === null || b === undefined) continue
      if (!(b > a) || !(a > 0)) continue
      lo.push({ ts, value: a })
      hi.push({ ts, value: b })
    }
    if (lo.length >= 2) bands.push({ lower: lo, upper: hi, paint })
  }

  return {
    yScale: 'log',
    floorAtZero: true,
    tick: 'number',
    caption: text(
      locale,
      `${model.version}。拟合窗 ${model.fitFrom} 至 ${model.fitUntil}，决定系数 ${model.r2.toFixed(2)}。2018 年前是样本内结果，之后是冻结系数的外推，都不是当时已知的预测。`,
      `${model.version}. Fit ${model.fitFrom} to ${model.fitUntil}, R2 ${model.r2.toFixed(2)}. In-sample before 2018, frozen extrapolation after. Neither is a forecast that existed at the time.`,
    ),
    bands,
    lines: [line(sampled, 'ink', 1.25)],
    rules: [],
    markers: [],
    legend: [
      ...paints.map((paint, i) => ({
        label: text(locale, `第${i + 1}区`, `zone ${i + 1}`),
        paint,
        swatch: 'fill' as const,
      })),
      { label: text(locale, '价格', 'price'), paint: 'ink' as const, swatch: 'line' as const },
    ],
  }
}

function piChart(price: readonly SeriesPoint[] | undefined, locale: Locale): DetailChart | null {
  if (!price) return null
  const lines = piCycleLines(price)
  const crosses = upwardCrosses(lines.ratio)
  const px = sample(positive(price), crosses)
  const fast = sample(positive(lines.fast), crosses)
  const slow = sample(positive(lines.slowTwice), crosses)
  if (px.length < 2 || fast.length < 2 || slow.length < 2) return null
  return {
    yScale: 'log',
    floorAtZero: true,
    tick: 'number',
    caption: text(
      locale,
      '对数坐标。圆点是快线真正上穿 2 倍慢线的日子，比值接近 1 不会画点。',
      'Log scale. Dots are days the fast average actually crossed above twice the slow average.',
    ),
    bands: [],
    lines: [
      line(px, 'faint', 1, true),
      line(fast, 'ink', 1.25),
      line(slow, 'muted', 1.25, true),
    ],
    rules: [],
    markers: markersOn(fast, crosses),
    legend: [
      { label: text(locale, '价格', 'price'), paint: 'faint', swatch: 'line' },
      { label: 'SMA111', paint: 'ink', swatch: 'line' },
      { label: text(locale, '2倍SMA350', '2x SMA350'), paint: 'muted', swatch: 'line' },
    ],
  }
}

function maChart(
  price: readonly SeriesPoint[] | undefined,
  locale: Locale,
  which: '200w' | '2y',
): DetailChart | null {
  if (!price) return null
  const px = sample(positive(price), [])
  if (px.length < 2) return null
  if (which === '200w') {
    const ma = sample(positive(sma200wSeries(price)), [])
    if (ma.length < 2) return null
    return {
      yScale: 'log',
      floorAtZero: true,
      tick: 'number',
      caption: text(
        locale,
        '对数坐标。均线取周日的日均参考价，不是 1400 日均线，也不是交易所周收盘价。',
        'Log scale. The average uses Sunday daily-average reference prices, not a 1400-day average and not an exchange weekly close.',
      ),
      bands: [],
      lines: [line(px, 'faint', 1, true), line(ma, 'ink', 1.25)],
      rules: [],
      markers: [],
      legend: [
        { label: text(locale, '价格', 'price'), paint: 'faint', swatch: 'line' },
        { label: text(locale, '200周均线', '200-week average'), paint: 'ink', swatch: 'line' },
      ],
    }
  }
  const built = ma2yLines(price)
  const average = sample(positive(built.average), [])
  const upper = sample(positive(built.upper), [])
  if (average.length < 2 || upper.length < 2) return null
  return {
    yScale: 'log',
    floorAtZero: true,
    tick: 'number',
    caption: text(
      locale,
      '对数坐标。均线是 730 个 UTC 日，上轨是它的 5 倍。',
      'Log scale. The average is 730 UTC days. The upper line is five times that average.',
    ),
    bands: [],
    lines: [line(px, 'faint', 1, true), line(average, 'ink', 1.25), line(upper, 'muted', 1.25, true)],
    rules: [],
    markers: [],
    legend: [
      { label: text(locale, '价格', 'price'), paint: 'faint', swatch: 'line' },
      { label: text(locale, '730日均线', '730-day average'), paint: 'ink', swatch: 'line' },
      { label: text(locale, '5倍上轨', '5x line'), paint: 'muted', swatch: 'line' },
    ],
  }
}

function hashChart(hashrate: readonly SeriesPoint[] | undefined, locale: Locale): DetailChart | null {
  if (!hashrate) return null
  const built = hashRibbonLines(hashrate)
  const crosses = upwardCrosses(built.ratio)
  const fast = sample(positive(built.fast), crosses)
  const slow = sample(positive(built.slow), crosses)
  if (fast.length < 2 || slow.length < 2) return null
  return {
    yScale: 'log',
    floorAtZero: true,
    tick: 'hashrate',
    caption: text(
      locale,
      `${HASH_RIBBON_VERSION}。圆点是 30 日均线上穿 60 日均线。没有价格动量确认。`,
      `${HASH_RIBBON_VERSION}. Dots are the 30-day average crossing above the 60-day average. No price-momentum confirmation.`,
    ),
    bands: [],
    lines: [line(fast, 'ink', 1.25), line(slow, 'muted', 1.25, true)],
    rules: [],
    markers: markersOn(fast, crosses),
    legend: [
      { label: text(locale, '30日均线', '30-day average'), paint: 'ink', swatch: 'line' },
      { label: text(locale, '60日均线', '60-day average'), paint: 'muted', swatch: 'line' },
    ],
  }
}
