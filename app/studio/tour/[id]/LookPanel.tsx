'use client'

import { useCallback, useEffect, useState } from 'react'
import { forfaitLeft, plural } from '@/lib/forfait'
import type { LookState as LookJob } from '@/lib/look-pipeline'
import { useForfait } from '../../components/useForfait'

/** The job's state, and the PC's thermal / pause state the route adds (lib/blender-guard.ts). */
type LookState = LookJob & { thermal?: { paused: boolean; waiting: boolean; userPaused: boolean; temp: number }; autoAi?: number }

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
 * deserve it. Since 14 Nov there is nothing to choose and no price shown: every view, up to what the account allows (the forfait).
 */
export default function LookPanel({ sceneId, tourReady }: { sceneId: string; tourReady: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LookState | null>(null)
  const [error, setError] = useState('')
  // a client's forfait counts 360 views, not credits or DA (lib/forfait.ts)
  const { forfait, signedIn, credits, refresh: refreshForfait } = useForfait()
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

  // a finished (or stopped) AI job changed what is left of the forfait
  useEffect(() => {
    if (!running) refreshForfait()
  }, [running, refreshForfait])

  // 14 Nov: no choosing and no price any more: every view, up to what the forfait (or the credits) allows
  const aiCount = Math.min(state?.suggestions?.length ?? 0, signedIn ? (panoLeft ?? credits) : 0)
  const allPoints = (state?.suggestions ?? []).slice(0, aiCount).map(x => x.index)
  const resumeLabel = (_c: number) => 'Reprendre'

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
                Roomia analyse le fichier (soleil, lumières, caméras), puis rend toutes les vues 360° en plein jour, lampes allumées. Environ 1 à 2 minutes
                par vue sur votre PC.
              </span>
              {stage === 'interrupted' && <span className="tour-error">Le travail précédent a été interrompu. Il repart de zéro (gratuit).</span>}
              {state?.error && <span className="tour-error">{state.error}</span>}
              {state?.error && state.log?.length > 0 && <pre className="look-log">{state.log.slice(-14).join('\n')}</pre>}
              {state?.step && state.stage === 'idle' && <span>{state.step}</span>}
              {!tourReady && <span className="tour-error">Préparez d’abord la visite 360° (bouton « Préparer la visite ») : la présentation s’appuie sur ses points et son plan.</span>}
              <button type="button" disabled={!tourReady} onClick={() => void start({ action: 'render' })}>
                Refaire la lumière du jour
              </button>
            </>
          )}

          {running && (
            <>
              <strong>{state?.step || 'En cours…'}</strong>
              {state?.ai ? <progress max={state.ai.images} value={state.ai.done} /> : <progress />}
              <span>
                {minutes} min écoulée{minutes > 1 ? 's' : ''}. Vous pouvez continuer à travailler, mais ne fermez pas Roomia. Si le PC s’arrête, relancez : les vues
                déjà finies sont gardées.
              </span>
              {state?.detail && <span>{state.detail}</span>}
              {state?.job === 'render' && (state.autoAi ?? 0) > 0 && (
                <span>
                  <b>Ensuite : finition IA de {state.autoAi} vue{state.autoAi! > 1 ? 's' : ''}</b>, elle démarre toute seule.
                </span>
              )}
              {state?.ai && (
                <span>
                  {state.ai.done} / {state.ai.images} vues
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
              <span>{state.step || 'Interrompue.'} Les vues déjà finies sont gardées.</span>
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
              {state?.suggestions && state.suggestions.length > 0 && aiCount > 0 && (
                <>
                  <strong>Finition IA</strong>
                  <span>
                    L’IA donne à chaque vue sa lumière du jour et ses lampes allumées ; Blender garde chaque objet et chaque texture.
                    {aiCount < state.suggestions.length ? ` Votre ${panoLeft !== null ? 'forfait' : 'compte'} permet ${plural(aiCount, 'vue', 'vues')} : les premières de la visite.` : ''}
                  </span>
                  <button type="button" onClick={() => void start({ action: 'ai', points: allPoints, ring: [], maxCost: allPoints.length * DA_PER_IMAGE })}>
                    Finir toute la visite avec l’IA ({plural(aiCount, 'vue', 'vues')})
                  </button>
                </>
              )}
            </>
          )}

          {stage === 'done' && (
            <>
              <strong>Finition IA terminée</strong>
              <span>
                {state?.ai?.images} vues finies. Rechargez la page pour les voir.
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
