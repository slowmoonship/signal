'use client'

/**
 * 全站只有这一个分享按钮。
 *
 * 浏览器能把文件交给系统分享面板时走 Web Share；
 * 不能分享文件、或分享失败时，直接下载同一张 PNG。
 * 用户取消分享面板不算失败，不再追加一次下载。
 */

import { useState } from 'react'

import { drawShareCard, type SharePainter } from './draw.js'
import { SHARE_HEIGHT, SHARE_WIDTH, type ShareCard, type ShareTheme } from './types.js'

export function ShareButton({
  card,
  label,
}: {
  readonly card: ShareCard
  readonly label: string
}) {
  const [pending, setPending] = useState(false)

  async function onShare(): Promise<void> {
    if (pending) return
    setPending(true)
    try {
      await document.fonts.ready
      const canvas = document.createElement('canvas')
      canvas.width = SHARE_WIDTH
      canvas.height = SHARE_HEIGHT
      const ctx = canvas.getContext('2d', { alpha: false })
      if (ctx === null) return
      const theme: ShareTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      const font = getComputedStyle(document.body).fontFamily
      drawShareCard(canvasPainter(ctx), card, theme, font)
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png')
      })
      if (blob === null) return
      const file = new File([blob], card.filename, { type: 'image/png' })
      const shared = await shareFile(file, card.shareText)
      if (shared === 'fallback') downloadBlob(blob, card.filename)
    } finally {
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
      {label}
    </button>
  )
}

async function shareFile(file: File, text: string): Promise<'shared' | 'aborted' | 'fallback'> {
  if (typeof navigator.share !== 'function') return 'fallback'
  const payload: ShareData = { files: [file], title: 'Signal', text }
  if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) return 'fallback'
  try {
    await navigator.share(payload)
    return 'shared'
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'aborted'
    return 'fallback'
  }
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
    clip() {
      ctx.clip()
    },
    arc(x, y, r) {
      ctx.arc(x, y, r, 0, Math.PI * 2)
    },
  }
}
