import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { TOUR_FILE, tourDir } from '@/lib/scene-tour'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — a panorama (pano-N.jpg) or the plan (plan.png) of the scene's tour. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!TOUR_FILE.test(file) || !(await readMeta(id))) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  const data = await readFile(path.join(tourDir(id), file)).catch(() => null)
  if (!data) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  // The page asks with ?v=<build time>, so a rebuilt tour is never served from an old cache.
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': file.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
  })
}
