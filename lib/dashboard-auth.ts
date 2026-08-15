import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export type DashboardAuth = {
  user: User
  supabase: SupabaseClient
  accessToken: string
}

export function createUserSupabase(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )
}

/** Resolve the logged-in dashboard user from Authorization: Bearer <jwt>. */
export async function getDashboardAuth(req: Request): Promise<DashboardAuth | null> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return null
  const accessToken = header.slice(7).trim()
  if (!accessToken) return null

  const supabase = createUserSupabase(accessToken)
  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) return null

  return { user: data.user, supabase, accessToken }
}
