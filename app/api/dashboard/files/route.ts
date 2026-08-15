import { NextRequest } from 'next/server'
import { getDashboardAuth } from '@/lib/dashboard-auth'
import {
  insertWorkspaceFile,
  listWorkspaceFiles,
  storageBackend,
  uploadWorkspaceBytes,
  type WorkspaceKind,
} from '@/lib/workspace-storage'

export const runtime = 'nodejs'
export const maxDuration = 60

function unauthorized() {
  return Response.json({ detail: 'Unauthorized' }, { status: 401 })
}

/** GET — list workspace files for the logged-in user (newest first). */
export async function GET(req: NextRequest) {
  const auth = await getDashboardAuth(req)
  if (!auth) return unauthorized()

  try {
    const files = await listWorkspaceFiles(auth.supabase, auth.user.id)
    return Response.json({
      files,
      backend: storageBackend(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'List failed'
    console.error('dashboard/files GET:', err)
    return Response.json({ detail: message }, { status: 500 })
  }
}

/**
 * POST — upload a file (multipart) or save a generation (JSON base64).
 *
 * Multipart fields: file, kind?=upload|generation, parent_id?
 * JSON body: { kind, name, image_base64, parent_id?, content_type? }
 */
export async function POST(req: NextRequest) {
  const auth = await getDashboardAuth(req)
  if (!auth) return unauthorized()

  try {
    const contentType = req.headers.get('content-type') ?? ''
    let kind: WorkspaceKind = 'upload'
    let name: string
    let parentId: string | null = null
    let body: Buffer
    let mime: string

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return Response.json({ detail: 'file is required' }, { status: 400 })
      }
      const kindRaw = String(form.get('kind') ?? 'upload')
      if (kindRaw !== 'upload' && kindRaw !== 'generation') {
        return Response.json({ detail: 'kind must be upload or generation' }, { status: 400 })
      }
      kind = kindRaw
      parentId = form.get('parent_id') ? String(form.get('parent_id')) : null
      name = file.name || `upload-${Date.now()}.jpg`
      mime = file.type || 'application/octet-stream'
      body = Buffer.from(await file.arrayBuffer())
    } else {
      const json = (await req.json()) as {
        kind?: WorkspaceKind
        name?: string
        image_base64?: string
        parent_id?: string | null
        content_type?: string
      }
      if (!json.image_base64) {
        return Response.json({ detail: 'image_base64 is required' }, { status: 400 })
      }
      kind = json.kind === 'generation' ? 'generation' : 'upload'
      name = json.name?.trim() || `${kind}-${Date.now()}.jpg`
      parentId = json.parent_id ?? null
      mime = json.content_type ?? 'image/jpeg'
      const raw = json.image_base64.includes(',')
        ? json.image_base64.split(',')[1]
        : json.image_base64
      body = Buffer.from(raw, 'base64')
    }

    if (body.length === 0) {
      return Response.json({ detail: 'Empty file' }, { status: 400 })
    }
    if (body.length > 25 * 1024 * 1024) {
      return Response.json({ detail: 'File too large (max 25MB)' }, { status: 400 })
    }

    const uploaded = await uploadWorkspaceBytes(auth.supabase, {
      userId: auth.user.id,
      filename: name,
      body,
      contentType: mime,
    })

    const row = await insertWorkspaceFile(auth.supabase, {
      userId: auth.user.id,
      kind,
      name,
      storagePath: uploaded.storagePath,
      publicUrl: uploaded.publicUrl,
      parentId,
    })

    return Response.json({ file: row, backend: storageBackend() }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    console.error('dashboard/files POST:', err)
    return Response.json({ detail: message }, { status: 500 })
  }
}
