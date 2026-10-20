import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { loadSharp } from '@/lib/load-sharp'
import { PHOTO_FILE, photosDir } from '@/lib/scene-photos'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — one photo of the scene; ?w=360 gives a small copy for the gallery grid. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id, file } = await params
  if (!PHOTO_FILE.test(file)) return Response.json({ detail: 'Photo introuvable' }, { status: 404 })
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const data = await readFile(path.join(photosDir(id), file)).catch(() => null)
  if (!data) return Response.json({ detail: 'Photo introuvable' }, { status: 404 })

  const width = Number(req.nextUrl.searchParams.get('w'))
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
  if (!Number.isFinite(width) || width < 64 || width > 1200) return new Response(new Uint8Array(data), { headers })
  const small = await loadSharp()(data).resize(width, Math.round(width * 1.5), { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()
  return new Response(new Uint8Array(small), { headers })
}
