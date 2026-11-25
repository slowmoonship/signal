/**
 * 点击分享时才读清单、才下载选中的那一张。
 * 首页渲染不把五张壁纸一起拉下来。
 */

import {
  backgroundAttempts,
  shareAssetUrl,
  validateCatalog,
  type BackgroundRecord,
  type ShareBackdrop,
  type ShareBitmap,
} from './backgrounds.js'

declare global {
  interface Window {
    /** 测试指定背景。页面上没有选择器。 */
    __signalShareBackground?: string
  }
}

let previousId: string | null = null

export async function loadShareBackground(random: () => number = Math.random): Promise<ShareBackdrop | null> {
  const records = await fetchCatalog()
  const order = backgroundAttempts(records, random, preferredBackgroundId(), previousId)
  for (const record of order) {
    const image = await loadBitmap(shareAssetUrl(record.file))
    if (!image) continue
    previousId = record.id
    return { id: record.id, credit: record.credit, image }
  }
  return null
}

function preferredBackgroundId(): string | null {
  const value = window.__signalShareBackground
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function fetchCatalog(): Promise<BackgroundRecord[]> {
  try {
    const response = await fetch(shareAssetUrl('/share/backgrounds.json'))
    if (!response.ok) return []
    const body: unknown = await response.json()
    return validateCatalog(body).records
  } catch {
    return []
  }
}

function loadBitmap(url: string): Promise<ShareBitmap | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        source: image,
        luminance: sampleLuminance(image),
      })
    }
    image.onerror = () => resolve(null)
    image.src = url
  })
}

function sampleLuminance(image: HTMLImageElement): number | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 12
    canvas.height = 12
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, 12, 12)
    const data = context.getImageData(0, 0, 12, 12).data
    let sum = 0
    const pixels = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      const red = data[i] ?? 0
      const green = data[i + 1] ?? 0
      const blue = data[i + 2] ?? 0
      sum += (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
    }
    return pixels > 0 ? sum / pixels : null
  } catch {
    return null
  }
}

/** 测试之间清掉「上一张」，避免串台。 */
export function resetShareBackgroundMemory(): void {
  previousId = null
}
