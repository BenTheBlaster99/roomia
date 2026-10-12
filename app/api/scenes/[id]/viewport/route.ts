import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { readMeta, viewportPath } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** "bytes=a-b" → [a, b] clamped to the file, or null when absent or malformed. */
function parseRange(header: string | null, size: number): [number, number] | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? '')
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  return start <= end && start < size ? [start, end] : null
}

/**
 * GET — the light copy Studio opens. The full-quality source never leaves the server.
 * Supports Range requests so the browser can fetch it in small, individually retried pieces.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') {
    return Response.json({ detail: 'Scène pas prête' }, { status: 404 })
  }
  const file = viewportPath(id)
  const { size } = await stat(file)

  const range = parseRange(req.headers.get('range'), size)
  const [start, end] = range ?? [0, size - 1]
  const stream = createReadStream(file, { start, end })
  stream.on('error', err => console.error(`viewport ${id}: read error`, err.message))
  req.signal.addEventListener('abort', () => {
    console.warn(`viewport ${id}: connection closed after ${stream.bytesRead}/${end - start + 1} bytes (range ${start}-${end})`)
    stream.destroy()
  })

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
