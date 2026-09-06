'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { DashboardProvider, useDashboard } from '@/app/dashboard/components/DashboardProvider'
import AdminShell from './AdminShell'

function StaffInner({ children }: { children: ReactNode }) {
  const { user, loading } = useDashboard()
  const router = useRouter()
  const [staff, setStaff] = useState<boolean | null>(null)

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/dashboard/login?next=/admin')
    }
  }, [loading, user, router])

  useEffect(() => {
    if (!user?.email) return
    let cancelled = false
    supabase
      .from('staff_admins')
      .select('email')
      .ilike('email', user.email)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setStaff(Boolean(data))
      })
    return () => {
      cancelled = true
    }
  }, [user?.email])

  if (loading || !user || staff === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#edf3ef] text-[var(--rm-muted)]">
        <p className="text-sm tracking-wide">Vérification du compte staff…</p>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#edf3ef] px-6 text-center">
        <p className="text-sm text-[var(--rm-muted)]">
          {user.email} n’est pas sur la liste staff (Jack / Sarah).
        </p>
        <a href="/dashboard" className="text-sm font-semibold text-[var(--rm-primary)] underline">
          Retour Pro
        </a>
      </div>
    )
  }

  return <AdminShell>{children}</AdminShell>
}

export default function StaffGate({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <StaffInner>{children}</StaffInner>
    </DashboardProvider>
  )
}
