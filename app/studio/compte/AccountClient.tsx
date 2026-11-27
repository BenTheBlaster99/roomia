'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { plural, PROJECT_SCOPE, type ForfaitItem, type ProjectsForfait } from '@/lib/forfait'
import type { CloudDrive } from '@/lib/roomia-cloud'
import DesktopNav from '../components/DesktopNav'
import Icon from '../components/Icon'

const KIND_LABELS: Record<string, string> = {
  reserve: 'Photo en cours',
  consume: 'Photo livrée',
  release: 'Échec, crédit rendu',
  grant: 'Crédits ajoutés',
  adjust: 'Crédits retirés',
  claim: 'Signalement',
  refund: 'Remboursé (signalement)',
  'claim-denied': 'Signalement refusé',
  forfait: 'Forfait',
}

/** With a forfait (lib/forfait.ts) the history speaks of images, never of credits. */
const FORFAIT_KIND_LABELS: Record<string, string> = {
  ...KIND_LABELS,
  reserve: 'Image en cours',
  consume: 'Image livrée',
  release: 'Échec, rien n’est décompté',
  refund: 'Rendue au forfait (signalement)',
  grant: 'Ajout au forfait',
  adjust: 'Correction',
  pack: 'Projets ajoutés',
  'pack-adjust': 'Correction',
  project: 'Projet commencé',
  'project-undo': 'Projet rendu (échec)',
  'project-update': 'Mise à jour',
  'project-admin': 'Ajustement Roomia',
}

/**
 * 27 Nov: the projects forfait (lib/forfait.ts). The person sees projects, what one project includes, and their started
 * projects; never a stock of photos or 360 views.
 */
