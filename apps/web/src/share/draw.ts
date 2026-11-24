/**
 * 分享图的入口。首页和详情各自排版，底、字体和页脚走同一套。
 */

import type { ShareBackdrop } from './backgrounds.js'
import type { SharePainter } from './canvas.js'
import { drawHomePoster } from './draw-home.js'
import { drawMetricPoster } from './draw-metric.js'
import type { ShareCard } from './types.js'

export type { SharePainter } from './canvas.js'

export type ShareDrawOptions = Readonly<{
  fontFamily: string
  generatedAt: string
  background: ShareBackdrop | null
}>

export function drawShareCard(painter: SharePainter, card: ShareCard, options: ShareDrawOptions): void {
  const family = options.fontFamily.trim() || 'sans-serif'
  if (card.kind === 'home') drawHomePoster(painter, card, family, options.generatedAt, options.background)
  else drawMetricPoster(painter, card, family, options.generatedAt, options.background)
}
