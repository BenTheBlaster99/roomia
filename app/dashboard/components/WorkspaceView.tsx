'use client'

import { useMemo, useState } from 'react'
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

type StackGroup = {
  parent: WorkspaceFileRow
  children: WorkspaceFileRow[]
}

export default function WorkspaceView({
  onUseInGenerate,
}: {
  onUseInGenerate: (file: WorkspaceFileRow) => void
}) {
  const { files, filesLoading, refreshFiles, authHeaders } = useDashboard()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WorkspaceFileRow | null>(null)

  const stacks = useMemo(() => {
    const byId = new Map(files.map(f => [f.id, f]))
    const childrenByParent = new Map<string, WorkspaceFileRow[]>()
    const childIds = new Set<string>()

    for (const f of files) {
      if (f.parent_id && byId.has(f.parent_id)) {
        childIds.add(f.id)
        const list = childrenByParent.get(f.parent_id) ?? []
        list.push(f)
        childrenByParent.set(f.parent_id, list)
      }
    }

    for (const list of childrenByParent.values()) {
      list.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    }

    const roots = files.filter(f => !childIds.has(f.id))
    const groups: StackGroup[] = roots.map(parent => ({
      parent,
      children: childrenByParent.get(parent.id) ?? [],
    }))

    return groups
  }, [files])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'upload')
      const res = await fetch('/api/dashboard/files', {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail ?? `Upload failed (${res.status})`)
      await refreshFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)]">
            Espace de travail
          </h2>
          <p className="mt-1 text-sm text-[var(--rm-muted)]">
            Uploads et générations empilées — comme un Drive, trié du plus récent.
          </p>
        </div>
        <label className="rm-btn-primary cursor-pointer text-sm">
          {uploading ? 'Envoi…' : 'Uploader une image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={handleUpload}
          />
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {filesLoading && files.length === 0 ? (
        <p className="text-sm text-[var(--rm-muted)]">Chargement des fichiers…</p>
      ) : stacks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--rm-primary)]/25 bg-[var(--rm-surface)]/70 px-6 py-14 text-center">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--rm-primary)]">
            Votre Drive est vide
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--rm-muted)]">
            Uploadez une photo de pièce, puis passez en mode Générer pour épingler et produire des
            variations — elles apparaîtront empilées ici.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {stacks.map(({ parent, children }) => (
            <li
              key={parent.id}
              className="overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] shadow-[0_12px_40px_-28px_rgba(20,32,28,0.45)]"
            >
              <FileRow
                file={parent}
                onPreview={() => setPreview(parent)}
                onUse={() => onUseInGenerate(parent)}
              />
              {children.length > 0 && (
                <ul className="border-t border-[var(--rm-text)]/6 bg-[var(--rm-bg)]/40">
                  {children.map((child, i) => (
                    <li
                      key={child.id}
                      className="border-t border-[var(--rm-text)]/5 first:border-t-0"
                      style={{ paddingLeft: '1.25rem' }}
                    >
                      <FileRow
                        file={child}
                        stacked
                        stackIndex={children.length - i}
                        onPreview={() => setPreview(child)}
                        onUse={() => onUseInGenerate(child)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--rm-ink)]/70 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="presentation"
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-[var(--rm-surface)] shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.public_url}
              alt={preview.name}
              className="max-h-[80vh] w-full object-contain"
            />
            <div className="flex items-center justify-between gap-3 border-t border-[var(--rm-text)]/8 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{preview.name}</p>
                <p className="text-xs text-[var(--rm-muted)]">{formatWhen(preview.created_at)}</p>
              </div>
              <button type="button" className="rm-btn-secondary text-sm" onClick={() => setPreview(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  stacked,
  stackIndex,
  onPreview,
  onUse,
}: {
  file: WorkspaceFileRow
  stacked?: boolean
  stackIndex?: number
  onPreview: () => void
  onUse: () => void
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${stacked ? 'bg-transparent' : ''}`}>
      <button
        type="button"
        onClick={onPreview}
        className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--rm-secondary)] ring-1 ring-[var(--rm-text)]/8"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.public_url} alt="" className="h-full w-full object-cover" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-[var(--rm-text)]">{file.name}</p>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              file.kind === 'generation'
                ? 'bg-[var(--rm-accent)]/15 text-[var(--rm-accent)]'
                : 'bg-[var(--rm-primary)]/10 text-[var(--rm-primary)]'
            }`}
          >
            {file.kind === 'generation'
              ? stacked && stackIndex
                ? `Génération · #${stackIndex}`
                : 'Génération'
              : 'Upload'}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--rm-muted)]">{formatWhen(file.created_at)}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="rm-btn-secondary px-3 py-1.5 text-xs" onClick={onPreview}>
          Voir
        </button>
        <button type="button" className="rm-btn-primary px-3 py-1.5 text-xs" onClick={onUse}>
          Générer
        </button>
      </div>
    </div>
  )
}