function ProjectsBlock({ f }: { f: ProjectsForfait }) {
  const left = Math.max(0, f.total - f.used)
  const day = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <section className="space-y-4">
      <h2 className="text-[18px] font-bold text-[var(--brand-ink)]">Mon forfait</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,280px)_1fr]">
        <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--brand-line)] bg-white p-5">
          <span className="text-[14px] font-semibold text-[var(--brand-ink-soft)]">Projets</span>
          <span className="flex items-baseline gap-1.5">
            <b className={`font-[family-name:var(--font-display)] text-[40px] font-extrabold leading-none ${left === 0 ? 'text-[var(--brand-gold-text)]' : 'text-[var(--brand-blue)]'}`}>{left}</b>
            <span className="text-[13px] text-[var(--brand-muted)]">
              restant{left > 1 ? 's' : ''} sur {f.total}
            </span>
          </span>
          <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--brand-blue-tint)]" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--brand-gold)]" style={{ width: `${f.total ? (left / f.total) * 100 : 0}%` }} />
          </span>
          {left === 0 && <span className="text-[13px] text-[var(--brand-muted)]">Pour ajouter des projets, contactez Roomia.</span>}
        </div>
        <div className="rounded-[14px] border border-[var(--brand-line)] bg-white p-5">
          <span className="text-[14px] font-semibold text-[var(--brand-ink-soft)]">Chaque projet comprend</span>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[
              `Visite 360° complète (jusqu’à ${PROJECT_SCOPE.views} points de vue)`,
              `${PROJECT_SCOPE.photos} photos HD`,
              'Plan 2D',
              'Plan 3D',
              'Lien client',
              `${PROJECT_SCOPE.updates} mises à jour`,
            ].map(t => (
              <li key={t} className="ui-chip ui-chip--gold">
                <Icon name="check" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--brand-muted)]">
            Un projet = un appartement type : les appartements identiques comptent pour un seul projet. Un projet est compté à sa première image IA ; une
            image qui échoue ne compte jamais. Villas, duplex et projets sur plusieurs niveaux : sur devis.
          </p>
        </div>
      </div>
      {f.projects.length > 0 && (
        <div className="rounded-[14px] border border-[var(--brand-line)] bg-white p-5">
          <span className="text-[14px] font-semibold text-[var(--brand-ink-soft)]">Mes projets</span>
          <ul className="mt-2 divide-y divide-[var(--brand-line)]">
            {f.projects.map(p => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[14px]">
                <span className="font-semibold text-[var(--brand-ink)]">
                  {p.name}
                  {p.credits > 1 ? <span className="font-normal text-[var(--brand-muted)]"> · compte pour {p.credits} projets</span> : null}
                </span>
                <span className="text-[13px] text-[var(--brand-muted)]">
                  Commencé le {day(p.openedAt)} · version {p.version} ·{' '}
                  {p.updates.used >= p.updates.included
                    ? 'mises à jour incluses utilisées'
                    : plural(p.updates.included - p.updates.used, 'mise à jour restante', 'mises à jour restantes')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** One part of the package: what is left, large, over what it was (16 Nov redesign). */
function ForfaitTile({ item }: { item: ForfaitItem }) {
  if (item.included) {
    return (
      <li className="flex flex-col justify-between gap-3 rounded-[14px] border border-[var(--brand-line)] bg-white p-4">
        <span className="text-[14px] font-semibold text-[var(--brand-ink-soft)]">{item.label}</span>
        <span className="ui-chip ui-chip--gold self-start">
          <Icon name="check" />
          Inclus
        </span>
      </li>
    )
  }
  const left = Math.max(0, item.total - item.used)
  return (
    <li className="flex flex-col gap-2 rounded-[14px] border border-[var(--brand-line)] bg-white p-4">
      <span className="text-[14px] font-semibold text-[var(--brand-ink-soft)]">{item.label}</span>
      <span className="flex items-baseline gap-1.5">
        <b className={`font-[family-name:var(--font-display)] text-[34px] font-extrabold leading-none ${left === 0 ? 'text-[var(--brand-gold-text)]' : 'text-[var(--brand-blue)]'}`}>{left}</b>
        <span className="text-[13px] text-[var(--brand-muted)]">restante{left > 1 ? 's' : ''} sur {item.total}</span>
      </span>
      <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--brand-blue-tint)]" aria-hidden>
        <span className="block h-full rounded-full bg-[var(--brand-gold)]" style={{ width: `${item.total ? (left / item.total) * 100 : 0}%` }} />
      </span>
    </li>
  )
}

const when = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`)
const button = 'ui-btn ui-btn--ghost ui-btn--sm'
const card = 'ui-card p-6'

async function readAccount(): Promise<{ data: CloudDrive } | { error: { text: string; status: number } }> {
  const res = await fetch('/api/account', { cache: 'no-store' }).catch(() => null)
  if (res?.ok) return { data: (await res.json()) as CloudDrive }
  const body = (await res?.json().catch(() => ({}))) as { detail?: string } | undefined
  return { error: { text: body?.detail ?? 'Serveur Roomia injoignable. Vérifiez la connexion internet.', status: res?.status ?? 503 } }
}

export default function AccountClient() {
  const [data, setData] = useState<CloudDrive | null>(null)
  const [error, setError] = useState<{ text: string; status: number } | null>(null)
  const [copied, setCopied] = useState('')
  const [showAll, setShowAll] = useState(false)

  const apply = useCallback((r: Awaited<ReturnType<typeof readAccount>>) => {
    if ('data' in r) {
      setData(r.data)
      setError(null)
    } else setError(r.error)
  }, [])
  const load = useCallback(() => readAccount().then(apply), [apply])

  useEffect(() => {
    let live = true
    void readAccount().then(r => live && apply(r))
    return () => {
      live = false
    }
  }, [apply])

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => undefined)
    setCopied(url)
    setTimeout(() => setCopied(''), 2000)
  }

  async function unpublish(id: string, title: string) {
    if (!window.confirm(`Retirer la visite « ${title} » ? Le lien envoyé à vos clients ne marchera plus.`)) return
    const res = await fetch(`/api/account/tours/${id}`, { method: 'DELETE' })
    if (!res.ok) setError({ text: ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? 'Impossible de retirer la visite.', status: res.status })
    await load()
  }

  const photos = data ? (showAll ? data.photos : data.photos.slice(0, 12)) : []
  const forfait = data?.user.forfait ?? null
  const labels = forfait ? FORFAIT_KIND_LABELS : KIND_LABELS

  return (
    <div className="min-h-screen bg-[var(--brand-paper)]">
      <DesktopNav current="compte" />
      <main className="mx-auto grid max-w-6xl gap-6 px-5 pb-16 pt-10 sm:px-8">
        <div>
          <h1 className="ui-title text-[32px]">Mon espace</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-[var(--brand-muted)]">
            Vos photos et vos visites publiées sont gardées sur le serveur Roomia : vous les retrouvez depuis n’importe quel PC, en vous connectant.
          </p>
        </div>

        {error &&
          (error.status === 401 ? (
            <section className="ui-card flex flex-wrap items-center gap-5 p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-blue)] text-white">
                <Icon name="user" size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[18px] font-bold text-[var(--brand-ink)]">Connectez-vous à votre compte Roomia</h2>
                <p className="mt-1 text-[14px] text-[var(--brand-ink-soft)]">Avec l’identifiant et le mot de passe que Roomia vous a donnés : vos photos, votre forfait et vos liens clients.</p>
              </div>
              <Link className="ui-btn ui-btn--primary ui-btn--lg" href="/login?next=%2Fstudio%2Fcompte">
                Se connecter
              </Link>
            </section>
          ) : (
            <p className="ui-notice ui-notice--warn">
              <Icon name="warn" size={17} />
              <span>
                {error.text}{' '}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load()}>
                  Réessayer
                </button>
              </span>
            </p>
          ))}

        {!data && !error && (
          <p className="flex items-center gap-3 text-[15px] text-[var(--brand-muted)]">
            <span className="ui-spinner" /> Chargement…
          </p>
        )}

        {data && (
          <>
            <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-blue)] font-[family-name:var(--font-display)] text-[20px] font-extrabold text-white">
                  {data.user.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <p className="text-[18px] font-bold text-[var(--brand-ink)]">{data.user.name}</p>
                  <p className="text-[13px] text-[var(--brand-muted)]">Identifiant : {data.user.login}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {forfait ? (
                  <span className="ui-chip ui-chip--gold !h-8 !px-4 !text-[13px]">{forfait.label}</span>
                ) : (
                  <span className="text-right">
                    <span className="block text-[13px] text-[var(--brand-muted)]">Crédits</span>
                    <span className="block font-[family-name:var(--font-display)] text-[26px] font-extrabold text-[var(--brand-blue)]">{data.user.credits}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="ui-btn ui-btn--quiet ui-btn--sm"
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
                    window.location.assign('/login?next=%2Fstudio%2Fcompte')
                  }}
                >
                  <Icon name="logout" size={16} />
                  Se déconnecter
                </button>
              </div>
            </section>

            {forfait?.projects && <ProjectsBlock f={forfait.projects} />}

            {forfait && !forfait.projects && (
              <section>
                <h2 className="mb-3 text-[18px] font-bold text-[var(--brand-ink)]">Mon forfait</h2>
                <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
                  {forfait.items.map(item => (
                    <ForfaitTile key={item.key} item={item} />
                  ))}
                </ul>
                <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-[var(--brand-muted)]">
                  Une photo ou une vue 360° n’est décomptée qu’une fois livrée : rien si elle échoue. Une mise à jour est une nouvelle version du projet envoyée
                  depuis SketchUp ; les plans et la visite 360° sont refaits.{' '}
                  {forfait.items.some(i => !i.included && i.used >= i.total) ? 'Pour étendre votre forfait, contactez Roomia.' : ''}
                </p>
              </section>
            )}

            <section className={card}>
              <h2 className="mb-4 text-[18px] font-bold text-[var(--brand-ink)]">
                Visites publiées <span className="font-normal text-[var(--brand-muted)]">· {data.tours.length}</span>
              </h2>
              {data.tours.length === 0 ? (
                <p className="text-[14px] text-[var(--brand-ink-soft)]">
                  Aucune pour l’instant. Dans la page d’un projet, cliquez « Partager » : vous obtenez un lien à envoyer à vos clients.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {data.tours.map(t => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--brand-line)] px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--brand-gold-tint)] text-[var(--brand-gold-dark)]">
                          <Icon name="link" size={18} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--brand-ink)]">{t.title}</p>
                          <p className="text-[13px] text-[var(--brand-muted)]">
                            Publiée le {when(t.at)} · {size(t.bytes)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={button} onClick={() => void copy(t.url)}>
                          <Icon name={copied === t.url ? 'check' : 'link'} size={15} />
                          {copied === t.url ? 'Lien copié' : 'Copier le lien'}
                        </button>
                        <a className={button} href={t.url} target="_blank" rel="noreferrer">
                          <Icon name="eye" size={15} />
                          Ouvrir
                        </a>
                        <button type="button" className="ui-btn ui-btn--quiet ui-btn--sm !text-[var(--brand-danger)]" onClick={() => void unpublish(t.id, t.title)}>
                          Retirer
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <h2 className="mb-4 text-[18px] font-bold text-[var(--brand-ink)]">
                Mes photos <span className="font-normal text-[var(--brand-muted)]">· {data.photos.length}</span>
              </h2>
              {data.photos.length === 0 ? (
                <p className="text-[14px] text-[var(--brand-ink-soft)]">Les photos que vous faites apparaîtront ici.</p>
              ) : (
                <>
                  <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                    {photos.map(p => (
                      <li key={p.job} className="group overflow-hidden rounded-[12px] border border-[var(--brand-line)] bg-white">
                        <a href={`/api/account/photos/${p.job}`} target="_blank" rel="noreferrer" className="block overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/account/photos/${p.job}`} alt={p.view} loading="lazy" className="aspect-[3/2] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                        </a>
                        <div className="px-3 py-2.5">
                          <p className="truncate text-[13px] font-semibold text-[var(--brand-ink)]">{p.project}</p>
                          <p className="truncate text-[12px] text-[var(--brand-muted)]">
                            {p.view} · {new Date(p.at).toLocaleDateString('fr-FR')}
                          </p>
                          <a
                            className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--brand-blue)]"
                            href={`/api/account/photos/${p.job}?download=1&name=${encodeURIComponent(`${p.project} - ${p.view}`)}`}
                          >
                            <Icon name="download" size={13} />
                            Télécharger
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.photos.length > 12 && (
                    <button type="button" className={`${button} mt-4`} onClick={() => setShowAll(v => !v)}>
                      {showAll ? 'Voir moins' : `Voir les ${data.photos.length} photos`}
                    </button>
                  )}
                </>
              )}
            </section>

            <details className={`${card} group [&_summary::-webkit-details-marker]:hidden`}>
              <summary className="flex cursor-pointer list-none items-center gap-2 text-[16px] font-bold text-[var(--brand-ink)]">
                Historique
                <span className="font-normal text-[var(--brand-muted)]">· {data.ledger.length}</span>
                <Icon name="arrow" size={16} className="ml-auto text-[var(--brand-muted)] transition-transform group-open:rotate-90" />
              </summary>
              {data.ledger.length === 0 ? (
                <p className="mt-3 text-[14px] text-[var(--brand-muted)]">Aucun mouvement pour l’instant.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-[14px]">
                    <thead className="text-[12px] text-[var(--brand-muted)]">
                      <tr>
                        <th className="py-1.5 pr-3 font-semibold">Date</th>
                        <th className="py-1.5 pr-3 font-semibold">Mouvement</th>
                        {!forfait && <th className="py-1.5 pr-3 text-right font-semibold">Crédits</th>}
                        {!forfait && <th className="py-1.5 text-right font-semibold">Solde</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l, i) => (
                        <tr key={i} className="border-t border-[var(--brand-line)]">
                          <td className="whitespace-nowrap py-2 pr-3 text-[var(--brand-muted)]">{when(l.at)}</td>
                          <td className="py-2 pr-3 text-[var(--brand-ink)]">
                            {labels[l.kind] ?? l.kind}
                            {l.detail && l.kind !== 'reserve' && l.kind !== 'consume' ? <span className="text-[var(--brand-muted)]"> · {l.detail}</span> : null}
                          </td>
                          {!forfait && (
                            <td className={`py-2 pr-3 text-right tabular-nums ${l.delta > 0 ? 'text-[var(--brand-blue)]' : 'text-[var(--brand-ink)]'}`}>
                              {l.delta > 0 ? `+${l.delta}` : l.delta}
                            </td>
                          )}
                          {!forfait && <td className="py-2 text-right tabular-nums text-[var(--brand-muted)]">{l.balance_after}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </>
        )}
      </main>
    </div>
  )
}
