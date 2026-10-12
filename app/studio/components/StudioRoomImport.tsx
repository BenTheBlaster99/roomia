'use client'

import { useEffect, useRef, useState } from 'react'
import { IMPORT_ACCEPT } from '@/lib/studio-import/formats'
import { importRoomFile } from '@/lib/studio-import/import-room'
import { UNIT_LABELS, type ImportLengthUnit } from '@/lib/studio-import/fit-imported-room'
import { captureHeavyCamera } from '@/lib/studio-import/heavy-view-camera'
import { useStudioStore } from '@/store/useStudioStore'

export default function StudioRoomImport({
  className,
  label = 'Importer SketchUp',
  onImported,
  compact = false,
}: {
  className?: string
  label?: string
  onImported?: () => void
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const importStatus = useStudioStore(s => s.importStatus)

  async function onFile(file: File | undefined) {
    if (!file) return
    setLocalError(null)
    useStudioStore.getState().setImportStatus('loading')
    let result: Awaited<ReturnType<typeof importRoomFile>>
    try {
      result = await importRoomFile(file, { onPhase: setPhase })
    } catch (err) {
      result = {
        ok: false,
        message: `L’import a échoué (${err instanceof Error ? err.message : 'erreur inconnue'}).`,
      }
    }
    setPhase(null)
    if (!result.ok) {
      useStudioStore.getState().setImportStatus('error', result.message)
      setLocalError(result.message)
      return
    }
    useStudioStore.getState().commitImportedRoom(result)
    onImported?.()
  }

  return (
    <div className={compact ? 'contents' : undefined}>
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onFile(file)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={importStatus === 'loading'}
        className={className}
      >
        {importStatus === 'loading' ? (phase ?? 'Import…') : label}
      </button>
      {localError && !compact && (
        <p className="mt-2 text-xs leading-relaxed text-red-600">{localError}</p>
      )}
    </div>
  )
}

export function ImportedRoomBar() {
  const importedRoom = useStudioStore(s => s.importedRoom)
  const importStatus = useStudioStore(s => s.importStatus)
  const importError = useStudioStore(s => s.importError)
  const setImportFit = useStudioStore(s => s.setImportFit)
  const clearImportedRoom = useStudioStore(s => s.clearImportedRoom)
  const [heavyPhase, setHeavyPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [heavySrc, setHeavySrc] = useState<string | null>(null)
  const [heavyError, setHeavyError] = useState<string | null>(null)
  const [heavySeconds, setHeavySeconds] = useState<string | null>(null)
  const heavySrcRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (heavySrcRef.current) URL.revokeObjectURL(heavySrcRef.current)
    }
  }, [])

  async function renderHeavyView() {
    const camera = captureHeavyCamera()
    if (!camera) {
      setHeavyError('La pièce n’est pas prête.')
      setHeavyPhase('error')
      return
    }
    setHeavyPhase('running')
    setHeavyError(null)
    try {
      const res = await fetch('/api/render/heavy-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...camera, sceneId: importedRoom?.sceneId }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new Error(err.detail ?? 'Le rendu du fichier complet a échoué.')
      }
      setHeavySeconds(res.headers.get('X-Render-Seconds'))
      const blob = await res.blob()
      if (heavySrcRef.current) URL.revokeObjectURL(heavySrcRef.current)
      const url = URL.createObjectURL(blob)
      heavySrcRef.current = url
      setHeavySrc(url)
      setHeavyPhase('done')
    } catch (err) {
      setHeavyError(err instanceof Error ? err.message : 'Le rendu du fichier complet a échoué.')
      setHeavyPhase('error')
    }
  }

  if (importStatus === 'loading') {
    return (
      <div className="absolute left-3 top-3 z-20 max-w-sm rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/95 px-3 py-2 text-xs shadow-md backdrop-blur">
        Chargement de la pièce SketchUp…
      </div>
    )
  }

  if (importError && !importedRoom) {
    return (
      <div className="absolute left-3 top-3 z-20 max-w-sm rounded-xl border border-red-200 bg-white/95 px-3 py-2 text-xs text-red-700 shadow-md">
        {importError}
      </div>
    )
  }

  // A prepared scene is managed from the right-hand sidebar instead of this floating card.
  if (!importedRoom || importedRoom.sceneId) return null

  return (
    <div className="absolute left-3 top-3 z-20 max-w-sm rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/95 px-3 py-2.5 text-xs shadow-md backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--rm-text)]">{importedRoom.fileName}</p>
          <p className="mt-0.5 text-[var(--rm-muted)]">
            {importedRoom.format.toUpperCase()} · {importedRoom.triangleCount.toLocaleString('fr-FR')} triangles ·{' '}
            {UNIT_LABELS[importedRoom.resolvedUnit]}
          </p>
        </div>
        <button
          type="button"
          onClick={clearImportedRoom}
          className="shrink-0 text-[var(--rm-muted)] hover:text-red-700"
        >
          Retirer
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[var(--rm-muted)]">
          Unité
          <select
            value={importedRoom.unit}
            onChange={e => setImportFit({ unit: e.target.value as ImportLengthUnit })}
            className="rounded-md border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-1.5 py-0.5 text-[var(--rm-text)]"
          >
            {(Object.keys(UNIT_LABELS) as ImportLengthUnit[]).map(key => (
              <option key={key} value={key}>
                {UNIT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[var(--rm-muted)]">
          <input
            type="checkbox"
            checked={importedRoom.zUp}
            onChange={e => setImportFit({ zUp: e.target.checked })}
          />
          Z-up (SketchUp)
        </label>
      </div>

      {importedRoom.warning && (
        <p className="mt-2 leading-relaxed text-amber-800">{importedRoom.warning}</p>
      )}

      {importedRoom.sceneId && (
      <button
        type="button"
        onClick={() => void renderHeavyView()}
        disabled={heavyPhase === 'running'}
        className="mt-2 w-full rounded-md bg-[var(--rm-text)] px-2 py-1.5 text-left font-semibold text-[var(--rm-bg)] disabled:opacity-60"
      >
        {heavyPhase === 'running' ? 'Rendu du fichier complet…' : 'Cette vue, fichier complet'}
      </button>
      )}
      {heavySeconds && heavyPhase === 'done' && (
        <p className="mt-1.5 text-[var(--rm-muted)]">Rendu en {heavySeconds} s</p>
      )}
      {heavyError && <p className="mt-1.5 leading-relaxed text-red-700">{heavyError}</p>}
      {heavySrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={heavySrc} alt="Vue du fichier complet" className="mt-2 w-full rounded-md" />
      )}
    </div>
  )
}
