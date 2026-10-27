import { NextRequest } from 'next/server'
import { clearedSessionCookie, logout, SESSION_COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

/** POST — closes the session on the server and clears the cookie. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value
  if (token) {
    try {
      logout(token)
    } catch {
      // the cookie is cleared anyway
    }
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie } })
}
