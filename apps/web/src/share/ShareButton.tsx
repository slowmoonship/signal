'use client'

/**
 * 全站只有这一个分享按钮。
 *
 * 浏览器能把文件交给系统分享面板时走 Web Share；
 * 不能分享文件、分享被拒绝，或异步绘制丢掉了用户手势时，直接下载同一张 PNG。
 * 用户取消分享面板不算失败，不再追加一次下载。
 */

import { useEffect, useRef, useState } from 'react'

import { getDictionary } from '@/i18n/dictionaries.js'

import { deliverShareFile } from './deliver.js'
import { drawShareCard, type SharePainter } from './draw.js'
import { loadPosterFont } from './fonts.js'
import { loadShareBackground } from './load-background.js'
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareCard } from './types.js'

export function ShareButton({
  card,
  label,
}: {
  readonly card: ShareCard
  readonly label: string
}) {
  const [pending, setPending] = useState(false)
  const busy = getDictionary().shareBusy
  const lock = useRef(false)

  useEffect(() => {
    void loadPosterFont()
  }, [])

  async function onShare(): Promise<void> {
    if (lock.current) return
    lock.current = true
    setPending(true)
    try {
      const family = await loadPosterFont()
      const background = await loadShareBackground()
      const canvas = document.createElement('canvas')
      canvas.width = SHARE_WIDTH
      canvas.height = SHARE_HEIGHT
      const context = canvas.getContext('2d', { alpha: false })
      if (context === null) return
      drawShareCard(canvasPainter(context), card, {
        fontFamily: family,
        generatedAt: new Date().toISOString(),
        background,
      })
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png')
      })
      if (blob === null) return
      const file = new File([blob], card.filename, { type: 'image/png' })
      const shared = await deliverShareFile(file, card.shareText, navigator)
      if (shared === 'fallback') downloadBlob(blob, card.filename)
    } finally {
      lock.current = false
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      data-share-kind={card.kind}
      className="shrink-0 border border-rule bg-surface px-3 py-1 text-sm text-ink hover:underline disabled:text-ink-subtle"
      aria-busy={pending}
      disabled={pending}
      onClick={() => {
        void onShare()
      }}
    >
      {pending ? busy : label}
    </button>
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function canvasPainter(ctx: CanvasRenderingContext2D): SharePainter {
  const numeric = ctx as CanvasRenderingContext2D & { fontVariantNumeric?: string }
  return {
    setFill(color) {
      ctx.fillStyle = color
    },
    setStroke(color) {
      ctx.strokeStyle = color
    },
    setLineWidth(width) {
      ctx.lineWidth = width
    },
    setFont(font) {
      ctx.font = font
      if ('fontVariantNumeric' in numeric) numeric.fontVariantNumeric = 'tabular-nums'
    },
    setTextAlign(align) {
      ctx.textAlign = align
    },
    setTextBaseline(baseline) {
      ctx.textBaseline = baseline
    },
    setLineDash(segments) {
      ctx.setLineDash([...segments])
    },
    setAlpha(alpha) {
      ctx.globalAlpha = alpha
    },
    fillRect(x, y, w, h) {
      ctx.fillRect(x, y, w, h)
    },
    fillText(text, x, y) {
      ctx.fillText(text, x, y)
    },
    measureText(text) {
      return { width: ctx.measureText(text).width }
    },
    beginPath() {
      ctx.beginPath()
    },
    moveTo(x, y) {
      ctx.moveTo(x, y)
    },
    lineTo(x, y) {
      ctx.lineTo(x, y)
    },
    stroke() {
      ctx.stroke()
    },
    fill() {
      ctx.fill()
    },
    save() {
      ctx.save()
    },
    restore() {
      ctx.restore()
    },
    rect(x, y, w, h) {
      ctx.rect(x, y, w, h)
    },
    roundRect(x, y, w, h, r) {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, r)
    },
    clip() {
      ctx.clip()
    },
    arc(x, y, r) {
      ctx.arc(x, y, r, 0, Math.PI * 2)
    },
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      ctx.drawImage(source as CanvasImageSource, sx, sy, sw, sh, dx, dy, dw, dh)
    },
  }
}
