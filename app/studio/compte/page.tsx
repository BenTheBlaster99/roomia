import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cloudMode } from '@/lib/roomia-cloud'
import AccountClient from './AccountClient'

export const metadata: Metadata = { title: 'Mon espace · Roomia' }

/** Roomia Desktop: the account's space on Roomia's server — credits, history, AI photos, published tours. */
export default async function AccountPage() {
  await connection()
  if (!cloudMode()) notFound()
  return <AccountClient />
}
