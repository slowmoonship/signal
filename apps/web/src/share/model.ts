/**
 * 把已经发布的快照整理成一张分享卡。
 *
 * 不重新计算指标，也不改状态规则。数字用 `formatValue`，
 * 判断用首页同一句 `marketSentence` 和详情页同一条 `reading.basis`。
 * `statusBasis` 会写出「近1年 P44」，那种缩写留在内部，不进分享图。
 */

import {
  buildDetailChart,
  classifyRegime,
  detailChartParents,
  formatAxisTick,
  formatHashRate,
  formatLogTick,
  formatValue,
  latestKnown,
  logMajorTicks,
  marketSentence,
  MISSING,
  readMarketScenario,
  REGIME_DATA_FAULT,
  REGIME_LABEL,
  registry,
  SHARE_HOME_METRIC_IDS,
  SITE_LOCALE,
  timeAxisTicks,
  type DetailChart,
  type FeatureTable,
  type PublishedMetric,
  type SeriesPoint,
} from '@slowmoonship/metrics'

import { loadMetric, type LoadResult } from '@/data/load.js'
import { siteRead } from '@/data/read.js'
import { getDictionary } from '@/i18n/dictionaries.js'
import { formatUtcDateTime, formatUtcDay } from '@/lib/format-time.js'

import type { HomeShareCard, MetricShareCard, ShareChart, SharePaint, SharePoint } from './types.js'

const DAY = 86_400
/** 内部表格用的分位缩写。分享图上不出现。 */
const PERCENTILE = /P\d+/

export function buildHomeShareCard(
  data: ReadonlyMap<string, LoadResult<PublishedMetric>>,
  features: FeatureTable,
): HomeShareCard {
  const t = getDictionary()
  const locale = SITE_LOCALE
  const read = readMarketScenario(features)
  const regime = classifyRegime(features)
  const regimeKind: HomeShareCard['regime'] =
    regime.status === 'unknown' || regime.regime === null ? 'fault' : regime.regime
  const regimeLabel =
    regimeKind === 'fault' ? t.marketReadFault : REGIME_LABEL[regimeKind][locale]
  const rawSentence =
    regimeKind === 'fault'
      ? REGIME_DATA_FAULT[locale]
      : marketSentence(read, features, locale)
  const sentence =
    publicLine(rawSentence) ??
    (regimeKind === 'fault' ? '' : publicLine(regime.basis[locale]) ?? '')

  const stats = SHARE_HOME_METRIC_IDS.map((id) => shareStat(id, data))
  const price = stats[0] ?? { label: t.sharePrice, value: MISSING }
  const rest = stats.slice(1)
  const priceData = data.get('price')
  const newest = priceData?.ok ? priceData.value.sourceTime : null
  const asOf = newest
    ? `价格数据截止 ${formatUtcDateTime(newest)} UTC`
    : `${t.updatedAt} ${MISSING}`

  return {
    kind: 'home',
    filename: 'signal-home.png',
    shareText: `${t.siteTitle} · ${regimeLabel}`,
    title: t.siteTitle,
    subtitle: t.shareSubtitle,
    regime: regimeKind,
    regimeLabel,
    sentence,
    price,
    stats: rest,
    asOf,
  }
}

export function buildMetricShareCard(id: string): MetricShareCard | null {
  if (!registry.has(id)) return null
  const t = getDictionary()
  const locale = SITE_LOCALE
  const def = registry.get(id)
  const loaded = loadMetric(id)
  const points = loaded.ok ? loaded.value.points : []
  const latest = latestKnown(points)
  const formatted = latest ? formatValue(latest.value, def.format, locale) : null
  const reading = siteRead().readings.get(id)
  const basis = reading ? publicLine(reading.basis[locale]) ?? '' : ''
  const status = reading ? publicLine(reading.word[locale]) ?? t.shareNoHistory : t.shareNoHistory
  const chart = shareChart(id, points)
  const filename = /^[a-z0-9-]+$/.test(id) ? `signal-${id}.png` : 'signal-metric.png'
  const value = formatted ?? MISSING

  return {
    kind: 'metric',
    filename,
    shareText: `${t.siteTitle} · ${def.name[locale]} ${value}`,
    title: t.siteTitle,
    category: t.categories[def.category],
    name: def.name[locale],
    value,
    status,
    statusLabel: t.shareStatus,
    basis,
    rangeLabel: rangeLabel(points, def.category),
    chart,
    emptyChart: t.shareNoHistory,
  }
}

