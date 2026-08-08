'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
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

  const links = [
    { href: '/styles', label: t('styles') },
    { href: '/marketplace', label: t('catalog') },
    { href: '/generateur', label: t('ai') },
    { href: '/studio', label: t('studio'), external: true },
    { href: '/partners', label: t('partners') },
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
          {trailing}
          {ctaHref.startsWith('/') &&
          !ctaHref.startsWith('/studio') &&
          !ctaHref.startsWith('/configure') &&
          !ctaHref.startsWith('/room') ? (
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
