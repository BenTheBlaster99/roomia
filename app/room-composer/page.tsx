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
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import ImageLightbox from '@/components/ImageLightbox'

const MAX_ZONES = 3

interface Zone {
  id: string
  x: number
  y: number
  item: CatalogItem | null
}

type Stage = 'idle' | 'placing' | 'catalog' | 'generating' | 'results' | 'error'
type ClickMode = 'furniture' | 'wall' | 'light'

type WallPin = { id: string; hex: string; label: string; prompt: string; x: number; y: number }
type LightPin = {
  id: ComposerLightId
  label: string
  prompt: string
  x: number
  y: number
}

type ProgressStep = 'masking' | 'generating' | 'results'

const PROGRESS_STEPS: { id: ProgressStep; title: string }[] = [
  { id: 'masking', title: 'Step 1 · Masking' },
  { id: 'generating', title: 'Step 2 · Generating' },
  { id: 'results', title: 'Step 3 · Results' },
]

function progressIndex(step: ProgressStep): number {
  return PROGRESS_STEPS.findIndex(s => s.id === step)
}

function imgToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
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

const PHOTO_TIPS = [
  'Take the photo in good lighting — natural light works best',
  'Include the walls and ceiling if you want paint or a chandelier',
  'Avoid extreme angles — shoot roughly straight-on',
  'One clear photo works better than a cluttered wide shot',
]

