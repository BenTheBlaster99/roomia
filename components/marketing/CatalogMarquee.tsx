'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

const ITEMS = [
  { label: 'Sofa', mark: 'Sf' },
  { label: 'Fauteuil', mark: 'Ft' },
  { label: 'Table', mark: 'Tb' },
  { label: 'Lit', mark: 'Lt' },
  { label: 'Luminaire', mark: 'Lm' },
  { label: 'Tapis', mark: 'Tp' },
  { label: 'Bibliothèque', mark: 'Bb' },
  { label: 'Buffet', mark: 'Bf' },
  { label: 'Chaise', mark: 'Ch' },
  { label: 'Rideaux', mark: 'Rd' },
]

export default function CatalogMarquee() {
  const t = useTranslations('home')
  const loop = [...ITEMS, ...ITEMS]

  return (
    <section className="border-y border-[var(--rm-text)]/8 bg-[var(--rm-ink)] py-10 text-[var(--rm-surface)] overflow-hidden">
      <div className="mx-auto max-w-6xl px-5 md:px-6 mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="rm-display text-2xl font-bold tracking-tight md:text-3xl">
            {t('catalogTitle')}
          </h2>
          <p className="mt-1 text-sm text-[var(--rm-surface)]/65">{t('catalogSub')}</p>
        </div>
        <Link
          href="/marketplace"
          className="text-sm font-semibold text-[var(--rm-accent)] hover:underline shrink-0"
        >
          {t('catalogCta')} →
        </Link>
      </div>

      <div className="relative">
        <div className="rm-marquee flex w-max gap-4 px-4">
          {loop.map((item, i) => (
            <Link
              key={`${item.label}-${i}`}
              href="/marketplace"
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 min-w-[9.5rem] hover:bg-white/10 transition-colors"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--rm-accent)]/25 text-xs font-bold text-[var(--rm-accent)]">
                {item.mark}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
