'use client'

import { useEffect, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import { getReferenceFidelity } from '@/lib/render-prompt'
import type { WorkspaceFileRow } from '@/types/workspace'
import { useDashboard } from './DashboardProvider'

const MAX_ZONES = 3

interface Zone {
  id: string
  x: number
  y: number
  item: CatalogItem | null
}

type Stage = 'pick' | 'placing' | 'catalog' | 'generating' | 'results' | 'error'
type ProgressStep = 'masking' | 'generating' | 'results'

function imgToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

async function urlToB64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load image (${res.status})`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export default function GenerateView({
  initialFile,
  onSaved,
}: {
  initialFile: WorkspaceFileRow | null
  onSaved: () => void
}) {
  const { files, authHeaders, refreshFiles } = useDashboard()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [originalB64, setOriginalB64] = useState('')
  const [originalSrc, setOriginalSrc] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [variations, setVariations] = useState<string[]>([])
  const [savedRows, setSavedRows] = useState<WorkspaceFileRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState<ProgressStep>('masking')
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Préparation…')
  const [catalog, setCatalog] = useState<CatalogItem[]>(MOCK_CATALOG.filter(c => c.available))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchGeneratedCatalog()
      .then(rows => {
        if (cancelled) return
        const fromDb = rows.map(row => {
          const item = furnitureItemToCatalogItem(row)
          return { ...item, available: Boolean(item.imageUrl || item.modelUrl || item.name) }
        })
        const byId = new Map<string, CatalogItem>()
        for (const item of MOCK_CATALOG.filter(c => c.available)) byId.set(item.id, item)
        for (const item of fromDb) byId.set(item.id, item)
        setCatalog([...byId.values()].filter(c => c.available))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!initialFile) return
    void loadFromWorkspace(initialFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile?.id])

  async function loadFromWorkspace(file: WorkspaceFileRow) {
    setError(null)
    try {
      const b64 = await urlToB64(file.public_url)
      setSourceId(file.id)
      setOriginalB64(b64)
      setOriginalSrc(file.public_url)
      setZones([])
      setActiveZoneId(null)
      setVariations([])
      setSavedRows([])
      setStage('placing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger l’image')
      setStage('error')
    }
  }

  async function handleLocalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setSaving(true)
    try {
      const b64 = await imgToB64(file)
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
      const row = data.file as WorkspaceFileRow
      setSourceId(row.id)
      setOriginalB64(b64)
      setOriginalSrc(URL.createObjectURL(file))
      setZones([])
      setVariations([])
      setSavedRows([])
      setStage('placing')
      await refreshFiles()
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setStage('error')
    } finally {
      setSaving(false)
    }
  }

  function handlePhotoClick(e: React.MouseEvent<HTMLImageElement>) {
    if (stage !== 'placing' || zones.length >= MAX_ZONES) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const newZone: Zone = { id: crypto.randomUUID(), x, y, item: null }
    setZones(z => [...z, newZone])
    setActiveZoneId(newZone.id)
    setStage('catalog')
  }

  function pickItemForZone(item: CatalogItem) {
    if (!activeZoneId) return
    setZones(z => z.map(zone => (zone.id === activeZoneId ? { ...zone, item } : zone)))
    setActiveZoneId(null)
    setStage('placing')
  }

  function removeZone(id: string) {
    setZones(z => z.filter(zone => zone.id !== id))
  }

  async function fetchRefB64(url: string | undefined | null): Promise<string | null> {
    if (!url) return null
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) return null
      const blob = await res.blob()
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.onerror = reject
        r.readAsDataURL(blob)
      })
    } catch {
      return null
    }
  }

  async function saveVariation(b64: string, index: number, parentId: string | null) {
    const res = await fetch('/api/dashboard/files', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'generation',
        name: `generation-${index + 1}.jpg`,
        image_base64: b64,
        parent_id: parentId,
        content_type: 'image/jpeg',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail ?? `Save failed (${res.status})`)
    return data.file as WorkspaceFileRow
  }

  async function handleGenerate() {
    const readyZones = zones.filter(z => z.item !== null)
    if (readyZones.length === 0) {
      setError('Ajoutez au moins un meuble avant de générer')
      return
    }

    setStage('generating')
    setError(null)
    setProgressStep('masking')
    setProgressPct(8)
    setProgressDetail('Préparation des masques…')
    setVariations([])
    setSavedRows([])

    try {
      const zonesPayload = await Promise.all(
        readyZones.map(async zone => {
          const item = zone.item!
          const reference_base64 = await fetchRefB64(item.imageUrl)
          const prompt = [item.name, item.style, item.category, item.notes ?? '', item.imageKeyword ?? '']
            .filter(Boolean)
            .join(', ')

          return {
            x: zone.x,
            y: zone.y,
            prompt,
            category: item.category,
            fidelity: getReferenceFidelity(item.category),
            reference_base64,
          }
        }),
      )

      const res = await fetch('/api/compose/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: originalB64,
          zones: zonesPayload,
          num_variations: 3,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Compose error ${res.status}`)
      }
      if (!res.body) throw new Error('Compose stream unavailable')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotVariations: string[] | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let event: {
            type: string
            step?: ProgressStep
            detail?: string
            label?: string
            pct?: number
            variations?: string[]
            failed_count?: number
          }
          try {
            event = JSON.parse(trimmed)
          } catch {
            continue
          }

          if (event.type === 'progress' && event.step) {
            setProgressStep(event.step)
            if (typeof event.pct === 'number') setProgressPct(event.pct)
            setProgressDetail(event.detail ?? event.label ?? '')
          } else if (event.type === 'done' && Array.isArray(event.variations)) {
            gotVariations = event.variations
            setProgressStep('results')
            setProgressPct(100)
            setProgressDetail('Enregistrement dans l’espace de travail…')
          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Compose failed')
          }
        }
      }

      if (!gotVariations?.length) {
        throw new Error('Aucune variation retournée')
      }

      const display = gotVariations.map(b64 => `data:image/jpeg;base64,${b64}`)
      setVariations(display)

      const saved: WorkspaceFileRow[] = []
      for (let i = 0; i < gotVariations.length; i++) {
        const row = await saveVariation(gotVariations[i], i, sourceId)
        saved.push(row)
      }
      setSavedRows(saved)
      await refreshFiles()
      onSaved()
      setStage('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de génération')
      setStage('error')
    }
  }

  function resetPick() {
    setStage('pick')
    setSourceId(null)
    setOriginalB64('')
    setOriginalSrc('')
    setZones([])
    setActiveZoneId(null)
    setVariations([])
    setSavedRows([])
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const readyCount = zones.filter(z => z.item).length
  const uploads = files.filter(f => f.kind === 'upload')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)]">
          Générer
        </h2>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">
          Choisissez une image, épinglez jusqu’à {MAX_ZONES} zones, générez — les résultats sont
          empilés dans l’espace de travail.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {stage === 'pick' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--rm-primary)]/30 bg-[var(--rm-surface)] px-6 py-12 text-center transition hover:border-[var(--rm-primary)]/55">
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--rm-primary)]">
              {saving ? 'Envoi…' : 'Uploader une photo'}
            </span>
            <span className="text-sm text-[var(--rm-muted)]">Enregistrée automatiquement dans le Drive</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={handleLocalUpload}
            />
          </label>

          <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
              Depuis l’espace de travail
            </p>
            {uploads.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--rm-muted)]">Aucun upload pour l’instant.</p>
            ) : (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {uploads.map(f => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => void loadFromWorkspace(f)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--rm-secondary)]/60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.public_url}
                        alt=""
                        className="h-12 w-12 rounded-lg object-cover ring-1 ring-[var(--rm-text)]/8"
                      />
                      <span className="truncate text-sm font-medium">{f.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {(stage === 'placing' ||
        stage === 'catalog' ||
        stage === 'generating' ||
        stage === 'results' ||
        stage === 'error') &&
        originalSrc && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[var(--rm-muted)]">
                {stage === 'placing' &&
                  `Touchez la photo pour épingler (${readyCount}/${MAX_ZONES} prêts)`}
                {stage === 'catalog' && 'Choisissez un meuble pour l’épingle'}
                {stage === 'generating' && progressDetail}
                {stage === 'results' && `${variations.length} variation(s) enregistrée(s)`}
                {stage === 'error' && 'Une erreur est survenue — vous pouvez réessayer'}
              </p>
              <button type="button" className="rm-btn-secondary text-xs" onClick={resetPick}>
                Changer d’image
              </button>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-ink)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalSrc}
                alt="Source"
                className={`mx-auto max-h-[62vh] w-full object-contain ${
                  stage === 'placing' ? 'cursor-crosshair' : ''
                }`}
                onClick={handlePhotoClick}
              />
              {zones.map((zone, i) => (
                <button
                  key={zone.id}
                  type="button"
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%` }}
                  onClick={e => {
                    e.stopPropagation()
                    if (stage === 'placing') removeZone(zone.id)
                  }}
                  title={zone.item?.name ?? `Zone ${i + 1}`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-lg ring-2 ring-white ${
                      zone.item
                        ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                        : 'bg-[var(--rm-accent)] text-[var(--rm-ink)]'
                    }`}
                  >
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>

            {stage === 'catalog' && (
              <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">Catalogue</p>
                  <button
                    type="button"
                    className="text-xs text-[var(--rm-muted)] underline"
                    onClick={() => {
                      if (activeZoneId) removeZone(activeZoneId)
                      setActiveZoneId(null)
                      setStage('placing')
                    }}
                  >
                    Annuler l’épingle
                  </button>
                </div>
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
                  {catalog.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickItemForZone(item)}
                      className="overflow-hidden rounded-xl border border-[var(--rm-text)]/8 text-left transition hover:border-[var(--rm-primary)]/40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="aspect-square w-full object-cover bg-[var(--rm-secondary)]"
                        />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center bg-[var(--rm-secondary)] text-xs text-[var(--rm-muted)]">
                          {item.name.slice(0, 1)}
                        </div>
                      )}
                      <span className="block truncate px-2 py-1.5 text-xs font-medium">{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stage === 'generating' && (
              <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-5">
                <div className="mb-2 flex justify-between text-xs text-[var(--rm-muted)]">
                  <span className="uppercase tracking-wider">{progressStep}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--rm-secondary)]">
                  <div
                    className="h-full rounded-full bg-[var(--rm-primary)] transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {stage === 'placing' && (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="rm-btn-primary"
                  disabled={readyCount === 0}
                  onClick={() => void handleGenerate()}
                >
                  Générer {readyCount > 0 ? `(${readyCount} zone${readyCount > 1 ? 's' : ''})` : ''}
                </button>
                {zones.length > 0 && (
                  <button type="button" className="rm-btn-secondary" onClick={() => setZones([])}>
                    Effacer les épingles
                  </button>
                )}
              </div>
            )}

            {stage === 'results' && variations.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-[var(--rm-primary)]">
                  Historique empilé (enregistré dans le Drive)
                </p>
                <ul className="space-y-4">
                  {variations.map((src, i) => (
                    <li
                      key={savedRows[i]?.id ?? i}
                      className="overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)]"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-[var(--rm-text)]/6 px-4 py-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--rm-accent)]">
                          Génération #{variations.length - i}
                        </span>
                        <a
                          href={savedRows[i]?.public_url ?? src}
                          download={`generation-${i + 1}.jpg`}
                          className="text-xs font-medium text-[var(--rm-primary)] underline"
                        >
                          Télécharger
                        </a>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Variation ${i + 1}`} className="w-full object-contain" />
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="rm-btn-primary"
                  onClick={() => {
                    setZones([])
                    setVariations([])
                    setSavedRows([])
                    setStage('placing')
                  }}
                >
                  Nouvelle génération sur cette image
                </button>
              </div>
            )}

            {stage === 'error' && (
              <button type="button" className="rm-btn-primary" onClick={() => setStage('placing')}>
                Réessayer
              </button>
            )}
          </div>
        )}
    </div>
  )
}
