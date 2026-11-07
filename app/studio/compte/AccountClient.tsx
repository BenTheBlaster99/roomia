'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { CloudDrive } from '@/lib/roomia-cloud'
import DesktopNav from '../components/DesktopNav'

const KIND_LABELS: Record<string, string> = {
  reserve: 'Photo en cours',
  consume: 'Photo livrée',
  release: 'Échec, crédit rendu',
  grant: 'Crédits ajoutés',
  adjust: 'Crédits retirés',
  claim: 'Signalement',
  refund: 'Remboursé (signalement)',
  'claim-denied': 'Signalement refusé',
}

const when = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} Go` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} Mo`)
const button = 'rounded-lg border border-[var(--rm-text)]/15 px-3 py-1.5 text-sm text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5 disabled:opacity-50'
const card = 'rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-4'

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

  return (
    <div className="min-h-screen bg-[var(--rm-bg)]">
      <DesktopNav current="compte" />
      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--rm-text)]">Mon espace Roomia</h1>
          <p className="text-sm text-[var(--rm-muted)]">
            Vos photos IA et vos visites publiées sont gardées sur le serveur Roomia : vous les retrouvez depuis n’importe quel PC, en vous connectant.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error.text}{' '}
            {error.status === 401 ? (
              <Link className="font-semibold underline underline-offset-2" href="/login?next=%2Fstudio%2Fcompte">
                Se connecter
              </Link>
            ) : (
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => void load()}>
                Réessayer
              </button>
            )}
          </div>
        )}

        {!data && !error && <p className="text-sm text-[var(--rm-muted)]">Chargement…</p>}

        {data && (
          <>
            <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <p className="text-sm text-[var(--rm-muted)]">Compte</p>
                <p className="font-semibold text-[var(--rm-text)]">
                  {data.user.name} <span className="font-normal text-[var(--rm-muted)]">({data.user.login})</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-[var(--rm-muted)]">Crédits</p>
                <p className="text-2xl font-semibold text-[var(--rm-primary)]">{data.user.credits}</p>
                <p className="text-xs text-[var(--rm-muted)]">1 crédit par photo IA livrée · les rendus Blender sont gratuits</p>
              </div>
            </section>

            <section className={card}>
              <h2 className="mb-2 font-semibold text-[var(--rm-text)]">Visites publiées · {data.tours.length}</h2>
              {data.tours.length === 0 ? (
                <p className="text-sm text-[var(--rm-muted)]">
                  Aucune pour l’instant. Ouvrez la visite 360° d’un projet et cliquez « Publier pour mes clients » : vous obtenez un lien à leur envoyer.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {data.tours.map(t => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--rm-bg)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--rm-text)]">{t.title}</p>
                        <p className="text-xs text-[var(--rm-muted)]">
                          Publiée le {when(t.at)} · {size(t.bytes)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={button} onClick={() => void copy(t.url)}>
                          {copied === t.url ? 'Lien copié ✓' : 'Copier le lien'}
                        </button>
                        <a className={button} href={t.url} target="_blank" rel="noreferrer">
                          Ouvrir
                        </a>
                        <button type="button" className={`${button} text-red-700`} onClick={() => void unpublish(t.id, t.title)}>
                          Retirer
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <h2 className="mb-2 font-semibold text-[var(--rm-text)]">Photos IA · {data.photos.length}</h2>
              {data.photos.length === 0 ? (
                <p className="text-sm text-[var(--rm-muted)]">Les photos IA que vous générez apparaîtront ici.</p>
              ) : (
                <>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {photos.map(p => (
                      <li key={p.job} className="overflow-hidden rounded-xl bg-[var(--rm-bg)]">
                        <a href={`/api/account/photos/${p.job}`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/account/photos/${p.job}`} alt={p.view} loading="lazy" className="aspect-[3/2] w-full object-cover" />
                        </a>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-xs font-medium text-[var(--rm-text)]">{p.project}</p>
                          <p className="truncate text-xs text-[var(--rm-muted)]">
                            {p.view} · {new Date(p.at).toLocaleDateString('fr-FR')}
                          </p>
                          <a
                            className="text-xs font-medium text-[var(--rm-primary)] underline underline-offset-2"
                            href={`/api/account/photos/${p.job}?download=1&name=${encodeURIComponent(`${p.project} - ${p.view}`)}`}
                          >
                            Télécharger
                          </a>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {data.photos.length > 12 && (
                    <button type="button" className={`${button} mt-3`} onClick={() => setShowAll(v => !v)}>
                      {showAll ? 'Voir moins' : `Voir les ${data.photos.length} photos`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className={card}>
              <h2 className="mb-2 font-semibold text-[var(--rm-text)]">Historique des crédits</h2>
              {data.ledger.length === 0 ? (
                <p className="text-sm text-[var(--rm-muted)]">Aucun mouvement pour l’instant.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-[var(--rm-muted)]">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Date</th>
                        <th className="py-1 pr-3 font-medium">Mouvement</th>
                        <th className="py-1 pr-3 text-right font-medium">Crédits</th>
                        <th className="py-1 text-right font-medium">Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger.map((l, i) => (
                        <tr key={i} className="border-t border-[var(--rm-text)]/5">
                          <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--rm-muted)]">{when(l.at)}</td>
                          <td className="py-1.5 pr-3 text-[var(--rm-text)]">
                            {KIND_LABELS[l.kind] ?? l.kind}
                            {l.detail && l.kind !== 'reserve' && l.kind !== 'consume' ? <span className="text-[var(--rm-muted)]"> · {l.detail}</span> : null}
                          </td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums ${l.delta > 0 ? 'text-[var(--rm-primary)]' : 'text-[var(--rm-text)]'}`}>
                            {l.delta > 0 ? `+${l.delta}` : l.delta}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-[var(--rm-muted)]">{l.balance_after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
