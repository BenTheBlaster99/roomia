import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { enqueueScene, MAX_QUEUED, queueLength } from '@/lib/scene-jobs'
import {
  createScene,
  deleteScene,
  MAX_SCENE_BYTES,
  originalPath,
  sceneFormatOf,
  writeMeta,
} from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * POST — upload a heavy scene (.dae or .glb) as the raw request body, header `x-file-name`.
 * The file is streamed to disk (never held in memory), kept as-is, and queued for preparation.
 * Returns { id }; poll GET /api/scenes/:id until status is "ready".
 */
export async function POST(req: NextRequest) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const fileName = decodeURIComponent(req.headers.get('x-file-name') ?? '')
  const format = sceneFormatOf(fileName)
  if (!format) {
    return Response.json({ detail: 'Formats acceptés : .dae ou .glb' }, { status: 400 })
  }
  if (!req.body) return Response.json({ detail: 'Fichier manquant' }, { status: 400 })

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_SCENE_BYTES) {
    return Response.json({ detail: 'Fichier trop volumineux' }, { status: 413 })
  }
  if (queueLength() >= MAX_QUEUED) {
    return Response.json({ detail: 'Serveur occupé, réessayez dans un instant' }, { status: 503 })
  }

  const meta = await createScene(fileName, format)
  let received = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      received += chunk.length
      if (received > MAX_SCENE_BYTES) return done(new Error('too large'))
      done(null, chunk)
    },
  })

  try {
    await pipeline(
      Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
      limiter,
      createWriteStream(originalPath(meta.id, format)),
    )
  } catch (err) {
    await deleteScene(meta.id)
    const tooLarge = err instanceof Error && err.message === 'too large'
    return Response.json(
      { detail: tooLarge ? 'Fichier trop volumineux' : 'Envoi interrompu' },
      { status: tooLarge ? 413 : 400 },
    )
  }

  await writeMeta({ ...meta, bytes: received })
  enqueueScene(meta.id)
  return Response.json({ id: meta.id })
}
