/**
 * 首页海报。结构固定成参考图那一版：品牌、市场状态和价格、四个分类面板、一行定投、页脚。
 * 定投不是视觉中心，所以它只占面板和页脚之间的一行。
 */

import { face, fitSize, wrap, type SharePainter } from './canvas.js'
import { paintBackdrop, paintFooter } from './draw-frame.js'
import { POSTER_GAP, POSTER_MARGIN, POSTER_PANEL_H, POSTER_PANELS_Y, POSTER_RADIUS } from './layout.js'
import { POSTER_FAINT, POSTER_INK, POSTER_MUTED, POSTER_PANEL, POSTER_PANEL_EDGE, POSTER_RULE, toneColor } from './theme.js'
import { SHARE_WIDTH, type HomeShareCard, type PosterStat } from './types.js'
import type { ShareBackdrop } from './backgrounds.js'

export function drawHomePoster(
  painter: SharePainter,
  card: HomeShareCard,
  family: string,
  generatedAt: string,
  background: ShareBackdrop | null,
): void {
  painter.setTextBaseline('top')
  painter.setTextAlign('left')
  paintBackdrop(painter, background)

  painter.setFill(POSTER_INK)
  painter.setFont(face(700, 46, family))
  painter.fillText(card.title, POSTER_MARGIN, 40)
  const titleW = painter.measureText(card.title).width
  painter.setFill(POSTER_MUTED)
  painter.setFont(face(400, 26, family))
  painter.fillText(card.subtitle, POSTER_MARGIN + titleW + 28, 54)

  drawHero(painter, card, family)
  painter.setFill(POSTER_MUTED)
  painter.setFont(face(400, 24, family))
  const sentence = wrap(painter, card.sentence, SHARE_WIDTH - POSTER_MARGIN * 2, 2)
  sentence.forEach((line, index) => painter.fillText(line, POSTER_MARGIN, 252 + index * 30))

  const panelW = (SHARE_WIDTH - POSTER_MARGIN * 2 - POSTER_GAP) / 2
  card.panels.forEach((panel, index) => {
    const x = POSTER_MARGIN + (index % 2) * (panelW + POSTER_GAP)
    const y = POSTER_PANELS_Y + Math.floor(index / 2) * (POSTER_PANEL_H + POSTER_GAP)
    drawPanel(painter, panel.title, panel.blurb, panel.columns, panel.items, x, y, panelW, POSTER_PANEL_H, family)
  })

  const footerTop = paintFooter(
    painter,
    family,
    generatedAt,
    [card.priceAsOf, card.strategyAsOf ? `Strategy 披露 ${card.strategyAsOf}` : '', `来源 ${card.sources.join('、')}`].filter(
      (part) => part.length > 0,
    ),
    background?.image ? background.credit : null,
  )
  painter.setFill(POSTER_MUTED)
  painter.setFont(face(400, 20, family))
  const dca = wrap(painter, card.dca, SHARE_WIDTH - POSTER_MARGIN * 2, 1)[0] ?? card.dca
  painter.fillText(dca, POSTER_MARGIN, footerTop - 36)
}

function drawHero(painter: SharePainter, card: HomeShareCard, family: string): void {
  const rightW = 340
  const rightX = SHARE_WIDTH - POSTER_MARGIN
  const mark = card.regime === 'bull' || card.regime === 'bear'
  if (mark) {
    painter.setFill(toneColor(card.regime === 'bull' ? 'up' : 'down'))
    painter.fillRect(POSTER_MARGIN, 124, 8, 72)
  }
  const regimeX = POSTER_MARGIN + (mark ? 20 : 0)
  const regimeSize = fitSize(painter, card.regimeLabel, 420, 84, 48, 700, family)
  painter.setFill(POSTER_INK)
  painter.setFont(face(700, regimeSize, family))
  painter.fillText(card.regimeLabel, regimeX, 112)
  const regimeW = painter.measureText(card.regimeLabel).width

  const priceX = regimeX + regimeW + 48
  const priceMax = rightX - rightW - 36 - priceX
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  painter.fillText(card.price.name, priceX, 116)
  const priceSize = fitSize(painter, card.price.value, Math.max(180, priceMax), 76, 40, 700, family)
  painter.setFill(POSTER_INK)
  painter.setFont(face(700, priceSize, family))
  painter.fillText(card.price.value, priceX, 142)

  drawSideStat(painter, card.drawdown, rightX, 112, rightW, family)
  drawSideStat(painter, card.change90, rightX, 196, rightW, family)
}

function drawSideStat(painter: SharePainter, stat: PosterStat, right: number, y: number, width: number, family: string): void {
  painter.setTextAlign('right')
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  painter.fillText(stat.name, right, y)
  const size = fitSize(painter, stat.value, width, 40, 24, 700, family)
  painter.setFill(toneColor(stat.tone))
  painter.setFont(face(700, size, family))
  painter.fillText(stat.value, right, y + 24)
  painter.setTextAlign('left')
}

function drawPanel(
  painter: SharePainter,
  title: string,
  blurb: string,
  columns: 2 | 3,
  items: readonly PosterStat[],
  x: number,
  y: number,
  w: number,
  h: number,
  family: string,
): void {
  painter.setFill(POSTER_PANEL)
  painter.roundRect(x, y, w, h, POSTER_RADIUS)
  painter.fill()
  painter.setStroke(POSTER_PANEL_EDGE)
  painter.setLineWidth(1)
  painter.roundRect(x, y, w, h, POSTER_RADIUS)
  painter.stroke()

  painter.setFill(POSTER_INK)
  painter.setFont(face(700, 28, family))
  painter.setTextAlign('left')
  painter.fillText(title, x + 22, y + 16)
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  painter.setTextAlign('right')
  const blurbSize = fitSize(painter, blurb, w * 0.62, 18, 14, 400, family)
  painter.setFont(face(400, blurbSize, family))
  painter.fillText(blurb, x + w - 22, y + 24)
  painter.setTextAlign('left')
  painter.setStroke(POSTER_RULE)
  painter.beginPath()
  painter.moveTo(x + 22, y + 58)
  painter.lineTo(x + w - 22, y + 58)
  painter.stroke()

  const innerX = x + 22
  const innerY = y + 72
  const innerW = w - 44
  const innerH = h - 84
  if (columns === 3) {
    const colW = innerW / 3
    items.forEach((item, index) => drawCell(painter, item, innerX + index * colW, innerY, colW - 14, innerH, family))
  } else {
    const colW = innerW / 2
    const rowH = innerH / 2
    items.forEach((item, index) => {
      drawCell(
        painter,
        item,
        innerX + (index % 2) * colW,
        innerY + Math.floor(index / 2) * rowH,
        colW - 16,
        rowH,
        family,
      )
    })
  }
}

function drawCell(
  painter: SharePainter,
  stat: PosterStat,
  x: number,
  y: number,
  w: number,
  h: number,
  family: string,
): void {
  painter.setTextAlign('left')
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  const name = wrap(painter, stat.name, w, 1)[0] ?? stat.name
  painter.fillText(name, x, y)
  const valueSize = fitSize(painter, stat.value, w, 32, 20, 700, family)
  painter.setFill(toneColor(stat.tone))
  painter.setFont(face(700, valueSize, family))
  painter.fillText(stat.value, x, y + 22)
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 16, family))
  const noteTop = y + 56
  const linesFit = Math.max(1, Math.min(3, Math.floor((h - 56) / 20)))
  const notes = wrap(painter, stat.note, w, linesFit)
  notes.forEach((line, index) => painter.fillText(line, x, noteTop + index * 20))
}
