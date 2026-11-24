/**
 * 单指标海报。和首页共用尺寸、字体、底和页脚，版式改成左文右图。
 *
 * 曲线沿用详情页已经切开的分段。一段里如果再遇到画不出来的点，
 * 就另起一笔，不把缺口连成一条直线。
 */

import type { ShareBackdrop } from './backgrounds.js'
import { face, fitSize, wrap, type SharePainter } from './canvas.js'
import { paintBackdrop, paintFooter } from './draw-frame.js'
import { POSTER_MARGIN, POSTER_RADIUS } from './layout.js'
import {
  POSTER_FAINT,
  POSTER_INK,
  POSTER_MUTED,
  POSTER_PANEL,
  POSTER_PANEL_EDGE,
  POSTER_PLOT,
  POSTER_RAINBOW,
  POSTER_RULE,
} from './theme.js'
import { SHARE_WIDTH, type MetricShareCard, type ShareChart, type SharePaint, type SharePoint } from './types.js'

export function drawMetricPoster(
  painter: SharePainter,
  card: MetricShareCard,
  family: string,
  generatedAt: string,
  background: ShareBackdrop | null,
): void {
  painter.setTextBaseline('top')
  painter.setTextAlign('left')
  paintBackdrop(painter, background)

  painter.setFill(POSTER_INK)
  painter.setFont(face(700, 28, family))
  painter.fillText(card.title, POSTER_MARGIN, 40)
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  painter.setTextAlign('right')
  painter.fillText(card.category, SHARE_WIDTH - POSTER_MARGIN, 48)
  painter.setTextAlign('left')

  const textW = 640
  painter.setFill(POSTER_INK)
  painter.setFont(face(700, 48, family))
  const nameLines = wrap(painter, card.name, textW, 2)
  nameLines.forEach((line, index) => painter.fillText(line, POSTER_MARGIN, 120 + index * 58))
  const valueY = 120 + nameLines.length * 58 + 8
  const valueSize = fitSize(painter, card.value, textW, 72, 36, 700, family)
  painter.setFont(face(700, valueSize, family))
  painter.fillText(card.value, POSTER_MARGIN, valueY)

  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 16, family))
  painter.fillText(card.statusLabel, POSTER_MARGIN, valueY + valueSize + 28)
  painter.setFill(POSTER_INK)
  painter.setFont(face(700, 32, family))
  painter.fillText(card.status, POSTER_MARGIN, valueY + valueSize + 50)

  if (card.basis) {
    painter.setFill(POSTER_MUTED)
    painter.setFont(face(400, 22, family))
    const basis = wrap(painter, card.basis, textW, 4)
    basis.forEach((line, index) => painter.fillText(line, POSTER_MARGIN, valueY + valueSize + 108 + index * 32))
  }

  drawChart(painter, card, family)
  paintFooter(
    painter,
    family,
    generatedAt,
    [card.rangeLabel, `来源 ${card.sources.join('、')}`],
    background?.image ? background.credit : null,
  )
}

