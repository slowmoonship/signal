/**
 * 海报背景只从已经部署的本地素材里选。
 *
 * 浏览器不访问壁纸站。清单坏了、图片坏了，就退到标明 fallback 的那张；
 * 那张也坏了，绘制层用纯色，不让分享按钮抛掉。
 */

import { BASE_PATH } from '@/lib/base-path.js'

export type BackgroundRecord = Readonly<{
  id: string
  file: string
  title: string
  author: string
  sourceUrl: string
  license: string
  licenseUrl: string
  credit: string
  fetchedAt: string
  width: number
  height: number
  fallback: boolean
}>

export type ShareBitmap = Readonly<{
  width: number
  height: number
  source: unknown
  luminance: number | null
}>

export type ShareBackdrop = Readonly<{
  id: string
  credit: string
  image: ShareBitmap | null
}>

const ID = /^[a-z0-9-]+$/

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function httpUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? raw : null
  } catch {
    return null
  }
}

export function validateCatalog(input: unknown): { records: BackgroundRecord[]; errors: string[] } {
  if (!Array.isArray(input)) return { records: [], errors: ['素材清单不是数组'] }
  const records: BackgroundRecord[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      errors.push('素材条目不是对象')
      continue
    }
    const row = item as Record<string, unknown>
    const id = text(row['id'])
    const file = text(row['file'])
    const title = text(row['title'])
    const author = text(row['author'])
    const sourceUrl = httpUrl(row['sourceUrl'])
    const license = text(row['license'])
    const licenseUrl = httpUrl(row['licenseUrl'])
    const credit = text(row['credit'])
    const fetchedAt = text(row['fetchedAt'])
    const width = row['width']
    const height = row['height']
    const reason =
      !id || !ID.test(id)
        ? 'id'
        : !file || !file.startsWith('/share/backgrounds/') || !file.endsWith('.webp')
          ? 'file'
          : !title
            ? 'title'
            : !author
              ? 'author'
              : !sourceUrl
                ? 'sourceUrl'
                : !license || license.toLowerCase() === 'unknown'
                  ? 'license'
                  : !licenseUrl
                    ? 'licenseUrl'
                    : !credit
                      ? 'credit'
                      : !fetchedAt || Number.isNaN(Date.parse(fetchedAt))
                        ? 'fetchedAt'
                        : typeof width !== 'number' || !Number.isInteger(width) || width < 1
                          ? 'width'
                          : typeof height !== 'number' || !Number.isInteger(height) || height < 1
                            ? 'height'
                            : typeof row['fallback'] !== 'boolean'
                              ? 'fallback'
                              : null
    if (
      reason ||
      !id ||
      !file ||
      !title ||
      !author ||
      !sourceUrl ||
      !license ||
      !licenseUrl ||
      !credit ||
      !fetchedAt ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      typeof row['fallback'] !== 'boolean'
    ) {
      errors.push(`素材 ${id ?? '?'} 缺少或写错了 ${reason ?? 'id'}`)
      continue
    }
    if (seen.has(id)) {
      errors.push(`素材 ${id} 重复`)
      continue
    }
    seen.add(id)
    records.push({
      id,
      file,
      title,
      author,
      sourceUrl,
      license,
      licenseUrl,
      credit,
      fetchedAt,
      width,
      height,
      fallback: row['fallback'],
    })
  }
  const fallbacks = records.filter((record) => record.fallback)
  if (records.length > 0 && fallbacks.length !== 1) {
    errors.push(`默认背景必须恰好一张，现在是 ${fallbacks.length} 张`)
  }
  return { records, errors }
}

export function shareAssetUrl(file: string): string {
  return file.startsWith('/') ? `${BASE_PATH}${file}` : `${BASE_PATH}/${file}`
}

export function fallbackBackground(records: readonly BackgroundRecord[]): BackgroundRecord | null {
  return records.find((record) => record.fallback) ?? null
}

/**
 * 指定 id 只给测试。正常点击在剩下的图里随机，并且躲开刚用过的那张。
 */
export function pickBackground(
  records: readonly BackgroundRecord[],
  random: () => number,
  options?: { preferId?: string | null; previousId?: string | null },
): BackgroundRecord | null {
  if (options?.preferId) {
    const preferred = records.find((record) => record.id === options.preferId)
    if (preferred) return preferred
  }
  if (records.length === 0) return null
  if (records.length === 1) return records[0] ?? null
  const previous = options?.previousId ?? null
  const pool = previous ? records.filter((record) => record.id !== previous) : records
  const usable = pool.length > 0 ? pool : records
  const roll = random()
  const sample = Number.isFinite(roll) ? roll : 0
  const index = Math.min(usable.length - 1, Math.max(0, Math.floor(sample * usable.length)))
  return usable[index] ?? null
}

/** 先试选中的，再试默认图。两张都失败就不再把整池试一遍。 */
export function backgroundAttempts(
  records: readonly BackgroundRecord[],
  random: () => number,
  preferId: string | null,
  previousId: string | null,
): readonly BackgroundRecord[] {
  const picked = pickBackground(records, random, { preferId, previousId })
  const fallback = fallbackBackground(records)
  const order: BackgroundRecord[] = []
  if (picked) order.push(picked)
  if (fallback && fallback.id !== picked?.id) order.push(fallback)
  return order
}

export type CoverCrop = Readonly<{ sx: number; sy: number; sw: number; sh: number }>

/** 等比例 cover。宽图裁左右，高图裁上下，不把照片拉变形。 */
export function coverCrop(imageW: number, imageH: number, viewW: number, viewH: number): CoverCrop | null {
  if (!(imageW > 0) || !(imageH > 0) || !(viewW > 0) || !(viewH > 0)) return null
  const scale = Math.max(viewW / imageW, viewH / imageH)
  const sw = viewW / scale
  const sh = viewH / scale
  return { sx: (imageW - sw) / 2, sy: (imageH - sh) / 2, sw, sh }
}

