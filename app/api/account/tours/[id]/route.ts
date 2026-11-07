import { NextRequest } from 'next/server'
import { CreditError } from '@/lib/credits'
import { cloudMode, cloudUnpublish } from '@/lib/roomia-cloud'

export const runtime = 'nodejs'

/** DELETE — removes a published tour from Roomia's server: its link stops working. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!cloudMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  const { id } = await params
  try {
    await cloudUnpublish(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ detail: err instanceof Error ? err.message : 'Serveur Roomia injoignable.' }, { status: err instanceof CreditError ? err.status : 503 })
  }
}
