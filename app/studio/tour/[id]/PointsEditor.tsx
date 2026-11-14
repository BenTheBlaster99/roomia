'use client'

import { useMemo, useRef, useState } from 'react'
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
  onConfirm,
  onRedo,
}: {
  sceneId: string
  proposal: TourProposal
  busy: boolean
  onConfirm: (points: ConfirmedPoints, aiMax: number) => void
  onRedo: () => void
}) {
  const levels = proposal.levels ?? []
  const eye = proposal.eye ?? 1.6
  const [points, setPoints] = useState<Edit[]>(() => (proposal.points ?? []).map(fromProposal))
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
  const number = useMemo(() => new Map(kept.map((p, n) => [p.key, n + 1])), [kept])
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
        <a className="tour-back" href={`/studio?scene=${sceneId}`}>
          ← Studio
        </a>
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
          <div
            ref={box}
            className={`points-plan${adding ? ' adding' : ''}`}
            style={{ aspectRatio: `${level.width} / ${level.height}` }}
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
            <img src={`/api/scenes/${sceneId}/tour/${level.file}?v=${encodeURIComponent(proposal.at)}`} alt="" draggable={false} onPointerDown={e => {
              if (adding) addAt(e.clientX, e.clientY)
              else setSelected(null)
            }} />
            {points
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
            <p className="tour-note">Cliquez un point du plan pour le renommer, le tourner, le déplacer ou le retirer.</p>
          )}

          <button type="button" className={`tour-btn secondary${adding ? ' on' : ''}`} onClick={() => setAdding(a => !a)}>
            {adding ? 'Cliquez sur le plan où placer le point…' : '＋ Ajouter un point'}
          </button>

          <div className="points-sum">
            <p className="tour-big">
              {kept.length} <span>{kept.length > 1 ? 'points 360°' : 'point 360°'}</span>
            </p>
            {!signedIn ? (
              <p className="tour-note">Connectez-vous à votre compte Roomia pour la finition IA : sans compte, la visite reste en rendu Blender.</p>
            ) : aiMax < 1 ? (
              <p className="tour-note">{panoLeft !== null ? 'Plus de vues 360° dans votre forfait' : 'Plus de crédits'} : la visite sera en rendu Blender. Contactez Roomia pour l’étendre.</p>
            ) : kept.length > aiMax ? (
              <p className="tour-note">
                Votre {panoLeft !== null ? 'forfait' : 'compte'} permet {plural(aiMax, 'vue finie', 'vues finies')} par l’IA : les {aiMax} premiers points auront la qualité finale,
                les autres le rendu Blender.
              </p>
            ) : (
              <p className="tour-note">Rendu, lumière du jour et finition IA de chaque point, sans autre clic.</p>
            )}
          </div>

          <button type="button" className="tour-btn" disabled={busy || kept.length === 0} onClick={confirm}>
            Lancer la visite 360°
          </button>
          <button type="button" className="tour-btn secondary" disabled={busy} onClick={onRedo}>
            Replacer les points automatiquement
          </button>
        </aside>
      </div>
    </div>
  )
}
