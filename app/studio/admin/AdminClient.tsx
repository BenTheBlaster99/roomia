'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AI_IMAGE_COST_DA, da, plural, PROJECT_PACKS, PROJECT_SCOPE, type Forfait, type ProjectUse } from '@/lib/forfait'

type Row = Record<string, string | number | null>
type Account = Row & { forfait: Forfait | null }

interface Overview {
  users: Account[]
  ledger: Row[]
  claims: Row[]
}

const KIND_LABELS: Record<string, string> = {
  reserve: 'Image en cours',
  consume: 'Image livrée',
  release: 'Échec (rien de compté)',
  grant: 'Crédits ajoutés',
  adjust: 'Crédits retirés',
  claim: 'Signalement',
  refund: 'Remboursé (signalement)',
  'claim-denied': 'Signalement refusé',
  forfait: 'Ancien forfait donné',
  pack: 'Projets ajoutés',
  'pack-adjust': 'Projets retirés',
  project: 'Projet commencé',
  'project-undo': 'Projet rendu (échec)',
  'project-update': 'Mise à jour',
  'project-admin': 'Ajustement',
}

const when = (ms: unknown) => (ms ? new Date(Number(ms)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const day = (ms: unknown) => (ms ? new Date(Number(ms)).toLocaleDateString('fr-FR', { dateStyle: 'medium' }) : '—')

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('')
}

const input = 'rounded-lg border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-3 py-2 text-sm text-[var(--rm-text)]'
const button = 'rounded-lg bg-[var(--rm-primary)] px-3 py-2 text-sm font-semibold text-[var(--rm-surface)] disabled:opacity-50'
const ghost = 'rounded-lg border border-[var(--rm-text)]/15 px-3 py-2 text-sm text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5 disabled:opacity-50'
const small = 'rounded-md border border-[var(--rm-text)]/15 px-2 py-1 text-xs text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5'
const card = 'rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5'

type Post = (url: string, body: unknown, done: string) => Promise<boolean>

/**
 * Roomia admin (27 Nov redesign). A client buys projects (lib/forfait.ts): after a payment, find the client and click the
 * pack that was paid. Each started project shows what it used and what it costs Roomia; a quoted villa or an extra update
 * is one click on that project. Accounts, passwords and the old credits are folded away under "Compte".
 */
export default function AdminClient({ adminLogin }: { adminLogin: string }) {
  const [data, setData] = useState<Overview | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/overview', { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setData((await res.json()) as Overview)
    else setMessage({ ok: false, text: 'Impossible de charger les données.' })
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then(res => (res.ok ? (res.json() as Promise<Overview>) : null))
      .then(d => {
        if (!cancelled && d) setData(d)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const post: Post = async (url, body, done) => {
    setMessage(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = res ? ((await res.json().catch(() => ({}))) as { detail?: string }) : {}
    if (res?.ok) setMessage({ ok: true, text: done })
    else setMessage({ ok: false, text: json.detail ?? 'Échec, réessayez.' })
    await load()
    return Boolean(res?.ok)
  }

  const clients = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.users ?? []).filter(u => u.role !== 'admin').filter(u => !q || `${u.name} ${u.login}`.toLowerCase().includes(q))
  }, [data, search])
  const admins = (data?.users ?? []).filter(u => u.role === 'admin')
  const pending = data?.claims.filter(c => c.status === 'pending') ?? []
  const flagged = (data?.users ?? []).flatMap(u => (u.forfait?.projects?.projects ?? []).filter(p => p.flags?.length).map(p => ({ user: u, project: p })))

  // the month's figures, for the header
  const totals = useMemo(() => {
    const projects = (data?.users ?? []).flatMap(u => u.forfait?.projects?.projects ?? [])
    const images = projects.reduce((n, p) => n + (p.aiImages ?? 0), 0)
    return { projects: projects.length, images }
  }, [data])

  return (
    <main className="min-h-screen bg-[var(--rm-bg)] px-4 py-8 text-[var(--rm-text)] sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--rm-primary)]">roomia · admin</p>
            <p className="mt-1 max-w-2xl text-sm text-[var(--rm-muted)]">
              Un client achète des <b>projets</b> (1 projet = 1 appartement type). Après un paiement : trouvez le client ci-dessous et cliquez sur le pack payé.
            </p>
            {data && (
              <p className="mt-1 text-xs text-[var(--rm-muted)]">
                {plural(clients.length, 'client', 'clients')} · {plural(totals.projects, 'projet commencé', 'projets commencés')} · {plural(totals.images, 'image IA', 'images IA')} ≈{' '}
                {da(totals.images * AI_IMAGE_COST_DA)} de coût IA
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link href="/studio" className={ghost}>
              Studio
            </Link>
            <button
              type="button"
              className={ghost}
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null)
                window.location.assign('/login')
              }}
            >
              Se déconnecter ({adminLogin})
            </button>
          </div>
        </header>

        {message && (
          <p className={`sticky top-2 z-10 rounded-lg px-4 py-3 text-sm shadow-sm ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {message.text}
            <button type="button" className="float-right text-xs underline" onClick={() => setMessage(null)}>
              fermer
            </button>
          </p>
        )}

        {(pending.length > 0 || flagged.length > 0) && (
          <section className={`${card} border-amber-300`}>
            <h2 className="mb-3 font-semibold">À regarder</h2>
            {flagged.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {flagged.map(({ user, project }) => (
                  <li key={`${user.id}-${project.id}`}>
                    ⚠ <b>{user.name}</b> · {project.name} — {project.flags!.join(' ; ')} Si c’est un autre appartement, demandez-lui d’en faire un nouveau projet.
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 && (
              <ul className="space-y-2">
                {pending.map(c => (
                  <ClaimRow key={Number(c.id)} claim={c} onDecide={(decision, note) => post(`/api/admin/claims/${c.id}`, { decision, note }, 'Signalement traité.')} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Clients</h2>
            <input className={`${input} w-64`} placeholder="Chercher un client…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {!data && <p className="text-sm text-[var(--rm-muted)]">Chargement…</p>}
          {data && clients.length === 0 && <p className="text-sm text-[var(--rm-muted)]">Aucun client{search ? ' pour cette recherche' : ''}.</p>}
          {clients.map(u => (
            <ClientCard key={Number(u.id)} u={u} post={post} />
          ))}
        </section>

        <NewClient post={post} />

        <details className={card}>
          <summary className="cursor-pointer font-semibold">Journal ({data?.ledger.length ?? 0} derniers mouvements)</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-xs">
              <thead className="uppercase text-[var(--rm-muted)]">
                <tr>
                  <th className="py-2">Quand</th>
                  <th>Client</th>
                  <th>Mouvement</th>
                  <th>Détail</th>
                </tr>
              </thead>
              <tbody>
                {data?.ledger.map(l => (
                  <tr key={Number(l.id)} className="border-t border-[var(--rm-text)]/8">
                    <td className="whitespace-nowrap py-1.5">{when(l.at)}</td>
                    <td>{l.login}</td>
                    <td>
                      {KIND_LABELS[String(l.kind)] ?? l.kind}
                      {l.actor ? ` · par ${l.actor}` : ''}
                    </td>
                    <td className="max-w-[34rem] truncate" title={String(l.detail ?? '')}>
                      {l.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <details className={card}>
          <summary className="cursor-pointer font-semibold">Signalements traités et comptes admin</summary>
          <ul className="mt-3 space-y-2">
            {data?.claims
              .filter(c => c.status !== 'pending')
              .map(c => (
                <ClaimRow key={Number(c.id)} claim={c} onDecide={async () => false} />
              ))}
          </ul>
          <p className="mt-3 text-sm text-[var(--rm-muted)]">Comptes admin : {admins.map(a => a.login).join(', ') || '—'}</p>
        </details>
      </div>
    </main>
  )
}

/** One client: projects used, the pack buttons, the started projects, and the account's rarely used settings folded away. */
function ClientCard({ u, post }: { u: Account; post: Post }) {
  const id = Number(u.id)
  const url = `/api/admin/users/${id}`
  const f = u.forfait
  const projects = f?.projects
  const oldForfait = f && !projects ? f : null

  async function addPack(n: number, price: number | null) {
    const what = `${plural(n, 'projet', 'projets')}${price ? ` (paiement de ${da(price)} reçu)` : ''}`
    if (!window.confirm(`Ajouter ${what} à ${u.name} ?${oldForfait ? '\n\nSon ancien forfait (photos / vues 360°) est remplacé ; les projets déjà finis par l’IA comptent comme commencés.' : ''}`)) return
    await post(url, { action: 'pack', projects: n, price, reason: price ? 'Paiement reçu' : 'Ajout' }, `${what} ajouté${n > 1 ? 's' : ''} à ${u.name}.`)
  }

  function otherPack() {
    const n = Number(window.prompt('Combien de projets ajouter ? (négatif pour corriger une erreur)', '1'))
    if (!Number.isInteger(n) || n === 0) return
    const price = n > 0 ? Number(window.prompt('Montant payé en DA (laisser vide si offert) :', '') || 0) : 0
    void (async () => {
      if (n < 0) {
        if (!window.confirm(`Retirer ${-n} projet(s) à ${u.name} ?`)) return
        await post(url, { action: 'pack', projects: n, reason: 'Correction' }, `Forfait de ${u.name} corrigé.`)
      } else await addPack(n, price > 0 ? price : null)
    })()
  }

  return (
    <article className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold">
            {u.name}{' '}
            {u.status !== 'active' && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">suspendu</span>}
          </p>
          <p className="text-xs text-[var(--rm-muted)]">
            Identifiant : {u.login} · dernière activité : {when(u.last_activity)}
          </p>
        </div>
        <div className="text-right">
          {projects ? (
            <>
              <p className="font-[family-name:var(--font-display)] text-3xl font-bold text-[var(--rm-primary)]">
                {Math.max(0, projects.total - projects.used)} <span className="text-base font-medium text-[var(--rm-muted)]">projet{projects.total - projects.used > 1 ? 's' : ''} restant{projects.total - projects.used > 1 ? 's' : ''}</span>
              </p>
              <p className="text-xs text-[var(--rm-muted)]">
                {projects.used} commencé{projects.used > 1 ? 's' : ''} sur {projects.total} achetés
              </p>
            </>
          ) : oldForfait ? (
            <p className="max-w-xs text-xs text-[var(--rm-muted)]">
              Ancien forfait « {oldForfait.label} » : {oldForfait.items.filter(i => !i.included).map(i => `${i.label} : ${Math.max(0, i.total - i.used)} restant(s) sur ${i.total}`).join(' · ')}. Un pack le
              remplace par le forfait projets.
            </p>
          ) : (
            <p className="text-sm text-[var(--rm-muted)]">Pas encore de projets</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase text-[var(--rm-muted)]">Paiement reçu :</span>
        {PROJECT_PACKS.map(p => (
          <button key={p.projects} type="button" className={ghost} onClick={() => void addPack(p.projects, p.price)}>
            +{plural(p.projects, 'projet', 'projets')} · {da(p.price)}
          </button>
        ))}
        <button type="button" className={small} onClick={otherPack}>
          Autre…
        </button>
      </div>

      {projects && projects.projects.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--rm-muted)]">
              <tr>
                <th className="py-2">Projet</th>
                <th>Commencé</th>
                <th title="Mises à jour utilisées / incluses">Mises à jour</th>
                <th title="Version actuelle : points 360° finis / inclus">Points 360°</th>
                <th title="Version actuelle : photos HD / incluses">Photos HD</th>
                <th title={`Toutes versions, ≈ ${AI_IMAGE_COST_DA} DA par image`}>Coût IA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.projects.map(p => (
                <ProjectRow key={p.id} p={p} url={url} post={post} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--rm-muted)]">Compte (mot de passe, suspension, anciens crédits)</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={ghost}
            onClick={() => {
              if (!window.confirm(`Donner un nouveau mot de passe à ${u.name} ? Il sera déconnecté partout.`)) return
              const password = randomPassword()
              void post(url, { action: 'password', password }, `Nouveau mot de passe de ${u.login} : ${password}  (à lui transmettre)`)
            }}
          >
            Nouveau mot de passe
          </button>
          {u.status === 'active' ? (
            <button type="button" className={ghost} onClick={() => window.confirm(`Suspendre ${u.name} ? Il ne pourra plus rien lancer.`) && void post(url, { action: 'suspend' }, `${u.login} suspendu.`)}>
              Suspendre
            </button>
          ) : (
            <button type="button" className={ghost} onClick={() => void post(url, { action: 'activate' }, `${u.login} réactivé.`)}>
              Réactiver
            </button>
          )}
          <span className="text-xs text-[var(--rm-muted)]">
            Anciens crédits (sans forfait) : {u.credits} · images livrées : {u.delivered} · échecs : {u.failed}
          </span>
          <button
            type="button"
            className={small}
            onClick={() => {
              const delta = Number(window.prompt('Crédits à ajouter (négatif pour retirer) — uniquement pour un compte sans forfait :', ''))
              if (!Number.isInteger(delta) || delta === 0) return
              const reason = window.prompt('Raison :', 'Correction') ?? ''
              if (reason.trim()) void post(url, { action: 'credits', delta, reason }, `Crédits de ${u.login} mis à jour.`)
            }}
          >
            Crédits…
          </button>
          {f && (
            <button
              type="button"
              className="text-xs text-red-700 underline underline-offset-2"
              onClick={() => window.confirm(`Retirer tout le forfait de ${u.name} ? Il repasse en crédits simples (${u.credits}).`) && void post(url, { action: 'forfait-remove' }, `Forfait de ${u.login} retiré.`)}
            >
              Retirer le forfait
            </button>
          )}
        </div>
      </details>
    </article>
  )
}

/** A started project: what it used in its current version, its AI cost, and the admin's one-click changes. */
function ProjectRow({ p, url, post }: { p: ProjectUse; url: string; post: Post }) {
  const [quote, setQuote] = useState(false)
  const [q, setQ] = useState({ credits: String(p.credits), views: String(p.views.included - PROJECT_SCOPE.views), photos: String(p.photos.included - PROJECT_SCOPE.photos) })
  const full = (u: { used: number; included: number }) => (u.used >= u.included ? 'font-semibold text-amber-700' : '')
  const send = (body: Record<string, unknown>, done: string) => post(url, { action: 'project', project: p.id, ...body }, done)
  return (
    <>
      <tr className="border-t border-[var(--rm-text)]/8 align-top">
        <td className="py-2">
          <p className="font-medium">
            {p.name}
            {p.flags?.length ? <span title={p.flags.join('\n')}> ⚠</span> : null}
          </p>
          <p className="text-xs text-[var(--rm-muted)]">
            version {p.version}
            {p.credits > 1 ? ` · compte pour ${p.credits} projets` : ''}
          </p>
        </td>
        <td className="text-xs">{day(p.openedAt)}</td>
        <td className={full(p.updates)}>
          {p.updates.used} / {p.updates.included}
        </td>
        <td className={full(p.views)}>
          {p.views.used} / {p.views.included}
        </td>
        <td className={full(p.photos)}>
          {p.photos.used} / {p.photos.included}
        </td>
        <td className="text-xs">
          {p.aiImages ?? 0} img · {da((p.aiImages ?? 0) * AI_IMAGE_COST_DA)}
        </td>
        <td className="space-x-1 whitespace-nowrap text-right">
          <button type="button" className={small} onClick={() => void send({ extraUpdates: p.updates.included - PROJECT_SCOPE.updates + 1 }, `+1 mise à jour pour ${p.name}.`)}>
            +1 mise à jour
          </button>
          <button type="button" className={small} onClick={() => setQuote(!quote)}>
            Sur devis…
          </button>
          <button
            type="button"
            className="text-xs text-red-700 underline underline-offset-2"
            onClick={() =>
              window.confirm(`Ne pas compter « ${p.name} » ? Le projet revient au forfait (ses images restent livrées). S’il est repris, sa prochaine image IA le recompte.`) &&
              void send({ remove: true }, `${p.name} n’est plus compté.`)
            }
          >
            Ne pas compter
          </button>
        </td>
      </tr>
      {quote && (
        <tr>
          <td colSpan={7} className="pb-3">
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-[var(--rm-text)]/[0.03] p-3 text-xs">
              <span className="max-w-[16rem] text-[var(--rm-muted)]">Villa, duplex, grand projet : il compte pour plus d’un projet, et/ou reçoit plus de points 360° et de photos.</span>
              <label className="flex flex-col">
                Compte pour (projets)
                <input className={`${input} w-24`} type="number" min={1} value={q.credits} onChange={e => setQ({ ...q, credits: e.target.value })} />
              </label>
              <label className="flex flex-col">
                Points 360° en plus
                <input className={`${input} w-24`} type="number" min={0} value={q.views} onChange={e => setQ({ ...q, views: e.target.value })} />
              </label>
              <label className="flex flex-col">
                Photos en plus
                <input className={`${input} w-24`} type="number" min={0} value={q.photos} onChange={e => setQ({ ...q, photos: e.target.value })} />
              </label>
              <button
                type="button"
                className={button}
                onClick={async () => {
                  const ok = await send({ credits: Number(q.credits), extraViews: Number(q.views), extraPhotos: Number(q.photos) }, `${p.name} : devis enregistré.`)
                  if (ok) setQuote(false)
                }}
              >
                Enregistrer
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** A new client: login, name, a generated password, and the pack they paid for. */
function NewClient({ post }: { post: Post }) {
  const empty = () => ({ login: '', name: '', password: randomPassword(), pack: '1' })
  const [form, setForm] = useState(empty)
  const pack = PROJECT_PACKS.find(p => String(p.projects) === form.pack)
  return (
    <section className={card}>
      <h2 className="mb-1 font-semibold">Nouveau client</h2>
      <p className="mb-3 text-sm text-[var(--rm-muted)]">Donnez-lui ensuite l’identifiant et le mot de passe : il se connecte dans Roomia Desktop (Mon espace).</p>
      <form
        onSubmit={async e => {
          e.preventDefault()
          const ok = await post(
            '/api/admin/users',
            { login: form.login, name: form.name, password: form.password, projects: pack?.projects ?? 0, price: pack?.price ?? 0, reason: pack ? 'Paiement reçu' : '' },
            `Client « ${form.name || form.login} » créé${pack ? ` avec ${plural(pack.projects, 'projet', 'projets')}` : ''}. Identifiant : ${form.login} · mot de passe : ${form.password}`,
          )
          if (ok) setForm(empty())
        }}
        className="grid items-end gap-3 sm:grid-cols-[1fr_1.5fr_1.5fr_1fr_auto]"
      >
        <label className="flex flex-col text-xs text-[var(--rm-muted)]">
          Identifiant
          <input className={input} placeholder="ex. sarah" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-[var(--rm-muted)]">
          Nom (bureau, personne)
          <input className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-[var(--rm-muted)]">
          Mot de passe
          <span className="flex gap-1">
            <input className={`${input} min-w-0 flex-1 font-mono`} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <button type="button" className={ghost} onClick={() => setForm({ ...form, password: randomPassword() })} title="Nouveau mot de passe">
              ↻
            </button>
          </span>
        </label>
        <label className="flex flex-col text-xs text-[var(--rm-muted)]">
          Pack payé
          <select className={input} value={form.pack} onChange={e => setForm({ ...form, pack: e.target.value })}>
            {PROJECT_PACKS.map(p => (
              <option key={p.projects} value={String(p.projects)}>
                {plural(p.projects, 'projet', 'projets')} · {da(p.price)}
              </option>
            ))}
            <option value="0">Aucun pour l’instant</option>
          </select>
        </label>
        <button type="submit" className={button} disabled={!form.login.trim() || form.password.length < 10}>
          Créer
        </button>
      </form>
    </section>
  )
}

function ClaimRow({ claim, onDecide }: { claim: Row; onDecide: (decision: 'refund' | 'deny', note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const photo = `/api/scenes/${claim.scene_id}/photos/${claim.photo_file}`
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--rm-text)]/10 p-3 text-sm">
      <a href={photo} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${photo}?w=200`} alt="Photo signalée" className="h-16 w-24 rounded object-cover" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Photo signalée · {claim.login} · {when(claim.created_at)}
        </p>
        <p className="text-[var(--rm-muted)]">« {claim.reason} »</p>
        {claim.status !== 'pending' && (
          <p className="text-xs">
            {claim.status === 'refunded' ? 'Remboursé' : 'Refusé'}
            {claim.note ? ` · ${claim.note}` : ''}
          </p>
        )}
      </div>
      {claim.status === 'pending' && (
        <div className="flex gap-1">
          <input className={`${input} w-48`} placeholder="Note (facultatif)" value={note} onChange={e => setNote(e.target.value)} />
          <button type="button" className={button} onClick={() => void onDecide('refund', note)} title="La photo ne compte plus (forfait) ou le crédit est rendu">
            Ne pas compter
          </button>
          <button type="button" className={ghost} onClick={() => void onDecide('deny', note)}>
            Refuser
          </button>
        </div>
      )}
    </li>
  )
}
