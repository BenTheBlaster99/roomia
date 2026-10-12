import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, accessToken } from '@/lib/access'

export const runtime = 'nodejs'

async function accessCookie(req: NextRequest, code: string): Promise<string> {
  const secure = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https'
  return `${ACCESS_COOKIE}=${await accessToken(code)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/**
 * GET ?code=…&next=/studio — one-click login link for testers: sets the cookie and redirects.
 * (The code sits in the link, so only share it with people you trust.)
 */
export async function GET(req: NextRequest) {
  const expected = process.env.ACCESS_CODE
  const next = req.nextUrl.searchParams.get('next') ?? '/studio'
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/studio'
  const origin = req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') ?? 'https'}://${req.headers.get('x-forwarded-host')}`
    : req.nextUrl.origin
  if (!expected || req.nextUrl.searchParams.get('code') !== expected) {
    if (expected) await new Promise(r => setTimeout(r, 800))
    return NextResponse.redirect(new URL(expected ? '/access' : target, origin), 302)
  }
  const res = NextResponse.redirect(new URL(target, origin), 302)
  res.headers.append('Set-Cookie', await accessCookie(req, expected))
  return res
}

/** POST { code } — sets the access cookie when the code is right. */
export async function POST(req: NextRequest) {
  const expected = process.env.ACCESS_CODE
  if (!expected) return Response.json({ ok: true })

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null
  if (typeof body?.code !== 'string' || body.code.trim() !== expected) {
    await new Promise(r => setTimeout(r, 800)) // slow down guessing
    return Response.json({ detail: 'Code incorrect' }, { status: 401 })
  }

  const res = Response.json({ ok: true })
  res.headers.append('Set-Cookie', await accessCookie(req, expected))
  return res
}
