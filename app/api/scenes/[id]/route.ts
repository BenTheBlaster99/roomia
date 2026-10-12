import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { isWorking } from '@/lib/scene-jobs'
import { readMeta, writeMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/** GET — preparation status: processing | ready | failed. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await accessDenied(req)
  if (denied) return denied
  const { id } = await params
  const meta = await readMeta(id)
  if (!meta) return Response.json({ detail: 'Scène introuvable' }, { status: 404 })

  // The server restarted mid-job: nothing is working on it any more.
  if (meta.status === 'processing' && !isWorking(id)) {
    const failed = { ...meta, status: 'failed' as const, error: 'Préparation interrompue, renvoyez le fichier' }
    await writeMeta(failed)
    return Response.json({ id, status: failed.status, error: failed.error })
  }

  return Response.json({
    id,
    status: meta.status,
    error: meta.error,
    fileName: meta.fileName,
    report: meta.report,
  })
}
