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
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            Drive
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--rm-primary)]">
            Espace de travail
          </h2>
          <p className="mt-2 max-w-lg text-sm text-[var(--rm-muted)]">
            Photos sources et looks empilés dessous — rien ne disparaît.
          </p>
        </div>
        <label className="rm-btn-primary cursor-pointer text-sm">
          {uploading ? 'Envoi…' : 'Uploader'}
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
        <div className="rounded-[1.75rem] border border-dashed border-[var(--rm-primary)]/25 bg-[var(--rm-surface)]/80 px-6 py-20 text-center">
          <p className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--rm-primary)]">
            Votre Drive est vide
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--rm-muted)]">
            Uploadez une photo de pièce. Les trois restyles s’empilent ici, sous l’original — plus de
            fichiers perdus dans WhatsApp.
          </p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {stacks.map(({ parent, children }) => (
            <li
              key={parent.id}
              className="overflow-hidden rounded-[1.5rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] shadow-[0_20px_56px_-36px_rgba(20,32,28,0.5)]"
            >
              <button type="button" className="block w-full text-left" onClick={() => setPreview(parent)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={parent.public_url}
                  alt=""
                  className="aspect-[4/3] w-full object-cover bg-[var(--rm-secondary)]"
                />
              </button>
              <div className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{parent.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--rm-muted)]">
                    {parent.kind === 'generation' ? 'Génération' : 'Original'} · {formatWhen(parent.created_at)}
                    {children.length > 0 ? ` · ${children.length} look${children.length > 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="rm-btn-primary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => onUseInGenerate(parent)}
                >
                  Restyler
                </button>
              </div>
              {children.length > 0 && (
                <ul className="grid grid-cols-3 gap-1 border-t border-[var(--rm-text)]/6 bg-[var(--rm-bg)]/50 p-2">
                  {children.map((child, i) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        onClick={() => setPreview(child)}
                        className="relative block w-full overflow-hidden rounded-lg"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={child.public_url}
                          alt=""
                          className="aspect-square w-full object-cover"
                        />
                        <span className="absolute left-1.5 top-1.5 rounded bg-[var(--rm-ink)]/75 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                          #{children.length - i}
                        </span>
                      </button>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--rm-ink)]/75 p-4 backdrop-blur-sm"
          onClick={() => setPreview(null)}
          role="presentation"
        >
          <div
            className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[1.5rem] bg-[var(--rm-surface)] shadow-2xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.public_url}
              alt={preview.name}
              className="max-h-[78vh] w-full object-contain"
            />
            <div className="flex items-center justify-between gap-3 border-t border-[var(--rm-text)]/8 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{preview.name}</p>
                <p className="text-xs text-[var(--rm-muted)]">{formatWhen(preview.created_at)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rm-btn-primary text-sm"
                  onClick={() => {
                    onUseInGenerate(preview)
                    setPreview(null)
                  }}
                >
                  Restyler
                </button>
                <button type="button" className="rm-btn-secondary text-sm" onClick={() => setPreview(null)}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
