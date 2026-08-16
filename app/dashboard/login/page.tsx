'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Mode = 'signin' | 'signup'

export default function DashboardLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/dashboard')
    })
  }, [router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        router.replace('/dashboard')
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) throw err
        if (data.session) {
          router.replace('/dashboard')
        } else {
          setInfo('Compte créé. Vérifiez votre e-mail si la confirmation est activée, puis connectez-vous.')
          setMode('signin')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentification échouée')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--rm-bg)] px-5 py-12 text-[var(--rm-text)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 70% 50% at 20% 10%, rgba(184,137,61,0.22), transparent 55%), radial-gradient(ellipse 60% 40% at 85% 20%, rgba(31,77,61,0.2), transparent 50%)',
        }}
      />
      <div className="rm-rise w-full max-w-md overflow-hidden rounded-3xl border border-[var(--rm-text)]/8 bg-[var(--rm-surface)] shadow-[0_28px_80px_-40px_rgba(20,32,28,0.55)]">
        <div className="border-b border-[var(--rm-text)]/6 px-7 py-6">
          <a
            href="/"
            className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)]"
          >
            roomia
          </a>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--rm-accent)]">
            Pro
          </p>
          <h1 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--rm-ink)]">
            {mode === 'signin' ? 'Connexion' : 'Créer un compte'}
          </h1>
          <p className="mt-1 text-sm text-[var(--rm-muted)]">
            Restyles photoréalistes, empilés dans votre Drive. Plus de fichiers perdus.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-7 py-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-xl border border-[var(--rm-primary)]/20 bg-[var(--rm-secondary)]/50 px-3 py-2 text-sm text-[var(--rm-primary)]">
              {info}
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">E-mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-[var(--rm-muted)]">Mot de passe</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--rm-text)]/12 bg-[var(--rm-bg)] px-3 py-2.5 outline-none ring-[var(--rm-primary)] focus:ring-2"
            />
          </label>

          <button type="submit" disabled={busy} className="rm-btn-primary w-full">
            {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
          </button>

          <p className="text-center text-sm text-[var(--rm-muted)]">
            {mode === 'signin' ? (
              <>
                Pas encore de compte ?{' '}
                <button
                  type="button"
                  className="font-semibold text-[var(--rm-primary)] underline"
                  onClick={() => {
                    setMode('signup')
                    setError(null)
                  }}
                >
                  S’inscrire
                </button>
              </>
            ) : (
              <>
                Déjà inscrit ?{' '}
                <button
                  type="button"
                  className="font-semibold text-[var(--rm-primary)] underline"
                  onClick={() => {
                    setMode('signin')
                    setError(null)
                  }}
                >
                  Se connecter
                </button>
              </>
            )}
          </p>
        </form>

        <div className="border-t border-[var(--rm-text)]/6 px-7 py-4 text-center text-xs text-[var(--rm-muted)]">
          Utilisateur particulier ?{' '}
          <a href="/room-composer" className="font-medium text-[var(--rm-primary)] underline">
            Compositeur public
          </a>
        </div>
      </div>
    </div>
  )
}
