'use client'

import { useEffect, useMemo, useState } from 'react'

interface Label {
  eligible?: 'oui' | 'non' | 'incertain'
  result?: 'ok' | 'rejet'
  reasons?: string[]
}

interface Face {
  at: string
  run: string
  index: number
  point: string
  face: string
  decision: string
  planes?: number
  distance?: number
  model?: string
  quality?: string
  light?: string
  seconds?: number
  ok?: boolean
  error?: string
  retried?: boolean
  capture?: string
  ai?: string
  label: Label | null
}

const DECISIONS: Record<string, string> = {
  ai: 'envoyée à l’IA',
  ceiling: 'plafond, gardé Blender',
  bare: 'mur nu (géométrie), gardé Blender',
  near: 'trop proche, gardé Blender',
  plain: 'image unie, gardé Blender',
  'no-credit': 'pas de crédit',
}

const REASONS: [string, string][] = [
  ['structure', 'Structure inventée'],
  ['materiau', 'Matière / couleur changée'],
  ['reflet', 'Reflet faux'],
  ['raccord', 'Raccord / lumière'],
  ['detail', 'Perte de détail'],
  ['autre', 'Autre'],
]

/** One card per kept face: the two questions are separate, and every setting is recorded without typing. */
export default function FacesClient({ sceneId, title }: { sceneId: string; title: string }) {
  const [faces, setFaces] = useState<Face[]>([])
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'tout' | 'ai' | 'garde' | 'a-faire'>('a-faire')

  useEffect(() => {
    let alive = true
    fetchFaces(sceneId)
      .then(list => alive && setFaces(list))
      .catch(err => alive && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      alive = false
    }
  }, [sceneId])

  async function label(face: Face, change: Label) {
    const next: Label = { ...face.label, ...change }
    setFaces(list => list.map(f => (f === face ? { ...f, label: next } : f)))
    const res = await fetch(`/api/scenes/${sceneId}/tour/faces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: face.run, index: face.index, face: face.face, ...next }),
    })
    if (!res.ok) setError('Le libellé n’a pas été enregistré. Réessayez.')
  }

  const shown = useMemo(
    () =>
      faces.filter(f =>
        filter === 'ai' ? f.ai : filter === 'garde' ? !f.ai : filter === 'a-faire' ? !f.label?.eligible || (f.ai && !f.label?.result) : true,
      ),
    [faces, filter],
  )
  const done = faces.filter(f => f.label?.eligible && (!f.ai || f.label.result)).length
  const img = (f: Face, file: string) => `/api/scenes/${sceneId}/tour/faces/${f.run}/${file}`

  return (
    <div className="faces">
      <header className="faces-head">
        <a href={`/studio/tour/${sceneId}?edit=1`}>← Visite</a>
        <div>
          <strong>Revue des faces · {title}</strong>
          <span>
            {done} / {faces.length} faces revues
          </span>
        </div>
        <nav>
          {(['a-faire', 'ai', 'garde', 'tout'] as const).map(k => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'a-faire' ? 'À revoir' : k === 'ai' ? 'Envoyées à l’IA' : k === 'garde' ? 'Gardées Blender' : 'Toutes'}
            </button>
          ))}
        </nav>
      </header>
      {error && <p className="faces-error">{error}</p>}
      {faces.length === 0 && !error && <p className="faces-empty">Aucune face gardée : lancez un 360° en qualité photo.</p>}
      <main className="faces-grid">
        {shown.map(f => (
          <article key={`${f.run}/${f.index}/${f.face}`} className="face-card">
            <div className="face-images">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- private API images, like the tour's */}
                {f.capture && <img src={img(f, f.capture)} alt="" loading="lazy" />}
                <figcaption>Capture Blender</figcaption>
              </figure>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- private API images, like the tour's */}
                {f.ai ? <img src={img(f, f.ai)} alt="" loading="lazy" /> : <div className="face-none">Pas d’image IA</div>}
                <figcaption>Résultat IA</figcaption>
              </figure>
            </div>
            <p className="face-meta">
              <strong>
                {f.point} · {f.face}
              </strong>{' '}
              — {DECISIONS[f.decision] ?? f.decision}
              {f.error && f.decision === 'ai' ? ` (échec : ${f.error})` : ''}
              <br />
              plans {f.planes ?? '–'} · distance {f.distance ?? '–'} m · {f.model} · {f.quality} · {f.light}
              {f.seconds ? ` · ${f.seconds} s` : ''}
              {f.retried ? ' · réessayée' : ''}
            </p>
            <div className="face-q">
              <span>1. Fallait-il l’envoyer à l’IA ?</span>
              {(['oui', 'non', 'incertain'] as const).map(v => (
                <button key={v} type="button" className={f.label?.eligible === v ? 'on' : ''} onClick={() => label(f, { eligible: v })}>
                  {v === 'oui' ? 'Oui' : v === 'non' ? 'Non, Blender suffit' : 'Incertain'}
                </button>
              ))}
            </div>
            {f.ai && (
              <div className="face-q">
                <span>2. Le résultat IA est-il acceptable ?</span>
                <button type="button" className={f.label?.result === 'ok' ? 'on' : ''} onClick={() => label(f, { result: 'ok', reasons: [] })}>
                  Acceptable
                </button>
                <button type="button" className={f.label?.result === 'rejet' ? 'on reject' : ''} onClick={() => label(f, { result: 'rejet' })}>
                  À rejeter
                </button>
              </div>
            )}
            {f.label?.result === 'rejet' && (
              <div className="face-q reasons">
                {REASONS.map(([k, text]) => {
                  const on = f.label?.reasons?.includes(k)
                  return (
                    <button
                      key={k}
                      type="button"
                      className={on ? 'on' : ''}
                      onClick={() => label(f, { reasons: on ? f.label!.reasons!.filter(r => r !== k) : [...(f.label?.reasons ?? []), k] })}
                    >
                      {text}
                    </button>
                  )
                })}
              </div>
            )}
          </article>
        ))}
      </main>
    </div>
  )
}

async function fetchFaces(sceneId: string): Promise<Face[]> {
  const res = await fetch(`/api/scenes/${sceneId}/tour/faces`, { cache: 'no-store' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.detail ?? 'Chargement impossible.')
  return body.faces as Face[]
}