export default function RoomComposerPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [originalB64, setOriginalB64] = useState('')
  const [originalSrc, setOriginalSrc] = useState('')
  const [zones, setZones] = useState<Zone[]>([])
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null)
  const [variations, setVariations] = useState<string[]>([])
  const [selectedVariation, setSelectedVariation] = useState<number | null>(null)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState<ProgressStep>('masking')
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Preparing…')
  const [clickMode, setClickMode] = useState<ClickMode>('furniture')
  const [wallPin, setWallPin] = useState<WallPin | null>(null)
  const [lightPin, setLightPin] = useState<LightPin | null>(null)
  const [pendingWallId, setPendingWallId] = useState<string | null>(null)
  const [pendingLightId, setPendingLightId] = useState<ComposerLightId | null>(null)
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('All')
  const [catalog, setCatalog] = useState<CatalogItem[]>(MOCK_CATALOG.filter(c => c.available))

  useEffect(() => {
    let cancelled = false
    fetchGeneratedCatalog()
      .then(rows => {
        if (cancelled) return
        const fromDb = rows.map(row => {
          const item = furnitureItemToCatalogItem(row)
          // Composer needs photos/prompts — GLB not required
          return { ...item, available: Boolean(item.imageUrl || item.modelUrl || item.name) }
        })
        const byId = new Map<string, CatalogItem>()
        for (const item of MOCK_CATALOG.filter(c => c.available)) byId.set(item.id, item)
        for (const item of fromDb) byId.set(item.id, item)
        setCatalog([...byId.values()].filter(c => c.available))
      })
      .catch(() => {
        /* keep mock catalog */
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const b64 = await imgToB64(file)
    setOriginalB64(b64)
    setOriginalSrc(URL.createObjectURL(file))
    setStage('placing')
    setZones([])
    setWallPin(null)
    setLightPin(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    setError(null)
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
      setLightPin({
        id: light.id,
        label: light.label,
        prompt: light.prompt,
        x,
        y,
      })
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
      if (!res.ok) {
        console.warn('Product photo fetch failed', url, res.status)
        return null
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        console.warn('Product photo is not an image', url, contentType)
        return null
      }
      const blob = await res.blob()
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.onerror = reject
        r.readAsDataURL(blob)
      })
    } catch (err) {
      console.warn('Product photo fetch error', url, err)
      return null
    }
  }

  async function handleGenerate() {
    const readyZones = zones.filter(z => z.item !== null)
    if (readyZones.length === 0 && !wallPin && !lightPin) {
      setError('Paint a wall, add a light, or pin a furniture piece')
      return
    }

    setStage('generating')
    setError(null)
    setSelectedVariation(null)
    setProgressStep('masking')
    setProgressPct(8)
    setProgressDetail('Preparing masks…')

    try {
      const zonesPayload = await Promise.all(
        readyZones.map(async zone => {
          const item = zone.item!
          const reference_base64 = await fetchRefB64(item.imageUrl)
          const prompt = [
            item.name,
            item.style,
            item.category,
            item.notes ?? '',
            item.imageKeyword ?? '',
          ]
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
            wall: wallPin
              ? { prompt: wallPin.prompt, x: wallPin.x, y: wallPin.y }
              : null,
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

      if (!res.body) {
        throw new Error('Compose stream unavailable')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let gotVariations: string[] | null = null
      let partialWarning: string | null = null

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
            label?: string
            detail?: string
            pct?: number
            variations?: string[]
            failed_count?: number
            warnings?: string[]
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
            setProgressDetail(
              event.failed_count && event.failed_count > 0
                ? `${event.variations.length} ready (${event.failed_count} failed)`
                : 'Done',
            )
            if (event.failed_count && event.failed_count > 0) {
              partialWarning = `${event.variations.length} of 3 variations succeeded. Others failed on the image API.`
            }
          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Compose failed')
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as {
            type: string
            variations?: string[]
            detail?: string
            failed_count?: number
          }
          if (event.type === 'done' && Array.isArray(event.variations)) {
            gotVariations = event.variations
            if (event.failed_count && event.failed_count > 0) {
              partialWarning = `${event.variations.length} of 3 variations succeeded. Others failed on the image API.`
            }
          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Compose failed')
          }
        } catch (trailErr) {
          if (trailErr instanceof SyntaxError) {
            // ignore incomplete trailing chunk if we already have results
            if (!gotVariations?.length) {
              throw new Error('Stream ended unexpectedly (no results)')
            }
          } else {
            throw trailErr
          }
        }
      }

      if (!gotVariations?.length) {
        throw new Error('No variations returned (all requests failed or stream cut off)')
      }

      setVariations(gotVariations.map(b64 => `data:image/jpeg;base64,${b64}`))
      if (partialWarning) setError(partialWarning)
      setStage('results')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch') || message.includes('502')
          ? 'Image API returned an error (502). Check OPENAI_BASE_URL / key, then retry — partial results are kept when any variation succeeds.'
          : message,
      )
      setStage('error')
    }
  }

  function reset() {
    setStage('idle')
    setOriginalB64('')
    setOriginalSrc('')
    setZones([])
    setActiveZoneId(null)
    setWallPin(null)
    setLightPin(null)
    setPendingWallId(null)
    setPendingLightId(null)
    setClickMode('furniture')
    setCatalogTab('All')
    setVariations([])
    setSelectedVariation(null)
    setLightboxSrc(null)
    setProgressStep('masking')
    setProgressPct(0)
    setProgressDetail('Preparing…')
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const readyCount = zones.filter(z => z.item).length
  const canGenerate = readyCount > 0 || Boolean(wallPin) || Boolean(lightPin)
  const filteredCatalog = catalog.filter(item => matchesCatalogTab(item, catalogTab))
  const placingHint =
    clickMode === 'wall'
      ? 'Tap the wall in the photo'
      : clickMode === 'light'
        ? (lightById(pendingLightId ?? '')?.hint ?? 'Tap where the light goes')
        : 'Tap the photo to swap furniture — optional'

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/studio" ctaLabel="Open studio" />

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-6 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
            Feature A
          </p>
          <h1 className="rm-display mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Restyle your room photo
          </h1>
          <p className="mt-2 text-sm text-[var(--rm-muted)] leading-relaxed">
            Paint walls, add a light, swap furniture — three photoreal looks from one photo.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {stage === 'idle' && (
          <div className="space-y-5">
            <div
              className="rm-panel border-dashed p-12 flex flex-col items-center gap-4 hover:border-[var(--rm-primary)]/40 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <div className="rm-display text-sm font-bold text-[var(--rm-primary)]">Upload a room photo</div>
              <div className="text-xs text-[var(--rm-muted)]">JPG, PNG — any room angle works</div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
              />
            </div>

            <div className="rm-panel p-5">
              <p className="text-xs font-semibold text-[var(--rm-muted)] uppercase tracking-widest mb-3">
                Tips for best results
              </p>
              <ul className="space-y-1.5">
                {PHOTO_TIPS.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[var(--rm-muted)]">
                    <span className="text-[var(--rm-accent)] flex-shrink-0">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {(stage === 'placing' || stage === 'catalog') && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p
                className={`text-xs ${
                  clickMode === 'furniture'
                    ? 'text-[var(--rm-muted)]'
                    : 'font-medium text-[var(--rm-primary)]'
                }`}
              >
                {placingHint}
              </p>
              <button
                type="button"
                onClick={reset}
                className="text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)] transition-colors"
              >
                Start over
              </button>
            </div>

            <div className="relative">
              <img
                src={originalSrc}
                alt="Your room"
                className="w-full rounded-[1.25rem] border border-[var(--rm-text)]/10 block cursor-crosshair"
                onClick={handlePhotoClick}
              />
              {wallPin && (
                <div
                  className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow pointer-events-none"
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
                  className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-400/90 text-[10px] font-bold text-zinc-900 shadow pointer-events-none"
                  style={{ left: `${lightPin.x * 100}%`, top: `${lightPin.y * 100}%` }}
                  title={lightPin.label}
                >
                  ✦
                </div>
              )}
              {zones.map((zone, i) => (
                <div
                  key={zone.id}
                  className="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--rm-accent)] bg-[var(--rm-accent)]/25 flex items-center justify-center text-xs font-bold text-[var(--rm-ink)] backdrop-blur-sm pointer-events-none"
                  style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%` }}
                >
                  {i + 1}
                </div>
              ))}
            </div>

            <div className="rm-panel flex flex-col gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                  Paint
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
                <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-widest text-[var(--rm-muted)]">
                  Light
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

            {zones.length > 0 && (
              <div className="space-y-2">
                {zones.map((zone, i) => (
                  <div
                    key={zone.id}
                    className="flex items-center justify-between rm-panel px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-[var(--rm-primary)] text-[var(--rm-surface)] text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      {zone.item ? (
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{zone.item.name}</div>
                          <div className="text-xs text-[var(--rm-muted)]">
                            {zone.item.category} · {zone.item.style}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--rm-muted)]">No item selected</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveZoneId(zone.id)
                          setStage('catalog')
                        }}
                        className="text-xs font-semibold text-[var(--rm-primary)] hover:underline"
                      >
                        {zone.item ? 'Change' : 'Pick item'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeZone(zone.id)}
                        className="text-xs text-[var(--rm-muted)] hover:text-red-600 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stage === 'catalog' && activeZoneId && (
              <div className="rm-panel border-[var(--rm-primary)]/25 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-[var(--rm-primary)]">
                    Pick an item for spot #{zones.findIndex(z => z.id === activeZoneId) + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveZoneId(null)
                      setStage('placing')
                    }}
                    className="text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)] transition-colors"
                  >
                    Back
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {filteredCatalog.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickItemForZone(item)}
                      className="bg-[var(--rm-surface)] border border-[var(--rm-text)]/10 rounded-xl p-2.5 text-left hover:border-[var(--rm-primary)]/40 transition-all"
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-full h-16 object-cover rounded-lg mb-1.5 bg-[var(--rm-secondary)]"
                        />
                      ) : (
                        <div className="w-full h-16 rounded-lg mb-1.5 bg-[var(--rm-secondary)] flex items-center justify-center text-[10px] text-[var(--rm-muted)]">
                          No product photo
                        </div>
                      )}
                      <div className="text-xs font-semibold truncate">{item.name}</div>
                      <div className="text-xs text-[var(--rm-muted)]">{item.category}</div>
                      {item.imageUrl ? (
                        <div className="text-[10px] text-[var(--rm-primary)] mt-0.5">IP-Adapter ready</div>
                      ) : (
                        <div className="text-[10px] text-[var(--rm-muted)] mt-0.5">text-only</div>
                      )}
                      <div className="text-xs text-[var(--rm-accent)] font-bold mt-0.5">
                        {item.price.toLocaleString()} DZD
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stage === 'placing' && canGenerate && (
              <button
                type="button"
                onClick={handleGenerate}
                className="w-full rm-btn-primary py-3.5 text-sm"
              >
                Generate 3 restyles
                <span className="mt-1 block text-[11px] font-normal opacity-80">
                  {[
                    wallPin ? wallPin.label : null,
                    lightPin ? lightPin.label : null,
                    readyCount > 0
                      ? `${readyCount} furniture piece${readyCount > 1 ? 's' : ''}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            )}
          </div>
        )}

        {stage === 'generating' && (
          <div className="space-y-4">
            <img
              src={originalSrc}
              alt="Processing"
              className="w-full rounded-[1.25rem] border border-[var(--rm-text)]/10 opacity-40"
            />
            <div className="space-y-5 rounded-[1.25rem] border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-5 py-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--rm-text)]">
                  {PROGRESS_STEPS[progressIndex(progressStep)]?.title ?? 'Working…'}
                </p>
                <span className="text-xs tabular-nums text-[var(--rm-muted)]">
                  {Math.round(progressPct)}%
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-[var(--rm-text)]/10">
                <div
                  className="h-full rounded-full bg-[var(--rm-primary)] transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(100, Math.max(4, progressPct))}%` }}
                />
              </div>

              <ol className="space-y-2.5">
                {PROGRESS_STEPS.map((step, i) => {
                  const activeIdx = progressIndex(progressStep)
                  const done = i < activeIdx
                  const active = i === activeIdx
                  return (
                    <li
                      key={step.id}
                      className={`flex items-center gap-3 text-sm ${
                        active
                          ? 'font-medium text-[var(--rm-primary)]'
                          : done
                            ? 'text-[var(--rm-text)]'
                            : 'text-[var(--rm-muted)]'
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          active
                            ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                            : done
                              ? 'bg-[var(--rm-primary)]/20 text-[var(--rm-primary)]'
                              : 'bg-[var(--rm-text)]/10 text-[var(--rm-muted)]'
                        }`}
                      >
                        {done ? '✓' : i + 1}
                      </span>
                      <span>{step.title.replace(/^Step \d+ · /, '')}</span>
                      {active && (
                        <span className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--rm-primary)] border-t-transparent" />
                      )}
                    </li>
                  )
                })}
              </ol>

              <p className="text-xs text-[var(--rm-muted)]">{progressDetail}</p>
            </div>
          </div>
        )}

        {stage === 'results' && (
          <div className="space-y-5">
            <p className="text-xs text-[var(--rm-muted)]">
              Cliquez pour sélectionner · double-clic ou « Agrandir » pour zoomer
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {variations.map((src, i) => (
                <div
                  key={i}
                  className={`relative overflow-hidden rounded-xl border-2 transition-all ${
                    selectedVariation === i
                      ? 'border-[var(--rm-primary)]'
                      : 'border-[var(--rm-text)]/10 hover:border-[var(--rm-primary)]/35'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedVariation(i)}
                    onDoubleClick={() => setLightboxSrc(src)}
                    className="block w-full text-left"
                  >
                    <img
                      src={src}
                      alt={`Variation ${i + 1}`}
                      className="w-full cursor-zoom-in"
                    />
                  </button>
                  <div className="pointer-events-none absolute top-2 left-2 rounded bg-[var(--rm-ink)]/80 px-2 py-0.5 text-xs text-[var(--rm-surface)]">
                    Option {i + 1}
                  </div>
                  {selectedVariation === i && (
                    <div className="pointer-events-none absolute top-2 right-10 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--rm-primary)] text-xs font-bold text-[var(--rm-surface)]">
                      ✓
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setLightboxSrc(src)}
                    title="Agrandir"
                    className="absolute top-2 right-2 rounded-md bg-[var(--rm-ink)]/75 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--rm-surface)] hover:bg-[var(--rm-ink)]"
                  >
                    Zoom
                  </button>
                </div>
              ))}
            </div>

            {selectedVariation !== null && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setLightboxSrc(variations[selectedVariation])}
                  className="flex-1 text-center rm-btn-secondary py-2.5 text-sm"
                >
                  Voir en grand
                </button>
                <a
                  href={variations[selectedVariation]}
                  download="roomia-design.jpg"
                  className="flex-1 text-center rm-btn-primary py-2.5 text-sm"
                >
                  Download
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent('Check out my room design from Roomia!')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center rm-btn-secondary py-2.5 text-sm"
                >
                  Share on WhatsApp
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={reset}
              className="w-full py-2 text-xs text-[var(--rm-muted)] hover:text-[var(--rm-text)] transition-colors"
            >
              Try with another photo
            </button>

            <ImageLightbox
              src={lightboxSrc}
              alt="Variation Roomia"
              onClose={() => setLightboxSrc(null)}
            />
          </div>
        )}

        {stage === 'error' && (
          <button
            type="button"
            onClick={() => setStage('placing')}
            className="w-full rm-btn-primary py-3 text-sm"
          >
            Try Again
          </button>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}
