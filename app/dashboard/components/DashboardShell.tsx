'use client'

import { useState } from 'react'
import type { WorkspaceFileRow } from '@/types/workspace'
import { useDashboard } from './DashboardProvider'
import OverviewView from './OverviewView'
import WorkspaceView from './WorkspaceView'
import GenerateView from './GenerateView'

type Mode = 'home' | 'workspace' | 'generate'

export default function DashboardShell() {
  const { user, signOut } = useDashboard()
  const [mode, setMode] = useState<Mode>('home')
  const [seedFile, setSeedFile] = useState<WorkspaceFileRow | null>(null)

  function useInGenerate(file: WorkspaceFileRow) {
    setSeedFile(file)
    setMode('generate')
  }

  function openGenerate() {
    setSeedFile(null)
    setMode('generate')
  }

  return (
    <div className="flex min-h-screen bg-[#edf3ef] text-[var(--rm-text)]">
      <aside className="hidden w-60 shrink-0 flex-col bg-[var(--rm-primary)] text-[var(--rm-surface)] md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <a href="/" className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
            roomia
          </a>
          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Pro
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <SideButton active={mode === 'home'} onClick={() => setMode('home')}>
            Tableau de bord
          </SideButton>
          <SideButton active={mode === 'workspace'} onClick={() => setMode('workspace')}>
            Espace de travail
          </SideButton>
          <SideButton active={mode === 'generate'} onClick={openGenerate}>
            Générer
          </SideButton>
          <a
            href="/room-composer"
            className="mt-3 block rounded-lg px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Compositeur public →
          </a>
          <a
            href="/admin"
            className="block rounded-lg px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Staff magasins
          </a>
        </nav>
        <div className="border-t border-white/10 px-4 py-4">
          <p className="truncate text-xs text-white/70">{user?.email}</p>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-white/85 underline-offset-2 hover:underline"
            onClick={() => void signOut()}
          >
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--rm-text)]/8 bg-white/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <a
              href="/"
              className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--rm-primary)]"
            >
              roomia
            </a>
            <span className="rounded bg-[var(--rm-accent)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--rm-accent)]">
              Pro
            </span>
          </div>
          <p className="hidden text-sm font-medium text-[var(--rm-muted)] md:block">
            {mode === 'home' && 'Aperçu'}
            {mode === 'workspace' && 'Fichiers'}
            {mode === 'generate' && 'Restyle'}
          </p>
          <button
            type="button"
            className="rm-btn-secondary px-3 py-1.5 text-xs md:hidden"
            onClick={() => void signOut()}
          >
            Déconnexion
          </button>
        </header>

        <div className="flex gap-2 border-b border-[var(--rm-text)]/8 bg-white px-4 py-2 md:hidden">
          <MobileTab active={mode === 'home'} onClick={() => setMode('home')}>
            Aperçu
          </MobileTab>
          <MobileTab active={mode === 'workspace'} onClick={() => setMode('workspace')}>
            Drive
          </MobileTab>
          <MobileTab active={mode === 'generate'} onClick={openGenerate}>
            Générer
          </MobileTab>
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="w-full">
            {mode === 'home' && (
              <OverviewView
                onOpenWorkspace={() => setMode('workspace')}
                onGenerate={openGenerate}
                onUseFile={useInGenerate}
              />
            )}
            {mode === 'workspace' && <WorkspaceView onUseInGenerate={useInGenerate} />}
            {mode === 'generate' && (
              <GenerateView
                initialFile={seedFile}
                onSaved={() => {
                  /* files refreshed in provider */
                }}
              />
            )}
          </div>
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
      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
        active ? 'bg-white text-[var(--rm-primary)]' : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function MobileTab({
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
      className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${
        active
          ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
          : 'bg-[var(--rm-secondary)]/70 text-[var(--rm-muted)]'
      }`}
    >
      {children}
    </button>
  )
}
