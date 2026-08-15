'use client'

import { useEffect, useState } from 'react'
import type { WorkspaceFileRow } from '@/types/workspace'
import { useDashboard } from './DashboardProvider'
import WorkspaceView from './WorkspaceView'
import GenerateView from './GenerateView'

const ONBOARD_KEY = 'roomia_dashboard_onboarded_v1'

type Mode = 'workspace' | 'generate'

export default function DashboardShell() {
  const { user, signOut } = useDashboard()
  const [mode, setMode] = useState<Mode>('workspace')
  const [seedFile, setSeedFile] = useState<WorkspaceFileRow | null>(null)
  const [showOnboard, setShowOnboard] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARD_KEY)) setShowOnboard(true)
    } catch {
      setShowOnboard(true)
    }
  }, [])

  function dismissOnboard() {
    try {
      localStorage.setItem(ONBOARD_KEY, '1')
    } catch {
      /* ignore */
    }
    setShowOnboard(false)
  }

  function useInGenerate(file: WorkspaceFileRow) {
    setSeedFile(file)
    setMode('generate')
  }

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 10% -10%, rgba(184,137,61,0.18), transparent 55%), radial-gradient(ellipse 70% 45% at 90% 0%, rgba(31,77,61,0.16), transparent 50%), linear-gradient(180deg, var(--rm-bg), #dfe8e1 100%)',
        }}
      />

      <header className="sticky top-0 z-30 border-b border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 md:px-6">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-[var(--rm-primary)]"
            >
              roomia
            </a>
            <span className="rounded-md bg-[var(--rm-accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--rm-accent)]">
              Pro
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden max-w-[14rem] truncate text-[var(--rm-muted)] sm:inline">
              {user?.email}
            </span>
            <button type="button" className="rm-btn-secondary px-3 py-1.5 text-xs" onClick={() => void signOut()}>
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-5 py-8 md:px-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="sticky top-24 space-y-1 rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)]/80 p-2 backdrop-blur">
            <SideButton active={mode === 'workspace'} onClick={() => setMode('workspace')}>
              Espace de travail
            </SideButton>
            <SideButton
              active={mode === 'generate'}
              onClick={() => {
                setSeedFile(null)
                setMode('generate')
              }}
            >
              Générer
            </SideButton>
            <a
              href="/room-composer"
              className="mt-2 block rounded-xl px-3 py-2.5 text-sm text-[var(--rm-muted)] transition hover:bg-[var(--rm-secondary)]/50 hover:text-[var(--rm-primary)]"
            >
              Compositeur public →
            </a>
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex gap-2 md:hidden">
            <button
              type="button"
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                mode === 'workspace'
                  ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                  : 'bg-[var(--rm-surface)] text-[var(--rm-muted)]'
              }`}
              onClick={() => setMode('workspace')}
            >
              Drive
            </button>
            <button
              type="button"
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                mode === 'generate'
                  ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                  : 'bg-[var(--rm-surface)] text-[var(--rm-muted)]'
              }`}
              onClick={() => {
                setSeedFile(null)
                setMode('generate')
              }}
            >
              Générer
            </button>
          </div>

          {showOnboard && (
            <div className="rm-rise mb-6 rounded-2xl border border-[var(--rm-accent)]/30 bg-[var(--rm-surface)] p-5 shadow-[0_16px_48px_-32px_rgba(20,32,28,0.5)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
                Premiers pas
              </p>
              <h3 className="mt-2 font-[family-name:var(--font-display)] text-xl font-bold text-[var(--rm-primary)]">
                Upload → Épingler → Générer
              </h3>
              <ol className="mt-3 space-y-1.5 text-sm text-[var(--rm-muted)]">
                <li>
                  <strong className="text-[var(--rm-text)]">1.</strong> Uploadez une photo dans l’espace
                  de travail
                </li>
                <li>
                  <strong className="text-[var(--rm-text)]">2.</strong> En mode Générer, épinglez les
                  meubles à remplacer
                </li>
                <li>
                  <strong className="text-[var(--rm-text)]">3.</strong> Les variations s’empilent sous
                  l’image source
                </li>
              </ol>
              <button type="button" className="rm-btn-primary mt-4 text-sm" onClick={dismissOnboard}>
                Compris
              </button>
            </div>
          )}

          {mode === 'workspace' ? (
            <WorkspaceView onUseInGenerate={useInGenerate} />
          ) : (
            <GenerateView
              initialFile={seedFile}
              onSaved={() => {
                /* files refreshed in provider */
              }}
            />
          )}
        </main>
      </div>
    </div>
  )
}

function SideButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
        active
          ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
          : 'text-[var(--rm-muted)] hover:bg-[var(--rm-secondary)]/60 hover:text-[var(--rm-primary)]'
      }`}
    >
      {children}
    </button>
  )
}
