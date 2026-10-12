import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { ACCESS_COOKIE, accessToken } from './lib/access'

const intl = createMiddleware(routing)

/**
 * The Studio page is gated by ACCESS_CODE when it is set. The APIs check access in their own
 * routes (lib/access-guard.ts): matching them here would cap upload bodies at 10 MB.
 */
const GATED = ['/studio']

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (GATED.some(p => pathname === p || pathname.startsWith(`${p}/`))) {
    const code = process.env.ACCESS_CODE
    if (!code) return NextResponse.next()
    const cookie = req.cookies.get(ACCESS_COOKIE)?.value
    if (cookie && cookie === (await accessToken(code))) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = '/access'
    url.search = `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }

  return intl(req)
}

export const config = {
  // Marketing routes get i18n; the Studio page gets the access check.
  matcher: [
    '/',
    '/(fr|en)',
    '/(fr|en)/:path*',
    '/about',
    '/partners',
    '/rooms',
    '/styles',
    '/styles/:path*',
    '/quiz',
    '/generateur',
    '/marketplace',
    '/studio',
    '/studio/:path*',
  ],
}
