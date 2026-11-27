import { NextRequest } from 'next/server'
import { projectUpdateRefusal, projectsTotal, recordForfaitUse, recordProjectVersion } from '@/lib/credits'
import { bearerUser, cloudOff, desktopCloudEnabled, notSignedIn } from '@/lib/desktop-cloud'

export const runtime = 'nodejs'

/**
 * POST { item: 'update', detail, project?, check?, note? } — Roomia Desktop and a new version of a project (lib/forfait.ts).
 * - Older apps (no project): counted only, never refused.
 * - 0.5.5 with a projects forfait: { check: true } first asks whether the project still has an update (402 with the
 *   sentence to show when not); once the new version is taken, the same call without check counts it. `note` says why
 *   the new model may be another apartment (shown to the admin only).
 */
export async function POST(req: NextRequest) {
  if (!desktopCloudEnabled()) return cloudOff()
  const user = bearerUser(req)
  if (!user) return notSignedIn()
  const body = (await req.json().catch(() => null)) as { item?: unknown; detail?: unknown; project?: unknown; check?: unknown; note?: unknown } | null
  if (body?.item !== 'update') return Response.json({ detail: 'Requête incomplète.' }, { status: 400 })
  const detail = String(body.detail ?? '')
  const project = typeof body.project === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(body.project) ? body.project : null
  if (project && projectsTotal(user.id) !== null) {
    if (body.check === true) {
      const refusal = projectUpdateRefusal(user.id, project)
      return refusal ? Response.json({ detail: refusal }, { status: 402 }) : Response.json({ ok: true })
    }
    recordProjectVersion(user.id, project, detail, typeof body.note === 'string' && body.note ? body.note : null)
    return Response.json({ ok: true })
  }
  if (body.check === true) return Response.json({ ok: true })
  recordForfaitUse(user.id, 'update', detail)
  return Response.json({ ok: true })
}
