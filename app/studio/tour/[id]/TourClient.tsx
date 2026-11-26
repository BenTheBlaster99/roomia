'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PANO_REJECT_REASONS, REJECT_LABELS, type PanoRejectReason } from '@/lib/pano-review'
import type { PanoAiCheck } from '@/lib/pano-ai'
import type { TourLevel, TourStatus, TourView } from '@/lib/scene-tour'
import type { VideoBuild, VideoStatus } from '@/lib/scene-video'
import { sendSceneFile } from '@/lib/studio-import/server-prep'
import Icon, { type IconName } from '../../components/Icon'
import DesktopPublish from './DesktopPublish'
import LookPanel from './LookPanel'
import PanoViewer, { SpotMark, type PanoSpot } from './PanoViewer'
import PointsEditor, { type ConfirmedPoints } from './PointsEditor'
import { GallerySheet, PhotosSheet, Plan3dSheet, PlanSheet, VideoSheet, type PlanData } from './TourSheets'
import type { TourProposal } from '@/lib/scene-tour'
import DesktopRenderNotice, { isCpuOnly, loadDesktopEngine, renderEstimate } from '../../components/DesktopRenderNotice'

interface TourData {
  /** AI 360°s offered at all (ROOMIA_AI_360=1); off since 2 Nov: the Cycles 360° is the product. */
  ai360?: boolean
  status: TourStatus
  plan: PlanData | null
  /** The 3D plan's file, when the build made one. */
  plan3d?: string | null
  /** A site with several levels: one plan each, bottom up. */
  levels: TourLevel[] | null
  builtAt: string | null
  /** changes when a 360 file changes (the look and the AI light replace them after the build) */
  version?: string
  /** A quick preview tour (desktop app): the golden-hour Présentation makes the final 360°. */
  preview?: boolean
  /** The golden-hour Présentation starts by itself when the build ends (desktop app). */
  autoLook?: boolean
  /** The build wrote a walkable map: the free walk can open. */
  walk?: boolean
  views: TourView[]
  /** The points proposed on the plan before the build (14 Nov), and whether the person chose them. */
  proposal: TourProposal | null
  chosen: boolean
  /** the 3D plan's last run (15 Nov) */
  plan3dState?: { state: 'running' | 'done' | 'failed'; error?: string } | null
  /** For the reviewer: what the last new version of the file changed, and what is left to remake. */
  update: {
    at: string
    added: number
    removed: number
    views: { index: number; name: string; faces: string[] }[]
    photos: string[]
    images: number
  } | null
}

interface VideoData {
  status: VideoStatus
  video: VideoBuild | null
}

type Mode = 'photo' | 'pano' | 'video' | 'plan2d' | 'plan3d' | 'photos' | 'gallery'

/** Views within this distance (metres) of the current one get an arrow towards them. */
const NEAR = 9
/** Eyes are ~1.5 m above the floor: arrows point at the floor where the next view stands. */
const EYE_ABOVE_ARROW = 1.25

const PHOTO_ASPECT = 1536 / 1024

/** Order of the visit (positions in `views`): from the first view, always the nearest one not yet seen (a level is
 *  finished before the next: a step of height counts as 10 m). */
function visitOrder(views: TourView[]): number[] {
  if (views.length === 0) return []
  const left = new Set(views.map((_, i) => i))
  const order = [0]
  left.delete(0)
  while (left.size) {
    const here = views[order[order.length - 1]].position
    let best = -1
    let bestD = Infinity
    for (const i of left) {
      const p = views[i].position
      const d = Math.hypot(p[0] - here[0], p[2] - here[2]) + (Math.abs(p[1] - here[1]) > 1 ? 10 : 0)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    order.push(best)
    left.delete(best)
  }
  return order
}

/** 25 Nov: where a point's 360° was taken and the way its middle looks (lib/scene-tour.ts pointFrame), not the saved camera's. */
const eyeOf = (v: TourView) => v.eye ?? v.position
const aheadOf = (v: TourView) => v.ahead ?? v.target

/** 25 Nov: where a point's carousel cover looks, in the viewer's yaw (+ = right of the 360°'s middle): the operator's chosen
 *  start, else the way the architect's camera looked (turned around when it faces a wall). Clicking the cover arrives there. */
function coverYaw(v: TourView) {
  if (v.startYaw != null) return v.startYaw
  const e = eyeOf(v)
  const a = aheadOf(v)
  const middle = Math.atan2(-(a[2] - e[2]), a[0] - e[0])
  const looks = Math.atan2(-(v.target[2] - v.position[2]), v.target[0] - v.position[0])
  const yaw = middle - looks + (v.noPhoto && !v.auto ? Math.PI : 0)
  return Math.atan2(Math.sin(yaw), Math.cos(yaw))
}

/** Direction from view `from` to the floor where view `to` stands: right (+) of where `from`'s 360° looks, and down (−). */
function direction(from: TourView, to: TourView) {
  const [px, py, pz] = eyeOf(from)
  const fx = aheadOf(from)[0] - px
  const fz = aheadOf(from)[2] - pz
  const there = eyeOf(to)
  const vx = there[0] - px
  const vz = there[2] - pz
  const yaw = Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz)
  const dist = Math.hypot(vx, vz)
  const pitch = Math.atan2(there[1] - EYE_ABOVE_ARROW - py, dist)
  return { yaw, pitch, dist }
}

/** What the Présentation and the AI finish are doing (app/api/scenes/[id]/look). */
interface LookData {
  stage: 'idle' | 'running' | 'ready' | 'done' | 'error' | 'interrupted'
  job: 'render' | 'ai' | null
  step: string
  error?: string
  ai?: { images: number; done: number }
  /** views the AI finish will take by itself once the Présentation is ready */
  autoAi?: number
}

/** Direction (radians, + = right) a point's 360° faces when one walks into it from another: the way one was going. */
function arrivalYaw(from: TourView, to: TourView) {
  const [ex, , ez] = eyeOf(to)
  const fx = aheadOf(to)[0] - ex
  const fz = aheadOf(to)[2] - ez
  const vx = ex - eyeOf(from)[0]
  const vz = ez - eyeOf(from)[2]
  if (Math.hypot(vx, vz) < 0.05) return null
  return Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz)
}

