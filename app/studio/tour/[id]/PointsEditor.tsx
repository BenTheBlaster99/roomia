'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { forfaitLeft, plural } from '@/lib/forfait'
import type { ProposalLevel, ProposalPoint, TourProposal } from '@/lib/scene-tour'
import { useForfait } from '../../components/useForfait'

/** A point while the person edits it: where it stands on its level's plan (pixels) and where its 360° starts (degrees). */
interface Edit {
  key: string
  kind: 'view' | 'auto'
  view?: number
  id?: string
  name: string
  level: number
  x: number
  y: number
  angle: number
  /** a SketchUp scene kept in the tour */
  on: boolean
  /** moved or turned: its position is computed from the plan */
  changed: boolean
  position: [number, number, number]
  target: [number, number, number]
}

export interface ConfirmedPoints {
  views: number[]
  auto: { id?: string; name: string; position: [number, number, number]; target: [number, number, number] }[]
}

const fromProposal = (p: ProposalPoint): Edit => ({
  key: p.key,
  kind: p.kind,
  view: p.view,
  id: p.id,
  name: p.name,
  level: p.level,
  x: p.plan.x,
  y: p.plan.y,
  angle: p.plan.angle,
  on: !p.off,
  changed: false,
  position: p.position,
  target: p.target,
})

/** Plan pixels -> the model (three.js, y up): the inverse of the tour script's plan_xy, at eye height on the level's floor. */
function toWorld(e: Edit, L: ProposalLevel, eye: number) {
  const [x0, y0, x1, y1] = L.frame
  const bx = x0 + (e.x / L.width) * (x1 - x0)
  const by = y1 - (e.y / L.height) * (y1 - y0)
  const bz = L.floor + eye
  // on the plan y goes down, in Blender it goes up
  const a = (e.angle * Math.PI) / 180
  const tx = bx + 2 * Math.cos(a)
  const ty = by - 2 * Math.sin(a)
  return { position: [bx, bz, -by] as [number, number, number], target: [tx, bz, -ty] as [number, number, number] }
}

/**
 * The points before the 360° is made (14 Nov, the user's ask): Roomia proposes them on the plan; the person keeps them or chooses
 * exactly which points, where and facing where. Then everything runs by itself: Blender, the daylight Présentation and the AI finish.
 */