function drawChart(painter: SharePainter, card: MetricShareCard, family: string): void {
  const plotX = 760
  const plotY = 120
  const plotW = SHARE_WIDTH - POSTER_MARGIN - plotX
  const plotH = 760
  painter.setFill(POSTER_PANEL)
  painter.roundRect(plotX, plotY, plotW, plotH, POSTER_RADIUS)
  painter.fill()
  painter.setStroke(POSTER_PANEL_EDGE)
  painter.setLineWidth(1)
  painter.roundRect(plotX, plotY, plotW, plotH, POSTER_RADIUS)
  painter.stroke()

  const chart = card.chart
  if (!chart) {
    painter.setFill(POSTER_MUTED)
    painter.setFont(face(400, 22, family))
    painter.fillText(card.emptyChart, plotX + 36, plotY + plotH / 2 - 12)
    return
  }

  const labelW = 88
  const innerX = plotX + labelW
  const innerW = plotW - labelW - 28
  const innerY = plotY + 36
  const innerH = plotH - 78
  painter.setFill(POSTER_PLOT)
  painter.fillRect(innerX, innerY, innerW, innerH)

  painter.save()
  painter.beginPath()
  painter.rect(innerX, innerY, innerW, innerH)
  painter.clip()
  for (const tick of chart.yTicks) {
    const y = yOf(chart, tick.value, innerY, innerH)
    if (y === null) continue
    painter.setStroke(POSTER_RULE)
    painter.setLineWidth(1)
    painter.setLineDash([])
    painter.beginPath()
    painter.moveTo(innerX, y)
    painter.lineTo(innerX + innerW, y)
    painter.stroke()
  }
  for (const band of chart.bands) fillBand(painter, chart, band, innerX, innerY, innerW, innerH)
  painter.setFont(face(400, 14, family))
  painter.setTextAlign('right')
  painter.setTextBaseline('bottom')
  for (const rule of chart.rules) {
    const y = yOf(chart, rule.value, innerY, innerH)
    if (y === null) continue
    painter.setStroke(POSTER_FAINT)
    painter.setLineWidth(1)
    painter.setLineDash([5, 5])
    painter.beginPath()
    painter.moveTo(innerX, y)
    painter.lineTo(innerX + innerW, y)
    painter.stroke()
    painter.setFill(POSTER_MUTED)
    painter.fillText(rule.label, innerX + innerW - 8, y - 4)
  }
  painter.setLineDash([])
  painter.setTextAlign('left')
  painter.setTextBaseline('top')
  for (const line of chart.lines) {
    painter.setStroke(lineColor(line.paint))
    painter.setLineWidth(Math.max(2, line.width * 1.6))
    painter.setLineDash(line.dash ? [7, 6] : [])
    for (const run of line.runs) strokeRun(painter, chart, run, innerX, innerY, innerW, innerH)
  }
  painter.setLineDash([])
  painter.setFill(POSTER_INK)
  for (const marker of chart.markers) {
    const x = xOf(chart, marker.ts, innerX, innerW)
    const y = yOf(chart, marker.value, innerY, innerH)
    if (x === null || y === null) continue
    painter.beginPath()
    painter.arc(x, y, 3.5)
    painter.fill()
  }
  painter.restore()

  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 14, family))
  painter.setTextAlign('right')
  painter.setTextBaseline('middle')
  for (const tick of chart.yTicks) {
    const y = yOf(chart, tick.value, innerY, innerH)
    if (y === null) continue
    painter.fillText(tick.label, innerX - 10, y)
  }
  painter.setTextBaseline('top')
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
    painter.fillText(tick.label, x, innerY + innerH + 12)
    lastRight = (first ? x : x + width / 2) + width
  })
  painter.setTextAlign('left')

  if (chart.legend.length > 0) {
    painter.setFont(face(400, 14, family))
    let x = innerX
    for (const item of chart.legend) {
      const width = painter.measureText(item.label).width
      if (x + width + 36 > innerX + innerW) break
      painter.setStroke(lineColor(item.paint))
      painter.setLineWidth(2)
      painter.beginPath()
      painter.moveTo(x, plotY + 18)
      painter.lineTo(x + 18, plotY + 18)
      painter.stroke()
      painter.setFill(POSTER_MUTED)
      painter.fillText(item.label, x + 24, plotY + 8)
      x += width + 48
    }
  }
}

function fillBand(
  painter: SharePainter,
  chart: ShareChart,
  band: ShareChart['bands'][number],
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
  painter.setFill(bandColor(band.paint))
  painter.fill()
}

function strokeRun(
  painter: SharePainter,
  chart: ShareChart,
  run: readonly SharePoint[],
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
      if (started) painter.stroke()
      painter.beginPath()
      started = false
      continue
    }
    if (!started) painter.moveTo(x, y)
    else painter.lineTo(x, y)
    started = true
  }
  if (started) painter.stroke()
}

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

function lineColor(paint: SharePaint): string {
  if (paint === 'ink') return POSTER_INK
  if (paint === 'muted') return POSTER_MUTED
  if (paint === 'faint') return POSTER_FAINT
  return POSTER_RAINBOW[paint]
}

function bandColor(paint: SharePaint): string {
  if (paint === 'ink' || paint === 'muted' || paint === 'faint') return POSTER_RULE
  return POSTER_RAINBOW[paint]
}
