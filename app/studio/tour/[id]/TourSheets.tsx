'use client'

// The tour's other deliverables, each in its own tab (11 Nov makeover): the architect's 2D plan, the 3D plan, the video and
// the AI photos (the views picked one by one, each with its own ambiance). Before, plans and video sat behind ?edit=1.
import { useEffect, useState } from 'react'
import { forfaitLeft, plural } from '@/lib/forfait'
import type { TourView } from '@/lib/scene-tour'
import type { VideoBuild, VideoStatus } from '@/lib/scene-video'
import { useForfait } from '../../components/useForfait'

const DA_PER_PHOTO = 14
const PACKAGE_PHOTOS = 20

export interface PlanData {
  file: string
  hd?: string
  lines?: string
  width: number
  height: number
  archi?: { rendu: string; technique: string; pdf: string; total?: number; rooms?: { name: string; area: number }[] }
}

const fmtArea = (a: number) => `${a.toFixed(1).replace('.', ',')} m²`

export function PlanSheet({ sceneId, plan, version, title }: { sceneId: string; plan: PlanData; version: string; title: string }) {
  const archi = plan.archi
  const [style, setStyle] = useState<'rendu' | 'technique'>('rendu')
  const file = archi ? (style === 'rendu' ? archi.rendu : archi.technique) : (plan.hd ?? plan.file)
  const url = (f: string) => `/api/scenes/${sceneId}/tour/${f}?v=${version}`
  const slug = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || sceneId
  return (
    <div className="tour-sheet">
      <div className="tour-sheet-view">
        <img src={url(file)} alt={`Plan 2D de ${title}`} />
      </div>
      <aside className="tour-sheet-side">
        <h2>Plan 2D</h2>
        {archi ? (
          <>
            <div className="tour-seg" role="group" aria-label="Style du plan">
              <button type="button" aria-pressed={style === 'rendu'} onClick={() => setStyle('rendu')}>
                Meublé
              </button>
              <button type="button" aria-pressed={style === 'technique'} onClick={() => setStyle('technique')}>
                Technique
              </button>
            </div>
            {archi.rooms && archi.rooms.length > 0 && (
              <table className="tour-rooms">
                <tbody>
                  {[...archi.rooms]
                    .sort((a, b) => b.area - a.area)
                    .map((r, k) => (
                      <tr key={`${r.name}-${k}`}>
                        <td>{r.name}</td>
                        <td>{fmtArea(r.area)}</td>
                      </tr>
                    ))}
                </tbody>
                {archi.total != null && (
                  <tfoot>
                    <tr>
                      <td>Surface totale</td>
                      <td>{fmtArea(archi.total)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            <a className="tour-btn" href={url(archi.pdf)} download={`plan-${slug}.pdf`}>
              Télécharger le PDF (A3)
            </a>
            <a className="tour-btn secondary" href={url(archi.rendu)} download={`plan-meuble-${slug}.png`}>
              Image meublée (PNG)
            </a>
            <a className="tour-btn secondary" href={url(archi.technique)} download={`plan-technique-${slug}.png`}>
              Image technique (PNG)
            </a>
            <p className="tour-note">Surfaces mesurées au nu des murs, noms des pièces proposés par l’IA. À titre indicatif.</p>
          </>
        ) : (
          <>
            <p className="tour-note">Le plan coté (pièces, surfaces, cotes) se fait à la prochaine préparation de la visite.</p>
            {plan.hd && (
              <a className="tour-btn" href={url(plan.hd)} download={`plan-${slug}.png`}>
                Télécharger le plan (murs pleins)
              </a>
            )}
            {plan.lines && (
              <a className="tour-btn secondary" href={url(plan.lines)} download={`plan-traits-${slug}.png`}>
                Télécharger le plan (traits)
              </a>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

export function Plan3dSheet({ sceneId, file, version, title }: { sceneId: string; file: string | null; version: string; title: string }) {
  if (!file) return <div className="tour-message">Le plan 3D se fait à la prochaine préparation de la visite.</div>
  const url = `/api/scenes/${sceneId}/tour/${file}?v=${version}`
  return (
    <div className="tour-sheet">
      <div className="tour-sheet-view">
        <img src={url} alt={`Plan 3D de ${title}`} />
      </div>
      <aside className="tour-sheet-side">
        <h2>Plan 3D</h2>
        <p className="tour-note">Vue en coupe meublée de tout l’appartement, à hauteur d’yeux.</p>
        <a className="tour-btn" href={url} download={`plan-3d-${sceneId}.jpg`}>
          Télécharger le plan 3D
        </a>
      </aside>
    </div>
  )
}

export function VideoSheet({
  sceneId,
  film,
  canMake,
  busy,
  onMake,
}: {
  sceneId: string
  film: { status: VideoStatus; video: VideoBuild | null } | null
  canMake: boolean
  busy: boolean
  onMake: () => void
}) {
  const v = film?.video
  return (
    <div className="tour-sheet">
      <div className="tour-sheet-view">
        {v ? (
          <video key={v.file} className="tour-video" src={`/api/scenes/${sceneId}/video/${v.file}`} poster={`/api/scenes/${sceneId}/video/${v.poster}`} controls playsInline />
        ) : (
          <div className="tour-message">Pas encore de vidéo pour ce projet.</div>
        )}
      </div>
      <aside className="tour-sheet-side">
        <h2>Vidéo</h2>
        {film?.status.state === 'building' ? (
          <>
            <p className="tour-note">{film.status.step}</p>
            <progress max={film.status.total ?? 1} value={film.status.done ?? 0} />
          </>
        ) : (
          <>
            {film?.status.state === 'failed' && <p className="tour-error">{film.status.error}</p>}
            <p className="tour-note">
              Un plan lent dans chaque pièce, rendu par Blender sur ce PC (gratuit). Compter plusieurs heures pour un grand appartement.
              {v && ` Dernière vidéo : ${Math.round(v.duration)} s, ${v.shots.length} plans.`}
            </p>
            {canMake && (
              <button type="button" className="tour-btn" onClick={onMake} disabled={busy}>
                {v ? 'Refaire la vidéo' : 'Créer la vidéo'}
              </button>
            )}
            {v && (
              <a className="tour-btn secondary" href={`/api/scenes/${sceneId}/video/${v.file}`} download={`visite-${sceneId}.mp4`}>
                Télécharger la vidéo
              </a>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

type Mood = 'jour' | 'soiree' | 'nuit'
const MOODS: { key: Mood; label: string }[] = [
  { key: 'jour', label: 'Jour' },
  { key: 'soiree', label: 'Soirée' },
  { key: 'nuit', label: 'Nuit' },
]
/** The ambiance of one photo, as the photo route's lighting: the 360° stays in broad daylight whatever is picked here. */
const LIGHTING: Record<Mood, { time: string; sun: boolean; interior: boolean }> = {
  jour: { time: 'apres-midi', sun: true, interior: true },
  soiree: { time: 'soiree', sun: true, interior: true },
  nuit: { time: 'soiree', sun: false, interior: true },
}

export function PhotosSheet({ sceneId, views, version, onDone }: { sceneId: string; views: TourView[]; version: string; onDone: () => void }) {
  // the designer's saved SketchUp views: each has a camera the photo is taken from
  const candidates = views.filter(v => !v.auto && !v.outside && !v.hidden)
  const [picked, setPicked] = useState<Record<number, Mood | undefined>>(() =>
    Object.fromEntries(candidates.filter(v => !v.photo && !v.noPhoto).slice(0, PACKAGE_PHOTOS).map(v => [v.index, 'jour' as Mood])),
  )
  const [running, setRunning] = useState('')
  const [failed, setFailed] = useState<string[]>([])
  // a client's forfait counts photos, not DA (lib/forfait.ts)
  const { forfait, refresh: refreshForfait } = useForfait()
  const photosLeft = forfaitLeft(forfait, 'photo')
  const chosen = candidates.filter(v => picked[v.index])
  const overForfait = photosLeft !== null && chosen.length > photosLeft
  const count = (m: Mood) => chosen.filter(v => picked[v.index] === m).length

  async function launch() {
    setFailed([])
    const bad: string[] = []
    for (const [k, v] of chosen.entries()) {
      setRunning(`Photo ${k + 1} / ${chosen.length} : ${v.name}…`)
      const res = await fetch('/api/render/scene-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // a new job id for every photo: a retry is never charged twice
        body: JSON.stringify({ sceneId, cameraIndex: v.index, lens: '24', ...LIGHTING[picked[v.index]!], ask: true, jobId: crypto.randomUUID() }),
      }).catch(() => null)
      const text = (await res?.text().catch(() => '')) ?? ''
      if (!res?.ok || /"error"/.test(text.split('\n').filter(Boolean).pop() ?? '')) bad.push(v.name)
    }
    setRunning('')
    setFailed(bad)
    refreshForfait()
    onDone()
  }

  return (
    <div className="tour-sheet">
      <div className="tour-sheet-view scroll">
        {candidates.length === 0 ? (
          <div className="tour-message">Ce fichier n’a pas de vues SketchUp enregistrées : enregistrez des scènes dans SketchUp pour choisir les photos.</div>
        ) : (
          <div className="tour-pick-grid">
            {candidates.map(v => {
              const mood = picked[v.index]
              const thumb = v.photo ? `/api/scenes/${sceneId}/photos/${encodeURIComponent(v.photo)}` : v.pano ? `/api/scenes/${sceneId}/tour/${v.pano}?v=${version}` : null
              return (
                <article key={v.index} className={`tour-pick${mood ? ' on' : ''}`}>
                  <button
                    type="button"
                    className="tour-pick-img"
                    aria-pressed={!!mood}
                    aria-label={`${mood ? 'Retirer' : 'Choisir'} ${v.name}`}
                    onClick={() => setPicked(p => ({ ...p, [v.index]: p[v.index] ? undefined : 'jour' }))}
                    disabled={!!running}
                  >
                    {thumb ? <img src={thumb} alt="" className={v.photo ? undefined : 'pano-mid'} /> : <span className="tour-pick-none">{v.name}</span>}
                    <span className="tour-pick-box" aria-hidden="true">
                      {mood ? '✓' : ''}
                    </span>
                    {v.photo && <span className="tour-pick-tag">Photo faite</span>}
                  </button>
                  <div className="tour-pick-body">
                    <strong>{v.name}</strong>
                    <div className="tour-seg small" role="radiogroup" aria-label={`Ambiance de ${v.name}`}>
                      {MOODS.map(m => (
                        <button
                          key={m.key}
                          type="button"
                          role="radio"
                          aria-checked={mood === m.key}
                          aria-pressed={mood === m.key}
                          onClick={() => setPicked(p => ({ ...p, [v.index]: m.key }))}
                          disabled={!!running}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
      <aside className="tour-sheet-side">
        <h2>Nouvelles photos</h2>
        <p className="tour-big">
          {chosen.length}
          <span> / {PACKAGE_PHOTOS} photos</span>
        </p>
        <table className="tour-rooms">
          <tbody>
            {MOODS.map(m => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td>{count(m.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tour-note">La visite 360° reste en plein jour. L’ambiance ne change que ces photos.</p>
        <table className="tour-rooms">
          <tbody>
            <tr>
              <td>Temps estimé</td>
              <td>{chosen.length * 2} min</td>
            </tr>
            {photosLeft !== null ? (
              <tr>
                <td>Forfait</td>
                <td>{plural(photosLeft, 'photo restante', 'photos restantes')}</td>
              </tr>
            ) : (
              <tr>
                <td>Crédits</td>
                <td>{chosen.length * DA_PER_PHOTO} DA</td>
              </tr>
            )}
          </tbody>
        </table>
        {running ? (
          <p className="tour-note">{running}</p>
        ) : (
          <>
            {overForfait && <p className="tour-note">Choisissez au plus {plural(photosLeft!, 'photo', 'photos')}, ou contactez Roomia pour étendre le forfait.</p>}
            <button type="button" className="tour-btn" onClick={launch} disabled={chosen.length === 0 || overForfait}>
              Lancer {chosen.length > 1 ? `les ${chosen.length} photos` : 'la photo'}
            </button>
          </>
        )}
        {failed.length > 0 && <p className="tour-error">Pas faites : {failed.join(', ')}. Vous pouvez les relancer.</p>}
        <p className="tour-note">Rien n’est débité avant le lancement.</p>
      </aside>
    </div>
  )
}

interface GalleryPhoto {
  file: string
  at: string
  view?: string
  time?: string
  lens?: string
}

const AMBIANCE_OF: Record<string, string> = { matin: 'Jour', midi: 'Jour', 'apres-midi': 'Jour', soiree: 'Soirée' }

/** Every AI photo of the project (11 Nov): the SketchUp views' photos and the frames picked in the 360°, newest first. */
export function GallerySheet({ sceneId, title, onCreate }: { sceneId: string; title: string; onCreate: () => void }) {
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null)
  const [open, setOpen] = useState<GalleryPhoto | null>(null)
  useEffect(() => {
    let live = true
    fetch(`/api/scenes/${sceneId}/photos`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { photos: [] }))
      .then((b: { photos: GalleryPhoto[] }) => live && setPhotos(b.photos))
      .catch(() => live && setPhotos([]))
    return () => {
      live = false
    }
  }, [sceneId])
  const url = (f: string) => `/api/scenes/${sceneId}/photos/${encodeURIComponent(f)}`
  const slug = title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || sceneId
  const label = (p: GalleryPhoto) => `${p.view ?? 'Photo'}${p.lens === '360' ? ' · cadrage 360°' : ''} · ${AMBIANCE_OF[p.time ?? ''] ?? 'Jour'}`
  if (!photos) return <div className="tour-message">Chargement des photos…</div>
  return (
    <div className="tour-sheet">
      <div className="tour-sheet-view scroll">
        {photos.length === 0 ? (
          <div className="tour-message">Pas encore de photo IA pour ce projet.</div>
        ) : (
          <div className="tour-gallery">
            {photos.map(p => (
              <figure key={p.file} className="tour-shot">
                <button type="button" onClick={() => setOpen(p)} aria-label={`Ouvrir ${p.view ?? 'la photo'} en grand`}>
                  <img src={url(p.file)} alt={p.view ?? 'Photo IA'} loading="lazy" />
                </button>
                <figcaption>
                  <span>{label(p)}</span>
                  <a href={url(p.file)} download={`${slug}-${(p.view ?? 'photo').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.jpg`}>
                    Télécharger
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      <aside className="tour-sheet-side">
        <h2>Galerie</h2>
        <p className="tour-big">
          {photos.length}
          <span> photo{photos.length > 1 ? 's' : ''} IA</span>
        </p>
        <p className="tour-note">Toutes les photos réalistes du projet, les plus récentes d’abord. Cliquez sur une photo pour l’ouvrir en grand.</p>
        <button type="button" className="tour-btn" onClick={onCreate}>
          Créer de nouvelles photos
        </button>
      </aside>
      {open && (
        <div className="tour-lightbox" role="dialog" aria-label={open.view ?? 'Photo'} onClick={() => setOpen(null)}>
          <img src={url(open.file)} alt={open.view ?? 'Photo IA'} />
          <div className="tour-lightbox-bar" onClick={e => e.stopPropagation()}>
            <span>{label(open)}</span>
            <a className="tour-btn" href={url(open.file)} download>
              Télécharger
            </a>
            <button type="button" className="tour-btn secondary" onClick={() => setOpen(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
