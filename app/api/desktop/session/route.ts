import { NextRequest } from 'next/server'
import { login, logout } from '@/lib/auth'
import { bearerToken, cloudOff, desktopCloudEnabled, DEVICE_SESSION_DAYS } from '@/lib/desktop-cloud'

export const runtime = 'nodejs'

/**
 * POST { login, password } — a Roomia Desktop app signs in (Roomia's server, lib/desktop-cloud.ts). Answers the device
 * token the app keeps and sends as "Authorization: Bearer"; the same tries limit as the Studio's sign-in.
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const body = (await req.json().catch(() => null)) as { login?: unknown; password?: unknown } | null
  const name = String(body?.login ?? '').trim()
  const password = String(body?.password ?? '')
  if (!name || !password || name.length > 60 || password.length > 200) {
    return Response.json({ detail: 'Identifiant ou mot de passe incorrect.' }, { status: 400 })
  }
  const address = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  let result: ReturnType<typeof login>
  try {
    result = login(name, password, address, DEVICE_SESSION_DAYS)
  } catch (err) {
    console.error('desktop login failed:', err)
    return Response.json({ detail: 'Connexion impossible pour le moment.' }, { status: 503 })
  }
  if ('error' in result) return Response.json({ detail: result.error }, { status: 401 })
  const { user } = result
  return Response.json({ token: result.token, user: { login: user.login, name: user.name, role: user.role, credits: user.credits } })
}

/** DELETE — the app signs out: its token stops working at once. */
export async function DELETE(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const token = bearerToken(req)
  if (token) {
    try {
      logout(token)
    } catch {
      // gone either way for the app
    }
  }
  return Response.json({ ok: true })
}
