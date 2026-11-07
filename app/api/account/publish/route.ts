import { NextRequest } from 'next/server'
import { CreditError } from '@/lib/credits'
import { publishStatus, startPublishing } from '@/lib/desktop-publish'
import { cloudMode } from '@/lib/roomia-cloud'
import { isSceneId, readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET ?sceneId= — where this project's publication is: sending, done (with the link), failed; and its last link. */
export async function GET(req: NextRequest) {
  if (!cloudMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const sceneId = req.nextUrl.searchParams.get('sceneId') ?? ''
  if (!isSceneId(sceneId)) return Response.json({ detail: 'Projet introuvable.' }, { status: 404 })
  const meta = await readMeta(sceneId)
  return Response.json({ progress: publishStatus(sceneId), published: meta?.publishedAs ?? null })
}

/** POST { sceneId } — publishes (or updates) this project's tour on Roomia's server, for a link to send to clients. */
export async function POST(req: NextRequest) {
  if (!cloudMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { sceneId?: unknown } | null
  const sceneId = typeof body?.sceneId === 'string' ? body.sceneId : ''
  if (!isSceneId(sceneId)) return Response.json({ detail: 'Projet introuvable.' }, { status: 404 })
  try {
    return Response.json({ progress: await startPublishing(sceneId) })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : String(err) }, { status: err instanceof CreditError ? err.status : 500 })
  }
}