function shareStat(
  id: (typeof SHARE_HOME_METRIC_IDS)[number],
  data: ReadonlyMap<string, LoadResult<PublishedMetric>>,
): { label: string; value: string } {
  const t = getDictionary()
  const locale = SITE_LOCALE
  if (!registry.has(id)) return { label: id, value: MISSING }
  const def = registry.get(id)
  const loaded = data.get(id)
  const points = loaded?.ok === true ? loaded.value.points : []
  const latest = latestKnown(points)
  const formatted = latest ? formatValue(latest.value, def.format, locale) : null
  const label = id === 'price' ? t.sharePrice : id === 'dca-max-wait-days' ? '定投赚5%最长等待' : (def.shortName?.[locale] ?? def.name[locale])
  return { label, value: formatted ?? MISSING }
}

function publicLine(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean || PERCENTILE.test(clean)) return null
  return clean
}

function rangeLabel(points: readonly SeriesPoint[], category: string): string {
  const t = getDictionary()
  const known = points.filter((point) => point.value !== null && Number.isFinite(point.value))
  const last = known[known.length - 1]
  if (!last) return t.shareNoHistory
  const day = formatUtcDay(last.ts)
  if (known.length < 2) return `${t.shareAsOf} ${day} UTC`
  const first = known[0]
  if (!first) return `${t.shareAsOf} ${day} UTC`
  const y0 = new Date(first.ts * 1000).getUTCFullYear()
  const y1 = new Date(last.ts * 1000).getUTCFullYear()
  const span = y0 === y1 ? String(y0) : `${y0}–${y1}`
  return `${t.shareHistory} ${span} · ${cadence(known, category)} · ${t.shareAsOf} ${day} UTC`
}

/** 日频序列写「日线」。披露之间隔了好几天，写成日线等于声称中间每天都有数。 */
function cadence(points: readonly SeriesPoint[], category: string): string {
  const t = getDictionary()
  if (category === 'strategy') return t.shareSparse
  const gaps: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    if (prev && next) gaps.push(next.ts - prev.ts)
  }
  gaps.sort((a, b) => a - b)
  const mid = gaps[Math.floor(gaps.length / 2)] ?? DAY
  return mid > 5 * DAY ? t.shareSparse : t.shareDaily
}

function shareChart(metricId: string, points: readonly SeriesPoint[]): ShareChart | null {
  const series: Record<string, readonly SeriesPoint[]> = { [metricId]: points }
  let parentsOk = true
  for (const parent of detailChartParents(metricId)) {
    const loaded = loadMetric(parent)
    if (!loaded.ok) {
      parentsOk = false
      break
    }
    series[parent] = loaded.value.points
  }
  if (parentsOk) {
    const detail = buildDetailChart(metricId, series, SITE_LOCALE)
    const drawn = detail ? chartFromDetail(detail) : null
    if (drawn) return drawn
  }
  return chartFromSeries(metricId, points)
}

