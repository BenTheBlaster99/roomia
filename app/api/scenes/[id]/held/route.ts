import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { addHeld, pickRequest, readHeld, removeHeld } from '@/lib/held-renders'
import { parseCaptureRequest } from '@/lib/scene-capture'
import { readCameras, readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** GET — the photos the user put on hold for this scene. */
export async function GET(req: NextRequest, { params }: Params) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  return Response.json({ held: await readHeld(id) })
}

/** POST — put a photo on hold: keeps the view and light so it can be run again later. */
export async function POST(req: NextRequest, { params }: Params) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ detail: 'Requête invalide' }, { status: 400 })
  const request = pickRequest(body)
  const parsed = parseCaptureRequest(request, await readCameras(id))
  if (typeof parsed === 'string') return Response.json({ detail: parsed }, { status: 400 })
  return Response.json({ held: await addHeld(id, `${parsed.name} · ${parsed.lighting.time}`, request) })
}

/** DELETE ?held=<id> — drop a held photo (after it was run, or because it isn't wanted any more). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const held = req.nextUrl.searchParams.get('held') ?? ''
  return Response.json({ held: await removeHeld(id, held) })
}
