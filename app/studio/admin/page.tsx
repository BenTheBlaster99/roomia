import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { adminPageUser } from '@/lib/page-session'
import AdminClient from './AdminClient'

export const metadata = { title: 'Roomia Studio · Comptes' }

/** Studio accounts, credits and usage (Studio PC only; admins only, everyone else gets "not found"). */
export default async function StudioAdminPage() {
  await connection()
  const user = await adminPageUser('/studio/admin')
  if (!user || user.role !== 'admin') notFound()
  return <AdminClient adminLogin={user.login} />
}
