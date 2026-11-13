'use client'

import { useEffect, useState } from 'react'
import { forfaitLeft, plural } from '@/lib/forfait'
import type { TourView } from '@/lib/scene-tour'
import { useForfait } from '../../components/useForfait'

/** What the 360 build sends as `autoAi` (app/api/scenes/[id]/tour): null = Blender only. */
export type AutoAiChoice = { views?: { index: number; name: string }[]; max: number } | null

/**
 * One click for the real result (13 Nov): with "Préparer la visite 360°" the person ticks the views the AI finishes; Roomia
 * renders the Blender 360° and the golden-hour Présentation, then the AI light on those views, without another click.
 * Signed-in accounts only (the AI is paid); at most what the forfait (or the credits) allows.
 */
export default function AutoAiPicker({ views, onChange }: { views: TourView[]; onChange: (choice: AutoAiChoice) => void }) {
  const { forfait, signedIn, credits } = useForfait()
  const panoLeft = forfaitLeft(forfait, 'pano')
  const limit = panoLeft ?? credits
  const candidates = views.filter(v => !v.auto && !v.outside && !v.hidden)
  const [on, setOn] = useState(true)
  const [picked, setPicked] = useState<number[] | null>(null)
  // every view ticked, up to what the account allows
  const chosen = picked ?? candidates.slice(0, limit).map(v => v.index)

  useEffect(() => {
    if (!signedIn || !on || limit < 1) onChange(null)
    else if (candidates.length) onChange({ max: limit, views: candidates.filter(v => chosen.includes(v.index)).map(v => ({ index: v.index, name: v.name })) })
    else onChange({ max: limit })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, on, limit, chosen.join(','), candidates.length])

  if (!signedIn) return null
  if (limit < 1) {
    return <span>Finition IA : {panoLeft !== null ? 'plus de vues 360° dans votre forfait' : 'plus de crédits'}. La visite sera en rendu Blender.</span>
  }
  const toggle = (i: number) =>
    setPicked(chosen.includes(i) ? chosen.filter(x => x !== i) : chosen.length < limit ? [...chosen, i] : chosen)

  return (
    <div className="auto-ai">
      <label>
        <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />{' '}
        <b>Finition IA automatique</b> : Roomia rend les 360° avec Blender puis l’IA leur donne sa lumière, sans autre clic.
      </label>
      {on &&
        (candidates.length ? (
          <>
            <span>
              Vues à finir : {chosen.length} sur {limit} {panoLeft !== null ? 'possibles avec votre forfait' : 'possibles (1 crédit par vue)'}.
            </span>
            <div className="look-points">
              {candidates.map(v => (
                <div key={v.index} className="look-point">
                  <label>
                    <input type="checkbox" checked={chosen.includes(v.index)} disabled={!chosen.includes(v.index) && chosen.length >= limit} onChange={() => toggle(v.index)} />
                    <b>{v.name}</b>
                  </label>
                </div>
              ))}
            </div>
          </>
        ) : (
          <span>
            Roomia place les points lui-même ; jusqu’à {plural(limit, 'vue sera finie', 'vues seront finies')} par l’IA
            {panoLeft !== null ? ' (votre forfait)' : ' (1 crédit par vue)'}.
          </span>
        ))}
    </div>
  )
}
