import { readFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { accessDenied } from '@/lib/access-guard'
import { attachment, exportEntries, panoDownload, withPanoXmp, zipStream } from '@/lib/scene-export'
import { readMeta } from '@/lib/scene-store'

export const runtime = 'nodejs'

/**
 * GET — downloads (lib/scene-export.ts). ?view=<index>: that point's 360° as an equirectangular JPEG tagged for 360° viewers.
 * Without it: the whole project in one folder (zip). On this PC only: proxy.ts keeps it off the public address.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const denied = await accessDenied(req, id)
  if (denied) return denied
  if ((await readMeta(id))?.status !== 'ready') return Response.json({ detail: 'Projet introuvable ou pas encore prêt.' }, { status: 404 })
  const view = req.nextUrl.searchParams.get('view')
  if (view !== null) {
    const pano = await panoDownload(id, Number(view))
    if (!pano) return Response.json({ detail: 'Ce point n’a pas encore de 360°.' }, { status: 404 })
    const jpg = await withPanoXmp(await readFile(pano.file))
    return new Response(new Uint8Array(jpg), { headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': attachment(pano.name), 'Cache-Control': 'no-store' } })
  }
  const { folder, entries } = await exportEntries(id)
  if (!entries.length) return Response.json({ detail: 'Rien à télécharger pour l’instant : préparez la visite 360° ou faites une photo.' }, { status: 404 })
  return new Response(zipStream(entries), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': attachment(`${folder} - Roomia.zip`), 'Cache-Control': 'no-store' },
  })
}
