import { CreditError } from '@/lib/credits'
import { cloudDrive, cloudMode } from '@/lib/roomia-cloud'

export const runtime = 'nodejs'

/** GET — Roomia Desktop's "Mon espace": the account, its credit history, its photos and its published tours. */
export async function GET() {
  if (!cloudMode()) return Response.json({ detail: 'Introuvable' }, { status: 404 })
  try {
    return Response.json(await cloudDrive())
  } catch (err) {
    const status = err instanceof CreditError ? err.status : 503
    return Response.json({ detail: err instanceof Error ? err.message : 'Serveur Roomia injoignable.' }, { status })
  }
}
