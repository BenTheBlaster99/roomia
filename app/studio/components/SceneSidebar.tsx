'use client'

import { useEffect, useRef, useState } from 'react'
import { applySceneView } from '@/lib/studio-import/heavy-view-camera'
import { captureHeavyCamera } from '@/lib/studio-import/heavy-view-camera'
import { type TimeOfDay } from '@/lib/render-lighting'
import { DEFAULT_LENS, LENSES, lensHfov, type LensId, type SceneCamera } from '@/lib/scene-cameras'
import { useStudioStore } from '@/store/useStudioStore'
import type { HeldRender } from '@/lib/held-renders'
import type { ScenePhoto } from '@/lib/scene-photos'
import { forfaitLeft, type Forfait } from '@/lib/forfait'
import MaterialFamiliesPanel from './MaterialFamiliesPanel'
import DesktopRenderNotice from './DesktopRenderNotice'
import Icon from './Icon'

type Phase = 'idle' | 'checking' | 'running' | 'done' | 'error'
type Step = 'capture' | 'photo' | null

interface Timings {
  capture: number
  photo: number
  total: number
}

/** The photo's ambiance (11 Nov): what a client asks for, as the photo route's lighting. */
const AMBIANCES: { key: 'jour' | 'soiree' | 'nuit'; label: string; time: TimeOfDay; sun: boolean; dot: string; hint: string }[] = [
  { key: 'jour', label: 'Jour', time: 'apres-midi', sun: true, dot: 'linear-gradient(135deg,#fff7d6,#bae6fd)', hint: 'Plein jour, lumières allumées.' },
  { key: 'soiree', label: 'Soirée', time: 'soiree', sun: true, dot: 'linear-gradient(135deg,#fb923c,#f472b6)', hint: 'Fin de journée, lumière chaude.' },
  { key: 'nuit', label: 'Nuit', time: 'soiree', sun: false, dot: 'linear-gradient(135deg,#4338ca,#1e1b4b)', hint: 'Nuit, seulement les lumières de la maison.' },
]
const ambianceOf = (time: TimeOfDay, sun: boolean) => (time === 'soiree' ? (sun ? 'soiree' : 'nuit') : 'jour')

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function toUrl(b64: string, type: string) {
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type }))
}

const withLens = (camera: SceneCamera, lens: LensId): SceneCamera => ({ ...camera, hfov: lensHfov(lens, camera) })


