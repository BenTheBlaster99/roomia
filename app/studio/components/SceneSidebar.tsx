'use client'

import { useEffect, useRef, useState } from 'react'
import { applySceneView } from '@/lib/studio-import/heavy-view-camera'
import { captureHeavyCamera } from '@/lib/studio-import/heavy-view-camera'
import { UNIT_LABELS, type ImportLengthUnit } from '@/lib/studio-import/fit-imported-room'
import { TIME_LABELS, TIMES_OF_DAY, type TimeOfDay } from '@/lib/render-lighting'
import type { SceneCamera } from '@/lib/scene-cameras'
import { useStudioStore } from '@/store/useStudioStore'

type Phase = 'idle' | 'running' | 'done' | 'error'
type Step = 'capture' | 'photo' | null

interface Timings {
  capture: number
  photo: number
  total: number
}

/** Sky colour dot for each moment of the day. */
const TIME_DOT: Record<TimeOfDay, string> = {
  matin: 'linear-gradient(135deg,#fde68a,#fdba74)',
  midi: 'linear-gradient(135deg,#fff7d6,#bae6fd)',
  'apres-midi': 'linear-gradient(135deg,#fb923c,#f472b6)',
  soiree: 'linear-gradient(135deg,#4338ca,#1e1b4b)',
}

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function toUrl(b64: string, type: string) {
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type }))
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--rm-muted)]">{children}</h3>
}

