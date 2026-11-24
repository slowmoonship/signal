/**
 * 把分享卡画成 1200×630 的图。
 *
 * 这不是页面截图：布局、留白和署名都在这里，不复用首页或详情页的 DOM。
 * 颜色写在这个文件里，而不是写进组件的 class。分享图要自成一张卡片，
 * 不走页面的 Tailwind，也没有渐变和阴影。
 */

import { SHARE_BRAND_LINE } from './brand.js'
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareCard, type ShareChart, type SharePaint, type ShareTheme } from './types.js'

export type SharePainter = {
  setFill(color: string): void
  setStroke(color: string): void
  setLineWidth(width: number): void
  setFont(font: string): void
  setTextAlign(align: 'left' | 'right' | 'center'): void
  setTextBaseline(baseline: 'top' | 'middle' | 'bottom'): void
  setLineDash(segments: readonly number[]): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fill(): void
  save(): void
  restore(): void
  rect(x: number, y: number, w: number, h: number): void
  clip(): void
  arc(x: number, y: number, r: number): void
}

type RegimeWash = 'bull' | 'bear' | 'range' | 'fault'

type Palette = {
  bg: string
  ink: string
  muted: string
  subtle: string
  rule: string
  plot: string
  wash: Record<RegimeWash, string>
  rainbow: Record<Exclude<SharePaint, 'ink' | 'muted' | 'faint'>, string>
}

const RAINBOW_LIGHT = {
  'rainbow-1': 'hsl(222 42% 86%)',
  'rainbow-2': 'hsl(204 40% 84%)',
  'rainbow-3': 'hsl(186 36% 82%)',
  'rainbow-4': 'hsl(48 42% 84%)',
  'rainbow-5': 'hsl(36 44% 82%)',
  'rainbow-6': 'hsl(24 46% 82%)',
  'rainbow-7': 'hsl(12 44% 82%)',
  'rainbow-8': 'hsl(2 42% 82%)',
  'rainbow-9': 'hsl(344 38% 84%)',
} as const

const RAINBOW_DARK = {
  'rainbow-1': 'hsl(222 36% 30%)',
  'rainbow-2': 'hsl(204 34% 28%)',
  'rainbow-3': 'hsl(186 32% 26%)',
  'rainbow-4': 'hsl(48 36% 28%)',
  'rainbow-5': 'hsl(36 38% 28%)',
  'rainbow-6': 'hsl(24 40% 28%)',
  'rainbow-7': 'hsl(12 38% 28%)',
  'rainbow-8': 'hsl(2 36% 28%)',
  'rainbow-9': 'hsl(344 34% 30%)',
} as const

