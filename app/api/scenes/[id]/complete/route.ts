import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { enqueueScene } from '@/lib/scene-jobs'
import { originalPath, readMeta, sceneDir, writeMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** POST — ends a resumable upload once every piece arrived, then queues the scene for preparation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied

  const { id } = await params
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'uploading') return Response.json({ detail: 'Envoi introuvable' }, { status: 404 })

  const statePath = path.join(sceneDir(id), 'upload.json')
  const state = JSON.parse(await readFile(statePath, 'utf8')) as { size: number; total: number; received: number[] }
  const missing = Array.from({ length: state.total }, (_, i) => i).filter(i => !state.received.includes(i))
  if (missing.length) {
    return Response.json({ detail: 'Pièces manquantes', missing }, { status: 409 })
  }
  const { size } = await stat(originalPath(id, meta.format))
  if (size !== state.size) return Response.json({ detail: 'Taille finale incorrecte' }, { status: 409 })

  await rm(statePath, { force: true })
  await writeMeta({ ...meta, status: 'processing', bytes: size })
  enqueueScene(id)
  return Response.json({ id })
}
