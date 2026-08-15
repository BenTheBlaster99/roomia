'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboard } from './DashboardProvider'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useDashboard()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/dashboard/login')
    }
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--rm-bg)] text-[var(--rm-muted)]">
        <p className="text-sm tracking-wide">Chargement du tableau de bord…</p>
      </div>
    )
  }

  if (!user) return null

  return <>{children}</>
}
