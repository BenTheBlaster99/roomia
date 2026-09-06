'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useDashboard } from '@/app/dashboard/components/DashboardProvider'

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useDashboard()
  const pathname = usePathname()
  const router = useRouter()
  const onStores = pathname === '/admin' || pathname.startsWith('/admin/stores')

  async function onSignOut() {
    await signOut()
    router.replace('/dashboard/login?next=/admin')
  }

  return (
    <div className="flex min-h-screen bg-[#edf3ef] text-[var(--rm-text)]">
      <aside className="hidden w-60 shrink-0 flex-col bg-[var(--rm-primary)] text-[var(--rm-surface)] md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <a href="/" className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
            roomia
          </a>
          <span className="rounded bg-[#b8893d] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            Staff
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <a
            href="/admin"
            className={`block rounded-lg px-3 py-2 text-sm font-semibold transition ${
              onStores ? 'bg-white text-[var(--rm-primary)]' : 'text-white/75 hover:bg-white/10 hover:text-white'
            }`}
          >
            Magasins
          </a>
          <a
            href="/catalog"
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Catalogue public →
          </a>
          <a
            href="/dashboard"
            className="block rounded-lg px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Tableau de bord Pro
          </a>
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Connecté</p>
          <p className="mt-1 truncate text-xs text-white/85">{user?.email}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-white/85 underline-offset-2 hover:underline"
            onClick={() => void onSignOut()}
          >
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--rm-text)]/8 bg-white/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <a
              href="/"
              className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--rm-primary)] md:hidden"
            >
              roomia
            </a>
            <span className="rounded bg-[#b8893d]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#b8893d] md:hidden">
              Staff
            </span>
            <p className="hidden truncate text-sm font-medium text-[var(--rm-muted)] md:block">
              Back-office catalogue — Jack &amp; Sarah
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <p className="hidden max-w-[14rem] truncate text-xs text-[var(--rm-muted)] sm:block">{user?.email}</p>
            <button type="button" className="rm-btn-secondary px-3 py-1.5 text-xs" onClick={() => void onSignOut()}>
              Déconnexion
            </button>
          </div>
        </header>

        <div className="flex gap-2 border-b border-[var(--rm-text)]/8 bg-white px-4 py-2 md:hidden">
          <a
            href="/admin"
            className="flex-1 rounded-lg bg-[var(--rm-primary)] px-2 py-2 text-center text-xs font-semibold text-[var(--rm-surface)]"
          >
            Magasins
          </a>
          <a
            href="/catalog"
            className="flex-1 rounded-lg bg-[var(--rm-secondary)]/70 px-2 py-2 text-center text-xs font-semibold text-[var(--rm-muted)]"
          >
            Catalogue
          </a>
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="w-full">{children}</div>
        </main>
      </div>
    </div>
  )
}