/** published: a tour sent from Roomia Desktop for the architect's clients — viewing only, no Studio tools. */
/** The card's rest and the person's pause, as the screens say them (lib/blender-guard.ts). */
function ThermalNote({ t }: { t?: { paused: boolean; waiting?: boolean; userPaused?: boolean; temp: number } }) {
  if (!t) return null
  if (t.userPaused) return <span className="tour-error">En pause : le point en cours se termine, puis le PC se repose. Appuyez sur « Reprendre » pour continuer.</span>
  if (t.paused) return <span className="tour-error">Pause : la carte graphique refroidit ({t.temp} °C). Le travail reprend tout seul.</span>
  if (t.waiting) return <span className="tour-error">La carte graphique refroidit entre deux points ({t.temp} °C). Le point suivant démarre dans un instant.</span>
  return null
}

export default function TourClient({ sceneId, title, published = false }: { sceneId: string; title: string; published?: boolean }) {
  const [data, setData] = useState<TourData | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [prev, setPrev] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('photo')
  // Review: show the Blender 360° instead of the AI one, to compare.
  const [showBase, setShowBase] = useState(false)
  const [rejectReason, setRejectReason] = useState<PanoRejectReason | ''>('')
  const [lookYaw, setLookYaw] = useState(0)
  const [panoReady, setPanoReady] = useState(false)
  /** The level whose plan is shown, when the visitor picked one; otherwise the current point's. */
  const [planLevel, setPlanLevel] = useState<number | null>(null)
  const [busy, setBusy] = useState('')
  /** the last frame of the 360° left through an arrow, fading out over the next one */
  const [fade, setFade] = useState<{ src: string; going: boolean } | null>(null)
  /** where the next 360° starts when one walked into it through an arrow */
  const [arrival, setArrival] = useState<number | null>(null)
  const [look, setLook] = useState<LookData | null>(null)
  /** "Voir l'aperçu": the visit while the final quality is still being made */
  const [preview, setPreview] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  /** "Points de vue" clicked on this page: only then does the editor show over a visit that exists (18 Nov) */
  const [pointsOpen, setPointsOpen] = useState(false)
  // ?edit=1: Roomia's own controls (paid upgrades); a client opening the tour never sees them.
  const [editing] = useState(() => !published && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1')
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [film, setFilm] = useState<VideoData | null>(null)

  const load = useCallback(() => fetchTour(sceneId, editing).then(setData), [sceneId, editing])
  const loadLook = useCallback(async () => {
    if (published) return
    const res = await fetch(`/api/scenes/${sceneId}/look`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setLook((await res.json()) as LookData)
  }, [sceneId, published])
  // "Arrêter": kills Blender for this scene's build now. It does not restart by itself (only a build cut by closing Roomia does).
  // 18 Nov: also the placement of the points and the daylight / AI finish (there was no way out of them)
  const stopBuild = useCallback(
    async (what: 'build' | 'points' | 'look') => {
      const url = what === 'look' ? `/api/scenes/${sceneId}/look` : `/api/scenes/${sceneId}/tour`
      const body = what === 'look' ? { action: 'stop' } : what === 'points' ? { stopPropose: true } : { stop: true }
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined)
      await load()
      await loadLook()
    },
    [sceneId, load, loadLook],
  )
  // "Pause after this point": the point in progress finishes, the next waits (the same flag the Présentation uses)
  const pauseBuild = useCallback(
    async (on: boolean) => {
      await fetch(`/api/scenes/${sceneId}/look`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: on ? 'pause' : 'resume' }) }).catch(() => undefined)
      await load()
    },
    [sceneId, load],
  )
  const loadFilm = useCallback(() => fetchVideo(sceneId).then(setFilm), [sceneId])

  useEffect(() => {
    loadFilm().catch(() => undefined)
  }, [loadFilm])

  // While the video is being filmed, follow the progress.
  useEffect(() => {
    if (film?.status.state !== 'building') return
    const timer = setInterval(() => loadFilm().catch(() => undefined), 5000)
    return () => clearInterval(timer)
  }, [film?.status.state, loadFilm])

  useEffect(() => {
    let alive = true
    fetchTour(sceneId, editing)
      .then(body => alive && setData(body))
      .catch(err => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [sceneId, editing])
  // what the Présentation and the AI finish are doing (once at the start; then while something is being made)
  useEffect(() => {
    const timer = setTimeout(() => void loadLook(), 0)
    return () => clearTimeout(timer)
  }, [loadLook])

  const views = useMemo(() => data?.views ?? [], [data])
  const hasPano = views.some(v => v.pano)
  // 21 Nov: the build makes no draft 360° when the quality render follows, so a built visit has its views but no picture until the render installs them
  const builtNoPano = !hasPano && views.some(v => !v.outside)
  const building = data?.status.state === 'building'
  const proposing = data?.proposal?.state === 'running'
  const lookRunning = look?.stage === 'running'
  // the whole chain (14 Nov): points -> Blender -> daylight Présentation -> AI finish; the visit shows when it is all done
  const pipeline =
    !published &&
    !editing &&
    !!data &&
    (building || proposing || lookRunning || (!!data.autoLook && !!data.preview && (hasPano || builtNoPano) && look?.stage !== 'error') || ((look?.autoAi ?? 0) > 0 && look?.stage !== 'error'))

  // 17 Nov (Sarah: "the visit won't open"): a proposal left on disk (the editor left another way, Roomia closed) no longer takes the
  // place of the visit. Over a visit, the editor only shows after "Points de vue" on this page; a leftover one is dropped.
  const leftover = !published && hasPano && !pointsOpen && data?.proposal?.state === 'ready' && !building
  useEffect(() => {
    if (!leftover) return
    void fetch(`/api/scenes/${sceneId}/tour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dropProposal: true }) })
      .then(() => load())
      .catch(() => undefined)
  }, [leftover, sceneId, load])

  // While anything is being made, follow the progress.
  useEffect(() => {
    if (!pipeline) return
    const timer = setInterval(() => {
      load().catch(() => undefined)
      void loadLook()
    }, 3000)
    return () => clearInterval(timer)
  }, [pipeline, load, loadLook])

  // while the 3D plan is being made on its own, follow it
  const plan3dRunning = data?.plan3dState?.state === 'running'
  useEffect(() => {
    if (!plan3dRunning) return
    const timer = setInterval(() => load().catch(() => undefined), 4000)
    return () => clearInterval(timer)
  }, [plan3dRunning, load])

  const order = useMemo(() => visitOrder(views), [views])
  const current = views[order[step]]
  const shown = current && mode === 'photo' && !current.photo && current.pano ? 'pano' : mode

  const go = useCallback(
    (nextStep: number) => {
      if (!order.length) return
      const s = ((nextStep % order.length) + order.length) % order.length
      if (s === step) return
      setPrev(step)
      setStep(s)
      setLookYaw(0)
      setPanoReady(false)
      setPlanLevel(null)
      setArrival(null)
    },
    [order.length, step],
  )
  const goToView = useCallback((index: number) => go(order.indexOf(views.findIndex(v => v.index === index))), [go, order, views])

  // the carousel (25 Nov): every point of the visit in its order, as a cover cut from its 360° (or its photo)
  const strip = useMemo(
    () =>
      order
        .map((i, k) => ({ v: views[i], n: k + 1 }))
        .filter(({ v }) => v && (v.pano || v.photo) && (!v.hidden || v.index === current?.index)),
    [order, views, current?.index],
  )
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const here = stripRef.current?.querySelector<HTMLElement>('[data-here]')
    here?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [current?.index, mode])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') go(step + 1)
      if (e.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, step])

  const spots = useMemo(() => {
    if (!current) return []
    // Points that can see each other (measured in the 3D model) get arrows; without that, the nearby ones.
    const linked = new Set(current.links)
    return views
      .filter(v => v.index !== current.index && !v.hidden && (linked.size ? linked.has(v.index) : true))
      .map(v => ({ view: v, ...direction(current, v) }))
      .filter(s => s.dist <= NEAR)
      .sort((a, b) => a.dist - b.dist)
  }, [current, views])

  // The 360° the arrows lead to are fetched ahead, so the next point appears at once.
  useEffect(() => {
    for (const s of spots.slice(0, 5)) {
      if (s.view.pano) new Image().src = `/api/scenes/${sceneId}/tour/${s.view.pano}?v=${encodeURIComponent(data?.version ?? data?.builtAt ?? '')}`
      else if (s.view.photo) new Image().src = photoUrl(sceneId, s.view.photo)
    }
  }, [spots, sceneId, data?.version, data?.builtAt])

  const photoSpots = useMemo(() => {
    if (!current) return []
    const tanH = Math.tan(((current.photoHfov / 2) * Math.PI) / 180)
    const tanV = tanH / PHOTO_ASPECT
    return spots
      .filter(s => Math.abs(s.yaw) < (80 * Math.PI) / 180)
      .map(s => ({ ...s, x: Math.tan(s.yaw) / tanH, y: Math.tan(s.pitch) / Math.cos(s.yaw) / tanV }))
      // Kept away from the edges, where a label would be cut on a phone.
      .filter(s => Math.abs(s.x) < 0.72 && Math.abs(s.y) < 0.85)
      .slice(0, 3)
  }, [current, spots])

  const panoSpots: PanoSpot[] = useMemo(() => spots.slice(0, 5).map(s => ({ key: String(s.view.index), label: s.view.name, yaw: s.yaw, pitch: s.pitch })), [spots])

  /** Through an arrow: the view has turned and zoomed towards it; the next 360° starts facing the way one walked. */
  const walkTo = useCallback(
    (key: string, snapshot?: string) => {
      const to = views.find(v => v.index === Number(key))
      if (!to || !current) return
      if (snapshot) setFade({ src: snapshot, going: false })
      goToView(to.index)
      setArrival(arrivalYaw(current, to))
    },
    [views, current, goToView],
  )

  async function post(body: Record<string, unknown>, failure: string) {
    setBusy('pano')
    setError('')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const answer = await res.json().catch(() => null)
      if (!res.ok) throw new Error(answer?.detail ?? failure)
      await load()
      await loadLook()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  /** "Points de vue" on a finished visit (18 Nov): the editor opens at once, from the visit; no Blender run. */
  async function openPoints() {
    setPointsOpen(true)
    await post({ editPoints: true }, 'Les points de vue n’ont pas pu s’ouvrir.')
  }

  /** Back to the visit from the editor: the proposal is dropped, nothing is rendered. */
  async function closePoints() {
    setPointsOpen(false)
    await post({ dropProposal: true }, 'Impossible d’annuler.')
  }

  /** Step 1: Roomia places the points and draws the plan (free, about a minute); the person sees them before anything is rendered. */
  async function propose(fresh = false) {
    const engine = await loadDesktopEngine()
    if (isCpuOnly(engine) && !window.confirm(`Ce PC n’a pas de carte graphique utilisable : la visite sera rendue sur le processeur. ${renderEstimate(engine!, 'tour', Math.max(views.length, 4))}\n\nContinuer quand même ?`)) return
    await post({ propose: true, ...(fresh ? { fresh: true } : {}) }, 'Le placement des points n’a pas pu démarrer.')
  }

  /** Step 2: the points chosen; everything else runs by itself (Blender, the daylight Présentation, the AI finish on every point). */
  async function confirmPoints(points: ConfirmedPoints, aiMax: number) {
    setPreview(false)
    await post({ confirmPoints: points, ...(aiMax > 0 ? { autoAi: { max: aiMax } } : {}) }, 'La visite n’a pas pu démarrer.')
  }

  async function makeVideo() {
    setBusy('video')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/video`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La vidéo n’a pas pu démarrer.')
      await loadFilm()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function editPoint(index: number, change: { hidden?: boolean; startYaw?: number | null; name?: string }) {
    setBusy('point')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point: { index, ...change } }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La modification n’a pas pu être enregistrée.')
      setData(body as TourData)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function upgradePano(indices: number[], light: 'soleil' | 'douce') {
    await post({ ai: indices, light }, 'La mise en qualité photo n’a pas pu démarrer.')
  }

  async function review(index: number, approve: boolean) {
    setBusy('review')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: { index, approve, ...(approve || !rejectReason ? {} : { reason: rejectReason }) } }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La décision n’a pas pu être enregistrée.')
      setData(body as TourData)
      setShowBase(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // A new version of the project's file: sent and prepared like any file, then it takes this scene's place.
  async function sendNewVersion(form: HTMLFormElement) {
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
    const scenes = (form.elements.namedItem('scenes') as HTMLInputElement).files?.[0]
    if (!file) return
    setError('')
    setBusy('Nouvelle version : envoi…')
    try {
      const sent = await sendSceneFile(file, phase => setBusy(`Nouvelle version : ${phase}`))
      if ('error' in sent) throw new Error(sent.error)
      if (scenes) {
        const res = await fetch(`/api/scenes/${sent.id}/cameras`, { method: 'PUT', body: await scenes.text() })
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? 'Les vues enregistrées n’ont pas pu être lues.')
      }
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVersion: sent.id }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La nouvelle version n’a pas pu être prise.')
      form.reset()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  async function applyUpdate(action: 'update' | 'mirrors') {
    await post({ [action]: true }, 'La mise à jour n’a pas pu démarrer.')
  }

  if (error && !data) return <div className="tour tour-message">{error}</div>
  if (!data) return <div className="tour tour-message">Chargement de la visite…</div>
  if (published && !current) return <div className="tour tour-message">Cette visite n’est pas disponible pour le moment.</div>

  // The points proposed on the plan, waiting for the person: the editor, also over a visit that exists already ("Revoir les points")
  if (!published && data.proposal?.state === 'ready' && !building && (!hasPano || pointsOpen)) {
    return (
      <PointsEditor
        sceneId={sceneId}
        proposal={data.proposal}
        busy={!!busy}
        error={error}
        onConfirm={(p, max) => void confirmPoints(p, max)}
        onRedo={() => void propose(true)}
        onCancel={hasPano ? () => void closePoints() : undefined}
      />
    )
  }
  // ── Before the visit exists, or while it is being made: the steps, never the unfinished Blender pictures ──
  if (!published && !editing && (pipeline || !hasPano) && !(preview && hasPano)) {
    const proposal = data.proposal
    if (pipeline) {
      return (
        <Pipeline
          sceneId={sceneId}
          title={title}
          data={data}
          look={look}
          onStop={() => void stopBuild(data.proposal?.state === 'running' ? 'points' : building ? 'build' : 'look')}
          onPause={on => void pauseBuild(on)}
          onPreview={hasPano && editing ? () => setPreview(true) : undefined}
        />
      )
    }
    // the visit is built but its quality render stopped before any picture existed (Roomia closed, PC off, an error): no draft to show,
    // so the way back is the render itself, from the points already confirmed (21 Nov)
    if (builtNoPano && !building && (look?.stage === 'interrupted' || look?.stage === 'error')) {
      return (
        <div className="tour tour-message">
          <a className="tour-back floating-back" href={`/studio?scene=${sceneId}`}>
            ← Studio
          </a>
          <strong className="tour-intro-title">La visite 360° de « {title} » n’est pas terminée</strong>
          <LookPanel sceneId={sceneId} tourReady />
        </div>
      )
    }
    // nothing yet: start by placing the points
    return (
      <div className="tour tour-message">
        <a className="tour-back floating-back" href={`/studio?scene=${sceneId}`}>
          ← Studio
        </a>
        <strong className="tour-intro-title">Créer la visite 360° de « {title} »</strong>
        <span>
          Roomia place d’abord les points de vue sur le plan de votre projet. Vous les vérifiez, vous en ajoutez ou en retirez, puis Roomia fait tout le reste : le
          rendu, la lumière du jour et la finition IA de chaque point.
        </span>
        {proposal?.state === 'failed' && <span className="tour-error">{proposal.error}</span>}
        {data.status.state === 'failed' && <span className="tour-error">{data.status.error}</span>}
        {error && <span className="tour-error">{error}</span>}
        <button type="button" onClick={() => void propose()} disabled={!!busy}>
          Placer les points de vue
        </button>
        <DesktopRenderNotice kind="tour" points={Math.max(views.length, 4)} />
        {data.builtAt && !hasPano && <span>Aucun point de vue trouvé la dernière fois : Roomia n’a reconnu aucune pièce couverte dans ce fichier.</span>}
      </div>
    )
  }

  if (!current) return <div className="tour tour-message">Aucun point de vue dans cette visite.</div>

  const coneAngle = (current.plan?.angle ?? 0) + (shown === 'pano' ? (lookYaw * 180) / Math.PI : 0)
  // On a site with several levels the plan is the current point's level, or the one the visitor picked.
  const levels = data.levels && data.levels.length > 1 ? data.levels : null
  const levelShown = levels ? (planLevel ?? current.level ?? levels[0].index) : null
  const plan = levels ? (levels.find(l => l.index === levelShown) ?? levels[0]) : data.plan
  const onPlan = (v: TourView) => !levels || v.level === levelShown
  const version = encodeURIComponent(data.version ?? data.builtAt ?? '')
  const previous = prev !== null ? views[order[prev]] : null
  const update = data.update
  const toUpdate = update ? update.views.length + update.photos.length : 0
  // AI 360° views not approved yet: their mirrors can be put back for free.
  const unapprovedAi = views.filter(v => v.panoAiFile && !v.panoAiApproved && !v.panoAiStale).length
  const blenderStops = views.filter(v => v.pano && !v.panoAiFile && !v.hidden).map(v => v.index)

  const inVisit = shown === 'pano' || shown === 'photo'
  const sections: RailItem[] = [
    { key: 'visit', icon: 'pano', label: 'Visite 360°', active: inVisit, onClick: () => setMode(current.pano ? 'pano' : 'photo') },
    { key: 'gallery', icon: 'gallery', label: 'Galerie', active: shown === 'gallery', onClick: () => setMode('gallery') },
    ...(data.plan ? [{ key: 'plan2d', icon: 'plan' as const, label: 'Plan 2D', active: shown === 'plan2d', onClick: () => setMode('plan2d') }] : []),
    ...(data.plan3d || !published
      ? [{ key: 'plan3d', icon: 'plan3d' as const, label: 'Plan 3D', active: shown === 'plan3d', todo: !data.plan3d, onClick: () => setMode('plan3d') }]
      : []),
    ...(film?.video || !published
      ? [{ key: 'video', icon: 'video' as const, label: 'Vidéo', active: shown === 'video', todo: !film?.video, onClick: () => setMode('video') }]
      : []),
    ...(!published ? [{ key: 'photos', icon: 'sparkle' as const, label: 'Nouvelles photos', active: shown === 'photos', onClick: () => setMode('photos') }] : []),
  ]
  const dark = inVisit || shown === 'video'

  return (
    <div className={`tour tour-shell${published ? ' is-public' : ''}`}>
      <ProjectRail items={sections} sceneId={published ? null : sceneId} />
      <div className="tour-main">
        <header className="tour-top">
          {!published && (
            <Link className="ui-btn ui-btn--quiet ui-btn--sm tour-top-back" href="/studio/projets">
              <Icon name="back" size={16} />
              Mes projets
            </Link>
          )}
          <div className="tour-top-title">
            <h1>{title}</h1>
          </div>
          {!published && (
            <div className="tour-top-actions">
              <DesktopPublish sceneId={sceneId} />
              <DownloadMenu sceneId={sceneId} viewIndex={shown === 'pano' ? current.index : null} />
            </div>
          )}
        </header>

      <main
        className={`tour-stage${dark ? ' dark' : ' light'}`}
        onPointerDown={e => {
          if (shown === 'photo') swipe.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={e => {
          const s = swipe.current
          swipe.current = null
          if (!s || shown !== 'photo') return
          const dx = e.clientX - s.x
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(step + (dx < 0 ? 1 : -1))
        }}
      >
        {shown === 'plan2d' && data.plan ? (
          <PlanSheet sceneId={sceneId} plan={plan ?? data.plan} version={version} title={title} />
        ) : shown === 'plan3d' ? (
          <Plan3dSheet
            sceneId={sceneId}
            file={data.plan3d ?? null}
            version={version}
            title={title}
            state={data.plan3dState}
            onMake={published || data.plan3dState?.state !== 'failed' ? undefined : () => void post({ plan3d: true }, 'Le plan 3D n’a pas pu démarrer.')}
          />
        ) : shown === 'gallery' ? (
          <GallerySheet sceneId={sceneId} title={title} onCreate={published ? undefined : () => setMode('photos')} />
        ) : shown === 'photos' ? (
          <PhotosSheet sceneId={sceneId} views={views} version={version} onDone={() => void load().catch(() => undefined)} />
        ) : shown === 'video' ? (
          <VideoSheet sceneId={sceneId} film={film} canMake={!published && views.every(v => v.pano || v.outside)} busy={!!busy} onMake={makeVideo} />
        ) : shown === 'pano' && current.pano ? (
          <>
            <PanoViewer
              key={`${current.index}-${editing && showBase ? 'base' : 'shown'}`}
              src={`/api/scenes/${sceneId}/tour/${editing && showBase && current.panoBase ? current.panoBase : current.pano}?v=${version}`}
              hdSrc={!(editing && showBase) && current.panoHd ? `/api/scenes/${sceneId}/tour/${current.panoHd}?v=${version}` : undefined}
              spots={panoSpots}
              onSpot={walkTo}
              onLook={setLookYaw}
              onReady={() => {
                setPanoReady(true)
                // the snapshot of the point left fades out once the new 360° shows
                setFade(f => (f && !f.going ? { ...f, going: true } : f))
              }}
              arrive={fade !== null}
              // the way one walked in; else the operator's chosen start; otherwise a saved view that looks at a wall starts turned around
              initialYaw={arrival ?? current.startYaw ?? (current.noPhoto && !current.auto ? Math.PI : 0)}
            />
            {fade && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={`pano-fade${fade.going ? ' go' : ''}`} src={fade.src} alt="" aria-hidden="true" onAnimationEnd={() => setFade(null)} />
            )}
            {!panoReady && !fade && <div className="tour-loading">Chargement du 360°…</div>}
            <p className="tour-hint">Faites glisser pour regarder autour</p>
          </>
        ) : current.photo ? (
          <>
            <img className="tour-backdrop" src={photoUrl(sceneId, current.photo)} alt="" aria-hidden="true" />
            <div className="tour-frame">
              {previous?.photo && previous.index !== current.index && (
                <img key={`out-${previous.index}`} className="tour-photo out" src={photoUrl(sceneId, previous.photo)} alt="" aria-hidden="true" />
              )}
              <img key={`in-${current.index}`} className="tour-photo in" src={photoUrl(sceneId, current.photo)} alt={`${title}, ${current.name}`} />
              {photoSpots.map(s => (
                <button
                  key={s.view.index}
                  type="button"
                  className="tour-spot"
                  style={{ left: `${((s.x + 1) / 2) * 100}%`, top: `${((1 - s.y) / 2) * 100}%` }}
                  onClick={() => goToView(s.view.index)}
                  aria-label={`Aller à ${s.view.name}`}
                >
                  <SpotMark />
                  <span className="spot-label">{s.view.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="tour-message">Pas encore de photo pour {current.name}.</div>
        )}

        {inVisit && (
          <div className="tour-visitbar">
            <div className="tour-point">
              {renaming !== null ? (
                <form
                  className="tour-rename"
                  onSubmit={e => {
                    e.preventDefault()
                    void editPoint(current.index, { name: renaming })
                    setRenaming(null)
                  }}
                >
                  <input autoFocus value={renaming} maxLength={60} onChange={e => setRenaming(e.target.value)} onKeyDown={e => e.key === 'Escape' && setRenaming(null)} aria-label="Nom du point" />
                  <button type="submit">OK</button>
                </form>
              ) : (
                <>
                  <strong>{current.name}</strong>
                  <span>
                    {step + 1} / {order.length}
                  </span>
                  {!published && (
                    <button type="button" className="tour-pencil" onClick={() => setRenaming(current.name)} aria-label={`Renommer ${current.name}`} title="Renommer ce point">
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="tour-visit-actions">
              {current.photo && current.pano && (
                <div className="tour-modes" role="group" aria-label="Affichage du point">
                  <button type="button" aria-pressed={shown === 'pano'} onClick={() => setMode('pano')}>
                    360°
                  </button>
                  <button type="button" aria-pressed={shown === 'photo'} onClick={() => setMode('photo')}>
                    Photo
                  </button>
                </div>
              )}
              {!published && (
                <button type="button" className="ui-btn ui-btn--glass ui-btn--sm" onClick={() => void openPoints()} disabled={!!busy || building} title="Revoir, ajouter ou retirer des points de vue, puis refaire la visite">
                  <Icon name="pin" size={15} />
                  Points de vue
                </button>
              )}
              {!published && (look?.stage === 'interrupted' || look?.stage === 'error') && <LookPanel sceneId={sceneId} tourReady={!building && hasPano} />}
              {/* Visite libre: taken out for now (15 Nov, the user); the reviewer still reaches it with ?edit=1 */}
              {data.walk && editing && (
                <a className="ui-btn ui-btn--glass ui-btn--sm" href={`/studio/explore/${sceneId}?at=${current.index}&edit=1`}>
                  Visite libre
                </a>
              )}
            </div>
          </div>
        )}

        {plan && (shown === 'photo' || shown === 'pano') && (
          <nav className="tour-plan" aria-label={levels ? 'Plan du site' : 'Plan de l’appartement'}>
            {levels && (
              <div className="tour-levels" role="group" aria-label="Niveau">
                {levels.map(l => (
                  <button key={l.index} type="button" aria-pressed={l.index === levelShown} onClick={() => setPlanLevel(l.index)}>
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            <div className="tour-plan-inner" style={{ aspectRatio: `${plan.width} / ${plan.height}`, ['--ratio' as string]: plan.width / plan.height }}>
              <img src={`/api/scenes/${sceneId}/tour/${plan.file}?v=${version}`} alt="" aria-hidden="true" />
              {views.map(v =>
                v.plan && onPlan(v) ? (
                  <button
                    key={v.index}
                    type="button"
                    className={`tour-dot${v.index === current.index ? ' here' : ''}`}
                    style={{ left: `${(v.plan.x / plan.width) * 100}%`, top: `${(v.plan.y / plan.height) * 100}%` }}
                    aria-label={v.name}
                    title={v.name}
                    onClick={() => goToView(v.index)}
                  >
                    {v.index === current.index && <span className="tour-cone" style={{ transform: `rotate(${coneAngle}deg)` }} />}
                  </button>
                ) : null,
              )}
            </div>
          </nav>
        )}

        {inVisit && strip.length > 1 && (
          <nav
            className={`tour-strip${plan ? ' with-plan' : ''}`}
            style={plan ? { ['--ratio' as string]: plan.width / plan.height } : undefined}
            aria-label="Les pièces de la visite"
          >
            <div className="tour-strip-track" ref={stripRef}>
              {strip.map(({ v, n }) => (
                <button
                  key={v.index}
                  type="button"
                  className={`tour-card${v.index === current.index ? ' here' : ''}`}
                  aria-current={v.index === current.index ? 'true' : undefined}
                  data-here={v.index === current.index ? '' : undefined}
                  onClick={() => {
                    // in the 360°, the next room opens in the 360° too, looking the way its cover looks
                    const in360 = shown === 'pano'
                    goToView(v.index)
                    if (v.pano) setArrival(coverYaw(v))
                    if (v.pano && in360) setMode('pano')
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.pano ? `/api/scenes/${sceneId}/tour/${v.pano}?cover=1&yaw=${coverYaw(v).toFixed(2)}&v=${version}` : photoUrl(sceneId, v.photo as string)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="tour-card-name">
                    <b>{n}</b>
                    {v.name}
                  </span>
                </button>
              ))}
            </div>
          </nav>
        )}

        {/* what is still being made, out of the way (the preview while the final quality is on its way, a rebuild) */}
        {!published && !editing && (pipeline || data.status.state === 'failed' || look?.stage === 'error' || error) && (
          <div className="tour-pill" role="status">
            {pipeline ? (
              <>
                <span className="tour-pill-dot" aria-hidden="true" />
                <span>{building ? data.status.step : look?.step || 'Qualité finale en cours…'}</span>
                <button type="button" onClick={() => setPreview(false)}>
                  Suivre
                </button>
              </>
            ) : (
              <span className="tour-error">{error || (data.status.state === 'failed' ? data.status.error : look?.error)}</span>
            )}
          </div>
        )}
      </main>
      </div>

      {editing && (
        <aside className="tour-prep">
          {building ? (
            <>
              <strong>{data.status.kind === 'ai' ? '360° en qualité photo…' : 'Préparation de la visite 360°…'}</strong>
              <span>{data.status.step}</span>
              <ThermalNote t={data.status.thermal} />
              <progress max={data.status.total ?? 1} value={data.status.done ?? 0} />
              <button type="button" className="tour-stop" onClick={() => void stopBuild('build')}>
                Arrêter
              </button>
            </>
          ) : (
            <>
              {data.status.state === 'failed' && <span className="tour-error">{data.status.error}</span>}
              {error && <span className="tour-error">{error}</span>}
              {update && (
                <>
                  <span>
                    Nouvelle version du fichier ({new Date(update.at).toLocaleDateString('fr-FR')}) : {update.added} objet(s) ajouté(s) ou modifié(s),{' '}
                    {update.removed} retiré(s).{' '}
                    {toUpdate
                      ? `À refaire : ${update.views.map(v => `${v.name} (${v.faces.length} face${v.faces.length > 1 ? 's' : ''})`).join(', ') || 'aucune vue 360°'}${update.photos.length ? `, ${update.photos.length} photo(s)` : ''}.`
                      : 'Aucune vue ni photo touchée : rien à refaire.'}
                  </span>
                  {toUpdate > 0 && (
                    <button type="button" onClick={() => applyUpdate('update')} disabled={!!busy}>
                      Mettre à jour seulement ce qui a changé (jusqu’à {update.images} image{update.images > 1 ? 's' : ''})
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={() => void propose()} disabled={!!busy}>
                Revoir les points de vue
              </button>
              {data.ai360 && current.pano && !current.panoAi && (
                <>
                  <span>360° en qualité photo pour {current.name} : six photos IA calées sur le rendu (6 images, environ 2 min).</span>
                  <button type="button" onClick={() => upgradePano([current.index], 'soleil')} disabled={!!busy}>
                    Passer en qualité photo
                  </button>
                </>
              )}
              {data.ai360 && <a href={`/studio/tour/${sceneId}/faces`}>Revue des faces IA</a>}
              {data.ai360 && unapprovedAi > 0 && (
                <button type="button" onClick={() => applyUpdate('mirrors')} disabled={!!busy}>
                  Remettre les vrais miroirs dans les 360° non validés (gratuit, aucune image achetée)
                </button>
              )}
              <form
                className="tour-version"
                onSubmit={e => {
                  e.preventDefault()
                  void sendNewVersion(e.currentTarget)
                }}
              >
                <span>Nouvelle version du fichier (seul ce qui a changé sera refait) :</span>
                <label>
                  Fichier 3D (.glb, .dae, .zip) <input type="file" name="file" accept=".glb,.dae,.zip" required />
                </label>
                <label>
                  Vues enregistrées (.json, facultatif) <input type="file" name="scenes" accept=".json,application/json" />
                </label>
                <button type="submit" disabled={!!busy}>
                  Envoyer la nouvelle version
                </button>
              </form>
              {data.ai360 && blenderStops.length > 1 && (
                <>
                  <span>Toute la visite en qualité photo ({blenderStops.length} points, {blenderStops.length * 6} images) :</span>
                  <button type="button" onClick={() => upgradePano(blenderStops, 'soleil')} disabled={!!busy}>
                    Passer toute la visite en qualité photo
                  </button>
                </>
              )}
              {shown === 'pano' && (
                <button type="button" onClick={() => editPoint(current.index, { startYaw: lookYaw })} disabled={!!busy}>
                  Démarrer le 360° de {current.name} dans cette direction
                </button>
              )}
              <button type="button" onClick={() => editPoint(current.index, { hidden: !current.hidden })} disabled={!!busy}>
                {current.hidden ? `Remettre ${current.name} dans la visite` : `Retirer ${current.name} de la visite`}
              </button>
              {current.panoAiFile && (
                <>
                  <span>
                    360° qualité photo de {current.name} : {current.panoAiApproved
                      ? 'validé, visible par les clients'
                      : current.panoAiStale
                        ? 'fait sur une ancienne version du fichier, à revérifier, invisible pour les clients'
                        : 'à vérifier, invisible pour les clients'}
                  </span>
                  {current.panoAiCheck && <span className={checkWarns(current.panoAiCheck) ? 'tour-error' : undefined}>{checkText(current.panoAiCheck)}</span>}
                  <button type="button" onClick={() => setShowBase(v => !v)} disabled={!!busy}>
                    {showBase ? 'Voir la version qualité photo' : 'Comparer avec la version Blender'}
                  </button>
                  {!current.panoAiApproved && (
                    <button type="button" onClick={() => review(current.index, true)} disabled={!!busy}>
                      Valider : fidèle au projet
                    </button>
                  )}
                  <select value={rejectReason} onChange={e => setRejectReason(e.target.value as PanoRejectReason | '')} aria-label="Raison du rejet">
                    <option value="">Raison du rejet (facultatif)</option>
                    {PANO_REJECT_REASONS.map(r => (
                      <option key={r} value={r}>
                        {REJECT_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => review(current.index, false)} disabled={!!busy}>
                    Rejeter : revenir à la version Blender
                  </button>
                </>
              )}
              {busy && busy !== 'pano' && <span>{busy}</span>}
            </>
          )}
        </aside>
      )}
    </div>
  )
}

/**
 * The visit while it is being made (14 Nov): the four steps, the one under way with its progress. Nothing unfinished is shown;
 * "Voir l'aperçu" opens the visit as it is when one wants to look anyway.
 */
function Pipeline({
  sceneId,
  title,
  data,
  look,
  onStop,
  onPause,
  onPreview,
}: {
  sceneId: string
  title: string
  data: TourData
  look: LookData | null
  onStop: () => void
  onPause: (on: boolean) => void
  onPreview?: () => void
}) {
  const building = data.status.state === 'building'
  const proposing = data.proposal?.state === 'running'
  const lookJob = look?.stage === 'running' ? look.job : null
  const aiPlanned = (look?.autoAi ?? 0) > 0 || lookJob === 'ai'
  const steps = [
    { key: 'points', label: 'Placement des points de vue' },
    { key: 'build', label: data.autoLook ? 'Plans et points de vue' : 'Rendu 360° et plans' },
    { key: 'look', label: 'Lumière du jour, lampes allumées' },
    ...(aiPlanned ? [{ key: 'ai', label: 'Finition IA de chaque point' }] : []),
  ]
  const now = proposing ? 'points' : building ? 'build' : lookJob === 'ai' ? 'ai' : 'look'
  const at = steps.findIndex(s => s.key === now)
  const progress =
    now === 'build'
      ? { value: data.status.done ?? 0, max: data.status.total ?? 1, text: data.status.step }
      : now === 'ai' && look?.ai
        ? { value: look.ai.done, max: look.ai.images, text: look.step }
        : now === 'points'
          ? { value: undefined, max: undefined, text: data.proposal?.step }
          : { value: undefined, max: undefined, text: look?.step || 'En attente du processeur graphique…' }
  const paused = data.status.thermal?.userPaused
  return (
    <div className="tour tour-message pipeline">
      <a className="tour-back floating-back" href={`/studio?scene=${sceneId}`}>
        ← Studio
      </a>
      <strong className="tour-intro-title">Votre visite 360° de « {title} » se prépare</strong>
      <ol className="pipeline-steps">
        {steps.map((s, n) => (
          <li key={s.key} className={n < at ? 'done' : n === at ? 'now' : ''}>
            <span className="pipeline-mark" aria-hidden="true">
              {n < at ? '✓' : n + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      {progress.text && <span>{progress.text}</span>}
      <progress max={progress.max} value={progress.value} />
      <ThermalNote t={data.status.thermal} />
      <span className="tour-note">Vous pouvez continuer à travailler, mais ne fermez pas Roomia. Si le PC s’arrête, le travail reprend à la prochaine ouverture.</span>
      <div className="pipeline-actions">
        {building && (
          <button type="button" className="tour-secondary" onClick={() => onPause(!paused)}>
            {paused ? 'Reprendre' : 'Pause après ce point'}
          </button>
        )}
        {building && (
          <button type="button" className="tour-stop" onClick={onStop}>
            Arrêter
          </button>
        )}
        {onPreview && (
          <button type="button" className="tour-secondary" onClick={onPreview}>
            Voir l’aperçu en attendant
          </button>
        )}
      </div>
    </div>
  )
}

async function fetchVideo(sceneId: string): Promise<VideoData> {
  const res = await fetch(`/api/scenes/${sceneId}/video`, { cache: 'no-store' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ?? 'Vidéo introuvable.')
  return body as VideoData
}

async function fetchTour(sceneId: string, review: boolean): Promise<TourData> {
  const res = await fetch(`/api/scenes/${sceneId}/tour${review ? '?edit=1' : ''}`, { cache: 'no-store' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ?? 'Visite introuvable.')
  return body as TourData
}

/** The automatic checks of an AI 360° in a sentence: how far it moved from the render, and lights the render lacks. */
function checkText(check: PanoAiCheck) {
  const moved = check.drift === null ? 'décalage non mesurable' : `décalage ${Math.round(check.drift)} px (90 % sous ${Math.round(check.driftP90 ?? 0)} px)`
  const lights = check.lights.length
    ? `${check.lights.length} lumière(s) absente(s) du rendu, à vérifier : ${check.lights.map(([yaw, up]) => `${yaw > 0 ? '+' : ''}${yaw}°/${up}°`).join(', ')}`
    : 'aucune lumière inventée détectée'
  return `Contrôle automatique : ${moved} ; ${lights}.`
}

/** A drift above ~12 px shows as ghosting of edges in the viewer; any new light deserves a look. */
function checkWarns(check: PanoAiCheck) {
  return (check.drift ?? 0) > 12 || check.lights.length > 0
}

function photoUrl(sceneId: string, file: string) {
  return `/api/scenes/${sceneId}/photos/${encodeURIComponent(file)}`
}

type RailItem = { key: string; icon: IconName; label: string; active: boolean; todo?: boolean; onClick: () => void }

/** The project's sections, one under the other (16 Nov redesign): the current one in gold; a bottom bar on a phone. */
function ProjectRail({ items, sceneId }: { items: RailItem[]; sceneId: string | null }) {
  return (
    <nav className="tour-rail" aria-label="Le projet">
      {sceneId ? (
        <Link className="tour-rail-mark" href="/studio/projets" aria-label="Roomia, mes projets">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomia-mark.png" alt="" width={44} height={44} />
        </Link>
      ) : (
        <span className="tour-rail-mark" aria-label="Roomia">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/roomia-mark.png" alt="" width={44} height={44} />
        </span>
      )}
      <div className="tour-rail-items">
        {items.map(it => (
          <button key={it.key} type="button" className={`tour-rail-item${it.active ? ' on' : ''}`} aria-current={it.active ? 'page' : undefined} onClick={it.onClick}>
            <Icon name={it.icon} size={22} />
            <span>{it.label}</span>
            {it.todo && <i className="tour-rail-todo">à faire</i>}
          </button>
        ))}
      </div>
      {sceneId && (
        <a className="tour-rail-item tour-rail-3d" href={`/studio?scene=${sceneId}`} title="La maquette 3D du projet">
          <Icon name="cube" size={22} />
          <span>Vue 3D</span>
        </a>
      )}
    </nav>
  )
}

/** Télécharger: this 360° (a panorama image with its 360 tags) or the whole project in one folder. */
function DownloadMenu({ sceneId, viewIndex }: { sceneId: string; viewIndex: number | null }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="relative" ref={box}>
      <button type="button" className="ui-btn ui-btn--ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="download" size={17} />
        Télécharger
      </button>
      {open && (
        <div className="ui-menu right-0 top-12 w-72" role="menu">
          {viewIndex !== null && (
            <a role="menuitem" href={`/api/scenes/${sceneId}/export?view=${viewIndex}`} onClick={() => setOpen(false)}>
              <Icon name="pano" size={17} />
              <span>
                Ce 360°
                <small className="block text-xs text-[var(--brand-muted)]">Image panoramique, lue par Facebook et Google</small>
              </span>
            </a>
          )}
          <a role="menuitem" href={`/api/scenes/${sceneId}/export`} onClick={() => setOpen(false)}>
            <Icon name="folder" size={17} />
            <span>
              Tout le projet
              <small className="block text-xs text-[var(--brand-muted)]">360°, galerie, plans et vidéo, dans un dossier</small>
            </span>
          </a>
        </div>
      )}
    </div>
  )
}
