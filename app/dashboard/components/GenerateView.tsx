'use client'

import { useEffect, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import { getReferenceFidelity } from '@/lib/render-prompt'
import {
  suggestFurniturePlacement,
  suggestLightPlacement,
  suggestWallPlacement,
} from '@/lib/placement-hints'
import {
  COMPOSER_LIGHTS,
  COMPOSER_WALLS,
  lightById,
  wallById,
  type ComposerLightId,
} from '@/lib/composer-restyle'
import type { WorkspaceFileRow } from '@/types/workspace'
import { useDashboard } from './DashboardProvider'

const MAX_ZONES = 3
const CATALOG_TABS = ['Tous', 'Sofa', 'Chair', 'Light', 'Tables', 'Rug'] as const
type CatalogTab = (typeof CATALOG_TABS)[number]

interface Zone {
  id: string
  x: number
  y: number
  item: CatalogItem
  autoPlace: boolean
}

type Stage = 'pick' | 'ready' | 'generating' | 'results' | 'error'
type ProgressStep = 'masking' | 'generating' | 'results'
type WallPin = { id: string; hex: string; label: string; prompt: string; x: number; y: number; autoPlace: boolean }
type LightPin = {
  id: ComposerLightId
  label: string
  prompt: string
  x: number
  y: number
  autoPlace: boolean
}

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

function matchesCatalogTab(item: CatalogItem, tab: CatalogTab) {
  if (tab === 'Tous') return true
  if (tab === 'Tables') {
    return ['Coffee Table', 'Dining Table', 'Side Table', 'TV Unit'].includes(item.category)
  }
  return item.category === tab
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
  const [pendingItem, setPendingItem] = useState<CatalogItem | null>(null)
  const [pendingWallId, setPendingWallId] = useState<string | null>(null)
  const [pendingLightId, setPendingLightId] = useState<ComposerLightId | null>(null)
  const [wallPin, setWallPin] = useState<WallPin | null>(null)
  const [lightPin, setLightPin] = useState<LightPin | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [variationCount, setVariationCount] = useState<1 | 2 | 3>(1)
  const [selectedResult, setSelectedResult] = useState(0)
  const [variations, setVariations] = useState<string[]>([])
  const [savedRows, setSavedRows] = useState<WorkspaceFileRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState<ProgressStep>('masking')
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Préparation…')
  const [catalog, setCatalog] = useState<CatalogItem[]>(MOCK_CATALOG.filter(c => c.available))
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('Tous')
  const [saving, setSaving] = useState(false)

  const placing = Boolean(pendingItem || pendingWallId || pendingLightId)

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

  function resetPlacementUi() {
    setZones([])
    setPendingItem(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setWallPin(null)
    setLightPin(null)
    setCursor(null)
    setVariations([])
    setSavedRows([])
    setSelectedResult(0)
  }

  async function loadFromWorkspace(file: WorkspaceFileRow) {
    setError(null)
    try {
      const b64 = await urlToB64(file.public_url)
      setSourceId(file.id)
      setOriginalB64(b64)
      setOriginalSrc(file.public_url)
      resetPlacementUi()
      setStage('ready')
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
      resetPlacementUi()
      setStage('ready')
      await refreshFiles()
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setStage('error')
    } finally {
      setSaving(false)
    }
  }

  function pointerOnPhoto(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
  }

  function handlePhotoMove(e: React.MouseEvent<HTMLImageElement>) {
    if (!placing || stage !== 'ready') return
    setCursor(pointerOnPhoto(e))
  }

  function handlePhotoClick(e: React.MouseEvent<HTMLImageElement>) {
    if (stage !== 'ready' || !placing) return
    const { x, y } = pointerOnPhoto(e)

    if (pendingWallId) {
      const wall = wallById(pendingWallId)
      if (!wall) return
      setWallPin({ ...wall, x, y, autoPlace: false })
      setPendingWallId(null)
      setCursor(null)
      return
    }

    if (pendingLightId) {
      const light = lightById(pendingLightId)
      if (!light) return
      setLightPin({ id: light.id, label: light.label, prompt: light.prompt, x, y, autoPlace: false })
      setPendingLightId(null)
      setCursor(null)
      return
    }

    if (pendingItem && zones.length < MAX_ZONES) {
      setZones(z => [...z, { id: crypto.randomUUID(), x, y, item: pendingItem, autoPlace: false }])
      setPendingItem(null)
      setCursor(null)
    }
  }

  function selectFurniture(item: CatalogItem) {
    if (zones.length >= MAX_ZONES) return
    setPendingItem(item)
    setPendingWallId(null)
    setPendingLightId(null)
  }

  function autoPlaceFurniture(item: CatalogItem) {
    if (zones.length >= MAX_ZONES) return
    const point = suggestFurniturePlacement(item.category)
    setZones(z => [...z, { id: crypto.randomUUID(), ...point, item, autoPlace: true }])
    setPendingItem(null)
    setCursor(null)
  }

  function autoPlaceWall(id: string) {
    const wall = wallById(id)
    if (!wall) return
    setWallPin({ ...wall, ...suggestWallPlacement(), autoPlace: true })
    setPendingWallId(null)
    setCursor(null)
  }

  function autoPlaceLight(id: ComposerLightId) {
    const light = lightById(id)
    if (!light) return
    const point = suggestLightPlacement(light.id)
    setLightPin({ id: light.id, label: light.label, prompt: light.prompt, ...point, autoPlace: true })
    setPendingLightId(null)
    setCursor(null)
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
    if (zones.length === 0 && !wallPin && !lightPin) {
      setError('Choisissez un meuble, une couleur de mur, ou une lumière')
      return
    }

    setStage('generating')
    setError(null)
    setProgressStep('masking')
    setProgressPct(8)
    setProgressDetail('Préparation des masques…')
    setVariations([])
    setSavedRows([])
    setSelectedResult(0)

    try {
      const zonesPayload = await Promise.all(
        zones.map(async zone => {
          const item = zone.item
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
            auto_place: zone.autoPlace,
          }
        }),
      )

      const res = await fetch('/api/compose/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: originalB64,
          zones: zonesPayload,
          atmosphere: {
            wall: wallPin ? { prompt: wallPin.prompt, x: wallPin.x, y: wallPin.y } : null,
            lighting: lightPin
              ? { prompt: lightPin.prompt, kind: lightPin.id, x: lightPin.x, y: lightPin.y }
              : null,
          },
          num_variations: variationCount,
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
    resetPlacementUi()
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const canGenerate = zones.length > 0 || Boolean(wallPin) || Boolean(lightPin)
  const uploads = files.filter(f => f.kind === 'upload')
  const visibleCatalog = catalog.filter(item => matchesCatalogTab(item, catalogTab))

  const hint = (() => {
    if (stage === 'generating') return progressDetail
    if (stage === 'results') return `${variations.length} résultat(s) — swipez ou cliquez`
    if (stage === 'error') return 'Une erreur est survenue — vous pouvez réessayer'
    if (pendingItem) return `Placez « ${pendingItem.name} » sur la photo, ou laissez l’IA choisir`
    if (pendingWallId) return 'Touchez un mur, ou placez automatiquement'
    if (pendingLightId) return 'Touchez l’endroit de la lumière, ou placez automatiquement'
    return 'Choisissez d’abord un meuble ou une couleur — puis posez-le sur la photo'
  })()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-ink)]">
          Générer
        </h2>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">
          Meuble d’abord, puis emplacement. Ou laissez l’IA poser au meilleur endroit.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {stage === 'pick' && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--rm-primary)]/30 bg-white px-6 py-12 text-center transition hover:border-[var(--rm-primary)]/55">
            <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--rm-primary)]">
              {saving ? 'Envoi…' : 'Uploader une photo'}
            </span>
            <span className="text-sm text-[var(--rm-muted)]">Enregistrée dans l’espace de travail</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={handleLocalUpload}
            />
          </label>

          <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
              Depuis le Drive
            </p>
            {uploads.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--rm-muted)]">Aucun upload pour l’instant.</p>
            ) : (
              <ul className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {uploads.map(f => (
                  <li key={f.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => void loadFromWorkspace(f)}
                      className="w-24 text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={f.public_url}
                        alt=""
                        className="h-20 w-24 rounded-lg object-cover ring-1 ring-[var(--rm-text)]/8"
                      />
                      <span className="mt-1 block truncate text-[11px] font-medium">{f.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {(stage === 'ready' || stage === 'generating' || stage === 'results' || stage === 'error') &&
        originalSrc && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(17rem,0.85fr)]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--rm-muted)]">{hint}</p>
                <button type="button" className="rm-btn-secondary text-xs" onClick={resetPick}>
                  Changer d’image
                </button>
              </div>

              <div
                className={`relative overflow-hidden rounded-2xl bg-[var(--rm-ink)] ${
                  placing && stage === 'ready'
                    ? 'ring-2 ring-[#3B82F6] ring-offset-2 ring-offset-[#edf3ef]'
                    : 'border border-[var(--rm-text)]/8'
                }`}
              >
                <div className="relative mx-auto inline-block w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={originalSrc}
                    alt="Source"
                    className={`mx-auto max-h-[56vh] w-full object-contain ${
                      placing && stage === 'ready' ? 'cursor-none' : ''
                    }`}
                    onClick={handlePhotoClick}
                    onMouseMove={handlePhotoMove}
                    onMouseLeave={() => setCursor(null)}
                  />

                  {placing && stage === 'ready' && cursor && (
                    <div
                      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
                    >
                      <GhostChip
                        imageUrl={pendingItem?.imageUrl}
                        hex={pendingWallId ? wallById(pendingWallId)?.hex : undefined}
                        label={
                          pendingItem?.name ??
                          (pendingWallId ? wallById(pendingWallId)?.label : undefined) ??
                          (pendingLightId ? lightById(pendingLightId)?.label : undefined) ??
                          '…'
                        }
                      />
                    </div>
                  )}

                  {zones.map((zone, i) => (
                    <button
                      key={zone.id}
                      type="button"
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%` }}
                      onClick={e => {
                        e.stopPropagation()
                        if (stage === 'ready') removeZone(zone.id)
                      }}
                      title={zone.autoPlace ? `${zone.item.name} · auto` : zone.item.name}
                    >
                      <span className="flex h-9 w-9 overflow-hidden rounded-full bg-white shadow-lg ring-2 ring-[#3B82F6]">
                        {zone.item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={zone.item.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[10px] font-bold">
                            {i + 1}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}

                  {wallPin && (
                    <button
                      type="button"
                      className="absolute z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
                      style={{
                        left: `${wallPin.x * 100}%`,
                        top: `${wallPin.y * 100}%`,
                        background: wallPin.hex,
                      }}
                      title={wallPin.label}
                      onClick={e => {
                        e.stopPropagation()
                        if (stage === 'ready') setWallPin(null)
                      }}
                    />
                  )}

                  {lightPin && (
                    <button
                      type="button"
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 px-2 py-1 text-[10px] font-bold shadow ring-2 ring-white"
                      style={{ left: `${lightPin.x * 100}%`, top: `${lightPin.y * 100}%` }}
                      title={lightPin.label}
                      onClick={e => {
                        e.stopPropagation()
                        if (stage === 'ready') setLightPin(null)
                      }}
                    >
                      ✦
                    </button>
                  )}
                </div>
              </div>

              {stage === 'generating' && (
                <div className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-5">
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

              {stage === 'results' && variations.length > 0 && (
                <div className="space-y-3">
                  <div className="overflow-hidden rounded-2xl border border-[var(--rm-text)]/8 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={variations[selectedResult]}
                      alt={`Résultat ${selectedResult + 1}`}
                      className="max-h-[48vh] w-full object-contain"
                    />
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--rm-accent)]">
                        Résultat {selectedResult + 1}/{variations.length}
                      </span>
                      <a
                        href={savedRows[selectedResult]?.public_url ?? variations[selectedResult]}
                        download={`generation-${selectedResult + 1}.jpg`}
                        className="text-xs font-medium text-[var(--rm-primary)] underline"
                      >
                        Télécharger
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {variations.map((src, i) => (
                      <button
                        key={savedRows[i]?.id ?? i}
                        type="button"
                        onClick={() => setSelectedResult(i)}
                        className={`h-20 w-28 shrink-0 overflow-hidden rounded-xl ring-2 ${
                          selectedResult === i ? 'ring-[var(--rm-primary)]' : 'ring-transparent'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="rm-btn-primary"
                    onClick={() => {
                      setVariations([])
                      setSavedRows([])
                      setStage('ready')
                    }}
                  >
                    Nouvelle génération sur cette image
                  </button>
                </div>
              )}

              {stage === 'error' && (
                <button type="button" className="rm-btn-primary" onClick={() => setStage('ready')}>
                  Réessayer
                </button>
              )}
            </div>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-4">
                <p className="text-sm font-bold">1. Peindre les murs</p>
                <p className="mt-1 text-xs text-[var(--rm-muted)]">
                  Choisissez la couleur, puis touchez un mur — ou laissez l’IA.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {COMPOSER_WALLS.map(wall => {
                    const active = (wallPin?.id ?? pendingWallId) === wall.id
                    return (
                      <button
                        key={wall.id}
                        type="button"
                        title={wall.label}
                        aria-label={wall.label}
                        onClick={() => {
                          setPendingWallId(wall.id)
                          setPendingItem(null)
                          setPendingLightId(null)
                        }}
                        className={`h-7 w-7 rounded-full ring-2 ${
                          active ? 'ring-[var(--rm-primary)]' : 'ring-[var(--rm-text)]/15'
                        }`}
                        style={{ background: wall.hex }}
                      />
                    )
                  })}
                </div>
                {pendingWallId && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rm-btn-secondary px-3 py-1.5 text-xs"
                      onClick={() => autoPlaceWall(pendingWallId)}
                    >
                      Meilleur endroit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[var(--rm-muted)] underline"
                      onClick={() => setPendingWallId(null)}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold">2. Ajouter un meuble</p>
                  <span className="text-[11px] text-[var(--rm-muted)]">
                    {zones.length}/{MAX_ZONES}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--rm-muted)]">
                  Sélectionnez, le curseur devient le meuble. Cliquez la photo, ou auto.
                </p>
                <div className="mt-3 flex gap-1 overflow-x-auto">
                  {CATALOG_TABS.map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setCatalogTab(tab)}
                      className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${
                        catalogTab === tab
                          ? 'bg-[var(--rm-primary)] text-white'
                          : 'bg-[var(--rm-secondary)] text-[var(--rm-muted)]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto">
                  {visibleCatalog.map(item => {
                    const selected = pendingItem?.id === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectFurniture(item)}
                        className={`overflow-hidden rounded-xl text-left ring-2 ${
                          selected ? 'ring-[#3B82F6]' : 'ring-transparent hover:ring-[var(--rm-primary)]/30'
                        }`}
                      >
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="aspect-square w-full bg-[var(--rm-secondary)] object-cover"
                          />
                        ) : (
                          <div className="flex aspect-square items-center justify-center bg-[var(--rm-secondary)] text-xs">
                            {item.name.slice(0, 1)}
                          </div>
                        )}
                        <span className="block truncate px-1 py-1 text-[10px] font-medium">{item.name}</span>
                      </button>
                    )
                  })}
                </div>
                {pendingItem && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rm-btn-secondary px-3 py-1.5 text-xs"
                      onClick={() => autoPlaceFurniture(pendingItem)}
                    >
                      Meilleur endroit
                    </button>
                    <button
                      type="button"
                      className="text-xs text-[var(--rm-muted)] underline"
                      onClick={() => {
                        setPendingItem(null)
                        setCursor(null)
                      }}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-4">
                <p className="text-sm font-bold">Lumière (optionnel)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COMPOSER_LIGHTS.map(light => {
                    const active = (lightPin?.id ?? pendingLightId) === light.id
                    return (
                      <button
                        key={light.id}
                        type="button"
                        onClick={() => {
                          setPendingLightId(light.id)
                          setPendingItem(null)
                          setPendingWallId(null)
                        }}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                          active
                            ? 'bg-[var(--rm-primary)] text-white'
                            : 'bg-[var(--rm-secondary)] text-[var(--rm-text)]'
                        }`}
                      >
                        {light.label}
                      </button>
                    )
                  })}
                </div>
                {pendingLightId && (
                  <button
                    type="button"
                    className="rm-btn-secondary mt-3 px-3 py-1.5 text-xs"
                    onClick={() => autoPlaceLight(pendingLightId)}
                  >
                    Meilleur endroit
                  </button>
                )}
              </section>

              {stage === 'ready' && (
                <section className="rounded-2xl border border-[var(--rm-text)]/8 bg-white p-4">
                  <p className="text-sm font-bold">Combien de résultats ?</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {([1, 2, 3] as const).map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setVariationCount(n)}
                        className={`rounded-xl py-2 text-sm font-bold ${
                          variationCount === n
                            ? 'bg-[var(--rm-primary)] text-white'
                            : 'bg-[var(--rm-secondary)] text-[var(--rm-text)]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="rm-btn-primary mt-4 w-full"
                    disabled={!canGenerate}
                    onClick={() => void handleGenerate()}
                  >
                    Générer {variationCount} résultat{variationCount > 1 ? 's' : ''}
                  </button>
                  {(zones.length > 0 || wallPin || lightPin) && (
                    <button
                      type="button"
                      className="mt-2 w-full text-xs text-[var(--rm-muted)] underline"
                      onClick={() => {
                        setZones([])
                        setWallPin(null)
                        setLightPin(null)
                      }}
                    >
                      Tout effacer
                    </button>
                  )}
                </section>
              )}
            </aside>
          </div>
        )}
    </div>
  )
}

function GhostChip({
  imageUrl,
  hex,
  label,
}: {
  imageUrl?: string | null
  hex?: string
  label: string
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white/95 px-1.5 py-1 shadow-lg ring-2 ring-[#3B82F6]">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <span
          className="h-8 w-8 rounded-full ring-1 ring-black/10"
          style={{ background: hex ?? '#1f4d3d' }}
        />
      )}
      <span className="max-w-[7rem] truncate pr-2 text-[11px] font-semibold">{label}</span>
    </div>
  )
}
