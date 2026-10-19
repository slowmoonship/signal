import { NextResponse, type NextRequest } from 'next/server'

/**
 * 语言协商（ADR-008：自建，不引入 next-intl）。
 *
 * 优先级：cookie > Accept-Language > 默认英文。
 * 只在没有 locale 前缀的路径上生效，且**排除静态资源与 API**，
 * 避免 `/icon.png` 被重定向到 `/zh/icon.png`。
 */

const COOKIE = 'signal_locale'
const DEFAULT_LOCALE = 'en'
const LOCALES = ['en', 'zh'] as const
type Locale = (typeof LOCALES)[number]

function isLocale(v: string | undefined): v is Locale {
  return v !== undefined && (LOCALES as readonly string[]).includes(v)
}

/** 从 Accept-Language 里挑一个我们支持的语言 */
function negotiate(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      return { tag: (tag ?? '').trim().toLowerCase(), q: q ? Number(q) : 1 }
    })
    .filter((x) => x.tag.length > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl

  // 已有 locale 前缀 → 放行
  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
    return NextResponse.next()
  }

  // 静态资源、API、Next 内部路径不参与协商
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    return NextResponse.next()
  }

  const fromCookie = req.cookies.get(COOKIE)?.value
  const locale = isLocale(fromCookie) ? fromCookie : negotiate(req.headers.get('accept-language'))

  const url = req.nextUrl.clone()
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
  url.search = search

  const res = NextResponse.redirect(url)
  res.cookies.set(COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
