import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  // Marketing routes only — tools stay outside i18n for now
  matcher: [
    '/',
    '/(fr|en)',
    '/(fr|en)/:path*',
    '/about',
    '/partners',
    '/rooms',
    '/styles',
    '/quiz',
    '/generateur',
    '/marketplace',
  ],
}
