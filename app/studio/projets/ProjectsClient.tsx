'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { DesktopProject } from '@/lib/desktop-projects'
import DesktopNav from '../components/DesktopNav'
import { BACKEND, isCpuOnly, PROFILE, useDesktopEngine } from '../components/DesktopRenderNotice'

const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`
const when = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

const button = 'rounded-lg border border-[var(--rm-text)]/15 px-3 py-1.5 text-sm text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5 disabled:opacity-50'
const primary = 'rounded-lg bg-[var(--rm-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--rm-surface)] hover:brightness-110'

const TOUR_LABEL: Record<DesktopProject['tour'], string> = {
  none: 'À préparer : visite 360°, plans, vidéo',
  building: 'Préparation Blender en cours…',
  done: 'Prêt : visite 360°, plan 2D et 3D',
  failed: 'Préparation interrompue',
}

async function readProjects(): Promise<{ projects: DesktopProject[]; freeBytes: number | null } | null> {
  const res = await fetch('/api/projects', { cache: 'no-store' }).catch(() => null)
  return res?.ok ? res.json() : null
}

export default function ProjectsClient() {
  const [data, setData] = useState<{ projects: DesktopProject[]; freeBytes: number | null } | null>(null)
  const [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const engine = useDesktopEngine()

  const apply = useCallback((r: Awaited<ReturnType<typeof readProjects>>) => (r ? setData(r) : setError('Impossible de lire les projets.')), [])
  const load = useCallback(() => readProjects().then(apply), [apply])

  useEffect(() => {
    let live = true
    const tick = () => void readProjects().then(r => live && apply(r))
    tick()
    // a tour being prepared moves on by itself
    const timer = setInterval(tick, 10_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [apply])

  async function rename() {
    if (!renaming) return
    const res = await fetch(`/api/projects/${renaming.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renaming.name }),
    })
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? 'Renommage impossible.')
    setRenaming(null)
    await load()
  }

  async function remove(project: DesktopProject) {
    const link = project.published ? `\n\nLe lien publié pour vos clients reste en ligne : retirez-le depuis « Mon espace » si besoin.` : ''
    if (!window.confirm(`Supprimer « ${project.name} » et tout ce qui a été rendu pour ce projet sur ce PC (${size(project.bytes)}) ?\n\nCette action est définitive.${link}`)) return
    const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? 'Suppression impossible.')
    await load()
  }

  async function applyVersion(project: DesktopProject) {
    const old = project.versionOf
    if (!old) return
    if (!window.confirm(`Mettre à jour « ${old.name} » avec cette nouvelle version ?\n\nLa visite est recalculée (gratuit, Blender) et garde ses photos ; les vues qui n’ont pas changé ne bougent pas. Ce nouvel envoi est ensuite fusionné dans « ${old.name} ».`)) return
    const res = await fetch(`/api/scenes/${old.id}/tour`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newVersion: project.id }) })
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? 'Mise à jour impossible.')
      return
    }
    window.location.assign(`/studio/tour/${old.id}`)
  }

  async function keepSeparate(project: DesktopProject) {
    await fetch(`/api/projects/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ separate: true }) })
    await load()
  }

  const total = data?.projects.reduce((n, p) => n + p.bytes, 0) ?? 0

  return (
    <div className="min-h-screen bg-[var(--rm-bg)]">
      <DesktopNav current="projets" />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-[var(--rm-text)]">Mes projets</h1>
            <p className="text-sm text-[var(--rm-muted)]">
              {data ? `${data.projects.length} projet${data.projects.length > 1 ? 's' : ''} · ${size(total)} sur ce PC` : 'Chargement…'}
              {data?.freeBytes != null && ` · ${size(data.freeBytes)} libres`}
            </p>
          </div>
          <button type="button" className={button} onClick={() => window.roomiaDesktop?.openProjects?.()}>
            Ouvrir le dossier des projets
          </button>
        </div>
        {engine && (
          <p className="mb-4 rounded-lg border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-3 py-2 text-xs text-[var(--rm-muted)]">
            Moteur de rendu :{' '}
            {isCpuOnly(engine) ? 'processeur (aucune carte graphique utilisable, rendus lents)' : `${engine.gpu || 'carte graphique'} · ${BACKEND[engine.backend] ?? engine.backend} · profil ${PROFILE[engine.profile] ?? engine.profile}`}
          </p>
        )}
        {data?.freeBytes != null && data.freeBytes < 5 * 1024 ** 3 && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Moins de 5 Go libres sur ce disque : une visite peut prendre plusieurs centaines de Mo. Supprimez d’anciens projets ou libérez de la place.
          </p>
        )}
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        {/* 14 Nov: how a project arrives from SketchUp (Roomia installs the extension itself; the button repairs it) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] px-4 py-3">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-[var(--rm-text)]">Depuis SketchUp</p>
            <p className="text-[var(--rm-muted)]">
              Enregistrez vos scènes (Fenêtre → Scènes → +), puis menu <b>Extensions → Roomia → Envoyer à Roomia</b> (ou le bouton maison) : le projet
              s’ouvre ici. Roomia installe l’extension tout seul ; redémarrez SketchUp si vous ne la voyez pas.
            </p>
          </div>
          {/* this page only exists in Roomia Desktop: the bridge is there */}
          <button type="button" className={button} onClick={() => void window.roomiaDesktop?.installSketchup?.()}>
            Installer l’extension SketchUp
          </button>
        </div>
        {data && data.projects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--rm-text)]/20 bg-[var(--rm-surface)] p-8 text-center">
            <p className="mb-1 font-medium text-[var(--rm-text)]">Aucun projet pour l’instant</p>
            <p className="mb-4 text-sm text-[var(--rm-muted)]">
              Importez un fichier SketchUp (.glb conseillé), ou cliquez « Envoyer à Roomia » dans SketchUp.
            </p>
            <Link className={primary} href="/studio">
              Importer un projet
            </Link>
          </div>
        )}
        <ul className="grid gap-3">
          {data?.projects.map(p => (
            <li key={p.id} className="rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-4">
              {p.versionOf && p.status === 'ready' && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--rm-secondary)] px-3 py-2 text-sm text-[var(--rm-text)]">
                  <span className="mr-auto">
                    Nouvelle version de <strong>« {p.versionOf.name} »</strong>, envoyée depuis SketchUp.
                    {!p.versionOf.tour && ' Créez d’abord la visite de l’ancienne version pour la mettre à jour.'}
                  </span>
                  {p.versionOf.tour && (
                    <button type="button" className={primary} onClick={() => void applyVersion(p)}>
                      Mettre à jour « {p.versionOf.name} »
                    </button>
                  )}
                  <button type="button" className={button} onClick={() => void keepSeparate(p)}>
                    Garder comme projet séparé
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {renaming?.id === p.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={e => {
                        e.preventDefault()
                        void rename()
                      }}
                    >
                      <input
                        autoFocus
                        className="rounded-lg border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-2 py-1 text-sm"
                        value={renaming.name}
                        onChange={e => setRenaming({ id: p.id, name: e.target.value })}
                        maxLength={120}
                      />
                      <button type="submit" className={primary}>
                        OK
                      </button>
                      <button type="button" className={button} onClick={() => setRenaming(null)}>
                        Annuler
                      </button>
                    </form>
                  ) : (
                    <p className="truncate font-semibold text-[var(--rm-text)]">{p.name}</p>
                  )}
                  <p className="mt-0.5 text-xs text-[var(--rm-muted)]">
                    {when(p.updatedAt)} · {size(p.bytes)} · {p.views} vue{p.views > 1 ? 's' : ''} SketchUp · {p.photos} photo{p.photos > 1 ? 's' : ''}
                  </p>
                  <p className="mt-1 text-xs">
                    {p.status === 'processing' ? (
                      <span className="text-[var(--rm-muted)]">Import en cours…</span>
                    ) : p.status === 'failed' ? (
                      <span className="text-red-700">Import échoué{p.error ? ` : ${p.error}` : ''}</span>
                    ) : (
                      <span className={p.tour === 'failed' ? 'text-amber-800' : 'text-[var(--rm-muted)]'}>{TOUR_LABEL[p.tour]}</span>
                    )}
                    {p.published && (
                      <>
                        {' · '}
                        <a className="font-medium text-[var(--rm-primary)] underline underline-offset-2" href={p.published.url} target="_blank" rel="noreferrer">
                          lien client publié
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.status === 'ready' && (
                    <>
                      {/* 11 Nov makeover: the project page (360°, plans, video, photos) is the main door; the 3D view is for the views */}
                      <a className={primary} href={`/studio/tour/${p.id}`}>
                        {p.tour === 'done' ? 'Ouvrir le projet' : p.tour === 'building' ? 'Voir la préparation' : 'Préparer le projet'}
                      </a>
                      <a className={button} href={`/studio?scene=${p.id}`}>
                        Vue 3D
                      </a>
                      {p.walk && (
                        <a className={button} href={`/studio/explore/${p.id}`}>
                          Visite libre
                        </a>
                      )}
                    </>
                  )}
                  <button type="button" className={button} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                    Renommer
                  </button>
                  <button type="button" className={`${button} text-red-700`} onClick={() => void remove(p)} disabled={p.tour === 'building'}>
                    Supprimer
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
