/**
 * 海报的颜色不跟网站的明暗主题走。
 *
 * 同一张图要压在雪山、夜景、粉云和建筑上。换背景只改遮罩强度，
 * 不改字色，也不改版式。数值默认是中性白；红绿只留给价格方向和牛熊的小标记。
 */

export const POSTER_INK = '#F5F5F5'
export const POSTER_MUTED = '#D0D4DB'
export const POSTER_FAINT = '#C5CAD3'
export const POSTER_UP = '#9ECBB4'
export const POSTER_DOWN = '#E7B1AA'
export const POSTER_PANEL = 'rgba(12, 16, 22, 0.88)'
export const POSTER_PANEL_EDGE = 'rgba(255, 255, 255, 0.18)'
export const POSTER_RULE = 'rgba(255, 255, 255, 0.12)'
export const POSTER_SCRIM = '#07090D'
export const POSTER_FALLBACK = '#1A1F29'
export const POSTER_PLOT = 'rgba(8, 12, 18, 0.55)'

/** 遮罩的固定回退。采样失败时用它，不让一张亮图把字淹没，也不把夜景涂死。 */
export const POSTER_SCRIM_FALLBACK = 0.5

export const POSTER_RAINBOW = {
  'rainbow-1': 'hsl(222 32% 42%)',
  'rainbow-2': 'hsl(204 30% 40%)',
  'rainbow-3': 'hsl(186 26% 36%)',
  'rainbow-4': 'hsl(48 28% 40%)',
  'rainbow-5': 'hsl(36 30% 40%)',
  'rainbow-6': 'hsl(24 32% 40%)',
  'rainbow-7': 'hsl(12 32% 40%)',
  'rainbow-8': 'hsl(2 30% 40%)',
  'rainbow-9': 'hsl(344 28% 42%)',
} as const

/**
 * 亮图多压一点，暗图少压一点。
 * 上下限是故意的：再暗，风景就没了；再亮，大标题会掉到 3:1 以下。
 */
export function scrimAlpha(luminance: number | null): number {
  if (luminance === null || !Number.isFinite(luminance)) return POSTER_SCRIM_FALLBACK
  const clamped = Math.min(1, Math.max(0, luminance))
  return 0.4 + clamped * 0.24
}

export function toneColor(tone: 'up' | 'down' | 'plain'): string {
  if (tone === 'up') return POSTER_UP
  if (tone === 'down') return POSTER_DOWN
  return POSTER_INK
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
}

function linear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** `#RRGGBB` 的相对亮度。海报对比度测试用它，不拿去改运行时的字色。 */
export function relativeLuminance(hex: string): number {
  const r = linear(channel(hex, 0))
  const g = linear(channel(hex, 1))
  const b = linear(channel(hex, 2))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

/** 把半透明面板合成到最坏的纯白底上，用来检查字还够不够深。 */
export function compositeOverWhite(rgba: string): string {
  const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)/.exec(rgba)
  if (!match) return '#000000'
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const alpha = Number(match[4])
  const mix = (channel: number): string =>
    Math.round(channel * alpha + 255 * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(r)}${mix(g)}${mix(b)}`
}
