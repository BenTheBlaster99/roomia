import Link from 'next/link'
import type { ReactNode } from 'react'

const LINKS = [
  { href: '/rooms', label: 'Presets' },
  { href: '/marketplace', label: 'Catalog' },
  { href: '/room-composer', label: 'Compose' },
  { href: '/studio', label: 'Studio' },
  { href: '/partners', label: 'Partners' },
]

export default function SiteNav({
  ctaHref = '/configure',
  ctaLabel = 'Start designing',
  trailing,
}: {
  ctaHref?: string
  ctaLabel?: string
  trailing?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rm-text)]/8 bg-[var(--rm-bg)]/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 md:px-6">
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--rm-primary)] transition-opacity hover:opacity-80"
        >
          roomia
        </Link>

        <div className="hidden items-center gap-7 text-sm text-[var(--rm-text)]/65 md:flex">
          {LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-[var(--rm-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {trailing}
          <Link href={ctaHref} className="rm-btn-primary text-sm">
            {ctaLabel}
          </Link>
        </div>
      </nav>
    </header>
  )
}
