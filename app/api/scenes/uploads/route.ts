import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { MAX_QUEUED, queueLength } from '@/lib/scene-jobs'
import { createScene, MAX_SCENE_BYTES, sceneDir, sceneFormatOf, UPLOAD_CHUNK_BYTES } from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * POST { fileName, size } — starts a resumable upload: the browser then PUTs the file in pieces
 * to /api/scenes/:id/chunk and finishes with /api/scenes/:id/complete.
 */
export async function POST(req: NextRequest) {
  const denied = await accessDenied(req)
  if (denied) return denied

  const body = (await req.json().catch(() => null)) as { fileName?: unknown; size?: unknown } | null
  const fileName = String(body?.fileName ?? '')
  const size = Number(body?.size)
  const format = sceneFormatOf(fileName)
  if (!format) return Response.json({ detail: 'Formats acceptés : .glb, .dae ou .zip' }, { status: 400 })
  if (!Number.isFinite(size) || size <= 0) return Response.json({ detail: 'Taille de fichier invalide' }, { status: 400 })
  if (size > MAX_SCENE_BYTES) return Response.json({ detail: 'Fichier trop volumineux' }, { status: 413 })
  if (queueLength() >= MAX_QUEUED) {
    return Response.json({ detail: 'Serveur occupé, réessayez dans un instant' }, { status: 503 })
  }

  const meta = await createScene(fileName, format, 'uploading')
  const total = Math.ceil(size / UPLOAD_CHUNK_BYTES)
  await writeFile(
    path.join(sceneDir(meta.id), 'upload.json'),
    JSON.stringify({ size, chunkBytes: UPLOAD_CHUNK_BYTES, total, received: [] }),
  )
  await writeFile(path.join(sceneDir(meta.id), `original.${format}`), '')
  return Response.json({ id: meta.id, chunkBytes: UPLOAD_CHUNK_BYTES, total })
}
