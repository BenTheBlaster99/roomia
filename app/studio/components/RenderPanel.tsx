'use client'

import { useState } from 'react'
import { useStudioStore } from '@/store/useStudioStore'
import { FLOOR_MATERIALS } from '@/lib/studio-constants'
import ImageLightbox from '@/components/ImageLightbox'

type ProgressStep = 'capturing' | 'generating' | 'results'

const PROGRESS_STEPS: { id: ProgressStep; title: string }[] = [
  { id: 'capturing', title: 'Step 1 · Capture' },
  { id: 'generating', title: 'Step 2 · Generating' },
  { id: 'results', title: 'Step 3 · Results' },
]

function progressIndex(step: ProgressStep): number {
  return PROGRESS_STEPS.findIndex(s => s.id === step)
}

export default function RenderPanel() {
  const { renderPanelOpen, setRenderPanelOpen, canvasRef, room, activeRoom, setViewMode } =
    useStudioStore()
  const [stage, setStage] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle')
  const [beforeSrc, setBeforeSrc] = useState('')
  const [afterSrc, setAfterSrc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [useEyeLevel, setUseEyeLevel] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [progressStep, setProgressStep] = useState<ProgressStep>('capturing')
  const [progressPct, setProgressPct] = useState(0)
  const [progressDetail, setProgressDetail] = useState('Preparing…')

  if (!renderPanelOpen) return null

  async function handleRender() {
    if (!canvasRef) {
      setError('Impossible de capturer la vue 3D. Réessayez.')
      setStage('error')
      return
    }

    setStage('rendering')
    setError(null)
    setProgressStep('capturing')
    setProgressPct(10)
    setProgressDetail('Capturing studio view…')

    const store = useStudioStore.getState()
    const previousView = store.viewMode

    try {
      store.setCaptureMode(true)
      store.selectItem(null)

      if (useEyeLevel) {
        store.setViewMode('capture')
        await new Promise(r => setTimeout(r, 900))
      } else {
        await new Promise(r => setTimeout(r, 350))
      }

      const dataUrl = canvasRef.toDataURL('image/jpeg', 0.95)
      store.setCaptureMode(false)
      if (useEyeLevel) {
        store.setViewMode(previousView === 'capture' ? 'perspective' : previousView)
      }

      setBeforeSrc(dataUrl)
      setProgressStep('generating')
      setProgressPct(40)
      setProgressDetail('Sending to GPT Image 2…')

      const res = await fetch('/api/render/photorealistic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: dataUrl.split(',')[1],
          floor_material: FLOOR_MATERIALS[room.floorMaterial]?.label ?? '',
          wall_color: room.wallColor,
          room_type: activeRoom,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Render error ${res.status}`)
      }

      if (!res.body) {
        throw new Error('Render stream unavailable')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let resultBase64: string | null = null

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
            result_base64?: string
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
          } else if (event.type === 'done' && event.result_base64) {
            resultBase64 = event.result_base64
            setProgressStep('results')
            setProgressPct(100)
            setProgressDetail('Done')
          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Render failed')
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as {
            type: string
            result_base64?: string
            detail?: string
          }
          if (event.type === 'done' && event.result_base64) {
            resultBase64 = event.result_base64
          } else if (event.type === 'error') {
            throw new Error(event.detail ?? 'Render failed')
          }
        } catch (trailErr) {
          if (trailErr instanceof SyntaxError) {
            if (!resultBase64) throw new Error('Stream ended unexpectedly')
          } else {
            throw trailErr
          }
        }
      }

      if (!resultBase64) {
        throw new Error('No render returned')
      }

      setAfterSrc(`data:image/jpeg;base64,${resultBase64}`)
      setStage('done')
    } catch (err: unknown) {
      useStudioStore.getState().setCaptureMode(false)
      if (useEyeLevel) {
        useStudioStore
          .getState()
          .setViewMode(previousView === 'capture' ? 'perspective' : previousView)
      }

      const message = err instanceof Error ? err.message : 'Something went wrong'
      const lower = message.toLowerCase()
      let friendly = message
      if (lower.includes('fetch') || lower.includes('network') || lower.includes('failed to fetch')) {
        friendly =
          'Passerelle de rendu inaccessible. Vérifiez que le serveur Next tourne et que OPENAI_API_KEY / OPENAI_BASE_URL sont configurés.'
      } else if (lower.includes('401') || lower.includes('403') || lower.includes('api key')) {
        friendly =
          'Authentification API refusée. Vérifiez OPENAI_API_KEY (et OPENAI_BASE_URL si vous utilisez une passerelle).'
      } else if (lower.includes('429') || lower.includes('rate')) {
        friendly = 'Trop de requêtes pour le moment. Attendez quelques secondes puis réessayez.'
      } else if (lower.includes('no image') || lower.includes('no render') || lower.includes('empty')) {
        friendly =
          'Le modèle n’a renvoyé aucune image. Réessayez, ou changez légèrement l’angle de caméra.'
      } else if (lower.includes('timeout') || lower.includes('timed out')) {
        friendly = 'Le rendu a expiré. Réessayez avec une scène plus simple ou un autre cadrage.'
      }
      setError(friendly)
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
    setProgressStep('capturing')
    setProgressPct(0)
    setProgressDetail('Preparing…')
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
                GPT Image 2 · 1 variation · même clé API que le Composer
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
                masqués), puis GPT Image 2 — comme le Composer.
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
              <div className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-800/40 px-4 py-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-200">
                    {PROGRESS_STEPS[progressIndex(progressStep)]?.title ?? 'Working…'}
                  </p>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {Math.round(progressPct)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-700">
                  <div
                    className="h-full rounded-full bg-amber-400 transition-[width] duration-500 ease-out"
                    style={{ width: `${Math.min(100, Math.max(4, progressPct))}%` }}
                  />
                </div>
                <ol className="space-y-2">
                  {PROGRESS_STEPS.map((step, i) => {
                    const activeIdx = progressIndex(progressStep)
                    const done = i < activeIdx
                    const active = i === activeIdx
                    return (
                      <li
                        key={step.id}
                        className={`flex items-center gap-3 text-sm ${
                          active
                            ? 'font-medium text-amber-400'
                            : done
                              ? 'text-zinc-200'
                              : 'text-zinc-500'
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            active
                              ? 'bg-amber-400 text-zinc-950'
                              : done
                                ? 'bg-amber-400/20 text-amber-400'
                                : 'bg-zinc-700 text-zinc-500'
                          }`}
                        >
                          {done ? '✓' : i + 1}
                        </span>
                        <span>{step.title.replace(/^Step \d+ · /, '')}</span>
                        {active && (
                          <span className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
                        )}
                      </li>
                    )
                  })}
                </ol>
                <p className="text-xs text-zinc-500">{progressDetail}</p>
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
                  <p className="mb-1.5 text-xs text-zinc-500">Photoréaliste (GPT Image 2)</p>
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