/** Right-hand panel for an imported scene: pick a saved view, set the light, generate the photo. */
export default function SceneSidebar() {
  const importedRoom = useStudioStore(s => s.importedRoom)
  const clearImportedRoom = useStudioStore(s => s.clearImportedRoom)
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
  /** Signed-in account and its render credits (null where the Studio has no accounts). */
  const [account, setAccount] = useState<{ name: string; credits: number; forfait?: Forfait | null } | null>(null)
  /** Roomia Desktop with nobody signed in (or Roomia's server out of reach): the photo IA needs the account. */
  const [desktopAccount, setDesktopAccount] = useState<'signed-out' | 'offline' | null>(null)
  /** The last delivered photo, so it can be reported if it doesn't respect the design. */
  const [lastPhoto, setLastPhoto] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [reportText, setReportText] = useState('')
  const [reportState, setReportState] = useState<{ ok: boolean; text: string } | null>(null)
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

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then(async res => {
        const data = (await res.json().catch(() => null)) as { user?: { name: string; credits: number; forfait?: Forfait | null }; desktop?: boolean } | null
        if (cancelled || !data) return
        if (res.ok && data.user) setAccount({ name: data.user.name, credits: data.user.credits, forfait: data.user.forfait ?? null })
        else if (data.desktop) setDesktopAccount(res.status === 401 ? 'signed-out' : 'offline')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function sendReport() {
    if (!lastPhoto) return
    const res = await fetch(`/api/scenes/${sceneId}/photos/${lastPhoto}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reportText }),
    }).catch(() => null)
    const detail = res ? ((await res.json().catch(() => ({}))) as { detail?: string }).detail : null
    setReportState(
      res?.ok
        ? { ok: true, text: 'Merci, c’est noté. Roomia regarde la photo et vous recontacte (crédit remboursé si le design n’est pas respecté).' }
        : { ok: false, text: detail ?? 'Envoi impossible, réessayez.' },
    )
    if (res?.ok) setReporting(false)
  }

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

  // a scene picked in the 3D view's bottom bar (18 Nov, the walk) is the photo's scene too, with this panel's lens
  useEffect(() => {
    const onPick = (e: Event) => {
      const index = (e as CustomEvent<{ index: number }>).detail?.index
      if (typeof index !== 'number' || !cameras[index]) return
      setSelected(index)
      setUseCurrent(false)
      applySceneView(withLens(cameras[index], lens))
    }
    window.addEventListener('roomia:scene-view', onPick)
    return () => window.removeEventListener('roomia:scene-view', onPick)
  }, [cameras, lens])

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
        // jobId: a new one for every attempt, so a double click or a retry is never charged twice.
        body: JSON.stringify({ ...request, sceneId, ask: true, jobId: crypto.randomUUID(), ...(opts.quality ? { quality: opts.quality } : {}) }),
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
            setLastPhoto(typeof event.photoFile === 'string' ? event.photoFile : null)
            setReporting(false)
            setReportState(null)
            if (typeof event.credits === 'number') {
              // a forfait counts this photo (not when the server only gave back one it had already delivered)
              setAccount(a =>
                a
                  ? {
                      ...a,
                      credits: Number(event.credits),
                      forfait:
                        a.forfait && a.credits !== Number(event.credits)
                          ? { ...a.forfait, items: a.forfait.items.map(i => (i.key === 'photo' ? { ...i, used: i.used + 1 } : i)) }
                          : a.forfait,
                    }
                  : a,
              )
            }
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
  // No photo without a credit: the request would be refused anyway, after a capture that takes minutes on a CPU-only PC.
  const photosLeft = forfaitLeft(account?.forfait, 'photo')
  const noCredits = !!account && (photosLeft !== null ? photosLeft < 1 : account.credits < 1)
  const hasView = useCurrent || selected !== null

  // the photo of a saved view, else its 360° (centred on the camera), shown on its card
  const thumbOf = (name: string, i: number) => {
    const photo = photos.find(p => p.view === name)
    return photo ? { src: `/api/scenes/${sceneId}/photos/${photo.file}?w=360`, pano: false } : { src: `/api/scenes/${sceneId}/tour/pano-${i}.jpg`, pano: true }
  }
  const ambiance = AMBIANCES.find(a => a.key === ambianceOf(time, sun))
  // one notice at a time at the foot of the panel, the one the person must act on first
  const blocker =
    desktopAccount === 'offline'
      ? { tone: 'warn', text: 'Pas de connexion au serveur Roomia : la photo attend la connexion. Vérifiez internet.' }
      : desktopAccount === 'signed-out'
        ? { tone: 'info', text: 'signed-out' }
        : noCredits
          ? { tone: 'warn', text: 'Plus de photos dans votre forfait. Contactez Roomia pour l’étendre.' }
          : null

  return (
    <aside className="flex h-full w-[24rem] flex-shrink-0 flex-col border-l border-[var(--brand-line)] bg-white">
      {/* the project, and its page */}
      <div className="border-b border-[var(--brand-line)] px-5 pb-4 pt-4">
        <div className="mb-2 flex items-center justify-end gap-2">
          <button type="button" onClick={clearImportedRoom} className="ui-btn ui-btn--quiet ui-btn--sm" title="Fermer cette scène dans le Studio (le projet reste dans Mes projets)">
            Fermer
          </button>
        </div>
        <h2 className="truncate text-[19px] font-bold text-[var(--brand-ink)]" title={importedRoom.fileName}>
          {importedRoom.fileName.replace(/\.(zip|glb|dae)$/i, '')}
        </h2>
        <a href={`/studio/tour/${sceneId}`} className="ui-btn ui-btn--ghost ui-btn--block mt-3 !justify-between !rounded-[12px] !border-[#ead8b8] !bg-[var(--brand-gold-tint)] !text-[var(--brand-ink)] hover:!border-[var(--brand-gold)]">
          <span className="flex items-center gap-2">
            <Icon name="pano" size={18} className="text-[var(--brand-gold-dark)]" />
            Page du projet
            <span className="font-normal text-[var(--brand-muted)]">360°, plans, vidéo</span>
          </span>
          <Icon name="arrow" size={16} />
        </a>
        {placeholders > 0 && (
          <p className="ui-notice ui-notice--warn mt-3 !text-[13px]">
            <Icon name="warn" size={15} />
            <span>
              {placeholders === 1 ? '1 texture n’a pas été exportée' : `${placeholders} textures n’ont pas été exportées`} depuis SketchUp : ces surfaces gardent leur
              couleur unie.
            </span>
          </p>
        )}
        {importedRoom.warning && (
          <p className="ui-notice ui-notice--warn mt-3 !text-[13px]">
            <Icon name="warn" size={15} />
            <span>{importedRoom.warning}</span>
          </p>
        )}
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
        {/* 1 · the view */}
        <section>
          <StepTitle n={1}>La vue</StepTitle>
          <button
            type="button"
            onClick={() => setUseCurrent(true)}
            aria-pressed={useCurrent}
            className={`mb-3 flex w-full items-center gap-3 rounded-[14px] border-2 bg-white px-3.5 py-3 text-left transition-all ${
              useCurrent ? 'border-[var(--brand-gold)] shadow-[0_0_0_3px_var(--brand-gold-tint)]' : 'border-[var(--brand-line)] hover:border-[var(--brand-blue-line)]'
            }`}
          >
            <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${useCurrent ? 'bg-[var(--brand-gold)] text-[var(--brand-blue-night)]' : 'bg-[var(--brand-blue-tint)] text-[var(--brand-blue)]'}`}>
              <Icon name="camera" size={19} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-[var(--brand-ink)]">Cadrer librement</span>
              <span className="block text-[13px] text-[var(--brand-muted)]">La photo reprend ce que montre la 3D</span>
            </span>
          </button>

          {cameras.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-[var(--brand-line-strong)] px-4 py-4 text-[13px] leading-relaxed text-[var(--brand-ink-soft)]">
              Aucune scène SketchUp dans ce fichier. Pour retrouver vos cadrages, enregistrez vos vues dans SketchUp (Fenêtre → Scènes → +), puis renvoyez le
              projet avec <b>Extensions → Roomia → Envoyer à Roomia</b>.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {cameras.map((camera, i) => {
                const on = selected === i && !useCurrent
                const thumb = thumbOf(camera.name, i)
                return (
                  <button
                    key={`${camera.name}-${i}`}
                    type="button"
                    onClick={() => chooseView(i)}
                    aria-pressed={on}
                    className={`group relative overflow-hidden rounded-[12px] border-2 bg-white text-left transition-all ${
                      on ? 'border-[var(--brand-gold)] shadow-[0_0_0_3px_var(--brand-gold-tint)]' : 'border-[var(--brand-line)] hover:border-[var(--brand-blue-line)]'
                    }`}
                  >
                    <span className="relative block aspect-[16/10] overflow-hidden bg-[var(--brand-blue-tint)]">
                      <span className="absolute inset-0 flex items-center justify-center font-[family-name:var(--font-display)] text-[22px] font-extrabold text-[var(--brand-blue)]/35">
                        {i + 1}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb.src}
                        alt=""
                        loading="lazy"
                        className={`relative h-full w-full object-cover ${thumb.pano ? 'scale-[2.6]' : ''}`}
                        onError={e => (e.currentTarget.style.display = 'none')}
                      />
                      {on && (
                        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-gold)] text-[var(--brand-blue-night)]">
                          <Icon name="check" size={14} strokeWidth={2.4} />
                        </span>
                      )}
                    </span>
                    <span className="block truncate px-2.5 py-2 text-[13px] font-semibold text-[var(--brand-ink)]">{camera.name}</span>
                  </button>
                )
              })}
            </div>
          )}

          {cameras.length > 0 && !useCurrent && (
            <div className="mt-4">
              <p className="ui-label mb-2">Angle de vue</p>
              <div className="ui-seg w-full" role="group" aria-label="Angle de vue">
                {LENSES.map(l => (
                  <button key={l.id} type="button" className="flex-1" aria-pressed={lens === l.id} onClick={() => chooseLens(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-[var(--brand-muted)]">
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
          <button type="button" onClick={() => jsonInput.current?.click()} className="mt-3 text-[12px] text-[var(--brand-muted)] underline underline-offset-2 hover:text-[var(--brand-blue)]">
            {cameras.length ? 'Remplacer les vues par un fichier .json' : 'Importer des vues depuis un fichier .json'}
          </button>
        </section>

        {/* 2 · the light: what each ambiance looks like, not a coloured dot */}
        <section>
          <StepTitle n={2}>L’ambiance</StepTitle>
          <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Ambiance de la photo">
            {AMBIANCES.map(a => {
              const on = ambianceOf(time, sun) === a.key
              return (
                <button
                  key={a.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setTime(a.time)
                    setSun(a.sun)
                    setInterior(true)
                  }}
                  className={`overflow-hidden rounded-[12px] border-2 bg-white text-left transition-all ${
                    on ? 'border-[var(--brand-gold)] shadow-[0_0_0_3px_var(--brand-gold-tint)]' : 'border-[var(--brand-line)] hover:border-[var(--brand-blue-line)]'
                  }`}
                >
                  <AmbianceArt kind={a.key} />
                  <span className="block px-2.5 py-2 text-[13px] font-semibold text-[var(--brand-ink)]">{a.label}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[13px] text-[var(--brand-muted)]">
            {ambiance?.hint} La visite 360° reste en plein jour.
          </p>
        </section>

        {/* 3 · what the surfaces are (18 Nov): their real finish in the 360° render, remembered on this PC */}
        <section>
          <MaterialFamiliesPanel sceneId={sceneId} />
        </section>

        {/* the result of the last run */}
        {(photoSrc || captureSrc) && (
          <section>
            <p className="ui-label mb-2">{photoSrc ? 'Votre photo' : 'Le cadrage vérifié'}</p>
            {photoSrc ? (
              <>
                <a href={photoSrc} target="_blank" rel="noreferrer" title="Ouvrir en grand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoSrc} alt="Photo de la scène" className="w-full rounded-[12px] shadow-[var(--brand-shadow)]" />
                </a>
                <div className="mt-2 flex gap-2">
                  <a
                    href={photoSrc}
                    download={`roomia-${(useCurrent ? 'vue-actuelle' : (cameras[selected ?? 0]?.name ?? 'scene')).replace(/\s+/g, '-').toLowerCase()}.jpg`}
                    className="ui-btn ui-btn--ghost ui-btn--sm flex-1"
                  >
                    <Icon name="download" size={15} />
                    Télécharger
                  </a>
                  <a href={photoSrc} target="_blank" rel="noreferrer" className="ui-btn ui-btn--ghost ui-btn--sm flex-1">
                    <Icon name="fullscreen" size={15} />
                    En grand
                  </a>
                </div>
                {timings && (
                  <p className="mt-2 text-[12px] text-[var(--brand-muted)]">
                    Faite en {timings.total} s{fellBack ? ' · qualité moyenne (le serveur d’images était trop lent en haute qualité)' : ''}
                  </p>
                )}
                {lastPhoto && account && !reporting && !reportState?.ok && (
                  <button type="button" onClick={() => setReporting(true)} className="mt-2 text-left text-[12px] text-[var(--brand-muted)] underline underline-offset-2 hover:text-[var(--brand-blue)]">
                    La photo ne respecte pas votre design ? Signaler
                  </button>
                )}
                {reporting && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={reportText}
                      onChange={e => setReportText(e.target.value)}
                      rows={3}
                      placeholder="Ce qui a changé par rapport à votre 3D (matériau, objet ajouté ou manquant, couleur…)"
                      className="w-full rounded-[10px] border border-[var(--brand-line-strong)] bg-white px-3 py-2 text-[13px] text-[var(--brand-ink)]"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void sendReport()} disabled={reportText.trim().length < 5} className="ui-btn ui-btn--primary ui-btn--sm">
                        Envoyer
                      </button>
                      <button type="button" onClick={() => setReporting(false)} className="ui-btn ui-btn--quiet ui-btn--sm">
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
                {reportState && <p className={`mt-2 text-[12px] ${reportState.ok ? 'text-[var(--brand-success)]' : 'text-[var(--brand-danger)]'}`}>{reportState.text}</p>}
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={captureSrc ?? ''} alt="Capture de la scène" className={`w-full rounded-[12px] ${checked ? '' : 'opacity-80'}`} />
                {checked && (
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--brand-muted)]">
                    Le cadrage vous convient ? Lancez « Faire le rendu ». Sinon, changez de vue ou d’angle de vue, ou cadrez librement.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {held.length > 0 && (
          <section>
            <p className="ui-label mb-2">En attente · {held.length}</p>
            <ul className="space-y-1.5">
              {held.map(item => (
                <li key={item.id} className="flex items-center gap-2 rounded-[10px] border border-[var(--brand-line)] bg-[var(--brand-paper)] px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-[var(--brand-ink)]" title={item.label}>
                    {item.label}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void generate({ request: item.request, heldId: item.id })} className="ui-btn ui-btn--primary ui-btn--sm">
                    Relancer
                  </button>
                  <button type="button" onClick={() => void dropHeld(item.id)} className="ui-btn ui-btn--quiet ui-btn--icon ui-btn--sm" aria-label={`Supprimer ${item.label}`}>
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-[var(--brand-muted)]">La capture est gardée : relancer ne refait que la photo (environ 1 minute).</p>
          </section>
        )}

        {photos.length > 0 && (
          <section>
            <p className="ui-label mb-2">Photos de ce projet · {photos.length}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {photos.slice(0, showAllPhotos ? photos.length : 9).map(photo => (
                <a
                  key={photo.file}
                  href={`/api/scenes/${sceneId}/photos/${photo.file}`}
                  target="_blank"
                  rel="noreferrer"
                  title={[photo.view, photo.time, photo.lens && `${photo.lens} mm`, photo.quality, photo.fellBack && 'qualité moyenne (secours)'].filter(Boolean).join(' · ')}
                  className="block overflow-hidden rounded-[8px]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/scenes/${sceneId}/photos/${photo.file}?w=360`} alt={photo.view ?? 'Photo'} loading="lazy" className="aspect-[3/2] w-full object-cover transition-transform hover:scale-105" />
                </a>
              ))}
            </div>
            {photos.length > 9 && (
              <button type="button" onClick={() => setShowAllPhotos(v => !v)} className="mt-2 text-[12px] text-[var(--brand-muted)] underline underline-offset-2 hover:text-[var(--brand-blue)]">
                {showAllPhotos ? 'Voir moins' : `Voir les ${photos.length} photos`}
              </button>
            )}
          </section>
        )}
      </div>

      {/* 3 · the one action, always in sight */}
      <div className="border-t border-[var(--brand-line)] bg-white px-5 pb-5 pt-4">
        {blocker && (
          <p className={`ui-notice mb-3 !text-[13px] ${blocker.tone === 'warn' ? 'ui-notice--warn' : ''}`}>
            <Icon name={blocker.tone === 'warn' ? 'warn' : 'user'} size={15} />
            {blocker.text === 'signed-out' ? (
              <span>
                Les photos utilisent votre compte Roomia.{' '}
                <a className="font-semibold underline underline-offset-2" href={`/login?next=${encodeURIComponent(typeof window === 'undefined' ? '/studio' : window.location.pathname + window.location.search)}`}>
                  Se connecter
                </a>
              </span>
            ) : (
              <span>{blocker.text}</span>
            )}
          </p>
        )}

        {running && (
          <div className="mb-3 rounded-[12px] bg-[var(--brand-blue-tint)] p-3">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-semibold text-[var(--brand-blue-deep)]">{step === 'photo' ? 'Création de la photo' : 'Capture de la vue'}</span>
              <span className="tabular-nums text-[var(--brand-blue)]">{formatClock(elapsed)}</span>
            </div>
            <div className="mt-2 flex gap-1.5">
              <span className={`h-1.5 flex-1 rounded-full ${step === 'capture' ? 'animate-pulse bg-[var(--brand-blue)]' : 'bg-[var(--brand-blue)]'}`} />
              <span className={`h-1.5 flex-1 rounded-full ${step === 'photo' ? 'animate-pulse bg-[var(--brand-blue)]' : 'bg-[var(--brand-blue-line)]'}`} />
            </div>
            <p className="mt-2 text-[12px] text-[var(--brand-blue-deep)]">Ne fermez pas cette fenêtre.</p>
          </div>
        )}

        {choice && (
          <div className="ui-notice ui-notice--warn mb-3 flex-col !gap-2 !text-[13px]">
            <p className="font-semibold">{choice.reason === 'slow' ? 'Le serveur d’images est trop lent en ce moment.' : 'Le serveur d’images ne répond pas.'}</p>
            <p>La capture est gardée : rien n’est perdu et aucune photo n’est relancée sans vous.</p>
            <button type="button" onClick={() => void generate({ request: lastRequest.current ?? undefined, quality: 'medium' })} className="ui-btn ui-btn--primary ui-btn--sm ui-btn--block">
              {choice.tried === 'high' ? 'Continuer en qualité moyenne (environ 40 s)' : 'Réessayer en qualité moyenne'}
            </button>
            <button type="button" onClick={() => void holdPhoto()} className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--block">
              Mettre en attente, je relance plus tard
            </button>
          </div>
        )}
        {notice && <p className="ui-notice mb-3 !text-[13px]">{notice}</p>}
        {error && (
          <p className="ui-notice ui-notice--danger mb-3 !text-[13px]">
            <Icon name="warn" size={15} />
            <span>{error}</span>
          </p>
        )}

        <button type="button" onClick={() => void generate()} disabled={busy || !hasView || noCredits} className="ui-btn ui-btn--primary ui-btn--lg ui-btn--block">
          <Icon name="sparkle" size={18} />
          {running ? 'Rendu en cours…' : 'Faire le rendu'}
        </button>
        <div className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-[var(--brand-muted)]">
          <span>{!hasView ? 'Choisissez une vue ci-dessus.' : checked ? 'Cadrage vérifié · environ 1 minute' : 'Environ 2 à 3 minutes'}</span>
          <button type="button" onClick={() => void checkView()} disabled={busy || !hasView} className="font-semibold text-[var(--brand-blue)] underline-offset-2 hover:underline disabled:opacity-40 disabled:no-underline">
            {phase === 'checking' ? `Vérification… ${formatClock(elapsed)}` : 'Vérifier le cadrage'}
          </button>
        </div>
        {!busy && <DesktopRenderNotice kind="view" className="mt-2" />}
      </div>
    </aside>
  )
}

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-bold text-[var(--brand-ink)]">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-blue)] text-[12px] font-bold text-white">{n}</span>
      {children}
    </h3>
  )
}

/** A small picture of each light, drawn in CSS: the sky through a window, the sun or the moon, the lamps. */
function AmbianceArt({ kind }: { kind: string }) {
  const sky =
    kind === 'jour'
      ? 'linear-gradient(180deg,#cfe6f2 0%,#eef6f8 55%,#f7f1e3 100%)'
      : kind === 'soiree'
        ? 'linear-gradient(180deg,#f2b27a 0%,#f6cf9a 45%,#f3e2c6 100%)'
        : 'linear-gradient(180deg,#0b2430 0%,#123848 60%,#1c4554 100%)'
  return (
    <span className="relative block h-16 overflow-hidden" style={{ background: sky }} aria-hidden="true">
      {kind === 'jour' && <span className="absolute right-3 top-2.5 h-5 w-5 rounded-full bg-[#fff6d8] shadow-[0_0_18px_6px_rgba(255,240,190,0.9)]" />}
      {kind === 'soiree' && <span className="absolute bottom-3 left-1/2 h-7 w-7 -translate-x-1/2 rounded-full bg-[#ffd9a0] shadow-[0_0_22px_8px_rgba(255,190,120,0.75)]" />}
      {kind === 'nuit' && (
        <>
          <span className="absolute right-3 top-2.5 h-4 w-4 rounded-full bg-[#e9eef0] shadow-[inset_-4px_-1px_0_0_#123848]" />
          <span className="absolute left-3 top-3 h-1 w-1 rounded-full bg-white/80" />
          <span className="absolute left-8 top-6 h-0.5 w-0.5 rounded-full bg-white/70" />
          <span className="absolute bottom-0 left-1/2 h-8 w-14 -translate-x-1/2 rounded-t-full bg-[radial-gradient(ellipse_at_bottom,rgba(255,196,120,0.75),transparent_70%)]" />
        </>
      )}
      <span className="absolute inset-x-0 bottom-0 h-3 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.08))]" />
    </span>
  )
}
