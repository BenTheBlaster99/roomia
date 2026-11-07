import { NextRequest } from 'next/server'
import { desktopMode, readProject } from '@/lib/desktop-projects'
import { isWorking } from '@/lib/scene-jobs'
import { readTourStatus } from '@/lib/scene-tour'
import { deleteScene, isSceneId, readMeta, writeMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * PATCH { name } — Roomia Desktop: renames a project (the name shown in the Studio, the tour and a published link).
 * PATCH { separate: true } — a model sent again from SketchUp stays a project of its own.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!desktopMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const { id } = await params
  const meta = isSceneId(id) ? await readMeta(id) : null
  if (!meta) return Response.json({ detail: 'Projet introuvable.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { name?: unknown; separate?: unknown } | null
  // "keep as a separate project": no longer offered as a new version of the earlier one
  if (body?.separate === true && meta.source) {
    const source = { ...meta.source }
    delete source.versionOf
    await writeMeta({ ...meta, source })
    return Response.json({ project: await readProject(id) })
  }
  const name = typeof body?.name === 'string' ? body.name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 120) : ''
  if (!name) return Response.json({ detail: 'Indiquez un nom.' }, { status: 400 })
  const ext = /\.(glb|dae|zip)$/i.exec(meta.fileName)?.[0] ?? ''
  await writeMeta({ ...meta, fileName: `${name}${ext}` })
  return Response.json({ project: await readProject(id) })
}

/** DELETE — Roomia Desktop: deletes a project and everything rendered for it, on this PC (a published link stays). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!desktopMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const { id } = await params
  if (!isSceneId(id) || !(await readMeta(id))) return Response.json({ detail: 'Projet introuvable.' }, { status: 404 })
  if (isWorking(id) || (await readTourStatus(id)).state === 'building') {
    return Response.json({ detail: 'Un rendu est en cours sur ce projet : attendez la fin avant de le supprimer.' }, { status: 409 })
  }
  await deleteScene(id)
  return Response.json({ ok: true })
}
