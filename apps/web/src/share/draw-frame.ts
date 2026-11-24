/**
 * 首页和详情海报共用的底和页脚。
 *
 * 背景换了，字和面板不换。遮罩强度可以随照片亮度变，字色不行。
 */

import { SHARE_BRAND_LINE } from './brand.js'
import { coverCrop, type ShareBackdrop } from './backgrounds.js'
import { face, packSegments, type SharePainter } from './canvas.js'
import { formatUtcDateTime } from '@/lib/format-time.js'
import { POSTER_MARGIN } from './layout.js'
import { POSTER_FAINT, POSTER_FALLBACK, POSTER_INK, POSTER_SCRIM, scrimAlpha } from './theme.js'
import { SHARE_HEIGHT, SHARE_WIDTH } from './types.js'

export function paintBackdrop(painter: SharePainter, background: ShareBackdrop | null): void {
  const image = background?.image ?? null
  const crop = image ? coverCrop(image.width, image.height, SHARE_WIDTH, SHARE_HEIGHT) : null
  if (image && crop) {
    painter.drawImage(image.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  } else {
    painter.setFill(POSTER_FALLBACK)
    painter.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  }
  painter.setFill(POSTER_SCRIM)
  painter.setAlpha(scrimAlpha(image?.luminance ?? null))
  painter.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  painter.setAlpha(0.16)
  painter.fillRect(0, 0, SHARE_WIDTH, 320)
  painter.setAlpha(1)
}

export function paintFooter(
  painter: SharePainter,
  family: string,
  generatedAt: string,
  segments: readonly string[],
  credit: string | null,
): number {
  const width = SHARE_WIDTH - POSTER_MARGIN * 2
  painter.setFont(face(400, 18, family))
  const parts = [...segments, `图片生成 ${formatUtcDateTime(generatedAt)} UTC`]
  if (credit) parts.push(`图片 ${credit}`)
  const meta = packSegments(painter, parts, width, 2)
  const lineH = 24
  const block = 28 + meta.length * lineH
  const y = SHARE_HEIGHT - 44 - block
  painter.setTextAlign('left')
  painter.setTextBaseline('top')
  painter.setFill(POSTER_INK)
  painter.setFont(face(400, 20, family))
  painter.fillText(SHARE_BRAND_LINE, POSTER_MARGIN, y)
  painter.setFill(POSTER_FAINT)
  painter.setFont(face(400, 18, family))
  meta.forEach((line, index) => {
    painter.fillText(line, POSTER_MARGIN, y + 30 + index * lineH)
  })
  return y
}
