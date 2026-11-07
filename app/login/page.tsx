'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'

/** Studio sign-in: one account per office or freelancer, created by Roomia. */
export default function LoginPage() {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Roomia Desktop (its preload): the Studio also works without the account, for everything but the photos IA
  const desktop = useSyncExternalStore(
    () => () => undefined,
    () => 'roomiaDesktop' in window,
    () => false,
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    }).catch(() => null)
    if (res?.ok) {
      const next = new URLSearchParams(window.location.search).get('next') ?? '/studio'
      window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/studio')
      return
    }
    const detail = res ? ((await res.json().catch(() => ({}))) as { detail?: string }).detail : null
    setError(detail ?? 'Connexion impossible, réessayez.')
    setBusy(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--rm-bg)] px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-7 shadow-lg">
        <p className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)]">roomia</p>
        <h1 className="mt-4 text-base font-semibold text-[var(--rm-text)]">Connexion au Studio</h1>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">Avec l’identifiant et le mot de passe que Roomia vous a donnés.</p>
        <input
          autoFocus
          autoComplete="username"
          value={login}
          onChange={e => setLogin(e.target.value)}
          placeholder="Identifiant"
          className="mt-5 w-full rounded-xl border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-4 py-3 text-sm text-[var(--rm-text)] outline-none focus:border-[var(--rm-primary)]"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="mt-3 w-full rounded-xl border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-4 py-3 text-sm text-[var(--rm-text)] outline-none focus:border-[var(--rm-primary)]"
        />
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !login.trim() || !password}
          className="mt-4 w-full rounded-xl bg-[var(--rm-primary)] px-4 py-3 text-sm font-semibold text-[var(--rm-surface)] disabled:opacity-50"
        >
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        {desktop && (
          <Link href="/studio/projets" className="mt-3 block text-center text-xs text-[var(--rm-muted)] underline underline-offset-2 hover:text-[var(--rm-text)]">
            Continuer sans compte (rendus Blender seulement)
          </Link>
        )}
      </form>
    </main>
  )
}
