'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import LanguageToggle from './LanguageToggle'

export default function SiteNav({
  ctaHref = '/generateur',
  ctaLabel,
  trailing,
}: {
  ctaHref?: string
  ctaLabel?: string
  trailing?: ReactNode
}) {
  const t = useTranslations('nav')
  const [loggedIn, setLoggedIn] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setLoggedIn(Boolean(data.session))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setLoggedIn(Boolean(session))
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const links = [
    { href: '/styles', label: t('styles') },
    { href: '/marketplace', label: t('catalog') },
    { href: '/generateur', label: t('ai') },
    { href: '/studio', label: t('studio'), external: true },
  ] as const

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 md:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)] transition-opacity hover:opacity-80"
        >
          roomia
        </Link>

        <div className="hidden items-center gap-6 text-sm text-[var(--rm-text)]/65 lg:flex">
          {links.map(link =>
            'external' in link && link.external ? (
              <a
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-[var(--rm-primary)]"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="transition-colors hover:text-[var(--rm-primary)]"
              >
                {link.label}
              </Link>
            ),
          )}
        </div>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          {loggedIn ? (
            <a
              href="/dashboard"
              className="hidden text-sm font-semibold text-[var(--rm-primary)] transition-opacity hover:opacity-80 sm:inline"
            >
              {t('dashboard')}
            </a>
          ) : (
            <a
              href="/dashboard/login"
              className="hidden rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-[var(--rm-accent)] transition-opacity hover:opacity-80 sm:inline"
            >
              {t('pro')}
            </a>
          )}
          {trailing}
          {ctaHref.startsWith('/') &&
          !ctaHref.startsWith('/studio') &&
          !ctaHref.startsWith('/configure') &&
          !ctaHref.startsWith('/room') &&
          !ctaHref.startsWith('/dashboard') ? (
            <Link href={ctaHref} className="rm-btn-primary text-sm">
              {ctaLabel ?? t('cta')}
            </Link>
          ) : (
            <a href={ctaHref} className="rm-btn-primary text-sm">
              {ctaLabel ?? t('cta')}
            </a>
          )}
        </div>
      </nav>
    </header>
  )
}
