import { readFile } from 'node:fs/promises'
import path from 'node:path'
import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { ACCESS_COOKIE, accessToken } from './lib/access'
import { whatsappLink } from './lib/contact'
import { accountsEnabled, SESSION_COOKIE } from './lib/session-cookie'

const intl = createMiddleware(routing)

/**
 * The public address of this PC (13 Nov 2026, the user's decision): the Studio is no longer on the internet. Clients use
 * Roomia Desktop; the Studio is the owner's alone, on this PC (http://localhost:3000). Through the tunnel only these
 * answer:
 *   /api/desktop/*                  Roomia Desktop: sign-in, credits, paid photos, publishing tours (never reaches this
 *                                   proxy, see the matcher: matching it would cap the tour uploads at 10 MB)
 *   GET /studio/tour/<id>           a tour published from Roomia Desktop, for the architect's clients, and its free
 *   GET /studio/explore/<id>        walk ("Visite libre")
 *   GET /api/scenes/<id>/tour|video|photos|look|viewport[/…]   what those pages load, for a published tour only
 *   /_next/*                        the page's scripts and styles (not matched either)
 * The Studio's front door (/ and /studio, where the website's button points) sends visitors to a WhatsApp demo request.
 * Everything else from outside gets 404. A request comes from outside when it was addressed to studio.room-ia.com
 * (cloudflared keeps the visitor's Host); on this PC it is localhost/127.0.0.1 and nothing changes.
 */
const PUBLIC_HOST = 'studio.room-ia.com'
const SCENES_DIR = process.env.SCENES_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.scenes')
const TOUR_PAGE = /^\/studio\/(?:tour|explore)\/([A-Za-z0-9_-]{21})\/?$/
const TOUR_DATA = /^\/api\/scenes\/([A-Za-z0-9_-]{21})\/(?:tour|video|photos|look|viewport)(?:\/[^?]*)?$/

async function published(id: string): Promise<boolean> {
  try {
    const meta = JSON.parse(await readFile(path.join(SCENES_DIR, id, 'meta.json'), 'utf8')) as { published?: unknown }
    return Boolean(meta.published)
  } catch {
    return false
  }
}

async function fromOutside(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl
  const reading = req.method === 'GET' || req.method === 'HEAD'
  const id = reading ? (pathname.match(TOUR_PAGE) ?? pathname.match(TOUR_DATA))?.[1] : undefined
  if (id && (await published(id))) return NextResponse.next()
  if (reading && pathname === '/favicon.ico') return NextResponse.next()
  // the website's "Tester sur mon projet" still points at /studio: send those visitors to a demo request instead
  if (reading && (pathname === '/' || pathname === '/studio' || pathname === '/studio/')) {
    return NextResponse.redirect(whatsappLink('Bonjour, je souhaite une démo de Roomia Render.'), 302)
  }
  return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

/**
 * With accounts on (ROOMIA_ACCOUNTS=1), /studio (and /studio/admin) need a signed-in account (this only checks the cookie is
 * there; the page and every API check the session itself). On the website the Studio keeps the
 * old optional ACCESS_CODE gate. The APIs check access in their own routes (lib/access-guard.ts):
 * matching them here would cap upload bodies at 10 MB.
 */
const GATED = ['/studio']
const SIGNED_IN = ['/studio']

const under = (pathname: string, prefixes: string[]) => prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))

export default async function proxy(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase()
  if (host === PUBLIC_HOST) return fromOutside(req)

  const { pathname } = req.nextUrl

  // the website on Vercel is a demonstration only: no Studio there either
  if (process.env.VERCEL && under(pathname, ['/studio'])) {
    return NextResponse.redirect(whatsappLink('Bonjour, je souhaite une démo de Roomia Render.'), 302)
  }

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
  matcher: [
    // Marketing routes get i18n; the Studio page gets the access check.
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
    // Everything addressed to the public tunnel address, except Roomia Desktop's API and the page assets.
    { source: '/((?!_next/|api/desktop/).*)', has: [{ type: 'host', value: 'studio\\.room-ia\\.com' }] },
  ],
}
