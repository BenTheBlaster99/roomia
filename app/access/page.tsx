'use client'

import { useState } from 'react'

export default function AccessPage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).catch(() => null)
    if (res?.ok) {
      const next = new URLSearchParams(window.location.search).get('next') ?? '/studio'
      window.location.assign(next.startsWith('/') && !next.startsWith('//') ? next : '/studio')
      return
    }
    setError(res ? 'Code incorrect.' : 'Connexion impossible, réessayez.')
    setBusy(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--rm-bg)] px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-[var(--rm-text)]/10 bg-[var(--rm-surface)] p-7 shadow-lg"
      >
        <p className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)]">roomia</p>
        <h1 className="mt-4 text-base font-semibold text-[var(--rm-text)]">Accès au Studio</h1>
        <p className="mt-1 text-sm text-[var(--rm-muted)]">Entrez le code d’accès qu’on vous a envoyé.</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Code d’accès"
          className="mt-5 w-full rounded-xl border border-[var(--rm-text)]/15 bg-[var(--rm-bg)] px-4 py-3 text-sm text-[var(--rm-text)] outline-none focus:border-[var(--rm-primary)]"
        />
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-4 w-full rounded-xl bg-[var(--rm-primary)] px-4 py-3 text-sm font-semibold text-[var(--rm-surface)] disabled:opacity-50"
        >
          {busy ? 'Vérification…' : 'Entrer'}
        </button>
      </form>
    </main>
  )
}
