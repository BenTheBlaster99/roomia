'use client'

import type { WorkspaceFileRow } from '@/types/workspace'
import { useDashboard } from './DashboardProvider'

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-DZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export default function OverviewView({
  onOpenWorkspace,
  onGenerate,
  onUseFile,
}: {
  onOpenWorkspace: () => void
  onGenerate: () => void
  onUseFile: (file: WorkspaceFileRow) => void
}) {
  const { files, filesLoading, user } = useDashboard()
  const uploads = files.filter(f => f.kind === 'upload')
  const generations = files.filter(f => f.kind === 'generation')
  const recent = files.slice(0, 8)
  const last = files[0]

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
          Tableau de bord
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-ink)]">
          Bonjour{user?.email ? `, ${user.email.split('@')[0]}` : ''}
        </h1>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">
          Photos, générations et historique — comme un Drive, prêt à restyler une pièce.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Uploads" value={filesLoading ? '—' : String(uploads.length)} />
        <StatCard label="Générations" value={filesLoading ? '—' : String(generations.length)} />
        <StatCard
          label="Dernière activité"
          value={last ? formatWhen(last.created_at) : 'Aucune'}
          compact
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="rm-btn-primary" onClick={onGenerate}>
          Nouvelle génération
        </button>
        <button type="button" className="rm-btn-secondary" onClick={onOpenWorkspace}>
          Ouvrir l’espace de travail
        </button>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--rm-ink)]">Récents</h2>
          {files.length > 0 && (
            <button
              type="button"
              className="text-xs font-semibold text-[var(--rm-primary)]"
              onClick={onOpenWorkspace}
            >
              Tout voir
            </button>
          )}
        </div>
        {filesLoading && files.length === 0 ? (
          <p className="text-sm text-[var(--rm-muted)]">Chargement…</p>
        ) : recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--rm-primary)]/25 bg-white px-6 py-12 text-center">
            <p className="font-semibold text-[var(--rm-primary)]">Rien ici pour l’instant</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--rm-muted)]">
              Uploadez une photo, choisissez un meuble ou une couleur de mur, puis générez.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {recent.map(file => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onUseFile(file)}
                  className="group w-full overflow-hidden rounded-xl border border-[var(--rm-text)]/8 bg-white text-left shadow-[0_8px_24px_-20px_rgba(20,32,28,0.5)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file.public_url}
                    alt=""
                    className="aspect-[4/3] w-full object-cover transition group-hover:opacity-90"
                  />
                  <span className="block truncate px-2.5 py-2 text-xs font-medium">{file.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  compact,
}: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--rm-muted)]">
        {label}
      </p>
      <p
        className={`mt-2 font-[family-name:var(--font-display)] font-bold text-[var(--rm-ink)] ${
          compact ? 'text-sm leading-snug' : 'text-3xl'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
