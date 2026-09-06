'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MOCK_CATALOG, type CatalogItem } from '@/lib/mock-catalog'
import { furnitureItemToCatalogItem } from '@/lib/catalog-mapper'
import { fetchGeneratedCatalog } from '@/lib/studio-catalog'

const AI_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? 'http://localhost:8000'

type Stage = 'idle' | 'uploaded' | 'segmenting' | 'segmented' | 'selecting' | 'processing' | 'done'

const CATEGORY_OPTIONS = ['Sofa', 'Bed', 'Chair', 'Coffee Table', 'Light', 'Wardrobe', 'Rug', 'Other']
const STYLE_OPTIONS = ['Minimalism', 'Industrial', 'Maximalism', 'Traditional Algerian', 'Mediterranean Coastal']

interface ImagePayload {
  base64: string
  src: string
}

interface SegmentResponse {
  mask_base64: string
  overlay_base64: string
}

interface InpaintResponse {
  result_base64: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

function fileToImagePayload(file: File): Promise<ImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const base64 = src.split(',')[1] ?? ''
      resolve({ base64, src })
    }
    reader.onerror = () => reject(new Error('Could not read image file'))
    reader.readAsDataURL(file)
  })
}

async function imageUrlToBase64(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const blob = await res.blob()
    return await fileToImagePayload(new File([blob], 'reference-image'))
      .then(payload => payload.base64)
  } catch {
    return null
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

async function parseSegmentResponse(res: Response): Promise<SegmentResponse> {
  const data = await readJson(res)
  if (!res.ok) {
    const detail = isRecord(data) && typeof data.detail === 'string' ? data.detail : 'Segmentation failed'
    throw new Error(detail)
  }
  if (
    !isRecord(data) ||
    typeof data.mask_base64 !== 'string' ||
    typeof data.overlay_base64 !== 'string'
  ) {
    throw new Error('Segmentation returned an invalid response')
  }
  return {
    mask_base64: data.mask_base64,
    overlay_base64: data.overlay_base64,
  }
}

async function parseInpaintResponse(res: Response, fallback: string): Promise<InpaintResponse> {
  const data = await readJson(res)
  if (!res.ok) {
    const detail = isRecord(data) && typeof data.detail === 'string' ? data.detail : fallback
    throw new Error(detail)
  }
  if (!isRecord(data) || typeof data.result_base64 !== 'string') {
    throw new Error('Image generation returned an invalid response')
  }
  return { result_base64: data.result_base64 }
}

function catalogPrompt(item: CatalogItem): string {
  return [
    item.name,
    item.style.toLowerCase(),
    item.category.toLowerCase(),
    item.imageKeyword,
    item.notes,
  ]
    .filter(Boolean)
    .join(', ')
}

function categoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    Sofa: '🛋️',
    Bed: '🛏️',
    Chair: '🪑',
    Light: '💡',
    'Coffee Table': '☕',
    'Dining Table': '🍽️',
    Rug: '▭',
    Wardrobe: '🚪',
    'TV Unit': '📺',
    'Side Table': '🪵',
  }
  return emojis[category] ?? '🪑'
}

