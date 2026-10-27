import type { NextRequest } from 'next/server'
import { ACCESS_COOKIE, accessToken } from './access'
import { SESSION_COOKIE, userFromToken, type User } from './auth'
import { accountsEnabled } from './session-cookie'
import { isSceneId, readMeta } from './scene-store'

/**
 * Access checks for the Studio API, done in each route (not in the proxy layer, which would cap
 * upload bodies at 10 MB). Every Studio call needs a signed-in, active account; a scene can only
 * be reached by the account that uploaded it, or an admin.
 */

/** The signed-in account, or null. Null too where the Studio database can't run (the website on Vercel). */
export function sessionUser(req: NextRequest): User | null {
  if (!accountsEnabled()) return null
  try {
    return userFromToken(req.cookies.get(SESSION_COOKIE)?.value)
  } catch (err) {
    console.error('session check failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Returns the response to send back when the request may not go on, or null when it may.
 * With a sceneId, the scene must belong to this account (admins reach every scene). Someone
 * else's scene answers "not found", so ids can't be probed.
 */
export async function accessDenied(req: NextRequest, sceneId?: string): Promise<Response | null> {
  // Accounts off: the Studio is open, as it was before accounts existed.
  if (!accountsEnabled()) return null
  const user = sessionUser(req)
  if (!user) return Response.json({ detail: 'Connectez-vous pour utiliser le Studio.' }, { status: 401 })
  if (sceneId === undefined) return null
  const meta = isSceneId(sceneId) ? await readMeta(sceneId) : null
  if (!meta || (user.role !== 'admin' && meta.ownerId !== user.id)) {
    return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  }
  return null
}

/** Admin-only routes: anyone else gets "not found". */
export function adminDenied(req: NextRequest): { user: User } | { denied: Response } {
  if (!accountsEnabled()) return { denied: Response.json({ detail: 'Introuvable' }, { status: 404 }) }
  const user = sessionUser(req)
  if (!user) return { denied: Response.json({ detail: 'Connectez-vous.' }, { status: 401 }) }
  if (user.role !== 'admin') return { denied: Response.json({ detail: 'Introuvable' }, { status: 404 }) }
  return { user }
}

/** The old shared-code check, kept for the website deployment (Vercel), where there are no accounts. */
export async function legacyAccessDenied(req: NextRequest): Promise<Response | null> {
  const code = process.env.ACCESS_CODE
  if (!code) return null
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value
  if (cookie && cookie === (await accessToken(code))) return null
  return Response.json({ detail: 'Accès non autorisé. Rechargez la page et entrez le code.' }, { status: 401 })
}

/**
 * On the Studio PC (ROOMIA_STUDIO_ONLY=1), the website's own paid endpoints (kitchen composer,
 * segmentation…) are switched off: the public tunnel must not expose them. Vercel leaves it unset.
 */
export function websiteOnlyDenied(): Response | null {
  return process.env.ROOMIA_STUDIO_ONLY === '1' ? Response.json({ detail: 'Introuvable' }, { status: 404 }) : null
}
