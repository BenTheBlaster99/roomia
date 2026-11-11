'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PANO_REJECT_REASONS, REJECT_LABELS, type PanoRejectReason } from '@/lib/pano-review'
import type { PanoAiCheck } from '@/lib/pano-ai'
import type { TourLevel, TourStatus, TourView } from '@/lib/scene-tour'
import type { VideoBuild, VideoStatus } from '@/lib/scene-video'
import { sendSceneFile } from '@/lib/studio-import/server-prep'
import DesktopPublish from './DesktopPublish'
import LookPanel from './LookPanel'
import PanoViewer, { type PanoSpot } from './PanoViewer'
import { GallerySheet, PhotosSheet, Plan3dSheet, PlanSheet, VideoSheet, type PlanData } from './TourSheets'
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
  /** A quick preview tour (desktop app): the golden-hour Présentation makes the final 360°. */
  preview?: boolean
  /** The golden-hour Présentation starts by itself when the build ends (desktop app). */
  autoLook?: boolean
  /** The build wrote a walkable map: the free walk can open. */
  walk?: boolean
  views: TourView[]
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

/** Direction from view `from` to the floor where view `to` stands: right (+) of where `from` looks, and down (−). */
function direction(from: TourView, to: TourView) {
  const [px, py, pz] = from.position
  const fx = from.target[0] - px
  const fz = from.target[2] - pz
  const vx = to.position[0] - px
  const vz = to.position[2] - pz
  const yaw = Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz)
  const dist = Math.hypot(vx, vz)
  const pitch = Math.atan2(to.position[1] - EYE_ABOVE_ARROW - py, dist)
  return { yaw, pitch, dist }
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
  // ?edit=1: Roomia's own controls (paid upgrades); a client opening the tour never sees them.
  const [editing] = useState(() => !published && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1')
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [film, setFilm] = useState<VideoData | null>(null)

  const load = useCallback(() => fetchTour(sceneId, editing).then(setData), [sceneId, editing])
  // "Arrêter": kills Blender for this scene's build now. It does not restart by itself (only a build cut by closing Roomia does).
  const stopBuild = useCallback(async () => {
    await fetch(`/api/scenes/${sceneId}/tour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stop: true }) }).catch(() => undefined)
    await load()
  }, [sceneId, load])
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

  // While the panoramas are being prepared, follow the progress.
  useEffect(() => {
    if (data?.status.state !== 'building') return
    const timer = setInterval(() => load().catch(() => undefined), 3000)
    return () => clearInterval(timer)
  }, [data?.status.state, load])

  const views = useMemo(() => data?.views ?? [], [data])
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
    },
    [order.length, step],
  )
  const goToView = useCallback((index: number) => go(order.indexOf(views.findIndex(v => v.index === index))), [go, order, views])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') go(step + 1)
      if (e.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, step])

  // Neighbours' photos are fetched ahead, so the next step appears at once.
  useEffect(() => {
    for (const s of [step + 1, step - 1]) {
      const v = views[order[((s % order.length) + order.length) % order.length]]
      if (v?.photo) new Image().src = photoUrl(sceneId, v.photo)
    }
  }, [step, order, views, sceneId])

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

  /** complete: the build, then every stop in photo quality (paid). */
  async function prepare(complete = false) {
    const engine = await loadDesktopEngine()
    if (isCpuOnly(engine) && !window.confirm(`Ce PC n’a pas de carte graphique utilisable : la visite sera rendue sur le processeur. ${renderEstimate(engine!, 'tour', Math.max(views.length, 4))}\n\nLancer quand même ?`)) return
    setBusy('pano')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complete ? { complete: true, light: 'soleil' } : {}),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La préparation n’a pas pu démarrer.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
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

  async function editPoint(index: number, change: { hidden?: boolean; startYaw?: number | null }) {
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
    setBusy('pano')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai: indices, light }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La mise en qualité photo n’a pas pu démarrer.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
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
    setBusy('pano')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [action]: true }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La mise à jour n’a pas pu démarrer.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  if (error && !data) return <div className="tour tour-message">{error}</div>
  if (!data) return <div className="tour tour-message">Chargement de la visite…</div>
  // No view yet (a file without saved views, before the first build): Blender places the points itself.
  if (!current) {
    const { status } = data
    if (published) return <div className="tour tour-message">Cette visite n’est pas disponible pour le moment.</div>
    return (
      <div className="tour tour-message">
        {status.state === 'building' ? (
          <>
            <strong>Préparation de la visite 360°…</strong>
            <span>{status.step}</span>
            {data.autoLook && <span>La qualité finale (plein jour) démarre toute seule à la fin de la préparation.</span>}
            <ThermalNote t={status.thermal} />
            <progress max={status.total ?? 1} value={status.done ?? 0} />
            <button type="button" className="tour-secondary" onClick={() => void pauseBuild(!status.thermal?.userPaused)}>
              {status.thermal?.userPaused ? 'Reprendre' : 'Pause après ce point'}
            </button>
            <button type="button" className="tour-stop" onClick={() => void stopBuild()}>
              Arrêter la préparation
            </button>
            <span>Si vous fermez Roomia, la préparation reprendra toute seule à la prochaine ouverture.</span>
          </>
        ) : data.builtAt ? (
          <span>Aucun point de vue trouvé : Roomia n’a reconnu aucune pièce couverte dans ce fichier.</span>
        ) : (
          <>
            {status.state === 'failed' && <span className="tour-error">{status.error}</span>}
            {error && <span className="tour-error">{error}</span>}
            {data.ai360 ? (
              <>
                <span>
                  Roomia place les points de vue dans chaque pièce, prépare les 360° et le plan, puis passe chaque point en qualité photo
                  (6 images par point, environ 2 min par point).
                </span>
                <button type="button" onClick={() => prepare(true)} disabled={!!busy}>
                  Créer la visite complète en qualité photo
                </button>
                <button type="button" className="tour-secondary" onClick={() => prepare()} disabled={!!busy}>
                  Version Blender seulement (gratuite, 1 à 5 min)
                </button>
                <DesktopRenderNotice kind="tour" points={Math.max(views.length, 4)} />
              </>
            ) : (
              <>
                <span>Roomia place les points de vue dans chaque pièce, puis prépare les 360° (rendu Cycles) et le plan.</span>
                <button type="button" onClick={() => prepare()} disabled={!!busy}>
                  Créer la visite 360°
                </button>
                <DesktopRenderNotice kind="tour" points={Math.max(views.length, 4)} />
              </>
            )}
          </>
        )}
      </div>
    )
  }

  const missingPhotos = views.filter(v => !v.photo && !v.noPhoto).length
  // Every stop still in Blender quality, for one order covering the whole apartment.
  const blenderStops = views.filter(v => v.pano && !v.panoAiFile && !v.hidden).map(v => v.index)
  // a stop outside the building has no 360° on purpose
  const missingPanos = views.filter(v => !v.pano && !v.outside).length
  const building = data.status.state === 'building'
  const coneAngle = (current.plan?.angle ?? 0) + (shown === 'pano' ? (lookYaw * 180) / Math.PI : 0)
  // On a site with several levels the plan is the current point's level, or the one the visitor picked.
  const levels = data.levels && data.levels.length > 1 ? data.levels : null
  const levelShown = levels ? (planLevel ?? current.level ?? levels[0].index) : null
  const plan = levels ? (levels.find(l => l.index === levelShown) ?? levels[0]) : data.plan
  const onPlan = (v: TourView) => !levels || v.level === levelShown
  const version = encodeURIComponent(data.builtAt ?? '')
  const previous = prev !== null ? views[order[prev]] : null
  const update = data.update
  const toUpdate = update ? update.views.length + update.photos.length : 0
  // AI 360° views not approved yet: their mirrors can be put back for free.
  const unapprovedAi = views.filter(v => v.panoAiFile && !v.panoAiApproved && !v.panoAiStale).length

  return (
    <div className="tour">
      <header className="tour-bar">
        {!published && (
          <a className="tour-back" href={`/studio?scene=${sceneId}`}>
            ← Studio
          </a>
        )}
        <div className="tour-title">
          <strong>{title}</strong>
          <span>
            {current.name} · {step + 1} / {order.length}
            {data.preview && !published ? ' · aperçu rapide : la qualité finale arrive avec la préparation plein jour' : ''}
          </span>
        </div>
        {!published && <LookPanel sceneId={sceneId} tourReady={!building && views.some(v => v.pano)} />}
        {!published && <DesktopPublish sceneId={sceneId} />}
        <div className="tour-modes" role="group" aria-label="Mode de visite">
          <button type="button" aria-pressed={shown === 'photo'} disabled={!current.photo} onClick={() => setMode('photo')}>
            Photo
          </button>
          <button type="button" aria-pressed={shown === 'pano'} disabled={!current.pano} onClick={() => setMode('pano')}>
            360°
          </button>
          {data.plan && (
            <button type="button" aria-pressed={shown === 'plan2d'} onClick={() => setMode('plan2d')}>
              Plan 2D
            </button>
          )}
          {(data.plan3d || !published) && (
            <button type="button" aria-pressed={shown === 'plan3d'} onClick={() => setMode('plan3d')}>
              Plan 3D
            </button>
          )}
          {(film?.video || !published) && (
            <button type="button" aria-pressed={shown === 'video'} onClick={() => setMode('video')}>
              Vidéo
            </button>
          )}
          <button type="button" aria-pressed={shown === 'gallery'} onClick={() => setMode('gallery')}>
            Galerie
          </button>
          {!published && (
            <button type="button" aria-pressed={shown === 'photos'} onClick={() => setMode('photos')}>
              Nouvelles photos
            </button>
          )}
          {/* the free walk starts where the visitor stands in the tour */}
          {data.walk && (
            <a
              href={`/studio/explore/${sceneId}?at=${current.index}${shown === 'pano' && lookYaw ? `&turn=${((-lookYaw * 180) / Math.PI).toFixed(1)}` : ''}${editing ? '&edit=1' : ''}`}
            >
              Visite libre
            </a>
          )}
        </div>
      </header>

      <main
        className="tour-stage"
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
          <Plan3dSheet sceneId={sceneId} file={data.plan3d ?? null} version={version} title={title} />
        ) : shown === 'gallery' ? (
          <GallerySheet sceneId={sceneId} title={title} onCreate={() => setMode('photos')} />
        ) : shown === 'photos' ? (
          <PhotosSheet sceneId={sceneId} views={views} version={version} onDone={() => void load().catch(() => undefined)} />
        ) : shown === 'video' ? (
          <VideoSheet sceneId={sceneId} film={film} canMake={!published && !missingPanos} busy={!!busy} onMake={makeVideo} />
        ) : shown === 'pano' && current.pano ? (
          <>
            <PanoViewer
              key={`${current.index}-${editing && showBase ? 'base' : 'shown'}`}
              src={`/api/scenes/${sceneId}/tour/${editing && showBase && current.panoBase ? current.panoBase : current.pano}?v=${version}`}
              hdSrc={!(editing && showBase) && current.panoHd ? `/api/scenes/${sceneId}/tour/${current.panoHd}?v=${version}` : undefined}
              spots={panoSpots}
              onSpot={key => goToView(Number(key))}
              onLook={setLookYaw}
              onReady={() => setPanoReady(true)}
              // The operator's chosen start; otherwise a saved view that looks at a wall starts turned around.
              initialYaw={current.startYaw ?? (current.noPhoto && !current.auto ? Math.PI : 0)}
            />
            {!panoReady && <div className="tour-loading">Chargement du 360°…</div>}
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
                >
                  <span aria-hidden="true">↑</span> {s.view.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="tour-message">Pas encore de photo pour {current.name}.</div>
        )}

        {(shown === 'photo' || shown === 'pano') && (
          <>
            <button type="button" className="tour-arrow left" aria-label="Vue précédente" onClick={() => go(step - 1)}>
              ‹
            </button>
            <button type="button" className="tour-arrow right" aria-label="Vue suivante" onClick={() => go(step + 1)}>
              ›
            </button>
          </>
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
            <div className="tour-plan-inner" style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
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
      </main>

      {!published && (shown === 'photo' || shown === 'pano') && (missingPanos > 0 || missingPhotos > 0 || building || busy || data.status.state === 'failed' || editing) && (
        <aside className="tour-prep">
          {building ? (
            <>
              <strong>{data.status.kind === 'ai' ? '360° en qualité photo…' : 'Préparation de la visite 360°…'}</strong>
              <span>{data.status.step}</span>
              <ThermalNote t={data.status.thermal} />
              <progress max={data.status.total ?? 1} value={data.status.done ?? 0} />
              <button type="button" className="tour-stop" onClick={() => void stopBuild()}>
                Arrêter
              </button>
            </>
          ) : (
            <>
              {data.status.state === 'failed' && <span className="tour-error">{data.status.error}</span>}
              {editing && error && <span className="tour-error">{error}</span>}
              {editing && update && (
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
              {editing && current.photo && update?.photos.includes(current.photo) && (
                <span>La photo de {current.name} montre une partie modifiée du fichier : elle sera refaite par la mise à jour.</span>
              )}
              {missingPanos > 0 && (
                <>
                  <button type="button" onClick={() => prepare()} disabled={!!busy}>
                    Préparer la visite 360° ({views.length} vues, 1 à 5 min selon la taille)
                  </button>
                  <DesktopRenderNotice kind="tour" points={Math.max(views.length, 4)} />
                </>
              )}
              {missingPhotos > 0 && (
                <button type="button" onClick={() => setMode('photos')} disabled={!!busy}>
                  Nouvelles photos ({missingPhotos} vues sans photo)
                </button>
              )}
              {editing && data.ai360 && current.pano && !current.panoAi && (
                <>
                  <span>360° en qualité photo pour {current.name} : six photos IA calées sur le rendu (6 images, environ 2 min).</span>
                  <button type="button" onClick={() => upgradePano([current.index], 'soleil')} disabled={!!busy}>
                    Passer en qualité photo
                  </button>
                </>
              )}
              {editing && data.ai360 && <a href={`/studio/tour/${sceneId}/faces`}>Revue des faces IA</a>}
              {editing && data.ai360 && unapprovedAi > 0 && (
                <button type="button" onClick={() => applyUpdate('mirrors')} disabled={!!busy}>
                  Remettre les vrais miroirs dans les 360° non validés (gratuit, aucune image achetée)
                </button>
              )}
              {editing && (
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
              )}
              {editing && data.ai360 && blenderStops.length > 1 && (
                <>
                  <span>Toute la visite en qualité photo ({blenderStops.length} points, {blenderStops.length * 6} images) :</span>
                  <button type="button" onClick={() => upgradePano(blenderStops, 'soleil')} disabled={!!busy}>
                    Passer toute la visite en qualité photo
                  </button>
                </>
              )}
              {editing && shown === 'pano' && (
                <button type="button" onClick={() => editPoint(current.index, { startYaw: lookYaw })} disabled={!!busy}>
                  Démarrer le 360° de {current.name} dans cette direction
                </button>
              )}
              {editing && (
                <button type="button" onClick={() => editPoint(current.index, { hidden: !current.hidden })} disabled={!!busy}>
                  {current.hidden ? `Remettre ${current.name} dans la visite` : `Retirer ${current.name} de la visite`}
                </button>
              )}
              {editing && current.panoAiFile && (
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