function palette(theme: ShareTheme): Palette {
  if (theme === 'dark') {
    return {
      bg: '#141416',
      ink: '#f4f4f5',
      muted: '#a1a1aa',
      subtle: '#71717a',
      rule: '#3f3f46',
      plot: '#1c1c1f',
      wash: {
        bull: 'hsl(140 18% 20%)',
        bear: 'hsl(0 16% 20%)',
        range: 'hsl(207 14% 20%)',
        fault: 'hsl(30 6% 18%)',
      },
      rainbow: RAINBOW_DARK,
    }
  }
  return {
    bg: '#f7f5f2',
    ink: '#18181b',
    muted: '#52525b',
    subtle: '#71717a',
    rule: '#e4e4e7',
    plot: '#fffdfb',
    wash: {
      bull: 'hsl(140 32% 90%)',
      bear: 'hsl(0 32% 93%)',
      range: 'hsl(207 28% 92%)',
      fault: 'hsl(30 8% 92%)',
    },
    rainbow: RAINBOW_LIGHT,
  }
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

export function drawShareCard(
  painter: SharePainter,
  card: ShareCard,
  theme: ShareTheme,
  fontFamily: string,
): void {
  const colors = palette(theme)
  const sans = fontFamily.trim() || 'sans-serif'
  painter.setTextBaseline('top')
  painter.setTextAlign('left')
  painter.setFill(colors.bg)
  painter.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  if (card.kind === 'home') drawHome(painter, card, colors, sans)
  else drawMetric(painter, card, colors, sans)
}

function drawHome(
  painter: SharePainter,
  card: Extract<ShareCard, { kind: 'home' }>,
  colors: Palette,
  sans: string,
): void {
  const pad = 56
  painter.setFill(colors.ink)
  painter.setFont(face(600, 26, sans))
  painter.fillText(card.title, pad, 48)
  painter.setFill(colors.muted)
  painter.setFont(face(400, 18, sans))
  painter.setTextAlign('right')
  painter.fillText(card.subtitle, SHARE_WIDTH - pad, 54)
  painter.setTextAlign('left')


  const wash = colors.wash[card.regime]
  painter.setFont(face(600, 72, sans))
  const wordWidth = painter.measureText(card.regimeLabel).width
  painter.setFill(wash)
  painter.fillRect(pad - 16, 148, wordWidth + 36, 96)
  painter.setFill(colors.ink)
  painter.fillText(card.regimeLabel, pad, 160)

  painter.setTextAlign('right')
  painter.setFill(colors.subtle)
  painter.setFont(face(500, 15, sans))
  painter.fillText(card.price.label, SHARE_WIDTH - pad, 156)
  painter.setFill(colors.ink)
  painter.setFont(face(600, 48, MONO))
  painter.fillText(card.price.value, SHARE_WIDTH - pad, 182)
  painter.setTextAlign('left')

  painter.setFill(colors.ink)
  painter.setFont(face(400, 22, sans))
  const lines = wrap(painter, card.sentence, SHARE_WIDTH - pad * 2, 2)
  lines.forEach((line, index) => painter.fillText(line, pad, 276 + index * 34))

  const statTop = 392
  painter.setFill(colors.rule)
  painter.fillRect(pad, statTop - 28, SHARE_WIDTH - pad * 2, 1)
  const columns = Math.max(card.stats.length, 1)
  const colW = (SHARE_WIDTH - pad * 2) / columns
  card.stats.forEach((stat, index) => {
    const x = pad + index * colW
    painter.setFill(colors.subtle)
    painter.setFont(face(400, 14, sans))
    const label = wrap(painter, stat.label, colW - 16, 1)[0] ?? ''
    painter.fillText(label, x, statTop)
    painter.setFill(colors.ink)
    painter.setFont(face(600, 22, MONO))
    const value = wrap(painter, stat.value, colW - 16, 1)[0] ?? ''
    painter.fillText(value, x, statTop + 24)
  })

  painter.setFill(colors.muted)
  painter.setFont(face(400, 16, sans))
  painter.fillText('每日定额买入，累计收益首次达到 +5%；仅统计已达标起点，未达标起点不计入。', pad, 478)
  drawFooter(painter, colors, sans, card.asOf, 56)
}

function drawMetric(
  painter: SharePainter,
  card: Extract<ShareCard, { kind: 'metric' }>,
  colors: Palette,
  sans: string,
): void {
  const pad = 48
  painter.setFill(colors.ink)
  painter.setFont(face(600, 22, sans))
  painter.fillText(card.title, pad, 40)

  painter.setFill(colors.muted)
  painter.setFont(face(500, 13, sans))
  painter.fillText(card.category, pad, 112)

  painter.setFill(colors.ink)
  painter.setFont(face(600, 36, sans))
  const nameLines = wrap(painter, card.name, 460, 2)
  nameLines.forEach((line, index) => painter.fillText(line, pad, 136 + index * 46))

  painter.setFont(face(600, 44, MONO))
  const valueSize = fitSize(painter, card.value, 440, 44, 26, MONO)
  painter.setFont(face(600, valueSize, MONO))
  painter.fillText(card.value, pad, 248)

  painter.setFill(colors.subtle)
  painter.setFont(face(400, 13, sans))
  painter.fillText(card.statusLabel, pad, 316)
  painter.setFill(colors.ink)
  painter.setFont(face(600, 28, sans))
  painter.fillText(card.status, pad, 338)

  if (card.basis) {
    painter.setFill(colors.muted)
    painter.setFont(face(400, 18, sans))
    const basis = wrap(painter, card.basis, 460, 3)
    basis.forEach((line, index) => painter.fillText(line, pad, 388 + index * 28))
  }

  drawChart(painter, card, colors, sans)
  drawFooter(painter, colors, sans, card.rangeLabel, 48)
}

function drawChart(
  painter: SharePainter,
  card: Extract<ShareCard, { kind: 'metric' }>,
  colors: Palette,
  sans: string,
): void {
  const plotX = 620
  const plotY = 128
  const plotW = SHARE_WIDTH - 48 - plotX
  const plotH = 372
  painter.setFill(colors.plot)
  painter.fillRect(plotX, plotY, plotW, plotH)

  const chart = card.chart
  if (!chart) {
    painter.setFill(colors.muted)
    painter.setFont(face(400, 16, sans))
    painter.fillText(card.emptyChart, plotX + 24, plotY + plotH / 2 - 8)
    return
  }

  const labelW = 64
  const innerX = plotX + labelW
  const innerW = plotW - labelW - 12
  const innerY = plotY + 16
  const innerH = plotH - 36

  painter.save()
  painter.beginPath()
  painter.rect(innerX, innerY, innerW, innerH)
  painter.clip()
  for (const tick of chart.yTicks) {
    const y = yOf(chart, tick.value, innerY, innerH)
    if (y === null) continue
    painter.setStroke(colors.rule)
    painter.setLineWidth(1)
    painter.setLineDash([])
    painter.beginPath()
    painter.moveTo(innerX, y)
    painter.lineTo(innerX + innerW, y)
    painter.stroke()
  }

  for (const band of chart.bands) fillBand(painter, chart, band, colors, innerX, innerY, innerW, innerH)
  painter.setFont(face(400, 12, MONO))
  painter.setTextAlign('right')
  painter.setTextBaseline('bottom')
  for (const rule of chart.rules) {
    const y = yOf(chart, rule.value, innerY, innerH)
    if (y === null) continue
    painter.setStroke(colors.subtle)
    painter.setLineWidth(1)
    painter.setLineDash([4, 4])
    painter.beginPath()
    painter.moveTo(innerX, y)
    painter.lineTo(innerX + innerW, y)
    painter.stroke()
    painter.setFill(colors.muted)
    painter.fillText(rule.label, innerX + innerW - 6, y - 3)
  }
  painter.setLineDash([])
  painter.setTextAlign('left')
  painter.setTextBaseline('top')
  for (const line of chart.lines) {
    painter.setStroke(lineColor(colors, line.paint))
    painter.setLineWidth(Math.max(2, line.width * 1.6))
    painter.setLineDash(line.dash ? [6, 5] : [])
    for (const run of line.runs) strokeRun(painter, chart, run, innerX, innerY, innerW, innerH)
  }
  painter.setLineDash([])
  painter.setFill(colors.ink)
  for (const marker of chart.markers) {
    const x = xOf(chart, marker.ts, innerX, innerW)
    const y = yOf(chart, marker.value, innerY, innerH)
    if (x === null || y === null) continue
    painter.beginPath()
    painter.arc(x, y, 3)
    painter.fill()
  }
  painter.restore()

  painter.setFill(colors.subtle)
  painter.setFont(face(400, 12, MONO))
  painter.setTextAlign('right')
  painter.setTextBaseline('middle')
  for (const tick of chart.yTicks) {
    const y = yOf(chart, tick.value, innerY, innerH)
    if (y === null) continue
    painter.fillText(tick.label, innerX - 8, y)
  }

  painter.setTextBaseline('top')
  painter.setFont(face(400, 12, MONO))
  const ticks = chart.xTicks.filter((tick) => tick.label.length > 0)
  let lastRight = Number.NEGATIVE_INFINITY
  ticks.forEach((tick, index) => {
    const x = xOf(chart, tick.ts, innerX, innerW)
    if (x === null) return
    const width = painter.measureText(tick.label).width
    const last = index === ticks.length - 1
    const first = index === 0
    if (!first && !last && x - width / 2 < lastRight + 8) return
    painter.setTextAlign(first ? 'left' : last ? 'right' : 'center')
    const textX = first ? x : last ? x : x
    painter.fillText(tick.label, textX, innerY + innerH + 10)
    lastRight = (first ? x : x + width / 2) + width
  })
  painter.setTextAlign('left')

  if (chart.legend.length > 0) {
    painter.setFont(face(400, 12, sans))
    let x = innerX
    for (const item of chart.legend) {
      const width = painter.measureText(item.label).width
      if (x + width + 28 > innerX + innerW) break
      painter.setStroke(lineColor(colors, item.paint))
      painter.setLineWidth(2)
      painter.beginPath()
      painter.moveTo(x, plotY + 10)
      painter.lineTo(x + 16, plotY + 10)
      painter.stroke()
      painter.setFill(colors.muted)
      painter.fillText(item.label, x + 20, plotY - 2)
      x += width + 40
    }
  }
}

function fillBand(
  painter: SharePainter,
  chart: ShareChart,
  band: ShareChart['bands'][number],
  colors: Palette,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const n = Math.min(band.lower.length, band.upper.length)
  if (n < 2) return
  painter.beginPath()
  let started = false
  for (let i = 0; i < n; i += 1) {
    const point = band.lower[i]
    if (!point) continue
    const x = xOf(chart, point.ts, left, width)
    const y = yOf(chart, point.value, top, height)
    if (x === null || y === null) continue
    if (!started) painter.moveTo(x, y)
    else painter.lineTo(x, y)
    started = true
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const point = band.upper[i]
    if (!point) continue
    const x = xOf(chart, point.ts, left, width)
    const y = yOf(chart, point.value, top, height)
    if (x === null || y === null) continue
    painter.lineTo(x, y)
  }
  painter.setFill(bandColor(colors, band.paint))
  painter.fill()
}

function strokeRun(
  painter: SharePainter,
  chart: ShareChart,
  run: readonly SharePointLike[],
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  let started = false
  painter.beginPath()
  for (const point of run) {
    const x = xOf(chart, point.ts, left, width)
    const y = yOf(chart, point.value, top, height)
    if (x === null || y === null) {
      started = false
      continue
    }
    if (!started) painter.moveTo(x, y)
    else painter.lineTo(x, y)
    started = true
  }
  painter.stroke()
}

type SharePointLike = { ts: number; value: number }

function xOf(chart: ShareChart, ts: number, left: number, width: number): number | null {
  if (!(chart.xMax > chart.xMin)) return null
  return left + ((ts - chart.xMin) / (chart.xMax - chart.xMin)) * width
}

function yOf(chart: ShareChart, value: number, top: number, height: number): number | null {
  if (!Number.isFinite(value)) return null
  if (chart.yScale === 'log') {
    if (!(value > 0) || !(chart.yMin > 0) || !(chart.yMax > chart.yMin)) return null
    const lo = Math.log10(chart.yMin)
    const hi = Math.log10(chart.yMax)
    if (!(hi > lo)) return null
    return top + (1 - (Math.log10(value) - lo) / (hi - lo)) * height
  }
  if (!(chart.yMax > chart.yMin)) return null
  return top + (1 - (value - chart.yMin) / (chart.yMax - chart.yMin)) * height
}

function drawFooter(
  painter: SharePainter,
  colors: Palette,
  sans: string,
  leftText: string,
  pad: number,
): void {
  const y = 572
  painter.setFill(colors.rule)
  painter.fillRect(pad, y - 18, SHARE_WIDTH - pad * 2, 1)
  painter.setFill(colors.muted)
  painter.setFont(face(400, 14, sans))
  painter.setTextAlign('left')
  painter.setTextBaseline('top')
  painter.fillText(leftText, pad, y)
  painter.fillText(`图片生成 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, pad, y + 20)
  painter.setFont(face(500, 16, sans))
  painter.fillText(SHARE_BRAND_LINE, pad, y + 40)
}

function lineColor(colors: Palette, paint: SharePaint): string {
  if (paint === 'ink') return colors.ink
  if (paint === 'muted') return colors.muted
  if (paint === 'faint') return colors.subtle
  return colors.rainbow[paint]
}

function bandColor(colors: Palette, paint: SharePaint): string {
  if (paint === 'ink' || paint === 'muted' || paint === 'faint') return colors.rule
  return colors.rainbow[paint]
}

function face(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`
}

function fitSize(
  painter: SharePainter,
  text: string,
  maxWidth: number,
  size: number,
  min: number,
  family: string,
): number {
  let current = size
  while (current > min && painter.measureText(text).width > maxWidth) {
    current -= 2
    painter.setFont(face(600, current, family))
  }
  return current
}

function wrap(painter: SharePainter, text: string, maxWidth: number, maxLines: number): string[] {
  const chars = [...text]
  if (chars.length === 0 || maxLines < 1) return []
  const lines: string[] = []
  let index = 0
  while (index < chars.length && lines.length < maxLines) {
    let end = index + 1
    while (end <= chars.length && painter.measureText(chars.slice(index, end).join('')).width <= maxWidth) {
      end += 1
    }
    end = Math.max(index + 1, end - 1)
    const lastLine = lines.length === maxLines - 1
    if (lastLine && end < chars.length) {
      let cut = end
      while (cut > index + 1 && painter.measureText(`${chars.slice(index, cut).join('')}…`).width > maxWidth) {
        cut -= 1
      }
      lines.push(`${chars.slice(index, cut).join('')}…`)
      break
    }
    lines.push(chars.slice(index, end).join(''))
    index = end
  }
  return lines
}
