import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE, userFromToken, type User } from './auth'
import { accountsEnabled, adminAreaEnabled } from './session-cookie'

/**
 * For server pages when accounts are on: the signed-in account, or a redirect to /login. With
 * accounts off it returns null and the page renders as before (open Studio).
 */
export async function pageUser(next: string): Promise<User | null> {
  if (!accountsEnabled()) return null
  const user = userFromToken((await cookies()).get(SESSION_COOKIE)?.value)
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  return user
}

/** The admin page: the signed-in account (or a redirect to /login), null where there is no admin page. */
export async function adminPageUser(next: string): Promise<User | null> {
  if (!adminAreaEnabled()) return null
  const user = userFromToken((await cookies()).get(SESSION_COOKIE)?.value)
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`)
  return user
}
