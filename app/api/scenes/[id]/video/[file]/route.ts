import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { VIDEO_FILE, videoDir, videoFileSize } from '@/lib/scene-video'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * GET — the video (video-….mp4) or its poster (poster-….jpg). Each build has a new name, so they are cached for good.
 * The video answers range requests: browsers fetch a video in pieces, and Safari plays nothing without them.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!VIDEO_FILE.test(file) || !(await readMeta(id))) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  const size = await videoFileSize(id, file)
  if (size === null) return Response.json({ detail: 'Fichier introuvable' }, { status: 404 })
  const type = file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
  const headers = { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' }
  const stream = (start: number, end: number) =>
    Readable.toWeb(createReadStream(path.join(videoDir(id), file), { start, end })) as ReadableStream<Uint8Array>
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (range && (range[1] || range[2])) {
    // "bytes=a-b", "bytes=a-" or the last n bytes, "bytes=-n"
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    return new Response(stream(start, end), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }
  return new Response(stream(0, size - 1), { headers: { ...headers, 'Content-Length': String(size) } })
}
