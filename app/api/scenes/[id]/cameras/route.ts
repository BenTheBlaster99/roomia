import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { fromSketchUpScenes } from '@/lib/scene-cameras'
import { readCameras, readMeta, writeCameras } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the scene's saved views (SketchUp scenes), in the prepared file's frame. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  return Response.json({ cameras: await readCameras(id) })
}

/**
 * PUT — add saved views from a SketchUp camera-export JSON (for a .glb sent on its own,
 * which carries no cameras). Replaces any views the scene already had.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const text = await req.text()
  if (text.length > 2_000_000) return Response.json({ detail: 'Fichier trop volumineux' }, { status: 413 })
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return Response.json({ detail: 'JSON illisible' }, { status: 400 })
  }
  const cameras = fromSketchUpScenes(data)
  if (!cameras.length) {
    return Response.json({ detail: 'Aucune scène valide dans ce fichier' }, { status: 400 })
  }
  await writeCameras(id, cameras)
  return Response.json({ cameras })
}
