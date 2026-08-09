'use client'

import { useState } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import { FLOOR_MATERIALS } from '@/lib/studio-constants'
import ImageLightbox from '@/components/ImageLightbox'

const AI_URL = process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? 'http://localhost:8000'

export default function RenderPanel() {
  const { renderPanelOpen, setRenderPanelOpen, canvasRef, room, activeRoom, setViewMode } =
    useStudioStore()
  const [stage, setStage] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle')
  const [beforeSrc, setBeforeSrc] = useState('')
  const [afterSrc, setAfterSrc] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** If true, jump to eye-level capture preset before shooting. Else use whatever view the user framed. */
  const [useEyeLevel, setUseEyeLevel] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (!renderPanelOpen) return null

  async function handleRender() {
    if (!canvasRef) {
      setError('Impossible de capturer la vue 3D. Réessayez.')
      setStage('error')
      return
    }

    setStage('rendering')
    setError(null)

    const store = useStudioStore.getState()
    const previousView = store.viewMode

    try {
      store.setCaptureMode(true)
      store.selectItem(null)

      if (useEyeLevel) {
        store.setViewMode('capture')
        await new Promise(r => setTimeout(r, 900))
      } else {
        // Keep user's framed view; short settle for chrome hide
        await new Promise(r => setTimeout(r, 350))
      }

      const dataUrl = canvasRef.toDataURL('image/jpeg', 0.95)
      store.setCaptureMode(false)
      if (useEyeLevel) {
        store.setViewMode(previousView === 'capture' ? 'perspective' : previousView)
      }

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
      if (useEyeLevel) {
        useStudioStore
          .getState()
          .setViewMode(previousView === 'capture' ? 'perspective' : previousView)
      }

      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(
        message.toLowerCase().includes('fetch')
          ? 'Backend IA inaccessible. Vérifiez que le serveur tourne.'
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
    setLightboxSrc(null)
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        onClick={close}
      >
        <div
          className="max-h-[90vh] w-full max-w-2xl space-y-5 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-white">Rendu photoréaliste</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Cadrez la vue 3D comme vous voulez, puis générez
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-xl leading-none text-zinc-500 hover:text-white"
            >
              ×
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-700/50 bg-red-900/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {stage === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-zinc-400">
                Orbitez et zoomez dans le studio pour choisir l&apos;angle. Le rendu utilise{' '}
                <strong className="text-zinc-200">la vue actuelle</strong> (grille et labels
                masqués). Ou activez la vue photo niveau des yeux.
              </p>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3">
                <input
                  type="checkbox"
                  checked={useEyeLevel}
                  onChange={e => setUseEyeLevel(e.target.checked)}
                  className="mt-1 accent-amber-400"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-200">
                    Vue photo (niveau des yeux)
                  </span>
                  <span className="text-xs text-zinc-500">
                    Ignore votre cadrage et utilise le preset Photo
                  </span>
                </span>
              </label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setViewMode('capture')
                  }}
                  className="flex-1 rounded-xl border border-zinc-600 py-2.5 text-sm text-zinc-300 hover:border-amber-400 hover:text-amber-400"
                >
                  Prévisualiser vue Photo
                </button>
                <button
                  type="button"
                  onClick={handleRender}
                  className="flex-1 rounded-xl bg-amber-400 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-300"
                >
                  Générer le rendu
                </button>
              </div>
            </div>
          )}

          {stage === 'rendering' && (
            <div className="space-y-4">
              {beforeSrc && (
                <img
                  src={beforeSrc}
                  alt="Capture"
                  className="w-full rounded-xl border border-zinc-800 opacity-50"
                />
              )}
              <div className="flex items-center justify-center gap-3 py-4">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                <span className="text-sm text-amber-400">
                  {beforeSrc ? 'Rendu en cours… (20–40 s)' : 'Capture de la vue…'}
                </span>
              </div>
            </div>
          )}

          {stage === 'done' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setLightboxSrc(beforeSrc)}
                >
                  <p className="mb-1.5 text-xs text-zinc-500">Vue 3D (capture)</p>
                  <img
                    src={beforeSrc}
                    alt="Avant"
                    className="w-full cursor-zoom-in rounded-xl border border-zinc-800 transition hover:border-zinc-500"
                  />
                  <p className="mt-1 text-[10px] text-zinc-600">Cliquer pour agrandir</p>
                </button>
                <button
                  type="button"
                  className="text-left"
                  onClick={() => setLightboxSrc(afterSrc)}
                >
                  <p className="mb-1.5 text-xs text-zinc-500">Photoréaliste</p>
                  <img
                    src={afterSrc}
                    alt="Après"
                    className="w-full cursor-zoom-in rounded-xl border border-amber-400/50 transition hover:border-amber-300"
                  />
                  <p className="mt-1 text-[10px] text-zinc-600">Cliquer pour agrandir</p>
                </button>
              </div>
              <div className="flex gap-3">
                <a
                  href={afterSrc}
                  download="roomia-render.jpg"
                  className="flex-1 rounded-xl bg-amber-400 py-2.5 text-center text-sm font-bold text-zinc-950 hover:bg-amber-300"
                >
                  Télécharger
                </a>
                <button
                  type="button"
                  onClick={handleRender}
                  className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm text-zinc-300 hover:border-amber-400 hover:text-amber-400"
                >
                  Réessayer
                </button>
              </div>
            </div>
          )}

          {stage === 'error' && (
            <button
              type="button"
              onClick={handleRender}
              className="w-full rounded-xl bg-amber-400 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-300"
            >
              Réessayer
            </button>
          )}
        </div>
      </div>

      <ImageLightbox src={lightboxSrc} alt="Rendu Roomia" onClose={() => setLightboxSrc(null)} />
    </>
  )
}
