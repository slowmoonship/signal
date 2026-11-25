/**
 * 海报字体打进静态站点，点击分享时才加载。
 *
 * Noto Sans SC 使用 SIL Open Font License，许可全文在
 * `public/share/fonts/OFL.txt`。不访问 Google Fonts。
 * 加载失败时退到本机的思源黑体，再不行就用 generic sans-serif。
 */

import { shareAssetUrl } from './backgrounds.js'

export const POSTER_FONT_FAMILY = 'Signal Poster'

const FACES = [
  { file: 'noto-sans-sc-latin-400.woff2', weight: '400', range: 'U+0000-00FF' },
  { file: 'noto-sans-sc-latin-700.woff2', weight: '700', range: 'U+0000-00FF' },
  { file: 'noto-sans-sc-latin-ext-400.woff2', weight: '400', range: 'U+0100-024F, U+2000-206F' },
  { file: 'noto-sans-sc-latin-ext-700.woff2', weight: '700', range: 'U+0100-024F, U+2000-206F' },
  { file: 'noto-sans-sc-400.woff2', weight: '400', range: 'U+2E80-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF' },
  { file: 'noto-sans-sc-700.woff2', weight: '700', range: 'U+2E80-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF' },
] as const

const FALLBACK = '"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif'

let loading: Promise<string> | null = null

export function loadPosterFont(): Promise<string> {
  if (!loading) loading = loadFaces()
  return loading
}

async function loadFaces(): Promise<string> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return FALLBACK
  try {
    await Promise.all(
      FACES.map(async (face) => {
        const loaded = new FontFace(POSTER_FONT_FAMILY, `url(${shareAssetUrl(`/share/fonts/${face.file}`)})`, {
          weight: face.weight,
          style: 'normal',
          unicodeRange: face.range,
        })
        await loaded.load()
        document.fonts.add(loaded)
      }),
    )
    return `"${POSTER_FONT_FAMILY}", ${FALLBACK}`
  } catch {
    return FALLBACK
  }
}
