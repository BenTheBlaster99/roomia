import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { BlenderRenderError, renderSceneView } from '@/lib/blender-render'
import { isSceneId, readMeta, sourcePath } from '@/lib/scene-store'

export const runtime = 'nodejs'
export const maxDuration = 180

function finiteTriple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const nums = value.map(Number)
  if (nums.some(n => !Number.isFinite(n))) return null
  return nums as [number, number, number]
}

function finiteQuad(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const nums = value.map(Number)
  if (nums.some(n => !Number.isFinite(n))) return null
  return nums as [number, number, number, number]
}

/** POST — grey capture of the camera Studio is looking through, rendered from the full file. */
export async function POST(req: NextRequest) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const body = (await req.json().catch(() => null)) as {
    position?: unknown
    quaternion?: unknown
    fov?: unknown
    sceneId?: unknown
  } | null
  const position = finiteTriple(body?.position)
  const quaternion = finiteQuad(body?.quaternion)
  const fov = Number(body?.fov)
  if (!position || !quaternion || !Number.isFinite(fov) || fov < 10 || fov > 120) {
    return Response.json({ detail: 'Caméra invalide.' }, { status: 400 })
  }

  const sceneId = String(body?.sceneId ?? '')
  const meta = isSceneId(sceneId) ? await readMeta(sceneId) : null
  if (!meta || meta.status !== 'ready') {
    return Response.json({ detail: 'Scène introuvable ou pas encore prête.' }, { status: 404 })
  }

  try {
    const { png, seconds } = await renderSceneView(sourcePath(sceneId), { position, quaternion, fov })
    console.log(`heavy-view ${sceneId}: ${seconds.toFixed(1)}s`)
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'X-Render-Seconds': seconds.toFixed(1),
      },
    })
  } catch (err) {
    const status = err instanceof BlenderRenderError ? err.status : 500
    const detail = err instanceof BlenderRenderError ? err.message : 'Le rendu du fichier complet a échoué.'
    return Response.json({ detail }, { status })
  }
}
