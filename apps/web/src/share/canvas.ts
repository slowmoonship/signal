/**
 * 绘制层和测试共用的画笔。
 *
 * 测试用一个只记账的画笔，不启动浏览器。圆角、透明度和图片是海报新增的，
 * 旧的矩形画笔盖不住半透明面板。
 */

export type SharePainter = {
  setFill(color: string): void
  setStroke(color: string): void
  setLineWidth(width: number): void
  setFont(font: string): void
  setTextAlign(align: 'left' | 'right' | 'center'): void
  setTextBaseline(baseline: 'top' | 'middle' | 'bottom'): void
  setLineDash(segments: readonly number[]): void
  setAlpha(alpha: number): void
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
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  clip(): void
  arc(x: number, y: number, r: number): void
  drawImage(
    source: unknown,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

export function face(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`
}

/** 字号往下收到放得下为止。收不动也把整段字画上去，不悄悄截掉。 */
export function fitSize(
  painter: SharePainter,
  text: string,
  maxWidth: number,
  size: number,
  min: number,
  weight: number,
  family: string,
): number {
  let current = size
  painter.setFont(face(weight, current, family))
  while (current > min && painter.measureText(text).width > maxWidth) {
    current -= 1
    painter.setFont(face(weight, current, family))
  }
  return current
}

const LINE_BREAK = new Set(['。', '，', '、', '；', '：', '｜', ' '])

function numericChar(chars: readonly string[], index: number): boolean {
  const ch = chars[index]
  if (!ch) return false
  if (/[0-9.,%]/.test(ch)) return true
  const next = chars[index + 1]
  return (ch === '+' || ch === '-' || ch === '$') && next !== undefined && /[0-9]/.test(next)
}

/** 优先在句读处换行。实在要在数字前断开时，把整段数字留到下一行。 */
function soften(chars: readonly string[], start: number, hard: number): number {
  if (hard >= chars.length || hard <= start + 1) return hard
  let candidate = hard
  if (numericChar(chars, hard - 1) && numericChar(chars, hard)) {
    let cursor = hard
    while (cursor > start + 1 && numericChar(chars, cursor - 1)) cursor -= 1
    if (cursor > start) candidate = cursor
  }
  for (let i = hard; i > start + 1; i -= 1) {
    const ch = chars[i - 1]
    if (ch && LINE_BREAK.has(ch) && i - start >= 6) return i
  }
  return candidate
}

export function wrap(painter: SharePainter, text: string, maxWidth: number, maxLines: number): string[] {
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
    end = soften(chars, index, end)
    const lastLine = lines.length === maxLines - 1
    if (lastLine && end < chars.length) {
      let cut = end
      while (cut > index + 1 && painter.measureText(`${chars.slice(index, cut).join('')}…`).width > maxWidth) {
        cut -= 1
      }
      cut = soften(chars, index, cut)
      if (cut <= index) cut = Math.max(index + 1, end)
      lines.push(`${chars.slice(index, cut).join('')}…`)
      break
    }
    if (end <= index) end = index + 1
    lines.push(chars.slice(index, end).join(''))
    index = end
  }
  return lines
}

/** 按「 · 」把页脚切成行。一段署名不从中间切开。 */
export function packSegments(painter: SharePainter, segments: readonly string[], maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] ?? ''
    const next = current.length === 0 ? segment : `${current} · ${segment}`
    if (current.length > 0 && painter.measureText(next).width > maxWidth) {
      if (lines.length >= maxLines - 1) {
        lines.push([current, ...segments.slice(i)].join(' · '))
        return lines
      }
      lines.push(current)
      current = segment
    } else {
      current = next
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}
