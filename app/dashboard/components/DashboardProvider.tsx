'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { WorkspaceFileRow } from '@/types/workspace'

type DashboardContextValue = {
  user: User | null
  session: Session | null
  loading: boolean
  files: WorkspaceFileRow[]
  filesLoading: boolean
  refreshFiles: () => Promise<void>
  authHeaders: () => HeadersInit
  signOut: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used inside DashboardProvider')
  return ctx
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState<WorkspaceFileRow[]>([])
  const [filesLoading, setFilesLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setUser(next?.user ?? null)
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const authHeaders = useCallback((): HeadersInit => {
    const token = session?.access_token
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [session?.access_token])

  const refreshFiles = useCallback(async () => {
    if (!session?.access_token) {
      setFiles([])
      return
    }
    setFilesLoading(true)
    try {
      const res = await fetch('/api/dashboard/files', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail ?? `List failed (${res.status})`)
      setFiles((data.files ?? []) as WorkspaceFileRow[])
    } catch (err) {
      console.error(err)
      setFiles([])
    } finally {
      setFilesLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    if (session?.access_token) {
      void refreshFiles()
    } else {
      setFiles([])
    }
  }, [session?.access_token, refreshFiles])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setFiles([])
  }, [])

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      files,
      filesLoading,
      refreshFiles,
      authHeaders,
      signOut,
    }),
    [user, session, loading, files, filesLoading, refreshFiles, authHeaders, signOut],
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
