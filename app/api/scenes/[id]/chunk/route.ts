import { open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { originalPath, readMeta, sceneDir } from '@/lib/scene-store'

export const runtime = 'nodejs'

interface UploadState {
  size: number
  chunkBytes: number
  total: number
  received: number[]
}

/** PUT ?index=N — one piece of a resumable upload. Safe to repeat: a retried piece overwrites itself. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied

  const { id } = await params
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'uploading') return Response.json({ detail: 'Envoi introuvable' }, { status: 404 })

  const statePath = path.join(sceneDir(id), 'upload.json')
  const state = JSON.parse(await readFile(statePath, 'utf8')) as UploadState
  const index = Number(req.nextUrl.searchParams.get('index'))
  if (!Number.isInteger(index) || index < 0 || index >= state.total) {
    return Response.json({ detail: 'Pièce invalide' }, { status: 400 })
  }

  const data = Buffer.from(await req.arrayBuffer())
  const expected = index === state.total - 1 ? state.size - index * state.chunkBytes : state.chunkBytes
  if (data.length !== expected) {
    return Response.json({ detail: `Pièce incomplète (${data.length}/${expected} octets)` }, { status: 400 })
  }

  const file = await open(originalPath(id, meta.format), 'r+')
  try {
    await file.write(data, 0, data.length, index * state.chunkBytes)
  } finally {
    await file.close()
  }

  // Re-read before saving so overlapping retries don't lose each other's pieces.
  const latest = JSON.parse(await readFile(statePath, 'utf8')) as UploadState
  if (!latest.received.includes(index)) latest.received.push(index)
  await writeFile(statePath, JSON.stringify(latest))
  return Response.json({ received: latest.received.length, total: latest.total })
}
