'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import LanguageSelect from './LanguageToggle'

const NAV_LINKS = [
  { href: '/', key: 'home' as const },
  { href: '/generateur', key: 'ai' as const },
  { href: '/studio', key: 'studio' as const, external: true },
  { href: '/styles', key: 'styles' as const },
  { href: '/contact', key: 'contact' as const },
]

export default function SiteNav({
  trailing,
  tone = 'light',
}: {
  ctaHref?: string
  ctaLabel?: string
  trailing?: ReactNode
  tone?: 'light' | 'dark'
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

  const dark = tone === 'dark'
  const headerClass = dark
    ? 'sticky top-0 z-50 border-b border-white/10 bg-[#1a2f26]'
    : 'sticky top-0 z-50 border-b border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/92 backdrop-blur-xl'
  const inkClass = dark ? 'text-[#f4efe4]' : 'text-[var(--rm-ink)]'
  const mutedClass = dark ? 'text-[#f4efe4]/70' : 'text-[var(--rm-text)]/70'
  const currentClass = dark
    ? 'font-semibold text-[#f4efe4]'
    : 'font-semibold text-[var(--rm-ink)]'

  return (
    <header className={headerClass}>
      <nav className="mx-auto flex min-h-[var(--rm-nav-h)] max-w-6xl items-center justify-between px-5 lg:grid lg:grid-cols-[auto_1fr_auto] lg:gap-4 md:px-6">
        <button
          type="button"
          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg lg:hidden ${inkClass}`}
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

        <Link
          href="/"
          className={`font-[family-name:var(--font-display)] text-3xl font-bold leading-none tracking-tight ${inkClass} transition-opacity hover:opacity-80`}
          aria-label="Roomia"
        >
          R
        </Link>

        <div className={`hidden items-center justify-center gap-7 text-sm lg:flex ${mutedClass}`}>
          {NAV_LINKS.map(link => {
            const current = !link.external && isCurrent(link.href)
            const className = current
              ? `${inkClass} underline decoration-current underline-offset-[10px]`
              : 'transition-colors hover:opacity-100 hover:text-current'
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

        <div className="hidden items-center justify-end gap-3 lg:flex">
          {trailing}
          {loggedIn ? (
            <a
              href="/dashboard"
              className={`text-sm font-semibold transition-opacity hover:opacity-80 ${dark ? 'text-[#f4efe4]' : 'text-[var(--rm-primary)]'}`}
            >
              {t('dashboard')}
            </a>
          ) : (
            <a
              href="/dashboard/login"
              className="rounded-md px-2 py-1 text-xs font-bold uppercase tracking-wider text-[var(--rm-accent)] transition-opacity hover:opacity-80"
            >
              {t('pro')}
            </a>
          )}
        </div>
      </nav>

      {menuOpen && (
        <div className={`border-t px-5 py-5 lg:hidden ${dark ? 'border-white/10 bg-[#1a2f26]' : 'border-[var(--rm-text)]/8 bg-[var(--rm-bg)]'}`}>
          <div className={`mx-auto flex max-w-6xl flex-col gap-1 text-sm font-medium ${dark ? 'text-[#f4efe4]' : 'text-[var(--rm-text)]'}`}>
            {NAV_LINKS.map(link => {
              const current = !link.external && isCurrent(link.href)
              return link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="py-2.5"
                  onClick={() => setMenuOpen(false)}
                >
                  {t(link.key)}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`py-2.5 ${current ? currentClass : ''}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {t(link.key)}
                </Link>
              )
            })}
            {loggedIn ? (
              <a href="/dashboard" className="py-2.5" onClick={() => setMenuOpen(false)}>
                {t('dashboard')}
              </a>
            ) : (
              <a href="/dashboard/login" className="py-2.5" onClick={() => setMenuOpen(false)}>
                {t('pro')}
              </a>
            )}
            <div className="mt-4 pt-4 border-t border-current/10">
              <LanguageSelect dark={dark} />
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
