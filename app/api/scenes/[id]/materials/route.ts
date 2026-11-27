import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { guessFamilies, rememberFamilies } from '@/lib/material-library'
import { cleanRoles, type MaterialFamily } from '@/lib/material-roles'
import { readMaterialRoles, readMeta, writeMaterialRoles } from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * GET — the roles the designer gave the scene's materials (mirror, glass, light, normal, and since 18 Nov what each one is);
 * with ?guesses=1 also every material's family as the 360° render will use it (Roomia's guess, the designer's tags on top).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if (!(await readMeta(id))) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })
  const roles = await readMaterialRoles(id)
  if (req.nextUrl.searchParams.get('guesses') !== '1') return Response.json({ roles })
  return Response.json({ roles, ...(await guessFamilies(id)) })
}

/** PUT — replace the scene's material roles. The next capture of the scene uses them. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
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
  // what the designer says a material is, the PC remembers for the next projects (lib/material-library.ts)
  const before = await readMaterialRoles(id)
  const changes: Record<string, MaterialFamily | null> = {}
  for (const name of new Set([...Object.keys(before), ...Object.keys(roles)])) {
    if (before[name]?.family !== roles[name]?.family) changes[name] = roles[name]?.family ?? null
  }
  await writeMaterialRoles(id, roles)
  if (Object.keys(changes).length) await rememberFamilies(changes)
  return Response.json({ roles })
}
