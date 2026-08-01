'use client'

import { useState } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import { FLOOR_MATERIALS } from '@/lib/studio-constants'

const AI_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? 'http://localhost:8000'

export default function RenderPanel() {
  const { renderPanelOpen, setRenderPanelOpen, canvasRef, room, activeRoom } = useStudioStore()
  const [stage, setStage] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle')
  const [beforeSrc, setBeforeSrc] = useState('')
  const [afterSrc, setAfterSrc] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!renderPanelOpen) return null

  async function handleRender() {
    if (!canvasRef) {
      setError('Could not capture the 3D view. Try reopening the panel.')
      setStage('error')
      return
    }

    setStage('rendering')
    setError(null)

    const store = useStudioStore.getState()
    const previousView = store.viewMode

    try {
      // Eye-level framing + hide editor chrome, then wait for camera settle
      store.setViewMode('capture')
      store.setCaptureMode(true)
      store.selectItem(null)
      await new Promise(r => setTimeout(r, 900))

      const dataUrl = canvasRef.toDataURL('image/jpeg', 0.95)
      store.setCaptureMode(false)
      store.setViewMode(previousView === 'capture' ? 'perspective' : previousView)

      setBeforeSrc(dataUrl)

      const res = await fetch(`${AI_URL}/render/photorealistic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: dataUrl.split(',')[1],
          floor_material: FLOOR_MATERIALS[room.floorMaterial]?.label ?? '',
          wall_color: room.wallColor,
          room_type: activeRoom,
          strength: 0.62,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Backend error ${res.status}`)
      }

      const data = await res.json()
      setAfterSrc(`data:image/jpeg;base64,${data.result_base64}`)
      setStage('done')
    } catch (err: unknown) {
      useStudioStore.getState().setCaptureMode(false)
      useStudioStore.getState().setViewMode(previousView === 'capture' ? 'perspective' : previousView)

      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch')
          ? 'Could not reach AI backend. Make sure it is running on port 8000.'
          : message,
      )
      setStage('error')
    }
  }

  function close() {
    const store = useStudioStore.getState()
    store.setCaptureMode(false)
    if (store.viewMode === 'capture') store.setViewMode('perspective')
    setRenderPanelOpen(false)
    setStage('idle')
    setBeforeSrc('')
    setAfterSrc('')
    setError(null)
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-white">Photorealistic Render</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Turn your 3D design into a realistic photo
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-zinc-500 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {stage === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400 leading-relaxed">
              We&apos;ll move to an eye-level camera, hide the editor grid/labels, capture your room,
              then generate a photorealistic version with realistic materials and lighting.
            </p>
            <button
              type="button"
              onClick={handleRender}
              className="w-full py-3 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
            >
              ✨ Generate Photorealistic Render
            </button>
          </div>
        )}

        {stage === 'rendering' && (
          <div className="space-y-4">
            {beforeSrc && (
              <img
                src={beforeSrc}
                alt="Capturing"
                className="w-full rounded-xl border border-zinc-800 opacity-50"
              />
            )}
            <div className="flex items-center justify-center gap-3 py-4">
              <span className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-amber-400">
                {beforeSrc
                  ? 'Rendering... (20–40 seconds)'
                  : 'Framing camera & capturing...'}
              </span>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">3D View (clean capture)</p>
                <img
                  src={beforeSrc}
                  alt="Before"
                  className="w-full rounded-xl border border-zinc-800"
                />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Photorealistic</p>
                <img
                  src={afterSrc}
                  alt="After"
                  className="w-full rounded-xl border border-amber-400/50"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <a
                href={afterSrc}
                download="roomia-render.jpg"
                className="flex-1 text-center py-2.5 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
              >
                ⬇ Download
              </a>
              <button
                type="button"
                onClick={handleRender}
                className="flex-1 py-2.5 border border-zinc-700 rounded-xl text-sm text-zinc-300 hover:border-amber-400 hover:text-amber-400 transition-colors"
              >
                🔄 Try Again
              </button>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <button
            type="button"
            onClick={handleRender}
            className="w-full py-3 bg-amber-400 text-zinc-950 rounded-xl text-sm font-bold hover:bg-amber-300 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    </div>
  )
}