function chartFromDetail(chart: DetailChart): ShareChart | null {
  const values: number[] = []
  const times: number[] = []
  const collect = (point: { ts: number; value: number }): void => {
    times.push(point.ts)
    if (usable(point.value, chart.yScale)) values.push(point.value)
  }
  if (!chart.yDomain) {
    for (const band of chart.bands) {
      for (const point of band.lower) collect(point)
      for (const point of band.upper) collect(point)
    }
  }
  for (const line of chart.lines) {
    for (const segment of line.segments) for (const point of segment) collect(point)
  }
  for (const rule of chart.rules) if (usable(rule.value, chart.yScale)) values.push(rule.value)
  const domain = chart.yDomain ?? axisDomain(values, chart.yScale, chart.floorAtZero)
  if (!domain || times.length < 2) return null
  const xMin = Math.min(...times)
  const xMax = Math.max(...times)
  if (!(xMax > xMin) || !(domain.max > domain.min)) return null

  const lines = chart.lines.map((line) => ({
    // 详情图的每一段已经按缺口切开。再按 1.5 天切开，会把抽稀后的日期间隔当成缺失，线就碎成点。
    runs: line.segments
      .map((segment) => thin(segment, 180))
      .filter((run) => run.length >= 2),
    paint: asPaint(line.paint),
    width: line.width,
    dash: line.dash,
  }))
  const bands = chart.bands.map((band) => {
    const paired = stridePair(band.lower, band.upper, 120)
    return { ...paired, paint: asPaint(band.paint) }
  })
  const markers = chart.markers
    .filter((marker) => usable(marker.y, chart.yScale))
    .slice(-24)
    .map((marker) => ({ ts: marker.ts, value: marker.y }))

  return {
    yScale: chart.yScale,
    yMin: domain.min,
    yMax: domain.max,
    xMin,
    xMax,
    xTicks: timeAxisTicks(xMin, xMax, 5),
    yTicks: yTicks(domain.min, domain.max, chart),
    lines,
    bands,
    rules: chart.rules.filter((rule) => usable(rule.value, chart.yScale)),
    markers,
    legend: lineLegend(chart),
  }
}

/**
 * 没有叠加图的指标，沿用详情页单线图的轴：
 * 非负序列的下界是它自己的最小值，不把纵轴垫到 0 以下。
 */
function chartFromSeries(metricId: string, points: readonly SeriesPoint[]): ShareChart | null {
  if (!registry.has(metricId)) return null
  const def = registry.get(metricId)
  const gap = def.category === 'strategy' ? 22 * DAY : 1.5 * DAY
  const known = points.filter(
    (point): point is { ts: number; value: number } => point.value !== null && Number.isFinite(point.value),
  )
  if (known.length < 2) return null
  const rawMin = Math.min(...known.map((point) => point.value))
  const rawMax = Math.max(...known.map((point) => point.value))
  const flat = rawMax === rawMin
  const pad = flat ? Math.max(1, Math.abs(rawMax) * 0.1) : (rawMax - rawMin) * 0.08
  const yMin = rawMin >= 0 ? rawMin : rawMin - pad
  const yMax = rawMax + pad
  const xMin = known[0]?.ts
  const xMax = known[known.length - 1]?.ts
  if (xMin === undefined || xMax === undefined || !(xMax > xMin) || !(yMax > yMin)) return null
  const runs = splitGap(known, gap)
    .map((run) => thin(run, 180))
    .filter((run) => run.length >= 2)
  return {
    yScale: 'linear',
    yMin,
    yMax,
    xMin,
    xMax,
    xTicks: timeAxisTicks(xMin, xMax, 5),
    yTicks: [yMin, yMin + (yMax - yMin) / 2, yMax].map((value) => ({
      value,
      label: formatAxisTick(value, SITE_LOCALE),
    })),
    lines: [
      {
        runs,
        paint: 'ink',
        width: 1.5,
        dash: false,
      },
    ],
    bands: [],
    rules: [],
    markers: [],
    legend: [],
  }
}

/** 两条以上的线才需要图例。分区色带自己能看懂，列出前四个区号会让人以为只有四区。 */
function lineLegend(chart: DetailChart): ShareChart['legend'] {
  const lines = chart.legend.filter((item) => item.swatch === 'line')
  if (lines.length < 2) return []
  return lines.slice(0, 3).map((item) => ({ label: item.label, paint: asPaint(item.paint) }))
}

function yTicks(
  min: number,
  max: number,
  chart: DetailChart,
): { value: number; label: string }[] {
  const raw = chart.yScale === 'log' ? logMajorTicks(min, max) : [min, (min + max) / 2, max]
  const ticks: { value: number; label: string }[] = []
  for (const value of raw) {
    const label = tickText(value, chart)
    if (!label) continue
    if (chart.yScale === 'log' && /^\$?0(?:\.0+)?$/.test(label)) continue
    if (chart.yScale === 'linear' && chart.floorAtZero && label.startsWith('-')) continue
    ticks.push({ value, label })
  }
  return ticks
}

