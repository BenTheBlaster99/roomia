'use client'

import { useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const AI_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? 'http://localhost:8000'

interface RoomDims {
  width_m: number
  length_m: number
  height_m: number
}

type Stage = 'idle' | 'analyzing' | 'done' | 'error'

async function fileToB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

const PHOTO_TIPS = [
  'Stand in the doorway or corner',
  'Capture the whole room — floor to ceiling',
  'Take 2–3 photos from different angles for better accuracy',
  'Avoid mirrors pointing at the camera',
  'Good lighting helps — open curtains if possible',
]

export default function RoomCapturePage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [stage, setStage] = useState<Stage>('idle')
  const [previews, setPreviews] = useState<string[]>([])
  const [depthSrc, setDepthSrc] = useState('')
  const [photosUsed, setPhotosUsed] = useState(0)
  const [dims, setDims] = useState<RoomDims>({ width_m: 5, length_m: 6, height_m: 2.8 })
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const processFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    const valid = files.filter(f => f.type.startsWith('image/')).slice(0, 3)
    if (!valid.length) {
      setError('Please upload image files (JPG, PNG, HEIC)')
      return
    }

    setError(null)
    setStage('analyzing')
    setPreviews(valid.map(f => URL.createObjectURL(f)))

    try {
      const b64s = await Promise.all(valid.map(fileToB64))

      const res = await fetch(`${AI_URL}/depth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images_base64: b64s }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Backend error ${res.status}`)
      }

      const data = await res.json()
      setDepthSrc(`data:image/jpeg;base64,${data.depth_visual_base64}`)
      setDims(data.room_dims)
      setPhotosUsed(data.photos_used)
      setStage('done')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.includes('fetch')
          ? 'Could not reach AI backend. Make sure it is running on port 8000.'
          : message,
      )
      setStage('error')
    }
  }, [])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    processFiles(Array.from(e.target.files ?? []))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  function openInStudio() {
    const params = new URLSearchParams({
      width: String(dims.width_m),
      length: String(dims.length_m),
      height: String(dims.height_m),
    })
    router.push(`/studio?${params}`)
  }

  function reset() {
    setStage('idle')
    setPreviews([])
    setDepthSrc('')
    setError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const area = (dims.width_m * dims.length_m).toFixed(1)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-20">
        <Link href="/" className="text-xl font-bold text-amber-400 tracking-tight">
          roomia
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/studio" className="text-zinc-400 hover:text-white transition-colors">
            Studio
          </Link>
          <span className="text-zinc-600">Scan Room</span>
        </div>
      </nav>

      <div className="rm-page space-y-8 py-10">
        <div>
          <h1 className="text-2xl font-bold mb-2">Scan your room</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Upload 1–3 photos of your room. AI estimates the dimensions and opens your exact space
            in the 3D studio ready to furnish.
          </p>
        </div>

        {(stage === 'idle' || stage === 'error') && (
          <div className="space-y-5">
            {error && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div
              onDragOver={e => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-4 cursor-pointer transition-all ${
                dragging
                  ? 'border-amber-400 bg-amber-400/5'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <div className="text-5xl">📷</div>
              <div className="text-center">
                <div className="text-sm font-medium text-zinc-200 mb-1">
                  Drop room photos here or click to upload
                </div>
                <div className="text-xs text-zinc-600">JPG, PNG, HEIC · Up to 3 photos</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                Tips for better accuracy
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

        {stage === 'analyzing' && (
          <div className="space-y-5">
            <div className={`grid gap-3 ${previews.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {previews.map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt={`Room photo ${i + 1}`}
                    className="w-full rounded-xl border border-zinc-800 opacity-50 object-cover"
                    style={{ maxHeight: 220, objectFit: 'cover' }}
                  />
                  {i === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl">
                      <span className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-amber-400 font-medium bg-zinc-950/70 px-3 py-1 rounded-full">
                        Estimating dimensions...
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-600 text-center">
              This may take 15–30 seconds on first run while the model loads
            </p>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1.5 font-medium">Your photo</p>
                <img
                  src={previews[0]}
                  alt="Room"
                  className="w-full rounded-xl border border-zinc-800 object-cover"
                  style={{ height: 160, objectFit: 'cover' }}
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5 font-medium">
                  Depth map
                  <span className="ml-1 text-zinc-700 font-normal">(yellow = closer)</span>
                </p>
                <img
                  src={depthSrc}
                  alt="Depth visualization"
                  className="w-full rounded-xl border border-zinc-800 object-cover"
                  style={{ height: 160, objectFit: 'cover' }}
                />
              </div>
            </div>

            {photosUsed > 1 && (
              <p className="text-xs text-green-500">
                ✓ Averaged across {photosUsed} photos for better accuracy
              </p>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
              <div>
                <p className="text-sm font-bold mb-0.5">Estimated dimensions</p>
                <p className="text-xs text-zinc-500">
                  AI estimates are approximate. Adjust to match your actual room.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {(
                  [
                    { label: 'Width', key: 'width_m', icon: '↔' },
                    { label: 'Length', key: 'length_m', icon: '↕' },
                    { label: 'Height', key: 'height_m', icon: '⇕' },
                  ] as const
                ).map(({ label, key, icon }) => (
                  <div key={key}>
                    <label className="text-xs text-zinc-500 block mb-1.5">
                      {icon} {label}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={0.1}
                        value={dims[key]}
                        onChange={e =>
                          setDims(d => ({
                            ...d,
                            [key]: parseFloat(e.target.value) || 1,
                          }))
                        }
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-sm text-white focus:outline-none focus:border-amber-400 transition-colors"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500 pointer-events-none">
                        m
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-600 pt-1">
                <span>Floor area: {area} m²</span>
                <span>
                  {dims.width_m}m × {dims.length_m}m × {dims.height_m}m
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-2">Or use a standard size:</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Small room', w: 3.5, l: 4, h: 2.7 },
                  { label: 'Medium room', w: 4.5, l: 5.5, h: 2.8 },
                  { label: 'Large room', w: 6, l: 7, h: 3 },
                  { label: 'Studio apt', w: 5, l: 5, h: 2.7 },
                ].map(p => (
                  <button
                    key={p.label}
                    onClick={() =>
                      setDims({
                        width_m: p.w,
                        length_m: p.l,
                        height_m: p.h,
                      })
                    }
                    className="px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded-full text-xs text-zinc-400 hover:border-amber-400 hover:text-amber-400 transition-all"
                  >
                    {p.label} ({p.w}×{p.l}m)
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={openInStudio}
                className="w-full py-4 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
              >
                🧊 Open My Room in 3D Studio →
              </button>
              <button
                onClick={reset}
                className="w-full py-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                ← Scan a different room
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
