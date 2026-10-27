'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TourStatus, TourView } from '@/lib/scene-tour'
import PanoViewer, { type PanoSpot } from './PanoViewer'

interface TourData {
  status: TourStatus
  plan: { file: string; hd?: string; lines?: string; width: number; height: number } | null
  builtAt: string | null
  views: TourView[]
}

type Mode = 'photo' | 'pano'

/** Views within this distance (metres) of the current one get an arrow towards them. */
const NEAR = 9
/** Eyes are ~1.5 m above the floor: arrows point at the floor where the next view stands. */
const EYE_ABOVE_ARROW = 1.25

const PHOTO_ASPECT = 1536 / 1024

/** Order of the visit (positions in `views`): from the first view, always the nearest one not yet seen. */
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
      const d = Math.hypot(p[0] - here[0], p[2] - here[2])
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

export default function TourClient({ sceneId, title }: { sceneId: string; title: string }) {
  const [data, setData] = useState<TourData | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [prev, setPrev] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('photo')
  // Review: show the Blender 360° instead of the AI one, to compare.
  const [showBase, setShowBase] = useState(false)
  const [lookYaw, setLookYaw] = useState(0)
  const [panoReady, setPanoReady] = useState(false)
  const [busy, setBusy] = useState('')
  // ?edit=1: Roomia's own controls (paid upgrades); a client opening the tour never sees them.
  const [editing] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1')
  const swipe = useRef<{ x: number; y: number } | null>(null)

  const load = useCallback(() => fetchTour(sceneId, editing).then(setData), [sceneId, editing])

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

  async function prepare() {
    setBusy('pano')
    try {
      const res = await fetch(`/api/scenes/${sceneId}/tour`, { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail ?? 'La préparation n’a pas pu démarrer.')
      await load()
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
        body: JSON.stringify({ review: { index, approve } }),
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

  async function renderMissingPhotos() {
    const missing = views.filter(v => !v.photo && !v.noPhoto)
    for (const [k, v] of missing.entries()) {
      setBusy(`Photo ${k + 1} / ${missing.length} : ${v.name}…`)
      const res = await fetch('/api/render/scene-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId, cameraIndex: v.index, lens: '24', time: 'apres-midi', sun: true, interior: true }),
      }).catch(() => null)
      // The photo step streams its progress; the tour only needs it to finish.
      await res?.text().catch(() => '')
      await load().catch(() => undefined)
    }
    setBusy('')
  }

  if (error && !data) return <div className="tour tour-message">{error}</div>
  if (!data) return <div className="tour tour-message">Chargement de la visite…</div>
  if (!current) return <div className="tour tour-message">Cette scène n’a pas de vue enregistrée.</div>

  const missingPhotos = views.filter(v => !v.photo && !v.noPhoto).length
  // Every stop still in Blender quality, for one order covering the whole apartment.
  const blenderStops = views.filter(v => v.pano && !v.panoAiFile && !v.hidden).map(v => v.index)
  const missingPanos = views.filter(v => !v.pano).length
  const building = data.status.state === 'building'
  const coneAngle = (current.plan?.angle ?? 0) + (shown === 'pano' ? (lookYaw * 180) / Math.PI : 0)
  const version = encodeURIComponent(data.builtAt ?? '')
  const previous = prev !== null ? views[order[prev]] : null

  return (
    <div className="tour">
      <header className="tour-bar">
        <a className="tour-back" href={`/studio?scene=${sceneId}`}>
          ← Studio
        </a>
        <div className="tour-title">
          <strong>{title}</strong>
          <span>
            {current.name} · {step + 1} / {order.length}
          </span>
        </div>
        <div className="tour-modes" role="group" aria-label="Mode de visite">
          <button type="button" aria-pressed={shown === 'photo'} disabled={!current.photo} onClick={() => setMode('photo')}>
            Photo
          </button>
          <button type="button" aria-pressed={shown === 'pano'} disabled={!current.pano} onClick={() => setMode('pano')}>
            360°
          </button>
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
        {shown === 'pano' && current.pano ? (
          <>
            <PanoViewer
              key={`${current.index}-${editing && showBase ? 'base' : 'shown'}`}
              src={`/api/scenes/${sceneId}/tour/${editing && showBase && current.panoBase ? current.panoBase : current.pano}?v=${version}`}
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

        <button type="button" className="tour-arrow left" aria-label="Vue précédente" onClick={() => go(step - 1)}>
          ‹
        </button>
        <button type="button" className="tour-arrow right" aria-label="Vue suivante" onClick={() => go(step + 1)}>
          ›
        </button>

        {data.plan && (
          <nav className="tour-plan" aria-label="Plan de l’appartement">
            <div className="tour-plan-inner" style={{ aspectRatio: `${data.plan.width} / ${data.plan.height}` }}>
              <img src={`/api/scenes/${sceneId}/tour/${data.plan.file}?v=${version}`} alt="" aria-hidden="true" />
              {views.map(v =>
                v.plan ? (
                  <button
                    key={v.index}
                    type="button"
                    className={`tour-dot${v.index === current.index ? ' here' : ''}`}
                    style={{ left: `${(v.plan.x / data.plan!.width) * 100}%`, top: `${(v.plan.y / data.plan!.height) * 100}%` }}
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

      {(missingPanos > 0 || missingPhotos > 0 || building || busy || data.status.state === 'failed' || editing) && (
        <aside className="tour-prep">
          {building ? (
            <>
              <strong>{data.status.kind === 'ai' ? '360° en qualité photo…' : 'Préparation de la visite 360°…'}</strong>
              <span>{data.status.step}</span>
              <progress max={data.status.total ?? 1} value={data.status.done ?? 0} />
            </>
          ) : (
            <>
              {data.status.state === 'failed' && <span className="tour-error">{data.status.error}</span>}
              {missingPanos > 0 && (
                <button type="button" onClick={prepare} disabled={!!busy}>
                  Préparer la visite 360° ({views.length} vues, 1 à 5 min selon la taille)
                </button>
              )}
              {missingPhotos > 0 && (
                <button type="button" onClick={renderMissingPhotos} disabled={!!busy}>
                  Générer les {missingPhotos} photos manquantes
                </button>
              )}
              {editing && current.pano && !current.panoAi && (
                <>
                  <span>360° en qualité photo pour {current.name} (jusqu’à 5 images) :</span>
                  <button type="button" onClick={() => upgradePano([current.index], 'soleil')} disabled={!!busy}>
                    Lumière soleil (chaude, dorée)
                  </button>
                  <button type="button" onClick={() => upgradePano([current.index], 'douce')} disabled={!!busy}>
                    Lumière douce (égale partout)
                  </button>
                </>
              )}
              {editing && <a href={`/studio/tour/${sceneId}/faces`}>Revue des faces IA</a>}
              {editing && data.plan?.hd && (
                <>
                  <a href={`/api/scenes/${sceneId}/tour/${data.plan.hd}?v=${version}`} download={`plan-${sceneId}.png`}>
                    Télécharger le plan (murs pleins)
                  </a>
                  {data.plan.lines && (
                    <a href={`/api/scenes/${sceneId}/tour/${data.plan.lines}?v=${version}`} download={`plan-traits-${sceneId}.png`}>
                      Télécharger le plan (traits)
                    </a>
                  )}
                </>
              )}
              {editing && blenderStops.length > 1 && (
                <>
                  <span>Toute la visite en qualité photo ({blenderStops.length} points, jusqu’à {blenderStops.length * 5} images) :</span>
                  <button type="button" onClick={() => upgradePano(blenderStops, 'soleil')} disabled={!!busy}>
                    Lumière soleil
                  </button>
                  <button type="button" onClick={() => upgradePano(blenderStops, 'douce')} disabled={!!busy}>
                    Lumière douce
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
                  <button type="button" onClick={() => setShowBase(v => !v)} disabled={!!busy}>
                    {showBase ? 'Voir la version qualité photo' : 'Comparer avec la version Blender'}
                  </button>
                  {!current.panoAiApproved && (
                    <button type="button" onClick={() => review(current.index, true)} disabled={!!busy}>
                      Valider : fidèle au projet
                    </button>
                  )}
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

async function fetchTour(sceneId: string, review: boolean): Promise<TourData> {
  const res = await fetch(`/api/scenes/${sceneId}/tour${review ? '?edit=1' : ''}`, { cache: 'no-store' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ?? 'Visite introuvable.')
  return body as TourData
}

function photoUrl(sceneId: string, file: string) {
  return `/api/scenes/${sceneId}/photos/${encodeURIComponent(file)}`
}