export default function PhotoStudioPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [generatedItems, setGeneratedItems] = useState<CatalogItem[]>([])
  const [originalBase64, setOriginalBase64] = useState('')
  const [originalSrc, setOriginalSrc] = useState('')
  const [overlaySrc, setOverlaySrc] = useState('')
  const [maskBase64, setMaskBase64] = useState('')
  const [resultSrc, setResultSrc] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGeneratedCatalog()
      .then(rows => {
        if (!cancelled) {
          setGeneratedItems(rows.map(row => furnitureItemToCatalogItem(row)))
        }
      })
      .catch(err => {
        console.error('Generated catalog load failed:', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const catalogItems = useMemo(
    () => [...generatedItems, ...MOCK_CATALOG].filter(item => item.available),
    [generatedItems],
  )

  const filteredCatalogItems = useMemo(
    () =>
      catalogItems
        .filter(item => !selectedCategory || selectedCategory === 'Other' || item.category === selectedCategory)
        .slice(0, 12),
    [catalogItems, selectedCategory],
  )

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const payload = await fileToImagePayload(file)
      setOriginalBase64(payload.base64)
      setOriginalSrc(payload.src)
      setOverlaySrc('')
      setMaskBase64('')
      setResultSrc('')
      setCustomPrompt('')
      setSelectedCategory('')
      setError(null)
      setStage('uploaded')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (stage !== 'uploaded') return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    setStage('segmenting')
    setError(null)

    try {
      const res = await fetch(`${AI_URL}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: originalBase64, x, y }),
      })
      const data = await parseSegmentResponse(res)
      setMaskBase64(data.mask_base64)
      setOverlaySrc(`data:image/jpeg;base64,${data.overlay_base64}`)
      setStage('segmented')
    } catch (err) {
      setError(getErrorMessage(err))
      setStage('uploaded')
    }
  }

  async function handleRemove() {
    setStage('processing')
    setError(null)

    try {
      const res = await fetch(`${AI_URL}/inpaint/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: originalBase64, mask_base64: maskBase64 }),
      })
      const data = await parseInpaintResponse(res, 'Removal failed')
      setResultSrc(`data:image/jpeg;base64,${data.result_base64}`)
      setStage('done')
    } catch (err) {
      setError(getErrorMessage(err))
      setStage('segmented')
    }
  }

  async function handleReplace(prompt: string) {
    const finalPrompt = prompt.trim()
    if (!finalPrompt) {
      setError('Describe what furniture you want to place there')
      return
    }

    setStage('processing')
    setError(null)

    try {
      const res = await fetch(`${AI_URL}/inpaint/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: originalBase64,
          mask_base64: maskBase64,
          prompt: finalPrompt,
        }),
      })
      const data = await parseInpaintResponse(res, 'Replacement failed')
      setResultSrc(`data:image/jpeg;base64,${data.result_base64}`)
      setStage('done')
    } catch (err) {
      setError(getErrorMessage(err))
      setStage('segmented')
    }
  }

  async function handleStyleReplace(styleName: string) {
    if (!selectedCategory) {
      setError('Choose what type of furniture you selected first')
      return
    }

    setStage('processing')
    setError(null)

    try {
      const res = await fetch(`${AI_URL}/inpaint/replace-style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: originalBase64,
          mask_base64: maskBase64,
          style_name: styleName,
          category: selectedCategory,
        }),
      })
      const data = await parseInpaintResponse(res, 'Style replacement failed')
      setResultSrc(`data:image/jpeg;base64,${data.result_base64}`)
      setStage('done')
    } catch (err) {
      setError(getErrorMessage(err))
      setStage('segmented')
    }
  }

  async function handleCatalogReplace(item: CatalogItem) {
    setStage('processing')
    setError(null)

    try {
      const referenceBase64 = item.imageUrl ? await imageUrlToBase64(item.imageUrl) : null
      const res = await fetch(`${AI_URL}/inpaint/replace-ip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: originalBase64,
          mask_base64: maskBase64,
          prompt: catalogPrompt(item),
          reference_base64: referenceBase64,
        }),
      })
      const data = await parseInpaintResponse(res, 'Catalog replacement failed')
      setResultSrc(`data:image/jpeg;base64,${data.result_base64}`)
      setStage('done')
    } catch (err) {
      setError(getErrorMessage(err))
      setStage('segmented')
    }
  }

  function reset() {
    setStage('idle')
    setOriginalBase64('')
    setOriginalSrc('')
    setOverlaySrc('')
    setMaskBase64('')
    setResultSrc('')
    setCustomPrompt('')
    setSelectedCategory('')
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white sticky top-0 z-20">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-amber-600 tracking-tight">
            roomia
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm">
            <Link href="/marketplace" className="text-zinc-500 hover:text-zinc-900 transition-colors">
              Catalog
            </Link>
            <Link href="/studio" className="text-zinc-500 hover:text-zinc-900 transition-colors">
              Studio
            </Link>
            <span className="text-amber-700 font-medium">AI Photo Studio</span>
          </div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="px-4 py-2 border border-zinc-200 rounded-lg text-xs text-zinc-700 hover:border-amber-400 hover:text-amber-700 transition-all bg-white"
        >
          New photo
        </button>
      </nav>

      <main className="rm-page space-y-8 py-10">
        <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8 items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-600 mb-3">
              AI Photo Studio
            </p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
              Change furniture inside a real room photo.
            </h1>
            <p className="text-sm text-zinc-600 leading-relaxed max-w-2xl">
              Upload one client photo, click the furniture to select it, then remove it, restyle it,
              or use a catalog item as a visual reference when an image is available.
            </p>
          </div>
          <div className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
            <p className="text-sm font-bold mb-2">Backend target</p>
            <p className="text-xs text-zinc-500 break-all">{AI_URL}</p>
            <p className="text-xs text-zinc-400 mt-3">
              Start the Python backend first, then test segmentation before generation.
            </p>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {stage === 'idle' && (
          <section
            className="border-2 border-dashed border-zinc-300 bg-white rounded-3xl p-12 flex flex-col items-center gap-4 hover:border-amber-400 transition-colors cursor-pointer text-center"
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-4xl">🏠</div>
            <div>
              <p className="text-sm font-bold text-zinc-800">Upload a room photo</p>
              <p className="text-xs text-zinc-500 mt-1">JPG or PNG. Any room shape and angle works.</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </section>
        )}

        {(stage === 'uploaded' || stage === 'segmenting') && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-600">
                {stage === 'uploaded'
                  ? 'Click the furniture piece you want to edit.'
                  : 'Selecting the furniture with SAM2...'}
              </p>
              <button
                type="button"
                onClick={reset}
                className="text-xs text-zinc-500 hover:text-zinc-800 transition-colors"
              >
                Upload different photo
              </button>
            </div>
            <div className="relative bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
              <img
                src={originalSrc}
                alt="Uploaded room"
                onClick={handleImageClick}
                className={`w-full block ${stage === 'uploaded' ? 'cursor-crosshair' : 'opacity-60'}`}
              />
              {stage === 'segmenting' && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center">
                  <div className="flex items-center gap-3 rounded-full bg-white border border-amber-200 px-4 py-2 shadow-sm">
                    <span className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium text-amber-700">Analyzing selection</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {stage === 'segmented' && (
          <section className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
            <div className="space-y-3">
              <p className="text-sm text-zinc-600">Selection confirmed. Choose what to do with it.</p>
              <img
                src={overlaySrc}
                alt="Selected furniture overlay"
                className="w-full rounded-3xl border border-amber-300 shadow-sm"
              />
            </div>

            <div className="bg-white border border-zinc-200 rounded-3xl p-5 shadow-sm space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-bold text-zinc-700">What did you select?</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_OPTIONS.map(category => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                        selectedCategory === category
                          ? 'bg-amber-500 text-white font-bold'
                          : 'bg-stone-100 text-zinc-600 hover:bg-stone-200'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStage('uploaded')}
                className="w-full py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-600 hover:border-zinc-400 transition-all"
              >
                Reselect furniture
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="w-full py-2.5 border border-red-200 bg-red-50 rounded-xl text-sm font-bold text-red-700 hover:bg-red-100 transition-all"
              >
                Remove selected furniture
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedCategory) {
                    setError('Choose the selected furniture category first')
                    return
                  }
                  setStage('selecting')
                }}
                className="w-full py-2.5 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors"
              >
                Replace with style or catalog
              </button>

              <div className="pt-4 border-t border-zinc-100 space-y-2">
                <div>
                  <p className="text-xs font-bold text-zinc-700 mb-2">Quick style replacement</p>
                  <div className="flex flex-wrap gap-2">
                    {STYLE_OPTIONS.map(styleName => (
                      <button
                        type="button"
                        key={styleName}
                        onClick={() => handleStyleReplace(styleName)}
                        className="px-3 py-1.5 border border-zinc-200 rounded-full text-xs text-zinc-700 hover:border-amber-300 hover:text-amber-700 transition-colors"
                      >
                        {styleName}
                      </button>
                    ))}
                  </div>
                </div>

                <label htmlFor="custom-prompt" className="text-xs font-bold text-zinc-700">
                  Or write a custom prompt
                </label>
                <textarea
                  id="custom-prompt"
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="Example: beige modern L-shaped sofa with wooden legs"
                  className="w-full min-h-24 resize-none bg-stone-50 border border-zinc-200 rounded-xl px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => handleReplace(customPrompt)}
                  className="w-full py-2.5 border border-amber-300 rounded-xl text-sm font-bold text-amber-700 hover:bg-amber-50 transition-colors"
                >
                  Generate from prompt
                </button>
              </div>
            </div>
          </section>
        )}

        {stage === 'selecting' && (
          <section className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Choose replacement reference</h2>
                <p className="text-sm text-zinc-500">
                  Showing {selectedCategory} items. Uses improved text prompts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStage('segmented')}
                className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                Back
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900">
              Catalog picks use improved text prompts for now. IP-Adapter needs a product photo later.
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCatalogItems.map(item => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => handleCatalogReplace(item)}
                  className="group bg-white border border-zinc-200 rounded-2xl p-4 text-left hover:border-amber-300 hover:shadow-sm transition-all"
                >
                  <div
                    className="h-20 rounded-xl mb-3 flex items-center justify-center text-3xl overflow-hidden"
                    style={{ backgroundColor: `${item.color}22` }}
                  >
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      categoryEmoji(item.category)
                    )}
                  </div>
                  <div className="font-bold text-sm group-hover:text-amber-700 transition-colors">
                    {item.name}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {item.category} · {item.style}
                  </div>
                  <div className="text-xs text-amber-700 font-bold mt-2">
                    {item.price.toLocaleString()} DZD
                  </div>
                  <div className={`text-xs mt-2 ${item.imageUrl ? 'text-emerald-700' : 'text-zinc-400'}`}>
                    {item.imageUrl ? 'Uses product image reference' : 'Prompt-only fallback'}
                  </div>
                </button>
              ))}
            </div>

            {filteredCatalogItems.length === 0 && (
              <div className="text-center py-12 text-sm text-zinc-500">
                No available catalog items for this category yet.
              </div>
            )}
          </section>
        )}

        {stage === 'processing' && (
          <section className="relative bg-white rounded-3xl border border-zinc-200 overflow-hidden shadow-sm">
            <img src={originalSrc} alt="Processing room" className="w-full block opacity-50" />
            <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex flex-col items-center justify-center gap-3">
              <span className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-amber-700">Generating edited photo...</p>
              <p className="text-xs text-zinc-500">First model load can take a few minutes.</p>
            </div>
          </section>
        )}

        {stage === 'done' && (
          <section className="space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold text-zinc-500 mb-2">Before</p>
                <img src={originalSrc} alt="Original room" className="w-full rounded-2xl border border-zinc-200" />
              </div>
              <div>
                <p className="text-xs font-bold text-amber-700 mb-2">After</p>
                <img src={resultSrc} alt="Generated room result" className="w-full rounded-2xl border border-amber-300" />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={resultSrc}
                download="roomia-ai-photo.jpg"
                className="flex-1 text-center py-3 bg-amber-500 text-white rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors"
              >
                Download result
              </a>
              <a
                href={`https://wa.me/?text=${encodeURIComponent('Check out my Roomia AI room redesign')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 text-center py-3 border border-zinc-200 rounded-xl text-sm text-zinc-700 hover:border-green-500 hover:text-green-700 transition-all bg-white"
              >
                Share on WhatsApp
              </a>
              <button
                type="button"
                onClick={reset}
                className="flex-1 py-3 border border-zinc-200 rounded-xl text-sm text-zinc-700 hover:border-amber-300 hover:text-amber-700 transition-all bg-white"
              >
                Try another photo
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
