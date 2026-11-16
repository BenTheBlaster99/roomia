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

  // 16 Nov redesign: a project photo in a deep-blue frame, the form on white (brand tokens in app/globals.css)
  const field =
    'mt-1.5 w-full rounded-[10px] border border-[var(--brand-line-strong)] bg-white px-4 py-3 text-[15px] text-[var(--brand-ink)] outline-none transition-shadow focus:border-[var(--brand-blue)] focus:shadow-[var(--brand-focus)]'
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[var(--brand-blue-night)] lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing/f5-salon-photo.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-[linear-gradient(160deg,rgba(8,36,46,0.92)_0%,rgba(18,76,94,0.55)_45%,rgba(8,36,46,0.85)_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <span className="font-[family-name:var(--font-display)] text-[26px] font-black uppercase leading-none tracking-[0.02em] [font-variation-settings:'wdth'_125]">
            Roomia<span className="text-[var(--brand-gold-light)]">.</span>
          </span>
          <div>
            <p className="max-w-md font-[family-name:var(--font-display)] text-[40px] font-extrabold leading-[1.1] [font-variation-settings:'wdth'_108]">
              Votre projet SketchUp, <em className="font-[family-name:var(--font-serif)] font-normal not-italic text-[var(--brand-gold-light)] [font-style:italic]">visité</em> avant d’être construit.
            </p>
            <p className="mt-4 max-w-md text-[16px] text-white/75">Visite 360°, photos réalistes, plans 2D et 3D, vidéo.</p>
          </div>
        </div>
      </aside>

      <div className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-[400px]">
          <span className="font-[family-name:var(--font-display)] text-[22px] font-black uppercase leading-none tracking-[0.02em] text-[var(--brand-blue)] [font-variation-settings:'wdth'_125] lg:hidden">
            Roomia<span className="text-[var(--brand-gold)]">.</span>
          </span>
          <h1 className="mt-6 font-[family-name:var(--font-display)] text-[30px] font-extrabold text-[var(--brand-ink)] [font-variation-settings:'wdth'_108] lg:mt-0">Connexion</h1>
          <p className="mt-2 text-[15px] text-[var(--brand-muted)]">Avec l’identifiant et le mot de passe que Roomia vous a donnés.</p>
          <label className="mt-8 block text-[14px] font-semibold text-[var(--brand-ink-soft)]">
            Identifiant
            <input autoFocus autoComplete="username" value={login} onChange={e => setLogin(e.target.value)} className={field} />
          </label>
          <label className="mt-4 block text-[14px] font-semibold text-[var(--brand-ink-soft)]">
            Mot de passe
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={field} />
          </label>
          {error && <p className="mt-3 rounded-[10px] bg-[var(--brand-danger-tint)] px-3 py-2 text-[14px] text-[#7d2a1c]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !login.trim() || !password}
            className="mt-6 w-full rounded-full bg-[var(--brand-blue)] px-4 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--brand-blue-deep)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
          {desktop && (
            <Link href="/studio/projets" className="mt-5 block text-center text-[14px] text-[var(--brand-muted)] underline underline-offset-4 hover:text-[var(--brand-blue)]">
              Continuer sans compte
            </Link>
          )}
        </form>
      </div>
    </main>
  )
}
