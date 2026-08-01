'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'

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
    <div className="min-h-screen bg-zinc-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-20">
        <Link href="/" className="text-xl font-bold text-amber-400 tracking-tight">
          roomia
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/photo-studio" className="text-zinc-400 hover:text-white transition-colors">
            AI Photo
          </Link>
          <span className="text-zinc-600">Room Composer</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Furnish your room photo</h1>
          <p className="text-sm text-zinc-400">
            Upload your room, tap up to {MAX_ZONES} spots to furnish, and get 3 AI-generated
            variations to choose from.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {stage === 'idle' && (
          <div className="space-y-5">
            <div
              className="border-2 border-dashed border-zinc-700 rounded-2xl p-12 flex flex-col items-center gap-4 hover:border-amber-400 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <div className="text-4xl">🏠</div>
              <div className="text-sm font-medium text-zinc-300">Upload a room photo</div>
              <div className="text-xs text-zinc-600">JPG, PNG — any room angle works</div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
              />
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                Tips for best results
              </p>
              <ul className="space-y-1.5">
                {PHOTO_TIPS.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-zinc-500">
                    <span className="text-amber-400 flex-shrink-0">·</span>
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
              <p className="text-xs text-zinc-400">
                {zones.length < MAX_ZONES
                  ? `👆 Tap furniture to change (${zones.length}/${MAX_ZONES} selected)`
                  : `Maximum ${MAX_ZONES} zones selected`}
              </p>
              <button
                type="button"
                onClick={reset}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Start over
              </button>
            </div>

            <div className="relative">
              <img
                src={originalSrc}
                alt="Your room"
                className="w-full rounded-2xl border border-zinc-800 block cursor-crosshair"
                onClick={handlePhotoClick}
              />
              {zones.map((zone, i) => (
                <div
                  key={zone.id}
                  className="absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400 bg-amber-400/20 flex items-center justify-center text-xs font-bold text-amber-400 backdrop-blur-sm pointer-events-none"
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
                    className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-amber-400 text-zinc-950 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      {zone.item ? (
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{zone.item.name}</div>
                          <div className="text-xs text-zinc-500">
                            {zone.item.category} · {zone.item.style}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-500">No item selected</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveZoneId(zone.id)
                          setStage('catalog')
                        }}
                        className="text-xs text-amber-400 hover:text-amber-300 transition-colors"
                      >
                        {zone.item ? 'Change' : 'Pick item'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeZone(zone.id)}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stage === 'catalog' && activeZoneId && (
              <div className="bg-zinc-900 border border-amber-400/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-400">
                    Pick an item for spot #{zones.findIndex(z => z.id === activeZoneId) + 1}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveZoneId(null)
                      setStage('placing')
                    }}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    ← Back
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                  {catalog.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickItemForZone(item)}
                      className="bg-zinc-800 border border-zinc-700 rounded-xl p-2.5 text-left hover:border-amber-400/50 transition-all"
                    >
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="w-full h-16 object-cover rounded-lg mb-1.5 bg-zinc-700"
                        />
                      ) : (
                        <div className="w-full h-16 rounded-lg mb-1.5 bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-500">
                          No product photo
                        </div>
                      )}
                      <div className="text-xs font-semibold truncate">{item.name}</div>
                      <div className="text-xs text-zinc-500">{item.category}</div>
                      {item.imageUrl ? (
                        <div className="text-[10px] text-green-500 mt-0.5">📷 IP-Adapter ready</div>
                      ) : (
                        <div className="text-[10px] text-zinc-500 mt-0.5">text-only (weaker)</div>
                      )}
                      <div className="text-xs text-amber-400 font-bold mt-0.5">
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
                className="w-full py-3.5 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
              >
                ✨ Generate {readyCount} zone{readyCount > 1 ? 's' : ''} → 3 Results
              </button>
            )}
          </div>
        )}

        {stage === 'generating' && (
          <div className="space-y-4">
            <img
              src={originalSrc}
              alt="Processing"
              className="w-full rounded-2xl border border-zinc-800 opacity-40"
            />
            <div className="flex flex-col items-center gap-3 py-6">
              <span className="w-10 h-10 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-amber-400 font-medium">Generating 3 variations...</p>
              <p className="text-xs text-zinc-600">
                This can take 1–3 minutes with multiple furniture pieces. Start with 1 zone to
                smoke-test.
              </p>
            </div>
          </div>
        )}

        {stage === 'results' && (
          <div className="space-y-5">
            <p className="text-xs text-zinc-400">✓ Pick your favorite</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {variations.map((src, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedVariation(i)}
                  className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                    selectedVariation === i
                      ? 'border-amber-400'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <img src={src} alt={`Variation ${i + 1}`} className="w-full" />
                  <div className="absolute top-2 left-2 bg-zinc-950/80 text-xs px-2 py-0.5 rounded-full">
                    Option {i + 1}
                  </div>
                  {selectedVariation === i && (
                    <div className="absolute top-2 right-2 bg-amber-400 text-zinc-950 text-xs w-6 h-6 rounded-full flex items-center justify-center font-bold">
                      ✓
                    </div>
                  )}
                </button>
              ))}
            </div>

            {selectedVariation !== null && (
              <div className="flex gap-3">
                <a
                  href={variations[selectedVariation]}
                  download="roomia-design.jpg"
                  className="flex-1 text-center py-2.5 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
                >
                  ⬇ Download
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent('Check out my room design from Roomia! 🏠')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center py-2.5 border border-zinc-700 rounded-xl text-sm text-zinc-300 hover:border-green-500 hover:text-green-400 transition-colors"
                >
                  Share on WhatsApp
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={reset}
              className="w-full py-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Try with another photo
            </button>
          </div>
        )}

        {stage === 'error' && (
          <button
            type="button"
            onClick={() => setStage('placing')}
            className="w-full py-3 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  )
}
