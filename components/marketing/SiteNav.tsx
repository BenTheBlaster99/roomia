'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import LanguageToggle from './LanguageToggle'

const NAV_LINKS = [
  { href: '/', key: 'home' as const },
  { href: '/generateur', key: 'ai' as const },
  { href: '/studio', key: 'studio' as const, external: true },
  { href: '/styles', key: 'styles' as const },
  { href: '/contact', key: 'contact' as const },
]

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
  const pathname = usePathname()
  const [loggedIn, setLoggedIn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)

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

  const ctaIsLocaleLink =
    ctaHref.startsWith('/') &&
    !ctaHref.startsWith('/studio') &&
    !ctaHref.startsWith('/configure') &&
    !ctaHref.startsWith('/room') &&
    !ctaHref.startsWith('/dashboard')

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/92 backdrop-blur-xl">
      <nav className="mx-auto grid min-h-[var(--rm-nav-h)] max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-5 md:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-3xl font-bold leading-none tracking-tight text-[var(--rm-ink)] transition-opacity hover:opacity-80"
          aria-label="Roomia"
        >
          R
        </Link>

        <div className="hidden items-center justify-center gap-7 text-sm text-[var(--rm-text)]/70 lg:flex">
          {NAV_LINKS.map(link => {
            const current = !link.external && isCurrent(link.href)
            const className = current
              ? 'text-[var(--rm-ink)] underline decoration-[var(--rm-ink)] underline-offset-[10px]'
              : 'transition-colors hover:text-[var(--rm-primary)]'
            return link.external ? (
              <a key={link.href} href={link.href} className={className}>
                {t(link.key)}
              </a>
            ) : (
              <Link key={link.href} href={link.href} className={className} aria-current={current ? 'page' : undefined}>
                {t(link.key)}
              </Link>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2">
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
          {ctaIsLocaleLink ? (
            <Link href={ctaHref} className="rm-btn-primary text-sm">
              {ctaLabel ?? t('ctaCreate')}
            </Link>
          ) : (
            <a href={ctaHref} className="rm-btn-primary text-sm">
              {ctaLabel ?? t('ctaCreate')}
            </a>
          )}
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--rm-ink)] lg:hidden"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen(open => !open)}
          >
            <span className="sr-only">Menu</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
              {menuOpen ? (
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="border-t border-[var(--rm-text)]/8 bg-[var(--rm-bg)] px-5 py-4 lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm font-medium text-[var(--rm-text)]">
            {NAV_LINKS.map(link => {
              const current = !link.external && isCurrent(link.href)
              return link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="py-1.5"
                  onClick={() => setMenuOpen(false)}
                >
                  {t(link.key)}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`py-1.5 ${current ? 'font-semibold text-[var(--rm-ink)]' : ''}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {t(link.key)}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </header>
  )
}
