'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { Forfait } from '@/lib/forfait'

type Row = Record<string, string | number | null>

interface Overview {
  users: Row[]
  ledger: Row[]
  claims: Row[]
}

const KIND_LABELS: Record<string, string> = {
  reserve: 'Réservé (photo en cours)',
  consume: 'Photo livrée',
  release: 'Rendu (échec, crédit rendu)',
  grant: 'Crédits ajoutés',
  adjust: 'Crédits retirés',
  claim: 'Signalement',
  refund: 'Remboursé (signalement)',
  'claim-denied': 'Signalement refusé',
  forfait: 'Forfait donné',
}

/** A new client forfait (lib/forfait.ts), as the admin types it. */
const FORFAIT_DEFAULT = { label: 'Projet', photo: '20', pano: '10', update: '3', plan2d: true, plan3d: true }

function ForfaitSummary({ forfait }: { forfait: Forfait | null }) {
  if (!forfait) return <span className="text-xs text-[var(--rm-muted)]">Pas de forfait (crédits simples)</span>
  return (
    <div className="text-xs">
      <p className="font-semibold">{forfait.label}</p>
      {forfait.items.map(i => (
        <p key={i.key}>
          {i.label} : {i.included ? 'inclus' : <b>{Math.max(0, i.total - i.used)} / {i.total}</b>}
        </p>
      ))}
    </div>
  )
}

const when = (ms: unknown) => (ms ? new Date(Number(ms)).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(14))
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('')
}

const input = 'rounded-lg border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-3 py-2 text-sm text-[var(--rm-text)]'
const button = 'rounded-lg bg-[var(--rm-primary)] px-3 py-2 text-sm font-semibold text-[var(--rm-surface)] disabled:opacity-50'
const ghost = 'rounded-lg border border-[var(--rm-text)]/15 px-3 py-2 text-sm text-[var(--rm-text)] hover:bg-[var(--rm-text)]/5'

