import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { FACE_FILE, FACE_RUN, tourDir } from '@/lib/scene-tour'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — one kept face of a photo-quality run: its Blender capture or its AI result. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; run: string; file: string }> }) {
  const { id, run, file } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!FACE_RUN.test(run) || !FACE_FILE.test(file) || !(await readMeta(id))) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  const data = await readFile(path.join(tourDir(id), 'faces', run, file)).catch(() => null)
  if (!data) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
}