export default function PointsEditor({
  sceneId,
  proposal,
  busy,
  error,
  onConfirm,
  onRedo,
  onCancel,
}: {
  sceneId: string
  proposal: TourProposal
  busy: boolean
  /** what the last action answered (shown under the buttons) */
  error?: string
  onConfirm: (points: ConfirmedPoints, aiMax: number) => void
  onRedo: () => void
  /** back to the visit as it is (when one exists): the proposal is dropped, nothing is rendered */
  onCancel?: () => void
}) {
  const levels = proposal.levels ?? []
  const eye = proposal.eye ?? 1.6
  const [points, setPoints] = useState<Edit[]>(() => (proposal.points ?? []).map(fromProposal))
  /** the points as they came: over a visit, "Lancer" only once something changed (18 Nov: nothing is made again for nothing) */
  const [initial] = useState(() => JSON.stringify((proposal.points ?? []).map(fromProposal).map(p => [p.key, p.on, p.name])))
  /** the points of the visit as it is: only the ones moved, turned, added or put back are made again (18 Nov) */
  const [inVisit] = useState(() => new Set(proposal.fromBuild ? (proposal.points ?? []).filter(p => !p.off).map(p => p.key) : []))
  /** the plan picture didn't load (17 Nov, Sarah: a white plan with the points pushed to its edges) */
  const [planFailed, setPlanFailed] = useState(false)
  const [levelIndex, setLevelIndex] = useState(() => (levels.find(l => l.main) ?? levels[0])?.index ?? 0)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ key: string; moved: boolean } | null>(null)
  const added = useRef(0)
  const { forfait, signedIn, credits } = useForfait()
  const panoLeft = forfaitLeft(forfait, 'pano')
  const aiMax = signedIn ? (panoLeft ?? credits) : 0

  const level = levels.find(l => l.index === levelIndex) ?? levels[0]
  const kept = points.filter(p => p.on)
  const dirty = points.some(p => p.changed) || JSON.stringify(points.map(p => [p.key, p.on, p.name])) !== initial
  const toRender = kept.filter(p => p.changed || !inVisit.has(p.key))
  // the 360 is the AI image itself (15 Nov): never a visit left at the Blender stage, so every point needs its finish
  const blocked = !signedIn
    ? 'Connectez-vous à votre compte Roomia (Mon espace) pour lancer la visite : chaque point est fini par l’IA.'
    : aiMax < toRender.length
      ? `Votre ${panoLeft !== null ? 'forfait' : 'compte'} permet encore ${plural(aiMax, 'vue 360°', 'vues 360°')} : ${toRender.length} points à faire. Retirez-en ou contactez Roomia pour l’étendre.`
      : null
  const number = new Map(kept.map((p, n) => [p.key, n + 1]))
  const sel = points.find(p => p.key === selected) ?? null

  const update = (key: string, patch: Partial<Edit>) => setPoints(ps => ps.map(p => (p.key === key ? { ...p, ...patch } : p)))
  const planXY = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(level.width, Math.max(0, ((clientX - r.left) / r.width) * level.width)), y: Math.min(level.height, Math.max(0, ((clientY - r.top) / r.height) * level.height)) }
  }

  function addAt(clientX: number, clientY: number) {
    const { x, y } = planXY(clientX, clientY)
    // facing the middle of the plan: most often into the room
    const angle = (Math.atan2(level.height / 2 - y, level.width / 2 - x) * 180) / Math.PI
    const key = `new:${++added.current}`
    const n = points.filter(p => p.kind === 'auto').length + 1
    setPoints(ps => [...ps, { key, kind: 'auto', name: `Point ${n}`, level: level.index, x, y, angle, on: true, changed: true, position: [0, 0, 0], target: [0, 0, 0] }])
    setSelected(key)
    setAdding(false)
  }

  function confirm() {
    const views = points.filter(p => p.kind === 'view' && p.on).map(p => p.view!)
    const auto = points
      .filter(p => p.kind === 'auto' && p.on)
      .map(p => {
        const L = levels.find(l => l.index === p.level) ?? level
        const where = p.changed ? toWorld(p, L, eye) : { position: p.position, target: p.target }
        return { ...(p.id ? { id: p.id } : {}), name: p.name, ...where }
      })
    onConfirm({ views, auto }, aiMax)
  }

  if (!level) return <div className="tour tour-message">Aucun plan n’a pu être dessiné pour ce fichier.</div>

  return (
    <div className="tour points">
      <header className="points-head">
        <Link className="tour-back" href="/studio/projets" onClick={() => onCancel?.()}>
          ← Mes projets
        </Link>
        <div>
          <strong>Les points de vue de votre visite 360°</strong>
          <span>
            Roomia a placé {plural(kept.length, 'point', 'points')} : gardez-les tels quels, ou choisissez exactement où regarder. Cliquez un point pour le
            modifier, faites-le glisser pour le déplacer.
          </span>
        </div>
        {levels.length > 1 && (
          <div className="tour-levels" role="group" aria-label="Niveau">
            {levels.map(l => (
              <button key={l.index} type="button" aria-pressed={l.index === level.index} onClick={() => setLevelIndex(l.index)}>
                {l.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="points-body">
        <div className="points-plan-wrap">
          <div className="points-plan-fit">
          <div
            ref={box}
            className={`points-plan${adding ? ' adding' : ''}`}
            style={{ aspectRatio: `${level.width} / ${level.height}`, ['--ratio' as string]: level.width / level.height }}
            onPointerDown={e => {
              if (adding && e.target === e.currentTarget) addAt(e.clientX, e.clientY)
              else if (e.target === e.currentTarget) setSelected(null)
            }}
            onPointerMove={e => {
              const d = drag.current
              if (!d) return
              const { x, y } = planXY(e.clientX, e.clientY)
              d.moved = true
              update(d.key, { x, y, changed: true })
            }}
            onPointerUp={() => {
              drag.current = null
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/scenes/${sceneId}/tour/${level.file}?v=${encodeURIComponent(proposal.at)}`}
              alt=""
              draggable={false}
              onError={() => setPlanFailed(true)}
              onPointerDown={e => {
                if (adding) addAt(e.clientX, e.clientY)
                else setSelected(null)
              }}
            />
            {planFailed && (
              <div className="points-plan-failed">
                <strong>Le plan n’a pas pu être affiché.</strong>
                <span>Roomia peut replacer les points et redessiner le plan.</span>
                <button type="button" className="tour-btn" disabled={busy} onClick={onRedo}>
                  Replacer automatiquement
                </button>
              </div>
            )}
            {!planFailed && points
              .filter(p => p.level === level.index)
              .map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`points-dot${p.on ? '' : ' off'}${p.key === selected ? ' sel' : ''}${p.kind === 'view' ? ' view' : ''}`}
                  style={{ left: `${(p.x / level.width) * 100}%`, top: `${(p.y / level.height) * 100}%` }}
                  title={p.name}
                  onPointerDown={e => {
                    e.stopPropagation()
                    setSelected(p.key)
                    if (p.kind === 'auto') {
                      drag.current = { key: p.key, moved: false }
                      ;(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId)
                    }
                  }}
                >
                  {p.on && <span className="points-cone" style={{ transform: `rotate(${p.angle}deg)` }} />}
                  <b>{p.on ? number.get(p.key) : '–'}</b>
                </button>
              ))}
          </div>
          </div>
        </div>

        <aside className="points-side">
          {sel ? (
            <div className="points-card">
              <label className="points-name">
                Nom du point
                <input value={sel.name} maxLength={60} onChange={e => update(sel.key, { name: e.target.value })} />
              </label>
              {sel.kind === 'view' ? (
                <>
                  <span className="tour-note">Vue enregistrée dans SketchUp : elle garde la place et la direction de la scène.</span>
                  <button type="button" className="tour-btn secondary" onClick={() => update(sel.key, { on: !sel.on })}>
                    {sel.on ? 'Retirer de la visite' : 'Remettre dans la visite'}
                  </button>
                </>
              ) : (
                <>
                  <span className="tour-note">Le 360° démarre dans la direction de la flèche.</span>
                  <div className="points-turn">
                    <button type="button" className="tour-btn secondary" onClick={() => update(sel.key, { angle: sel.angle - 45, changed: true })} aria-label="Tourner à gauche">
                      ⟲ Tourner
                    </button>
                    <button type="button" className="tour-btn secondary" onClick={() => update(sel.key, { angle: sel.angle + 45, changed: true })} aria-label="Tourner à droite">
                      Tourner ⟳
                    </button>
                  </div>
                  <button
                    type="button"
                    className="tour-btn secondary danger"
                    onClick={() => {
                      setPoints(ps => ps.filter(p => p.key !== sel.key))
                      setSelected(null)
                    }}
                  >
                    Supprimer ce point
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <p className="tour-note">Cliquez un point du plan pour le renommer, le tourner, le déplacer ou le retirer.</p>
              <ul className="points-legend">
                <li>
                  <i className="view" /> Une scène enregistrée dans SketchUp
                </li>
                <li>
                  <i /> Un point proposé par Roomia
                </li>
              </ul>
            </>
          )}

          <button type="button" className={`tour-btn secondary${adding ? ' on' : ''}`} onClick={() => setAdding(a => !a)}>
            {adding ? 'Cliquez sur le plan où placer le point…' : '＋ Ajouter un point'}
          </button>

          <div className="points-sum">
            <p className="tour-big">
              {kept.length} <span>{kept.length > 1 ? 'points 360°' : 'point 360°'}</span>
            </p>
            {blocked ? (
              <p className="tour-note">{blocked}</p>
            ) : onCancel && !dirty ? (
              <p className="tour-note">Aucun changement : votre visite reste telle quelle.</p>
            ) : onCancel ? (
              <p className="tour-note">
                {toRender.length
                  ? `${plural(toRender.length, 'point à refaire', 'points à refaire')} (${plural(toRender.length, 'vue 360°', 'vues 360°')} de votre ${panoLeft !== null ? 'forfait' : 'compte'}) ; les autres gardent leur 360° fini. Plans mis à jour.`
                  : 'Aucun point à refaire : la visite et les plans sont mis à jour, sans nouvelle vue 360°.'}
              </p>
            ) : (
              <p className="tour-note">Rendu, lumière du jour, finition IA de chaque point et plans, en une fois, sans autre clic.</p>
            )}
          </div>

          <button type="button" className="tour-btn" disabled={busy || kept.length === 0 || !!blocked || (!!onCancel && !dirty)} onClick={confirm}>
            {onCancel ? (toRender.length ? `Refaire ${plural(toRender.length, 'point', 'points')}` : 'Mettre à jour la visite') : 'Lancer la visite 360°'}
          </button>
          <button type="button" className="tour-btn secondary" disabled={busy} onClick={onRedo}>
            Replacer automatiquement
          </button>
          {onCancel && (
            <button type="button" className="tour-btn secondary" disabled={busy} onClick={onCancel}>
              Garder la visite actuelle
            </button>
          )}
          {error && <p className="tour-error">{error}</p>}
        </aside>
      </div>
    </div>
  )
}