/** Roomia admin: create accounts, add credits after a payment, suspend, see usage and reports. */
export default function AdminClient({ adminLogin }: { adminLogin: string }) {
  const [data, setData] = useState<Overview | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [form, setForm] = useState({ login: '', name: '', password: randomPassword(), credits: '10', reason: 'Pack de lancement' })
  const [creditInputs, setCreditInputs] = useState<Record<number, { delta: string; reason: string }>>({})
  const [forfaitInputs, setForfaitInputs] = useState<Record<number, typeof FORFAIT_DEFAULT>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/overview').catch(() => null)
    if (res?.ok) setData((await res.json()) as Overview)
    else setMessage({ ok: false, text: 'Impossible de charger les données.' })
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/overview')
      .then(res => (res.ok ? (res.json() as Promise<Overview>) : null))
      .then(d => {
        if (!cancelled && d) setData(d)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function post(url: string, body: unknown, done: string) {
    setMessage(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = res ? ((await res.json().catch(() => ({}))) as { detail?: string }) : {}
    if (res?.ok) setMessage({ ok: true, text: done })
    else setMessage({ ok: false, text: json.detail ?? 'Échec, réessayez.' })
    await load()
    return Boolean(res?.ok)
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault()
    const ok = await post(
      '/api/admin/users',
      { ...form, credits: Number(form.credits) || 0 },
      `Compte « ${form.login} » créé. Mot de passe à transmettre : ${form.password}`,
    )
    if (ok) setForm({ login: '', name: '', password: randomPassword(), credits: '10', reason: 'Pack de lancement' })
  }

  const pending = data?.claims.filter(c => c.status === 'pending') ?? []

  return (
    <main className="min-h-screen bg-[var(--rm-bg)] px-4 py-8 text-[var(--rm-text)] sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--rm-primary)]">roomia · admin</p>
            <p className="text-sm text-[var(--rm-muted)]">Connecté : {adminLogin}. Les paiements se font hors ligne ; ajoutez les crédits ici après réception.</p>
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
              Se déconnecter
            </button>
          </div>
        </header>

        {message && (
          <p className={`rounded-lg px-4 py-3 text-sm ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
        )}

        <section className="rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
          <h2 className="mb-3 font-semibold">Nouveau compte (bureau ou freelance)</h2>
          <form onSubmit={createAccount} className="grid gap-3 sm:grid-cols-6">
            <input className={`${input} sm:col-span-1`} placeholder="Identifiant" value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />
            <input className={`${input} sm:col-span-2`} placeholder="Nom (bureau, personne)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-1 sm:col-span-2">
              <input className={`${input} min-w-0 flex-1 font-mono`} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <button type="button" className={ghost} onClick={() => setForm({ ...form, password: randomPassword() })} title="Nouveau mot de passe">
                ↻
              </button>
            </div>
            <input className={`${input} sm:col-span-1`} type="number" min={0} placeholder="Crédits" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value })} />
            <input className={`${input} sm:col-span-4`} placeholder="Raison des crédits (paiement CCP, pack de lancement…)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            <button type="submit" className={`${button} sm:col-span-2`} disabled={!form.login || form.password.length < 10}>
              Créer le compte
            </button>
          </form>
        </section>

        <section className="overflow-x-auto rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
          <h2 className="mb-3 font-semibold">Comptes</h2>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--rm-muted)]">
              <tr>
                <th className="py-2">Compte</th>
                <th>Statut</th>
                <th>Crédits</th>
                <th>Photos livrées</th>
                <th>Échecs (rendus)</th>
                <th>Dernière activité</th>
                <th>Ajouter / retirer des crédits</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map(u => {
                const id = Number(u.id)
                const edit = creditInputs[id] ?? { delta: '', reason: '' }
                return (
                  <tr key={id} className="border-t border-[var(--rm-text)]/8 align-top">
                    <td className="py-2.5">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-[var(--rm-muted)]">
                        {u.login} {u.role === 'admin' ? '· admin' : ''}
                      </p>
                    </td>
                    <td className={u.status === 'active' ? 'text-emerald-700' : 'text-red-700'}>{u.status === 'active' ? 'actif' : 'suspendu'}</td>
                    <td className="text-lg font-semibold">{u.credits}</td>
                    <td>{u.delivered}</td>
                    <td>{u.failed}</td>
                    <td className="text-xs">{when(u.last_activity)}</td>
                    <td>
                      <div className="flex gap-1">
                        <input
                          className={`${input} w-20`}
                          type="number"
                          placeholder="+10"
                          value={edit.delta}
                          onChange={e => setCreditInputs({ ...creditInputs, [id]: { ...edit, delta: e.target.value } })}
                        />
                        <input
                          className={`${input} w-44`}
                          placeholder="Raison (paiement…)"
                          value={edit.reason}
                          onChange={e => setCreditInputs({ ...creditInputs, [id]: { ...edit, reason: e.target.value } })}
                        />
                        <button
                          type="button"
                          className={button}
                          disabled={!edit.delta || !edit.reason.trim()}
                          onClick={async () => {
                            if (await post(`/api/admin/users/${id}`, { action: 'credits', delta: Number(edit.delta), reason: edit.reason }, `Crédits de ${u.login} mis à jour.`)) {
                              setCreditInputs({ ...creditInputs, [id]: { delta: '', reason: '' } })
                            }
                          }}
                        >
                          OK
                        </button>
                      </div>
                    </td>
                    <td className="space-x-1 whitespace-nowrap">
                      {u.status === 'active' ? (
                        <button type="button" className={ghost} onClick={() => void post(`/api/admin/users/${id}`, { action: 'suspend' }, `${u.login} suspendu.`)}>
                          Suspendre
                        </button>
                      ) : (
                        <button type="button" className={ghost} onClick={() => void post(`/api/admin/users/${id}`, { action: 'activate' }, `${u.login} réactivé.`)}>
                          Réactiver
                        </button>
                      )}
                      <button
                        type="button"
                        className={ghost}
                        onClick={() => {
                          const password = randomPassword()
                          void post(`/api/admin/users/${id}`, { action: 'password', password }, `Nouveau mot de passe de ${u.login} : ${password}`)
                        }}
                      >
                        Nouveau mot de passe
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="overflow-x-auto rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
          <h2 className="mb-1 font-semibold">Forfaits clients</h2>
          <p className="mb-3 text-sm text-[var(--rm-muted)]">
            Le client voit son forfait (photos, vues 360°, plans, mises à jour) à la place des crédits ou des DA. Les photos et les vues 360° sont décomptées une fois
            livrées ; les mises à jour sont comptées, jamais bloquées. Donner un forfait remplace l’ancien et remet ses compteurs à zéro.
          </p>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--rm-muted)]">
              <tr>
                <th className="py-2">Compte</th>
                <th>Forfait actuel (reste / total)</th>
                <th>Nouveau forfait</th>
              </tr>
            </thead>
            <tbody>
              {data?.users
                .filter(u => u.role !== 'admin')
                .map(u => {
                  const id = Number(u.id)
                  const forfait = (u as unknown as { forfait: Forfait | null }).forfait
                  const f = forfaitInputs[id] ?? FORFAIT_DEFAULT
                  const set = (patch: Partial<typeof FORFAIT_DEFAULT>) => setForfaitInputs({ ...forfaitInputs, [id]: { ...f, ...patch } })
                  const num = (key: 'photo' | 'pano' | 'update', label: string) => (
                    <label className="flex flex-col text-xs text-[var(--rm-muted)]">
                      {label}
                      <input className={`${input} w-20`} type="number" min={0} value={f[key]} onChange={e => set({ [key]: e.target.value })} />
                    </label>
                  )
                  return (
                    <tr key={id} className="border-t border-[var(--rm-text)]/8 align-top">
                      <td className="py-2.5">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-[var(--rm-muted)]">{u.login}</p>
                      </td>
                      <td className="py-2.5">
                        <ForfaitSummary forfait={forfait} />
                        {forfait && (
                          <button
                            type="button"
                            className="mt-1 text-xs text-red-700 underline underline-offset-2"
                            onClick={() => {
                              if (window.confirm(`Retirer le forfait de ${u.login} ? Le compte repasse en crédits simples (solde : ${u.credits}).`)) {
                                void post(`/api/admin/users/${id}`, { action: 'forfait-remove' }, `Forfait de ${u.login} retiré.`)
                              }
                            }}
                          >
                            Retirer le forfait
                          </button>
                        )}
                      </td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col text-xs text-[var(--rm-muted)]">
                            Nom
                            <input className={`${input} w-32`} value={f.label} onChange={e => set({ label: e.target.value })} />
                          </label>
                          {num('photo', 'Photos IA')}
                          {num('pano', 'Vues 360° IA')}
                          {num('update', 'Mises à jour')}
                          <label className="flex items-center gap-1 pb-2 text-xs">
                            <input type="checkbox" checked={f.plan2d} onChange={e => set({ plan2d: e.target.checked })} /> Plan 2D
                          </label>
                          <label className="flex items-center gap-1 pb-2 text-xs">
                            <input type="checkbox" checked={f.plan3d} onChange={e => set({ plan3d: e.target.checked })} /> Plan 3D
                          </label>
                          <button
                            type="button"
                            className={button}
                            onClick={() => {
                              if (forfait && !window.confirm(`${u.login} a déjà un forfait : le remplacer (compteurs remis à zéro) ?`)) return
                              void post(
                                `/api/admin/users/${id}`,
                                { action: 'forfait', label: f.label, photo: Number(f.photo), pano: Number(f.pano), update: Number(f.update), plan2d: f.plan2d ? 1 : 0, plan3d: f.plan3d ? 1 : 0 },
                                `Forfait « ${f.label} » donné à ${u.login}.`,
                              )
                            }}
                          >
                            Donner ce forfait
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
          <h2 className="mb-1 font-semibold">Signalements de fidélité {pending.length ? `· ${pending.length} à traiter` : ''}</h2>
          <p className="mb-3 text-sm text-[var(--rm-muted)]">
            Une photo livrée dont le client dit qu’elle ne respecte pas son design. Regardez la photo, puis remboursez le crédit ou refusez.
          </p>
          {data?.claims.length ? (
            <ul className="space-y-2">
              {data.claims.map(c => (
                <ClaimRow key={Number(c.id)} claim={c} onDecide={(decision, note) => post(`/api/admin/claims/${c.id}`, { decision, note }, 'Signalement traité.')} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--rm-muted)]">Aucun signalement.</p>
          )}
        </section>

        <section className="overflow-x-auto rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-5">
          <h2 className="mb-3 font-semibold">Journal des crédits (300 derniers mouvements)</h2>
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="uppercase text-[var(--rm-muted)]">
              <tr>
                <th className="py-2">Quand</th>
                <th>Compte</th>
                <th>Mouvement</th>
                <th>Crédit</th>
                <th>Solde après</th>
                <th>Détail</th>
                <th>Job</th>
              </tr>
            </thead>
            <tbody>
              {data?.ledger.map(l => (
                <tr key={Number(l.id)} className="border-t border-[var(--rm-text)]/8">
                  <td className="py-1.5 whitespace-nowrap">{when(l.at)}</td>
                  <td>{l.login}</td>
                  <td>
                    {KIND_LABELS[String(l.kind)] ?? l.kind}
                    {l.actor ? ` · par ${l.actor}` : ''}
                  </td>
                  <td className={Number(l.delta) > 0 ? 'text-emerald-700' : Number(l.delta) < 0 ? 'text-red-700' : ''}>
                    {Number(l.delta) > 0 ? `+${l.delta}` : l.delta}
                  </td>
                  <td>{l.balance_after}</td>
                  <td className="max-w-[28rem] truncate" title={String(l.detail ?? '')}>
                    {l.detail}
                  </td>
                  <td className="font-mono text-[10px] text-[var(--rm-muted)]">{l.job_id ? String(l.job_id).slice(0, 10) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
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
          {claim.login} · {when(claim.created_at)}
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
          <button type="button" className={button} onClick={() => void onDecide('refund', note)}>
            Rembourser 1 crédit
          </button>
          <button type="button" className={ghost} onClick={() => void onDecide('deny', note)}>
            Refuser
          </button>
        </div>
      )}
    </li>
  )
}
