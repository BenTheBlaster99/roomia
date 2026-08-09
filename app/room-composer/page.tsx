'use client'

import { useEffect, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import ImageLightbox from '@/components/ImageLightbox'

const AI_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? 'http://localhost:8000'
const MAX_ZONES = 3

interface Zone {
  id: string
  x: number
  y: number
  item: CatalogItem | null
}

type Stage = 'idle' | 'placing' | 'catalog' | 'generating' | 'results' | 'error'

function imgToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

const PHOTO_TIPS = [
  'Take the photo in good lighting — natural light works best',
  'Make sure the whole piece of furniture you want to change is visible',
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
    setError(null)
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
    if (readyZones.length === 0) {
      setError('Add at least one furniture piece before generating')
      return
    }

    setStage('generating')
    setError(null)
    setSelectedVariation(null)

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
            reference_base64,
          }
        }),
      )

      const res = await fetch(`${AI_URL}/compose/room`, {
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
        throw new Error(err.detail ?? `Backend error ${res.status}`)
      }

      const data = await res.json()
      setVariations(
        (data.variations as string[]).map(b64 => `data:image/jpeg;base64,${b64}`),
      )
      setStage('results')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch')
          ? 'Could not reach AI backend. Make sure it is running on port 8000.'
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
    setVariations([])
    setSelectedVariation(null)
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const readyCount = zones.filter(z => z.item).length

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/studio" ctaLabel="Open studio" />

      <div className="max-w-3xl mx-auto px-5 py-10 space-y-6 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
            Feature A
          </p>
          <h1 className="rm-display mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            Furnish your room photo
          </h1>
          <p className="mt-2 text-sm text-[var(--rm-muted)] leading-relaxed">
            Upload your room, tap up to {MAX_ZONES} spots to furnish, and get 3 AI-generated
            variations to choose from.
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
              <p className="text-xs text-[var(--rm-muted)]">
                {zones.length < MAX_ZONES
                  ? `Tap furniture to change (${zones.length}/${MAX_ZONES} selected)`
                  : `Maximum ${MAX_ZONES} zones selected`}
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {catalog.map(item => (
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

            {stage === 'placing' && readyCount > 0 && (
              <button
                type="button"
                onClick={handleGenerate}
                className="w-full rm-btn-primary py-3.5 text-sm"
              >
                Generate {readyCount} zone{readyCount > 1 ? 's' : ''} → 3 results
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
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="w-10 h-10 border-2 border-[var(--rm-primary)] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-[var(--rm-primary)] font-medium">Generating 3 variations...</p>
              <p className="text-xs text-[var(--rm-muted)] text-center max-w-sm">
                This can take 1–3 minutes with multiple furniture pieces. Start with 1 zone to
                smoke-test.
              </p>
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
