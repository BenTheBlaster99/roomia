import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { TOUR_FILE, tourDir } from '@/lib/scene-tour'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = { '.png': 'image/png', '.json': 'application/json', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream', '.ply': 'application/octet-stream', '.hdr': 'application/octet-stream' }

/** GET — a panorama (pano-N.jpg), a plan (plan.png), the walkable map (nav.json) or the free walk's baked model of the scene's tour. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!TOUR_FILE.test(file) || !(await readMeta(id))) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  const full = path.join(tourDir(id), file)
  // The page asks with ?v=<build time>, so a rebuilt tour is never served from an old cache.
  const cache = 'private, max-age=86400'
  if (['.glb', '.spz', '.ply'].includes(path.extname(file))) {
    // the free walk's model and its splat are tens of MB: streamed, not read whole into memory
    const size = await stat(full).then(s => s.size).catch(() => null)
    if (size === null) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
    const stream = createReadStream(full)
    req.signal.addEventListener('abort', () => stream.destroy())
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { 'Content-Type': TYPES[path.extname(file)], 'Content-Length': String(size), 'Cache-Control': cache },
    })
  }
  const data = await readFile(full).catch(() => null)
  if (!data) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'image/jpeg', 'Cache-Control': cache },
  })
}
