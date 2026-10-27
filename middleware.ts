import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { ACCESS_COOKIE, accessToken } from './lib/access'
import { accountsEnabled, SESSION_COOKIE } from './lib/session-cookie'

const intl = createMiddleware(routing)

/**
 * With accounts on (ROOMIA_ACCOUNTS=1), /studio (and /studio/admin) need a signed-in account (this only checks the cookie is
 * there; the page and every API check the session itself). On the website the Studio keeps the
 * old optional ACCESS_CODE gate. The APIs check access in their own routes (lib/access-guard.ts):
 * matching them here would cap upload bodies at 10 MB.
 */
const GATED = ['/studio']
const SIGNED_IN = ['/studio']

const under = (pathname: string, prefixes: string[]) => prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (accountsEnabled() && under(pathname, SIGNED_IN)) {
    if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`
    return NextResponse.redirect(url)
  }

  if (under(pathname, GATED)) {
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
