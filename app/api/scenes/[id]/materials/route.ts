import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { cleanRoles } from '@/lib/material-roles'
import { readMaterialRoles, readMeta, writeMaterialRoles } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — the roles the designer gave the scene's materials (mirror, glass, light, normal). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  return Response.json({ roles: await readMaterialRoles(id) })
}

/** PUT — replace the scene's material roles. The next capture of the scene uses them. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const text = await req.text()
  if (text.length > 200_000) return Response.json({ detail: 'Trop de matériaux' }, { status: 413 })
  let body: { roles?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return Response.json({ detail: 'JSON illisible' }, { status: 400 })
  }
  const roles = cleanRoles(body.roles)
  await writeMaterialRoles(id, roles)
  return Response.json({ roles })
}