/** Right-hand panel for an imported scene: pick a saved view, set the light, generate the photo. */
export default function SceneSidebar() {
  const importedRoom = useStudioStore(s => s.importedRoom)
  const clearImportedRoom = useStudioStore(s => s.clearImportedRoom)
  const setImportFit = useStudioStore(s => s.setImportFit)
  const sceneId = importedRoom?.sceneId ?? ''

  const [cameras, setCameras] = useState<SceneCamera[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [time, setTime] = useState<TimeOfDay>('midi')
  const [sun, setSun] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState<Step>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [captureSrc, setCaptureSrc] = useState<string | null>(null)
  const [photoSrc, setPhotoSrc] = useState<string | null>(null)
  const [timings, setTimings] = useState<Timings | null>(null)
  const [greySrc, setGreySrc] = useState<string | null>(null)
  const [greyBusy, setGreyBusy] = useState(false)
  const jsonInput = useRef<HTMLInputElement>(null)
  const autoViewDone = useRef(false)

  useEffect(() => {
    if (!sceneId) return
    let cancelled = false
    fetch(`/api/scenes/${sceneId}/cameras`)
      .then(res => (res.ok ? (res.json() as Promise<{ cameras: SceneCamera[] }>) : null))
      .then(data => {
        if (data && !cancelled) setCameras(data.cameras)
      })
      .catch(() => undefined) // the panel just stays empty; the rest of Studio keeps working
    return () => {
      cancelled = true
    }
  }, [sceneId, reloadKey])

  // Land in the first saved view as soon as the scene is on screen, instead of far above the site.
  useEffect(() => {
    if (!cameras.length || autoViewDone.current) return
    const first = Math.max(0, cameras.findIndex(c => !/^dernière vue$/i.test(c.name)))
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (applySceneView(cameras[first])) {
        autoViewDone.current = true
        setSelected(first)
        clearInterval(timer)
      } else if (tries > 40) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [cameras])

  useEffect(() => {
    if (phase !== 'running') return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [phase])

  function chooseView(index: number) {
    setSelected(index)
    applySceneView(cameras[index])
  }

  async function importScenesJson(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const res = await fetch(`/api/scenes/${sceneId}/cameras`, { method: 'PUT', body: await file.text() })
      if (!res.ok) {
        throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? 'Import impossible')
      }
      autoViewDone.current = false
      setReloadKey(k => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import impossible')
    }
  }

  async function generate() {
    if (selected === null) return
    setPhase('running')
    setStep('capture')
    setElapsed(0)
    setError(null)
    setPhotoSrc(null)
    setCaptureSrc(null)
    setTimings(null)
    try {
      const res = await fetch('/api/render/scene-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, cameraIndex: selected, time, sun }),
      })
      if (!res.ok || !res.body) {
        throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `Erreur ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as Record<string, unknown>
          if (event.type === 'progress') setStep(event.step === 'generating' ? 'photo' : event.step === 'capturing' ? 'capture' : null)
          else if (event.type === 'capture') setCaptureSrc(toUrl(String(event.capture_base64), 'image/png'))
          else if (event.type === 'error') throw new Error(String(event.detail ?? 'Échec du rendu'))
          else if (event.type === 'done') {
            setPhotoSrc(toUrl(String(event.result_base64), 'image/jpeg'))
            setTimings(event.timings as Timings)
            finished = true
          }
        }
      }
      if (!finished) throw new Error('Le rendu s’est arrêté avant la fin.')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du rendu')
      setPhase('error')
    } finally {
      setStep(null)
    }
  }

  async function greyCapture() {
    const camera = captureHeavyCamera()
    if (!camera) return
    setGreyBusy(true)
    try {
      const res = await fetch('/api/render/heavy-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...camera, sceneId }),
      })
      if (res.ok) setGreySrc(URL.createObjectURL(await res.blob()))
    } finally {
      setGreyBusy(false)
    }
  }

  if (!importedRoom?.sceneId) return null
  const running = phase === 'running'

  return (
    <aside className="flex h-full w-[22rem] flex-shrink-0 flex-col overflow-y-auto border-l border-[var(--rm-text)]/10 bg-[var(--rm-surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--rm-text)]/8 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--rm-text)]" title={importedRoom.fileName}>
            {importedRoom.fileName}
          </p>
          <p className="mt-0.5 text-xs text-[var(--rm-muted)]">Scène importée · prête à rendre</p>
        </div>
        <button
          type="button"
          onClick={clearImportedRoom}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--rm-muted)] transition-colors hover:bg-red-50 hover:text-red-700"
        >
          Retirer
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        <section>
          <SectionTitle>1 · Choisir la vue</SectionTitle>
          {cameras.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--rm-text)]/20 px-4 py-5 text-center">
              <p className="text-xs leading-relaxed text-[var(--rm-muted)]">
                Aucune vue enregistrée dans ce fichier. Importez le JSON exporté de SketchUp (extension Z5 Camera Transfer).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {cameras.map((camera, i) => (
                <button
                  key={`${camera.name}-${i}`}
                  type="button"
                  onClick={() => chooseView(i)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                    selected === i
                      ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)] text-[var(--rm-surface)] shadow-sm'
                      : 'border-[var(--rm-text)]/12 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      selected === i ? 'bg-[var(--rm-surface)]/20' : 'bg-[var(--rm-text)]/8'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{camera.name}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={jsonInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              void importScenesJson(file)
            }}
          />
          <button
            type="button"
            onClick={() => jsonInput.current?.click()}
            className="mt-2 text-xs text-[var(--rm-muted)] underline underline-offset-2 hover:text-[var(--rm-text)]"
          >
            {cameras.length ? 'Remplacer les vues (.json)' : 'Importer les vues (.json)'}
          </button>
        </section>

        <section>
          <SectionTitle>2 · Régler la lumière</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {TIMES_OF_DAY.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTime(t)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                  time === t
                    ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)]/8 text-[var(--rm-text)] ring-1 ring-[var(--rm-primary)]'
                    : 'border-[var(--rm-text)]/12 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
                }`}
              >
                <span className="h-4 w-4 shrink-0 rounded-full border border-black/10" style={{ background: TIME_DOT[t] }} />
                <span className="truncate">{TIME_LABELS[t]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={sun}
            onClick={() => setSun(v => !v)}
            className="mt-3 flex w-full items-center justify-between rounded-xl border text-left border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 text-sm text-[var(--rm-text)]"
          >
            <span>
              Soleil direct
              <span className="block text-xs text-[var(--rm-muted)]">{sun ? 'Rayons de soleil dans la pièce' : 'Lumière douce, sans rayons'}</span>
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${sun ? 'bg-[var(--rm-primary)]' : 'bg-[var(--rm-text)]/20'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${sun ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>
        </section>

        <section>
          <SectionTitle>3 · Générer</SectionTitle>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={running || selected === null || cameras.length === 0}
            className="w-full rounded-xl bg-[var(--rm-primary)] px-4 py-3 text-sm font-semibold text-[var(--rm-surface)] shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Génération en cours…' : selected === null ? 'Choisissez une vue' : 'Générer la photo'}
          </button>
          {!running && <p className="mt-1.5 text-center text-xs text-[var(--rm-muted)]">Compter 1 à 2 minutes</p>}

          {running && (
            <div className="mt-3 rounded-xl border border-[var(--rm-text)]/10 bg-[var(--rm-bg)] p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--rm-text)]">{step === 'photo' ? 'Création de la photo' : 'Capture de la vue'}</span>
                <span className="tabular-nums text-[var(--rm-muted)]">{formatClock(elapsed)}</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                <span className={`h-1.5 flex-1 rounded-full ${step === 'capture' ? 'animate-pulse bg-[var(--rm-primary)]' : 'bg-[var(--rm-primary)]'}`} />
                <span className={`h-1.5 flex-1 rounded-full ${step === 'photo' ? 'animate-pulse bg-[var(--rm-primary)]' : 'bg-[var(--rm-text)]/12'}`} />
              </div>
              <p className="mt-2 text-xs text-[var(--rm-muted)]">Ne fermez pas cette page.</p>
            </div>
          )}

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">{error}</p>}
        </section>

        {(photoSrc || captureSrc) && (
          <section>
            <SectionTitle>Résultat</SectionTitle>
            {photoSrc ? (
              <>
                <a href={photoSrc} target="_blank" rel="noreferrer" title="Ouvrir en grand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoSrc} alt="Photo de la scène" className="w-full rounded-xl shadow-md" />
                </a>
                <div className="mt-2 flex gap-2">
                  <a
                    href={photoSrc}
                    download={`roomia-${(cameras[selected ?? 0]?.name ?? 'scene').replace(/\s+/g, '-').toLowerCase()}.jpg`}
                    className="flex-1 rounded-lg border border-[var(--rm-text)]/15 px-3 py-2 text-center text-xs font-medium text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50"
                  >
                    Télécharger
                  </a>
                  <a
                    href={photoSrc}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 rounded-lg border border-[var(--rm-text)]/15 px-3 py-2 text-center text-xs font-medium text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50"
                  >
                    Ouvrir en grand
                  </a>
                </div>
                {timings && (
                  <p className="mt-2 text-xs text-[var(--rm-muted)]">
                    Capture {timings.capture} s · photo {timings.photo} s · total {timings.total} s
                  </p>
                )}
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={captureSrc ?? ''} alt="Capture de la scène" className="w-full rounded-xl opacity-80" />
            )}
          </section>
        )}

        <details className="group rounded-xl border border-[var(--rm-text)]/10 px-3 py-2.5 text-xs text-[var(--rm-muted)]">
          <summary className="cursor-pointer select-none font-medium text-[var(--rm-text)]">Options avancées</summary>
          <div className="mt-3 space-y-3">
            <label className="flex items-center justify-between gap-3">
              Unité
              <select
                value={importedRoom.unit}
                onChange={e => setImportFit({ unit: e.target.value as ImportLengthUnit })}
                className="rounded-md border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-2 py-1 text-[var(--rm-text)]"
              >
                {(Object.keys(UNIT_LABELS) as ImportLengthUnit[]).map(key => (
                  <option key={key} value={key}>
                    {UNIT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={importedRoom.zUp} onChange={e => setImportFit({ zUp: e.target.checked })} />
              Z vers le haut (SketchUp)
            </label>
            <button
              type="button"
              onClick={() => void greyCapture()}
              disabled={greyBusy}
              className="w-full rounded-lg border border-[var(--rm-text)]/15 px-3 py-2 text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50 disabled:opacity-50"
            >
              {greyBusy ? 'Capture…' : 'Capture grise de la vue actuelle'}
            </button>
            {greySrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={greySrc} alt="Capture grise" className="w-full rounded-lg" />
            )}
            {importedRoom.warning && <p className="leading-relaxed text-amber-800">{importedRoom.warning}</p>}
          </div>
        </details>
      </div>
    </aside>
  )
}
