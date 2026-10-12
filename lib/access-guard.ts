import type { NextRequest } from 'next/server'
import { ACCESS_COOKIE, accessToken } from './access'

/**
 * Access check for API routes, done in the route itself (not in the proxy layer, which would
 * cap upload bodies at 10 MB). Returns a 401 response to send back, or null when allowed.
 */
export async function accessDenied(req: NextRequest): Promise<Response | null> {
  const code = process.env.ACCESS_CODE
  if (!code) return null
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value
  if (cookie && cookie === (await accessToken(code))) return null
  return Response.json({ detail: 'Accès non autorisé. Rechargez la page et entrez le code.' }, { status: 401 })
}
