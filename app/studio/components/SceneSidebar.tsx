'use client'

import { useEffect, useRef, useState } from 'react'
import { applySceneView } from '@/lib/studio-import/heavy-view-camera'
import { captureHeavyCamera } from '@/lib/studio-import/heavy-view-camera'
import { UNIT_LABELS, type ImportLengthUnit } from '@/lib/studio-import/fit-imported-room'
import { TIME_LABELS, TIMES_OF_DAY, type TimeOfDay } from '@/lib/render-lighting'
import { DEFAULT_LENS, LENSES, lensHfov, type LensId, type SceneCamera } from '@/lib/scene-cameras'
import { useStudioStore } from '@/store/useStudioStore'
import MaterialRolesPanel from './MaterialRolesPanel'
import type { HeldRender } from '@/lib/held-renders'
import type { ScenePhoto } from '@/lib/scene-photos'

type Phase = 'idle' | 'checking' | 'running' | 'done' | 'error'
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

const withLens = (camera: SceneCamera, lens: LensId): SceneCamera => ({ ...camera, hfov: lensHfov(lens, camera) })

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
  /** Photo from Studio's own camera instead of a saved view (e.g. a saved view stuck behind a wall). */
  const [useCurrent, setUseCurrent] = useState(false)
  const [lens, setLens] = useState<LensId>(DEFAULT_LENS)
  const [time, setTime] = useState<TimeOfDay>('midi')
  const [sun, setSun] = useState(true)
  const [interior, setInterior] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [step, setStep] = useState<Step>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [captureSrc, setCaptureSrc] = useState<string | null>(null)
  const [photoSrc, setPhotoSrc] = useState<string | null>(null)
  const [timings, setTimings] = useState<Timings | null>(null)
  const [fellBack, setFellBack] = useState(false)
  /** The capture shown came from "Vérifier la vue" (free), not from a photo run. */
  const [checked, setChecked] = useState(false)
  const [placeholders, setPlaceholders] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  /** The image service was too slow or down: the user chooses medium quality or holding the photo. */
  const [choice, setChoice] = useState<{ tried: string; reason: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [held, setHeld] = useState<HeldRender[]>([])
  const [photos, setPhotos] = useState<ScenePhoto[]>([])
  const [showAllPhotos, setShowAllPhotos] = useState(false)
  /** What the last photo run asked for, and the held item being run again (if any). */
  const lastRequest = useRef<Record<string, unknown> | null>(null)
  const heldInUse = useRef<string | null>(null)
  const jsonInput = useRef<HTMLInputElement>(null)
  const autoViewDone = useRef(false)

  async function loadLists() {
    const [heldRes, photosRes] = await Promise.all([
      fetch(`/api/scenes/${sceneId}/held`).catch(() => null),
      fetch(`/api/scenes/${sceneId}/photos`).catch(() => null),
    ])
    if (heldRes?.ok) setHeld(((await heldRes.json()) as { held: HeldRender[] }).held)
    if (photosRes?.ok) setPhotos(((await photosRes.json()) as { photos: ScenePhoto[] }).photos)
  }

  useEffect(() => {
    if (!sceneId) return
    let cancelled = false
    Promise.all([
      fetch(`/api/scenes/${sceneId}/held`).then(res => (res.ok ? (res.json() as Promise<{ held: HeldRender[] }>) : null)),
      fetch(`/api/scenes/${sceneId}/photos`).then(res => (res.ok ? (res.json() as Promise<{ photos: ScenePhoto[] }>) : null)),
    ])
      .then(([heldData, photosData]) => {
        if (cancelled) return
        if (heldData) setHeld(heldData.held)
        if (photosData) setPhotos(photosData.photos)
      })
      .catch(() => undefined) // the lists just stay empty
    return () => {
      cancelled = true
    }
  }, [sceneId])

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

  useEffect(() => {
    if (!sceneId) return
    let cancelled = false
    fetch(`/api/scenes/${sceneId}`)
      .then(res => (res.ok ? (res.json() as Promise<{ report?: { placeholderTextures?: number } }>) : null))
      .then(data => {
        if (!cancelled) setPlaceholders(data?.report?.placeholderTextures ?? 0)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sceneId])

  // Land in the first saved view as soon as the scene is on screen, instead of far above the site.
  useEffect(() => {
    if (!cameras.length || autoViewDone.current) return
    const first = Math.max(0, cameras.findIndex(c => !/^dernière vue$/i.test(c.name)))
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (applySceneView(withLens(cameras[first], lens))) {
        autoViewDone.current = true
        setSelected(first)
        clearInterval(timer)
      } else if (tries > 40) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first load; lens changes re-apply below
  }, [cameras])

  useEffect(() => {
    if (phase !== 'running' && phase !== 'checking') return
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [phase])

  function chooseView(index: number) {
    setSelected(index)
    setUseCurrent(false)
    applySceneView(withLens(cameras[index], lens))
  }

  /** What to photograph: a saved view with its lens, or the camera as it is on screen now. */
  function viewRequest(): Record<string, unknown> | null {
    const base = { sceneId, time, sun, interior, lens }
    if (!useCurrent) return selected === null ? null : { ...base, cameraIndex: selected }
    const camera = captureHeavyCamera()
    if (!camera) return null
    return { ...base, current: { position: camera.position, quaternion: camera.quaternion, hfov: camera.hfov } }
  }

  async function checkView() {
    const request = viewRequest()
    if (!request) return
    setPhase('checking')
    setElapsed(0)
    setError(null)
    setPhotoSrc(null)
    setTimings(null)
    try {
      const res = await fetch('/api/render/scene-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok || !res.body) {
        throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `Erreur ${res.status}`)
      }
      // NDJSON: pings keep the link alive during a long capture, then the capture or an error.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let capture: string | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as Record<string, unknown>
          if (event.type === 'error') throw new Error(String(event.detail ?? 'Capture impossible'))
          if (event.type === 'done') capture = String(event.capture_base64)
        }
      }
      if (!capture) throw new Error('La capture s’est arrêtée avant la fin. Réessayez.')
      setCaptureSrc(toUrl(capture, 'image/png'))
      setChecked(true)
      setPhase('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture impossible')
      setPhase('error')
    }
  }

  /** The 3D view shows the lens the photo will use, so what you frame is what you get. */
  function chooseLens(next: LensId) {
    setLens(next)
    if (selected !== null && cameras[selected]) applySceneView(withLens(cameras[selected], next))
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

  /**
   * Runs the photo. `request` replaces the current view (running a held photo again), `quality` is
   * the user's answer "continue in medium", `heldId` is the held photo this run comes from.
   */
  async function generate(opts: { request?: Record<string, unknown>; quality?: 'medium'; heldId?: string } = {}) {
    const request = opts.request ?? viewRequest()
    if (!request) return
    lastRequest.current = request
    heldInUse.current = opts.heldId ?? heldInUse.current
    setPhase('running')
    setStep('capture')
    setElapsed(0)
    setError(null)
    setNotice(null)
    setChoice(null)
    setPhotoSrc(null)
    setCaptureSrc(null)
    setTimings(null)
    setFellBack(false)
    try {
      const res = await fetch('/api/render/scene-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ask: when the image service is slow or down, the Studio asks instead of retrying on its own.
        body: JSON.stringify({ ...request, sceneId, ask: true, ...(opts.quality ? { quality: opts.quality } : {}) }),
      })
      if (!res.ok || !res.body) {
        throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `Erreur ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      let asked = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as Record<string, unknown>
          if (event.type === 'progress') setStep(event.step === 'generating' ? 'photo' : event.step === 'capturing' ? 'capture' : null)
          else if (event.type === 'capture') {
            setCaptureSrc(toUrl(String(event.capture_base64), 'image/png'))
            setChecked(false)
          } else if (event.type === 'choice') {
            setChoice({ tried: String(event.tried), reason: String(event.reason) })
            asked = true
          } else if (event.type === 'error') throw new Error(String(event.detail ?? 'Échec du rendu'))
          else if (event.type === 'done') {
            setPhotoSrc(toUrl(String(event.result_base64), 'image/jpeg'))
            setTimings(event.timings as Timings)
            setFellBack(event.fellBack === true)
            finished = true
          }
        }
      }
      if (asked) {
        setPhase('idle')
        return
      }
      if (!finished) throw new Error('Le rendu s’est arrêté avant la fin.')
      setPhase('done')
      if (heldInUse.current) {
        await fetch(`/api/scenes/${sceneId}/held?held=${heldInUse.current}`, { method: 'DELETE' }).catch(() => undefined)
        heldInUse.current = null
      }
      void loadLists()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec du rendu')
      setPhase('error')
    } finally {
      setStep(null)
    }
  }

  /** "Mettre en attente": keeps the settings (the capture is already kept) to run the photo later. */
  async function holdPhoto() {
    setChoice(null)
    if (!heldInUse.current && lastRequest.current) {
      const res = await fetch(`/api/scenes/${sceneId}/held`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastRequest.current),
      }).catch(() => null)
      if (!res?.ok) {
        setError('La photo n’a pas pu être mise en attente. Réessayez.')
        return
      }
    }
    heldInUse.current = null
    setNotice('Photo mise en attente. Relancez-la depuis « En attente » quand le serveur d’images répond.')
    void loadLists()
  }

  async function dropHeld(id: string) {
    await fetch(`/api/scenes/${sceneId}/held?held=${id}`, { method: 'DELETE' }).catch(() => undefined)
    void loadLists()
  }

  if (!importedRoom?.sceneId) return null
  const running = phase === 'running'
  const busy = running || phase === 'checking'
  const hasView = useCurrent || selected !== null

  return (
    <aside className="flex h-full w-[22rem] flex-shrink-0 flex-col overflow-y-auto border-l border-[var(--rm-text)]/10 bg-[var(--rm-surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--rm-text)]/8 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--rm-text)]" title={importedRoom.fileName}>
            {importedRoom.fileName}
          </p>
          <p className="mt-0.5 text-xs text-[var(--rm-muted)]">Scène importée · prête à rendre</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--rm-muted)]">
            Aperçu allégé pour naviguer : la photo est faite à partir du fichier complet.
          </p>
          {placeholders > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800">
              {placeholders === 1 ? '1 texture n’a pas été exportée' : `${placeholders} textures n’ont pas été exportées`} par
              l’export GLB (remplacées par « invalid Texture »). Ces surfaces gardent leur couleur unie.
            </p>
          )}
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
                    selected === i && !useCurrent
                      ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)] text-[var(--rm-surface)] shadow-sm'
                      : 'border-[var(--rm-text)]/12 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                      selected === i && !useCurrent ? 'bg-[var(--rm-surface)]/20' : 'bg-[var(--rm-text)]/8'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{camera.name}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setUseCurrent(true)}
            className={`mt-2 flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
              useCurrent
                ? 'border-[var(--rm-primary)] bg-[var(--rm-primary)] text-[var(--rm-surface)] shadow-sm'
                : 'border-dashed border-[var(--rm-text)]/20 bg-[var(--rm-bg)] text-[var(--rm-text)] hover:border-[var(--rm-primary)]/50'
            }`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--rm-text)]/8 text-[13px]">◎</span>
            <span className="min-w-0">
              Vue actuelle
              <span className={`block text-xs ${useCurrent ? 'opacity-80' : 'text-[var(--rm-muted)]'}`}>
                Cadrez librement dans la 3D, la photo suit l’écran
              </span>
            </span>
          </button>
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

          {cameras.length > 0 && !useCurrent && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-[var(--rm-text)]">Objectif</p>
              <div className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--rm-text)]/6 p-1">
                {LENSES.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => chooseLens(l.id)}
                    className={`rounded-lg px-1 py-1.5 text-xs transition-all ${
                      lens === l.id
                        ? 'bg-[var(--rm-surface)] font-semibold text-[var(--rm-text)] shadow-sm'
                        : 'text-[var(--rm-muted)] hover:text-[var(--rm-text)]'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[var(--rm-muted)]">
                {lens === 'file'
                  ? 'Le cadrage exact enregistré dans SketchUp.'
                  : lens === '18'
                    ? 'Très grand angle : toute la pièce, un peu déformé sur les bords.'
                    : lens === '24'
                      ? 'Grand angle, le standard des rendus d’intérieur.'
                      : 'Cadrage serré, proche de l’œil.'}
              </p>
            </div>
          )}
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
          <button
            type="button"
            role="switch"
            aria-checked={interior}
            onClick={() => setInterior(v => !v)}
            className="mt-3 flex w-full items-center justify-between rounded-xl border text-left border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 text-sm text-[var(--rm-text)]"
          >
            <span>
              Lumières intérieures
              <span className="block text-xs text-[var(--rm-muted)]">{interior ? 'Spots, suspensions et LED allumés' : 'Seulement la lumière du jour'}</span>
            </span>
            <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${interior ? 'bg-[var(--rm-primary)]' : 'bg-[var(--rm-text)]/20'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${interior ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>
        </section>

        <section>
          <SectionTitle>3 · Générer</SectionTitle>
          <button
            type="button"
            onClick={() => void checkView()}
            disabled={busy || !hasView}
            className="mb-2 w-full rounded-xl border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-4 py-2.5 text-sm font-medium text-[var(--rm-text)] transition-all hover:border-[var(--rm-primary)]/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === 'checking' ? `Capture de la vue… ${formatClock(elapsed)}` : 'Vérifier la vue · gratuit'}
          </button>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || !hasView}
            className="w-full rounded-xl bg-[var(--rm-primary)] px-4 py-3 text-sm font-semibold text-[var(--rm-surface)] shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Génération en cours…' : !hasView ? 'Choisissez une vue' : 'Générer la photo'}
          </button>
          {!busy && (
            <p className="mt-1.5 text-center text-xs text-[var(--rm-muted)]">
              {checked ? 'Vue vérifiée : la photo prend environ 1 minute' : 'Compter 2 à 3 minutes'}
            </p>
          )}

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

          {choice && (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <p className="font-semibold">
                {choice.reason === 'slow' ? 'Le serveur d’images est trop lent en ce moment.' : 'Le serveur d’images ne répond pas.'}
              </p>
              <p>La capture est gardée : rien n’est perdu et aucune photo n’est relancée sans vous. Que voulez-vous faire ?</p>
              <button
                type="button"
                onClick={() => void generate({ request: lastRequest.current ?? undefined, quality: 'medium' })}
                className="w-full rounded-lg bg-[var(--rm-primary)] px-3 py-2 text-sm font-semibold text-[var(--rm-surface)]"
              >
                {choice.tried === 'high' ? 'Continuer en qualité moyenne (environ 40 s)' : 'Réessayer en qualité moyenne'}
              </button>
              <button
                type="button"
                onClick={() => void holdPhoto()}
                className="w-full rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900"
              >
                Mettre en attente, je relance plus tard
              </button>
            </div>
          )}
          {notice && <p className="mt-3 rounded-lg bg-[var(--rm-text)]/6 px-3 py-2 text-xs leading-relaxed text-[var(--rm-text)]">{notice}</p>}
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">{error}</p>}
        </section>

        {held.length > 0 && (
          <section>
            <SectionTitle>En attente · {held.length}</SectionTitle>
            <ul className="space-y-1.5">
              {held.map(item => (
                <li key={item.id} className="flex items-center gap-2 rounded-lg border border-[var(--rm-text)]/10 bg-[var(--rm-bg)] px-2.5 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-[var(--rm-text)]" title={item.label}>
                    {item.label}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void generate({ request: item.request, heldId: item.id })}
                    className="shrink-0 rounded-md bg-[var(--rm-primary)] px-2.5 py-1.5 font-semibold text-[var(--rm-surface)] disabled:opacity-50"
                  >
                    Relancer
                  </button>
                  <button
                    type="button"
                    onClick={() => void dropHeld(item.id)}
                    className="shrink-0 px-1 text-[var(--rm-muted)] hover:text-red-700"
                    aria-label={`Supprimer ${item.label}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-[var(--rm-muted)]">La capture est gardée : relancer ne refait que la photo (environ 1 minute).</p>
          </section>
        )}

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
                    download={`roomia-${(useCurrent ? 'vue-actuelle' : (cameras[selected ?? 0]?.name ?? 'scene')).replace(/\s+/g, '-').toLowerCase()}.jpg`}
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
                    {fellBack ? ' · qualité moyenne (le serveur d’images était trop lent en haute qualité)' : ''}
                  </p>
                )}
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={captureSrc ?? ''} alt="Capture de la scène" className={`w-full rounded-xl ${checked ? '' : 'opacity-80'}`} />
                {checked && (
                  <p className="mt-2 text-xs leading-relaxed text-[var(--rm-muted)]">
                    Capture de vérification (gratuite), avant l’étape photo. Si le cadrage est bon, cliquez sur « Générer la photo ».
                    Sinon, changez de vue ou d’objectif, ou cadrez vous-même avec « Vue actuelle ».
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setAdvancedOpen(true)}
              className="mt-2 text-left text-xs text-[var(--rm-muted)] underline underline-offset-2 hover:text-[var(--rm-text)]"
            >
              Un miroir, une vitre ou une lumière mal rendu ? Corriger un matériau
            </button>
          </section>
        )}

        {photos.length > 0 && (
          <section>
            <SectionTitle>Mes photos · {photos.length}</SectionTitle>
            <div className="grid grid-cols-3 gap-1.5">
              {photos.slice(0, showAllPhotos ? photos.length : 9).map(photo => (
                <a
                  key={photo.file}
                  href={`/api/scenes/${sceneId}/photos/${photo.file}`}
                  target="_blank"
                  rel="noreferrer"
                  title={[photo.view, photo.time, photo.lens && `${photo.lens} mm`, photo.quality, photo.fellBack && 'qualité moyenne (secours)'].filter(Boolean).join(' · ')}
                  className="block overflow-hidden rounded-lg border border-[var(--rm-text)]/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/scenes/${sceneId}/photos/${photo.file}?w=360`} alt={photo.view ?? 'Photo'} loading="lazy" className="aspect-[3/2] w-full object-cover" />
                </a>
              ))}
            </div>
            {photos.length > 9 && (
              <button
                type="button"
                onClick={() => setShowAllPhotos(v => !v)}
                className="mt-2 text-xs text-[var(--rm-muted)] underline underline-offset-2 hover:text-[var(--rm-text)]"
              >
                {showAllPhotos ? 'Voir moins' : `Voir les ${photos.length} photos`}
              </button>
            )}
            <p className="mt-1.5 text-xs text-[var(--rm-muted)]">Toutes les photos de cette scène sont gardées, même si votre connexion coupe.</p>
          </section>
        )}

        <details
          open={advancedOpen}
          onToggle={e => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
          className="group rounded-xl border border-[var(--rm-text)]/10 px-3 py-2.5 text-xs text-[var(--rm-muted)]"
        >
          <summary className="cursor-pointer select-none font-medium text-[var(--rm-text)]">Options avancées</summary>
          <div className="mt-3 space-y-3">
            {/* Only useful once there is a capture or photo to correct: a mirror, glass or lamp rendered wrong. */}
            {(photoSrc || captureSrc) && <MaterialRolesPanel sceneId={sceneId} />}
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
            {importedRoom.warning && <p className="leading-relaxed text-amber-800">{importedRoom.warning}</p>}
          </div>
        </details>
      </div>
    </aside>
  )
}
