import { NextRequest } from 'next/server'
import { CreditError } from '@/lib/credits'
import { cloudMode, cloudPhotoFile } from '@/lib/roomia-cloud'

export const runtime = 'nodejs'

/** GET — one photo of the account, fetched from Roomia's server (?download=1 to save it). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!cloudMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const { job } = await params
  try {
    const res = await cloudPhotoFile(job)
    if (!res.ok || !res.body) return Response.json({ detail: 'Photo introuvable.' }, { status: res.status === 401 ? 401 : 404 })
    const name = (req.nextUrl.searchParams.get('name') ?? 'photo-roomia').replace(/[^\w .-]+/g, '_').slice(0, 80)
    return new Response(res.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
        ...(req.nextUrl.searchParams.get('download') ? { 'Content-Disposition': `attachment; filename="${name}.jpg"` } : {}),
      },
    })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : 'Serveur Roomia injoignable.' }, { status: err instanceof CreditError ? err.status : 503 })
  }
}
