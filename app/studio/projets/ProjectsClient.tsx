'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesktopProject } from '@/lib/desktop-projects'
import DesktopNav from '../components/DesktopNav'
import { isCpuOnly, useDesktopEngine } from '../components/DesktopRenderNotice'
import Icon, { type IconName } from '../components/Icon'

const size = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`
const day = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

async function readProjects(): Promise<{ projects: DesktopProject[]; freeBytes: number | null } | null> {
  const res = await fetch('/api/projects', { cache: 'no-store' }).catch(() => null)
  return res?.ok ? res.json() : null
}

/**
 * Mes projets (16 Nov redesign): one card per project with its image, what is ready, and one action: open it. The rest
 * (3D view, rename, client link, delete) is in the card's ⋯ menu. The SketchUp guide is the empty state, then a small help.
 */
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
  const empty = data && data.projects.length === 0

  return (
    <div className="min-h-screen bg-[var(--brand-paper)]">
      <DesktopNav current="projets" />
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="ui-title text-[32px]">Mes projets</h1>
            <p className="mt-1 text-[15px] text-[var(--brand-muted)]">
              {data ? `${data.projects.length} projet${data.projects.length > 1 ? 's' : ''} · ${size(total)} sur ce PC` : 'Chargement…'}
            </p>
          </div>
        </div>

        <div className="mb-6 grid gap-3 empty:hidden">
          {error && (
            <p className="ui-notice ui-notice--danger">
              <Icon name="warn" size={17} />
              {error}
            </p>
          )}
          {data?.freeBytes != null && data.freeBytes < 5 * 1024 ** 3 && (
            <p className="ui-notice ui-notice--warn">
              <Icon name="warn" size={17} />
              <span>
                Il reste {size(data.freeBytes)} sur ce disque. Une visite prend plusieurs centaines de Mo : supprimez un ancien projet avant d’en préparer un nouveau.
              </span>
            </p>
          )}
          {engine && isCpuOnly(engine) && (
            <p className="ui-notice ui-notice--warn">
              <Icon name="cpu" size={17} />
              Aucune carte graphique utilisable sur ce PC : les rendus marchent, mais lentement.
            </p>
          )}
        </div>

        {empty && <SketchupGuide first />}

        <ul className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {data?.projects.map(p => (
            <li key={p.id} className="flex flex-col">
              {p.versionOf && p.status === 'ready' && (
                <div className="ui-notice mb-3 flex-col">
                  <span>
                    Nouvelle version de <strong>« {p.versionOf.name} »</strong>, envoyée depuis SketchUp.
                    {!p.versionOf.tour && ' Créez d’abord la visite de l’ancienne version pour la mettre à jour.'}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-2">
                    {p.versionOf.tour && (
                      <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => void applyVersion(p)}>
                        Mettre à jour « {p.versionOf.name} »
                      </button>
                    )}
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => void keepSeparate(p)}>
                      Garder comme projet séparé
                    </button>
                  </span>
                </div>
              )}
              <ProjectCard
                project={p}
                renaming={renaming?.id === p.id ? renaming.name : null}
                onRenameStart={() => setRenaming({ id: p.id, name: p.name })}
                onRenameChange={name => setRenaming({ id: p.id, name })}
                onRenameDone={() => void rename()}
                onRenameCancel={() => setRenaming(null)}
                onDelete={() => void remove(p)}
              />
            </li>
          ))}
        </ul>

        {data && !empty && <SketchupGuide />}
      </main>
    </div>
  )
}

function ProjectCard({
  project: p,
  renaming,
  onRenameStart,
  onRenameChange,
  onRenameDone,
  onRenameCancel,
  onDelete,
}: {
  project: DesktopProject
  renaming: string | null
  onRenameStart: () => void
  onRenameChange: (name: string) => void
  onRenameDone: () => void
  onRenameCancel: () => void
  onDelete: () => void
}) {
  const ready = p.status === 'ready'
  const open = `/studio/tour/${p.id}`
  const action = p.tour === 'done' ? 'Ouvrir le projet' : p.tour === 'building' ? 'Voir la préparation' : 'Préparer la visite'
  const cover = p.cover ? `${p.cover.url}${p.cover.kind === 'photo' ? '?w=720' : ''}` : null

  const marks: { icon: IconName; label: string; gold?: boolean; off?: boolean }[] = []
  if (p.tour === 'done') marks.push({ icon: 'pano', label: 'Visite 360°' }, { icon: 'plan', label: 'Plan 2D' })
  else if (p.tour === 'none' && ready) marks.push({ icon: 'pano', label: 'Visite à préparer', off: true })
  if (p.plan3d) marks.push({ icon: 'plan3d', label: 'Plan 3D' })
  if (p.photos) marks.push({ icon: 'photo', label: `${p.photos} photo${p.photos > 1 ? 's' : ''}` })
  if (p.video) marks.push({ icon: 'video', label: 'Vidéo' })
  if (p.published) marks.push({ icon: 'link', label: 'Lien client', gold: true })

  return (
    <article className="ui-card group flex flex-1 flex-col overflow-hidden transition-shadow hover:shadow-[var(--brand-shadow-lg)]">
      <a href={ready ? open : undefined} className="relative block aspect-[16/10] overflow-hidden bg-[var(--brand-blue-tint)]" tabIndex={-1} aria-hidden="true">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-2 text-[var(--brand-blue)]/60">
            <Icon name="cube" size={34} strokeWidth={1.4} />
            <span className="text-sm">Pas encore d’image</span>
          </span>
        )}
        {(p.status !== 'ready' || p.tour === 'building' || p.tour === 'failed') && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-semibold text-[var(--brand-ink)] shadow">
            {p.status === 'processing' || p.tour === 'building' ? <span className="ui-spinner !h-3.5 !w-3.5" /> : <Icon name="warn" size={14} />}
            {p.status === 'processing' ? 'Import en cours' : p.status === 'failed' ? 'Import échoué' : p.tour === 'building' ? 'Préparation en cours' : 'Préparation interrompue'}
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="min-w-0">
          {renaming !== null ? (
            <form
              className="flex gap-2"
              onSubmit={e => {
                e.preventDefault()
                onRenameDone()
              }}
            >
              <input autoFocus className="ui-field !min-h-9" value={renaming} onChange={e => onRenameChange(e.target.value)} maxLength={120} aria-label="Nom du projet" />
              <button type="submit" className="ui-btn ui-btn--primary ui-btn--sm">
                OK
              </button>
              <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm" onClick={onRenameCancel}>
                Annuler
              </button>
            </form>
          ) : (
            <h2 className="truncate text-[18px] font-bold text-[var(--brand-ink)]" title={p.name}>
              {p.name}
            </h2>
          )}
          <p className="mt-0.5 text-[13px] text-[var(--brand-muted)]">
            {day(p.updatedAt)} · {size(p.bytes)}
          </p>
          {p.status === 'failed' && p.error && <p className="mt-2 text-[13px] text-[var(--brand-danger)]">{p.error}</p>}
        </div>

        {marks.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {marks.map(m => (
              <li key={m.label} className={`ui-chip ${m.gold ? 'ui-chip--gold' : m.off ? 'ui-chip--off' : ''}`}>
                <Icon name={m.icon} />
                {m.label}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {ready ? (
            <a className="ui-btn ui-btn--primary flex-1" href={open}>
              {action}
              <Icon name="arrow" size={16} />
            </a>
          ) : (
            <span className="flex-1 text-[13px] text-[var(--brand-muted)]">{p.status === 'processing' ? 'Le projet s’ouvrira à la fin de l’import.' : ''}</span>
          )}
          <MoreMenu
            items={[
              ...(ready ? [{ icon: 'cube' as const, label: 'Vue 3D', href: `/studio?scene=${p.id}` }] : []),
              { icon: 'edit' as const, label: 'Renommer', run: onRenameStart },
              ...(p.published
                ? [
                    { icon: 'eye' as const, label: 'Ouvrir le lien client', run: () => openLink(p.published!.url) },
                    { icon: 'link' as const, label: 'Copier le lien client', run: () => void navigator.clipboard?.writeText(p.published!.url) },
                  ]
                : []),
              { icon: 'trash' as const, label: 'Supprimer', run: onDelete, danger: true, disabled: p.tour === 'building' },
            ]}
          />
        </div>
      </div>
    </article>
  )
}

function openLink(url: string) {
  if (window.roomiaDesktop?.openExternal) window.roomiaDesktop.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

type MenuItem = { icon: IconName; label: string; href?: string; run?: () => void; danger?: boolean; disabled?: boolean }

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="relative" ref={box}>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon" aria-label="Plus d’actions" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="more" size={20} strokeWidth={2.6} />
      </button>
      {open && (
        <div className="ui-menu bottom-12 right-0" role="menu">
          {items.map(it =>
            it.href ? (
              <a key={it.label} role="menuitem" href={it.href}>
                <Icon name={it.icon} size={17} />
                {it.label}
              </a>
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={`${it.danger ? 'danger' : ''} disabled:opacity-40`}
                onClick={() => {
                  setOpen(false)
                  it.run?.()
                }}
              >
                <Icon name={it.icon} size={17} />
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Vos vues', text: 'Dans SketchUp, enregistrez chaque vue que vous voulez en photo : Fenêtre → Scènes → +.' },
  { icon: 'sketchup', title: 'Envoyer à Roomia', text: 'Menu Extensions → Roomia → Envoyer à Roomia, ou le bouton maison de la barre d’outils.' },
  { icon: 'sparkle', title: 'Le projet s’ouvre ici', text: 'Roomia prépare la visite 360°, les plans et les photos. Vous n’avez rien à régler.' },
]

/** How a project arrives: the whole first screen when there is none, a small help under the projects after. */
function SketchupGuide({ first = false }: { first?: boolean }) {
  const content = (
    <>
      <ol className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-[var(--brand-radius)] bg-[var(--brand-paper)] p-5">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--brand-blue)] text-white">
              <Icon name={s.icon} size={21} />
            </span>
            <p className="ui-label mb-1">Étape {i + 1}</p>
            <p className="mb-1 font-bold text-[var(--brand-ink)]">{s.title}</p>
            <p className="text-[14px] leading-relaxed text-[var(--brand-ink-soft)]">{s.text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void window.roomiaDesktop?.installSketchup?.()}>
          <Icon name="sketchup" size={17} />
          Installer l’extension SketchUp
        </button>
        <Link className="ui-btn ui-btn--quiet" href="/studio">
          ou importer un fichier .glb
        </Link>
      </div>
      <p className="mt-3 text-[13px] text-[var(--brand-muted)]">Roomia installe l’extension tout seul. Si vous ne la voyez pas, redémarrez SketchUp une fois.</p>
    </>
  )
  if (first)
    return (
      <section className="ui-card p-8 sm:p-10">
        <h2 className="ui-title mb-2 text-[26px]">
          Votre premier projet, <em>depuis SketchUp</em>
        </h2>
        <p className="mb-6 max-w-2xl text-[15px] text-[var(--brand-ink-soft)]">Trois gestes, puis Roomia fait le reste.</p>
        {content}
      </section>
    )
  return (
    <details className="group mt-12 rounded-[var(--brand-radius-lg)] border border-[var(--brand-line)] bg-white px-6 py-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[15px] font-semibold text-[var(--brand-blue)]">
        <Icon name="help" size={18} />
        Envoyer un nouveau projet depuis SketchUp
        <Icon name="arrow" size={16} className="ml-auto transition-transform group-open:rotate-90" />
      </summary>
      <div className="pb-2 pt-5">{content}</div>
    </details>
  )
}