function tickText(value: number, chart: DetailChart): string {
  if (chart.tick === 'hashrate') return formatHashRate(value, SITE_LOCALE)
  if (chart.yScale === 'log') return formatLogTick(value, SITE_LOCALE, chart.tick === 'usd' ? 'usd' : 'plain')
  return formatAxisTick(value, SITE_LOCALE)
}

/**
 * 与详情页叠加图同一条纵轴规则。
 * 对数轴只接纳正数；非负序列不为了留白而画出负刻度。
 */
function axisDomain(
  values: readonly number[],
  scale: 'linear' | 'log',
  floorAtZero: boolean,
): { min: number; max: number } | null {
  if (values.length === 0) return null
  const min0 = Math.min(...values)
  const max0 = Math.max(...values)
  if (scale === 'log') {
    if (!(min0 > 0) || !(max0 > 0)) return null
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

function usable(value: number, scale: 'linear' | 'log'): boolean {
  return Number.isFinite(value) && (scale === 'linear' || value > 0)
}

function asPaint(paint: string): SharePaint {
  if (
    paint === 'ink' ||
    paint === 'muted' ||
    paint === 'faint' ||
    paint === 'rainbow-1' ||
    paint === 'rainbow-2' ||
    paint === 'rainbow-3' ||
    paint === 'rainbow-4' ||
    paint === 'rainbow-5' ||
    paint === 'rainbow-6' ||
    paint === 'rainbow-7' ||
    paint === 'rainbow-8' ||
    paint === 'rainbow-9'
  ) {
    return paint
  }
  return 'muted'
}

/**
 * 在已经连续的一段里抽稀，保留两端和每个桶的高低点。
 * 不按日历缺口再切：调用方交给它的点，中间的间隔是抽稀，不是缺失。
 */
function thin(points: readonly SharePoint[], max: number): SharePoint[] {
  if (points.length === 0 || max < 2) return []
  if (points.length <= max) return points.map((point) => ({ ts: point.ts, value: point.value }))
  const out: SharePoint[] = []
  const add = (point: SharePoint | undefined): void => {
    if (!point || !Number.isFinite(point.value)) return
    const last = out[out.length - 1]
    if (last && last.ts === point.ts) return
    out.push({ ts: point.ts, value: point.value })
  }
  const buckets = Math.max(1, Math.floor((max - 2) / 2))
  const width = points.length / buckets
  add(points[0])
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * width)
    const end = bucket === buckets - 1 ? points.length : Math.floor((bucket + 1) * width)
    let low = points[start]
    let high = points[start]
    for (let i = start; i < end; i += 1) {
      const point = points[i]
      if (!point || !low || !high) continue
      if (point.value < low.value) low = point
      if (point.value > high.value) high = point
    }
    if (low && high && low.ts > high.ts) {
      add(high)
      add(low)
    } else {
      add(low)
      add(high)
    }
  }
  add(points[points.length - 1])
  return out
}

function stridePair(
  lower: readonly SharePoint[],
  upper: readonly SharePoint[],
  max: number,
): { lower: SharePoint[]; upper: SharePoint[] } {
  const n = Math.min(lower.length, upper.length)
  const outL: SharePoint[] = []
  const outU: SharePoint[] = []
  if (n === 0) return { lower: outL, upper: outU }
  const steps = Math.min(max, n)
  let last = -1
  for (let i = 0; i < steps; i += 1) {
    const idx = steps === 1 ? 0 : Math.round((i * (n - 1)) / (steps - 1))
    if (idx === last) continue
    last = idx
    const lo = lower[idx]
    const hi = upper[idx]
    if (lo && hi) {
      outL.push(lo)
      outU.push(hi)
    }
  }
  return { lower: outL, upper: outU }
}

function splitGap(
  points: readonly { ts: number; value: number }[],
  gap: number,
): { ts: number; value: number }[][] {
  const runs: { ts: number; value: number }[][] = []
  let current: { ts: number; value: number }[] = []
  for (const point of points) {
    const prev = current[current.length - 1]
    if (prev && point.ts - prev.ts > gap) {
      if (current.length > 0) runs.push(current)
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) runs.push(current)
  return runs
}
