'use client'

import { useCallback, useEffect, useState } from 'react'
import { forfaitLeft, plural } from '@/lib/forfait'
import type { LookState as LookJob } from '@/lib/look-pipeline'
import { useForfait } from '../../components/useForfait'

/** The job's state, and the PC's thermal / pause state the route adds (lib/blender-guard.ts). */
type LookState = LookJob & { thermal?: { paused: boolean; waiting: boolean; userPaused: boolean; temp: number } }

const DA_PER_IMAGE = 16

const read = async (sceneId: string): Promise<LookState | null> => {
  const res = await fetch(`/api/scenes/${sceneId}/look`, { cache: 'no-store' }).catch(() => null)
  return res?.ok ? ((await res.json()) as LookState) : null
}

async function post(sceneId: string, body: Record<string, unknown>): Promise<{ ok: boolean; detail?: string }> {
  const res = await fetch(`/api/scenes/${sceneId}/look`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { detail?: string }
  return { ok: res.ok, detail: data.detail }
}

/**
 * "Présentation": the golden-hour 360° tour of every point (free, Blender only), then the AI finishing of the points that
 * deserve it. The AI step is paid, so the person chooses the points, sees the exact number of images and the cost, and
 * confirms that amount before anything is sent (lib/look-pipeline.ts refuses a job above the amount confirmed).
 */
export default function LookPanel({ sceneId, tourReady }: { sceneId: string; tourReady: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LookState | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  // a client's forfait counts 360 views, not credits or DA (lib/forfait.ts)
  const { forfait, refresh: refreshForfait } = useForfait()
  const panoLeft = forfaitLeft(forfait, 'pano')

  const load = useCallback(() => read(sceneId).then(s => s && setState(s)), [sceneId])
  const running = state?.stage === 'running'
  const paused = Boolean(state?.thermal?.userPaused)

  useEffect(() => {
    void load()
  }, [load])
  // the build that just ended starts the Présentation by itself (lib/scene-tour.ts): look again a few times for the new job
  useEffect(() => {
    if (!tourReady) return
    const timers = [1500, 5000, 12000].map(ms => setTimeout(() => void load(), ms))
    return () => timers.forEach(clearTimeout)
  }, [tourReady, load])
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void load(), 3000)
    return () => clearInterval(timer)
  }, [running, load])
  // every view starts selected (the AI light is one image per view)
  useEffect(() => {
    if (state?.suggestions && picked.length === 0 && state.stage === 'ready') setPicked(state.suggestions.map(s => s.index))
  }, [state, picked.length])

  // a finished (or stopped) AI job changed what is left of the forfait
  useEffect(() => {
    if (!running) refreshForfait()
  }, [running, refreshForfait])

  const images = picked.length
  const cost = images * DA_PER_IMAGE
  const overForfait = panoLeft !== null && images > panoLeft
  const resumeLabel = (c: number) => (panoLeft !== null ? 'Reprendre' : `Reprendre (${c} DA au plus)`)
  const toggle = (list: number[], set: (v: number[]) => void, i: number) => set(list.includes(i) ? list.filter(x => x !== i) : [...list, i])

  async function start(body: Record<string, unknown>) {
    setError('')
    const r = await post(sceneId, body)
    if (!r.ok) setError(r.detail ?? 'Impossible de démarrer.')
    await load()
  }

  const stage = state?.stage ?? 'idle'
  const label = running ? 'Qualité finale en cours…' : stage === 'done' ? 'Qualité finale ✓' : stage === 'ready' ? 'Qualité finale prête' : 'Qualité finale (plein jour)'
  const minutes = state?.startedAt ? Math.max(0, Math.round((Date.now() - state.startedAt) / 60000)) : 0

  return (
    <div className="tour-publish look-panel">
      <button type="button" className="tour-publish-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="tour-publish-panel look-panel-body" role="dialog" aria-label="Qualité finale plein jour">
          {(stage === 'idle' || (stage === 'interrupted' && state?.job !== 'ai') || (stage === 'error' && state?.job === 'render')) && (
            <>
              <strong>Qualité finale · plein jour</strong>
              <span>
                Roomia analyse le fichier (soleil, lumières, caméras), puis rend toutes les vues 360° en plein jour. Gratuit : aucun crédit,
                environ 1 à 2 minutes par vue sur votre PC.
              </span>
              {stage === 'interrupted' && <span className="tour-error">Le travail précédent a été interrompu. Il repart de zéro (gratuit).</span>}
              {state?.error && <span className="tour-error">{state.error}</span>}
              {state?.error && state.log?.length > 0 && <pre className="look-log">{state.log.slice(-14).join('\n')}</pre>}
              {state?.step && state.stage === 'idle' && <span>{state.step}</span>}
              {!tourReady && <span className="tour-error">Préparez d’abord la visite 360° (bouton « Préparer la visite ») : la présentation s’appuie sur ses points et son plan.</span>}
              <button type="button" disabled={!tourReady} onClick={() => void start({ action: 'render' })}>
                Générer la présentation (gratuit)
              </button>
            </>
          )}

          {running && (
            <>
              <strong>{state?.step || 'En cours…'}</strong>
              {state?.ai ? <progress max={state.ai.images} value={state.ai.done} /> : <progress />}
              <span>
                {minutes} min écoulée{minutes > 1 ? 's' : ''}. Vous pouvez continuer à travailler, mais ne fermez pas Roomia. Si le PC s’arrête, relancez : les images IA
                déjà faites ne sont pas payées deux fois.
              </span>
              {state?.detail && <span>{state.detail}</span>}
              {state?.ai && (
                <span>
                  {state.ai.done} / {state.ai.images} images · {state.ai.paid} payées · {state.ai.cached} reprises du cache
                </span>
              )}
              {state?.job === 'render' && (
                <>
                  <button type="button" className="tour-secondary" onClick={() => void start({ action: paused ? 'resume' : 'pause' })}>
                    {paused ? 'Reprendre' : 'Pause après cette vue'}
                  </button>
                  <span>{paused ? 'En pause : la vue en cours se termine, puis le PC se repose (utile pour travailler dans SketchUp).' : 'La vue en cours se termine, puis Roomia attend que vous repreniez.'}</span>
                </>
              )}
              <button type="button" className="tour-stop" onClick={() => void start({ action: 'stop' })}>
                Arrêter
              </button>
              <span>Arrêter coupe Blender tout de suite (le PC refroidit). Les images IA déjà faites sont gardées.</span>
            </>
          )}

          {stage === 'interrupted' && state?.job === 'ai' && state.ai && (
            <>
              <strong>Finition IA arrêtée</strong>
              <span>{state.step || 'Interrompue.'} Les images déjà faites sont gardées : les reprendre ne les repaie pas.</span>
              <button type="button" onClick={() => void start({ action: 'ai', points: state.ai!.points, ring: state.ai!.ring, maxCost: state.ai!.cost })}>
                {resumeLabel(state.ai.cost)}
              </button>
            </>
          )}

          {stage === 'ready' && (
            <>
              <strong>La visite 360° est prête</strong>
              <span>
                {state?.rendered?.length ?? 0} vues installées
                {state?.skipped && Object.keys(state.skipped).length > 0 ? `, ${Object.keys(state.skipped).length} ignorée(s) (caméra dans un meuble)` : ''}.
                Rechargez la page pour les voir.
              </span>
              <button type="button" onClick={() => window.location.reload()}>
                Voir la visite
              </button>
              {state?.suggestions && state.suggestions.length > 0 && (
                <>
                  <strong>Finition IA (payante)</strong>
                  <span>
                    L’IA donne sa lumière et ses couleurs à chaque vue ; Blender garde chaque objet et chaque texture.{' '}
                    {panoLeft !== null ? 'Chaque vue finie compte pour 1 vue de votre forfait.' : 'Une image IA par vue (1 crédit).'} Le style vient de
                    votre photo IA du séjour : faites-la d’abord pour le meilleur résultat.
                  </span>
                  <div className="look-points">
                    {state.suggestions.map(s => (
                      <div key={s.index} className="look-point">
                        <label>
                          <input type="checkbox" checked={picked.includes(s.index)} onChange={() => toggle(picked, setPicked, s.index)} />
                          <span
                            className="look-thumb"
                            style={{ backgroundImage: `url(/api/scenes/${sceneId}/tour/pano-${s.index}.jpg)` }}
                            role="img"
                            aria-label={s.name}
                          />
                          <b>{s.name}</b>
                        </label>
                      </div>
                    ))}
                  </div>
                  {panoLeft !== null ? (
                    <span>
                      <b>{plural(images, 'vue choisie', 'vues choisies')}</b> · votre forfait : {plural(panoLeft, 'vue restante', 'vues restantes')}.{' '}
                      {overForfait ? <span className="tour-error">Choisissez au plus {panoLeft} vue{panoLeft > 1 ? 's' : ''}, ou contactez Roomia pour étendre le forfait.</span> : 'Rien n’est envoyé avant votre confirmation.'}
                    </span>
                  ) : (
                    <span>
                      <b>
                        {images} vue{images > 1 ? 's' : ''} · {images} crédit{images > 1 ? 's' : ''}
                      </b>{' '}
                      ({cost} DA). Rien n’est envoyé avant votre confirmation.
                    </span>
                  )}
                  <button type="button" disabled={picked.length === 0 || overForfait} onClick={() => void start({ action: 'ai', points: picked, ring: [], maxCost: cost })}>
                    {panoLeft !== null ? `Confirmer et lancer (${plural(images, 'vue', 'vues')} du forfait)` : `Confirmer et lancer (${images} crédit${images > 1 ? 's' : ''})`}
                  </button>
                </>
              )}
            </>
          )}

          {stage === 'done' && (
            <>
              <strong>Finition IA terminée</strong>
              <span>
                {state?.ai?.images} images ({state?.ai?.paid} {panoLeft !== null ? 'décomptées du forfait' : 'payées'}, {state?.ai?.cached} reprises du cache). Rechargez la page pour voir les vues finies.
              </span>
              <button type="button" onClick={() => window.location.reload()}>
                Voir la visite
              </button>
            </>
          )}

          {stage === 'error' && state?.job === 'ai' && (
            <>
              <strong>La finition IA s’est arrêtée</strong>
              <span className="tour-error">{state.error}</span>
              <span>Les images déjà faites sont gardées. Relancer ne les repaie pas.</span>
              {state.ai && (
                <button type="button" onClick={() => void start({ action: 'ai', points: state.ai!.points, ring: state.ai!.ring, maxCost: state.ai!.cost })}>
                  {resumeLabel(state.ai.cost)}
                </button>
              )}
            </>
          )}
          {error && <span className="tour-error">{error}</span>}
        </div>
      )}
    </div>
  )
}
