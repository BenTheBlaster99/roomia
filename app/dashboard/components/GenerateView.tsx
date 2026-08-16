'use client'

import { useEffect, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import { getReferenceFidelity } from '@/lib/render-prompt'
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

interface Zone {
  id: string
  x: number
  y: number
  item: CatalogItem | null
}

type Stage = 'pick' | 'placing' | 'catalog' | 'generating' | 'results' | 'error'
type ClickMode = 'furniture' | 'wall' | 'light'
type ProgressStep = 'masking' | 'generating' | 'results'
type WallPin = { id: string; hex: string; label: string; prompt: string; x: number; y: number }
type LightPin = {
  id: ComposerLightId
  label: string
  prompt: string
  x: number
  y: number
}

const CATALOG_TABS = ['All', 'Sofa', 'Chair', 'Light', 'Tables', 'Rug'] as const
type CatalogTab = (typeof CATALOG_TABS)[number]

function matchesCatalogTab(item: CatalogItem, tab: CatalogTab) {
  if (tab === 'All') return true
  if (tab === 'Tables') {
    return ['Coffee Table', 'Dining Table', 'Side Table', 'TV Unit'].includes(item.category)
  }
  return item.category === tab
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
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('All')
  const [saving, setSaving] = useState(false)
  const [clickMode, setClickMode] = useState<ClickMode>('furniture')
  const [wallPin, setWallPin] = useState<WallPin | null>(null)
  const [lightPin, setLightPin] = useState<LightPin | null>(null)
  const [pendingWallId, setPendingWallId] = useState<string | null>(null)
  const [pendingLightId, setPendingLightId] = useState<ComposerLightId | null>(null)

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

  function clearRestyle() {
    setWallPin(null)
    setLightPin(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    setCatalogTab('All')
  }

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
      clearRestyle()
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
      clearRestyle()
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
    if (stage !== 'placing') return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    if (clickMode === 'wall' && pendingWallId) {
      const wall = wallById(pendingWallId)
      if (!wall) return
      setWallPin({ id: wall.id, hex: wall.hex, label: wall.label, prompt: wall.prompt, x, y })
      setClickMode('furniture')
      return
    }

    if (clickMode === 'light' && pendingLightId) {
      const light = lightById(pendingLightId)
      if (!light) return
      setLightPin({ id: light.id, label: light.label, prompt: light.prompt, x, y })
      setClickMode('furniture')
      return
    }

    if (zones.length >= MAX_ZONES) return
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
    if (readyZones.length === 0 && !wallPin && !lightPin) {
      setError('Peignez un mur, ajoutez une lumière, ou épinglez un meuble')
      return
    }

    setStage('generating')
    setError(null)
    setProgressStep('masking')
    setProgressPct(8)
    setProgressDetail('Lecture des murs, lumières et meubles…')
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
          atmosphere: {
            wall: wallPin ? { prompt: wallPin.prompt, x: wallPin.x, y: wallPin.y } : null,
            lighting: lightPin
              ? {
                  prompt: lightPin.prompt,
                  kind: lightPin.id,
                  x: lightPin.x,
                  y: lightPin.y,
                }
              : null,
          },
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
    clearRestyle()
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const readyCount = zones.filter(z => z.item).length
  const canGenerate = readyCount > 0 || Boolean(wallPin) || Boolean(lightPin)
  const uploads = files.filter(f => f.kind === 'upload')
  const filteredCatalog = catalog.filter(item => matchesCatalogTab(item, catalogTab))
  const lightHint = lightById(pendingLightId ?? '')?.hint ?? 'Tap where the light goes'
  const placingHint =
    clickMode === 'wall'
      ? 'Touchez le mur sur la photo'
      : clickMode === 'light'
        ? lightHint === 'Tap the ceiling'
          ? 'Touchez le plafond'
          : lightHint === 'Tap the floor'
            ? 'Touchez le sol'
            : 'Touchez le mur'
        : 'Touchez un meuble à remplacer — optionnel'

  return (
    <div className="space-y-7">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
          Restyle Pro
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--rm-primary)]">
          Générer
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--rm-muted)]">
          Peignez, éclairez, changez le mobilier — trois looks photoréalistes, empilés dans le Drive.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {stage === 'pick' && (
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.5rem] border border-dashed border-[var(--rm-primary)]/35 bg-[var(--rm-surface)] px-6 py-16 text-center shadow-[0_20px_60px_-40px_rgba(20,32,28,0.55)] transition hover:border-[var(--rm-primary)]/60">
            <span className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--rm-primary)]">
              {saving ? 'Envoi…' : 'Uploader une photo'}
            </span>
            <span className="text-sm text-[var(--rm-muted)]">
              Enregistrée automatiquement dans le Drive
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={saving}
              onChange={handleLocalUpload}
            />
          </label>

          <div className="rounded-[1.5rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rm-accent)]">
              Depuis le Drive
            </p>
            {uploads.length === 0 ? (
              <p className="mt-6 text-sm text-[var(--rm-muted)]">Aucun upload pour l’instant.</p>
            ) : (
              <ul className="mt-4 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {uploads.map(f => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => void loadFromWorkspace(f)}
                      className="group w-full overflow-hidden rounded-xl ring-1 ring-[var(--rm-text)]/8 transition hover:ring-[var(--rm-primary)]/40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.public_url} alt="" className="aspect-square w-full object-cover" />
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
              <p
                className={`text-sm ${
                  clickMode === 'furniture'
                    ? 'text-[var(--rm-muted)]'
                    : 'font-medium text-[var(--rm-primary)]'
                }`}
              >
                {stage === 'placing' && placingHint}
                {stage === 'catalog' && 'Choisissez un meuble pour l’épingle'}
                {stage === 'generating' && progressDetail}
                {stage === 'results' && `${variations.length} look(s) enregistré(s) dans le Drive`}
                {stage === 'error' && 'Une erreur est survenue — vous pouvez réessayer'}
              </p>
              <button type="button" className="rm-btn-secondary text-xs" onClick={resetPick}>
                Changer d’image
              </button>
            </div>

            <div className="relative overflow-hidden rounded-[1.5rem] border border-[var(--rm-text)]/8 bg-[var(--rm-ink)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalSrc}
                alt="Source"
                className={`mx-auto max-h-[58vh] w-full object-contain ${
                  stage === 'placing' ? 'cursor-crosshair' : ''
                }`}
                onClick={handlePhotoClick}
              />
              {wallPin && (
                <div
                  className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                  style={{
                    left: `${wallPin.x * 100}%`,
                    top: `${wallPin.y * 100}%`,
                    background: wallPin.hex,
                  }}
                  title={wallPin.label}
                />
              )}
              {lightPin && (
                <div
                  className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-400/90 text-[10px] font-bold text-zinc-900 shadow"
                  style={{ left: `${lightPin.x * 100}%`, top: `${lightPin.y * 100}%` }}
                  title={lightPin.label}
                >
                  ✦
                </div>
              )}
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

            {(stage === 'placing' || stage === 'catalog') && (
              <div className="flex flex-col gap-3 rounded-[1.25rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                    Peinture
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {COMPOSER_WALLS.map(wall => {
                      const active = (wallPin?.id ?? pendingWallId) === wall.id
                      return (
                        <button
                          key={wall.id}
                          type="button"
                          title={wall.label}
                          aria-label={wall.label}
                          onClick={() => {
                            if (active) {
                              setWallPin(null)
                              setPendingWallId(null)
                              setClickMode('furniture')
                              return
                            }
                            setPendingWallId(wall.id)
                            setPendingLightId(null)
                            if (wallPin) {
                              setWallPin({
                                ...wallPin,
                                id: wall.id,
                                hex: wall.hex,
                                label: wall.label,
                                prompt: wall.prompt,
                              })
                              setClickMode('furniture')
                            } else {
                              setClickMode('wall')
                            }
                          }}
                          className={`h-7 w-7 rounded-full border ${
                            active
                              ? 'border-[var(--rm-primary)] ring-2 ring-[var(--rm-primary)]/30'
                              : 'border-black/10'
                          }`}
                          style={{ background: wall.hex }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                    Lumière
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {COMPOSER_LIGHTS.map(light => {
                      const active = (lightPin?.id ?? pendingLightId) === light.id
                      return (
                        <button
                          key={light.id}
                          type="button"
                          onClick={() => {
                            if (active) {
                              setLightPin(null)
                              setPendingLightId(null)
                              setClickMode('furniture')
                              return
                            }
                            setPendingLightId(light.id)
                            setPendingWallId(null)
                            if (lightPin) {
                              setLightPin({
                                ...lightPin,
                                id: light.id,
                                label: light.label,
                                prompt: light.prompt,
                              })
                              setClickMode('furniture')
                            } else {
                              setClickMode('light')
                            }
                          }}
                          className={`rounded-full px-3 py-1 text-xs ${
                            active
                              ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                              : 'bg-[var(--rm-secondary)] text-[var(--rm-muted)]'
                          }`}
                        >
                          {light.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {stage === 'catalog' && (
              <div className="rounded-[1.25rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
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
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {CATALOG_TABS.map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setCatalogTab(tab)}
                      className={`rounded-full px-3 py-1 text-xs ${
                        catalogTab === tab
                          ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                          : 'bg-[var(--rm-secondary)] text-[var(--rm-muted)]'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
                  {filteredCatalog.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickItemForZone(item)}
                      className="overflow-hidden rounded-xl border border-[var(--rm-text)]/8 text-left transition hover:border-[var(--rm-primary)]/40"
                    >
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="aspect-square w-full bg-[var(--rm-secondary)] object-cover"
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
              <div className="rounded-[1.25rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] p-5">
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
                <p className="mt-3 text-sm text-[var(--rm-muted)]">{progressDetail}</p>
              </div>
            )}

            {stage === 'placing' && (
              <button
                type="button"
                className="w-full rm-btn-primary py-3.5 text-sm"
                disabled={!canGenerate}
                onClick={() => void handleGenerate()}
              >
                Générer 3 restyles
                <span className="mt-1 block text-[11px] font-normal opacity-80">
                  {[
                    wallPin ? wallPin.label : null,
                    lightPin ? lightPin.label : null,
                    readyCount > 0
                      ? `${readyCount} meuble${readyCount > 1 ? 's' : ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Peinture, lumière ou meuble'}
                </span>
              </button>
            )}

            {stage === 'results' && variations.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-[var(--rm-primary)]">
                  Empilé et sauvé dans le Drive
                </p>
                <ul className="space-y-5">
                  {variations.map((src, i) => (
                    <li
                      key={savedRows[i]?.id ?? i}
                      className="overflow-hidden rounded-[1.5rem] border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] shadow-[0_18px_50px_-36px_rgba(20,32,28,0.55)]"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-[var(--rm-text)]/6 px-4 py-2.5">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--rm-accent)]">
                          Look {i + 1}
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
                      <img src={src} alt={`Look ${i + 1}`} className="w-full object-contain" />
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
                    clearRestyle()
                    setStage('placing')
                  }}
                >
                  Nouveau restyle sur cette image
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
