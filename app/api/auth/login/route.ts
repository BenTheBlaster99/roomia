import { NextRequest } from 'next/server'
import { login, sessionCookie } from '@/lib/auth'

export const runtime = 'nodejs'

/** POST { login, password } — opens a Studio session (httpOnly cookie). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { login?: unknown; password?: unknown } | null
  const name = String(body?.login ?? '').trim()
  const password = String(body?.password ?? '')
  if (!name || !password || name.length > 60 || password.length > 200) {
    return Response.json({ detail: 'Identifiant ou mot de passe incorrect.' }, { status: 400 })
  }
  // Behind the Cloudflare tunnel every request comes from localhost; the visitor is in this header.
  const address = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  let result: ReturnType<typeof login>
  try {
    result = login(name, password, address)
  } catch (err) {
    console.error('login failed:', err)
    return Response.json({ detail: 'Connexion impossible pour le moment.' }, { status: 503 })
  }
  if ('error' in result) return Response.json({ detail: result.error }, { status: 401 })
  const secure = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  return Response.json(
    { user: { name: result.user.name, role: result.user.role, credits: result.user.credits } },
    { headers: { 'Set-Cookie': sessionCookie(result.token, secure) } },
  )
}
