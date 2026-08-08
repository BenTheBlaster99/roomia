'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import HaikeiBackdrop from './HaikeiBackdrop'

export default function SiteFooter() {
  const t = useTranslations('footer')

  return (
    <footer className="relative overflow-hidden border-t border-[var(--rm-text)]/10 bg-[var(--rm-ink)] text-[var(--rm-bg)]">
      <HaikeiBackdrop variant="footer" />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:items-end md:justify-between md:px-6">
        <div>
          <div className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">
            roomia
          </div>
          <p className="mt-2 max-w-xs text-sm text-[var(--rm-bg)]/65">{t('tagline')}</p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--rm-bg)]/70">
          <Link href="/rooms" className="hover:text-[var(--rm-bg)]">{t('presets')}</Link>
          <Link href="/marketplace" className="hover:text-[var(--rm-bg)]">{t('catalog')}</Link>
          <Link href="/generateur" className="hover:text-[var(--rm-bg)]">{t('ai')}</Link>
          <a href="/studio" className="hover:text-[var(--rm-bg)]">{t('studio')}</a>
          <Link href="/about" className="hover:text-[var(--rm-bg)]">{t('about')}</Link>
          <Link href="/partners" className="hover:text-[var(--rm-bg)]">{t('partners')}</Link>
          <a href="mailto:contact@roomia.dz" className="hover:text-[var(--rm-bg)]">{t('contact')}</a>
        </div>

        <p className="text-xs text-[var(--rm-bg)]/45">{t('rights')}</p>
      </div>
    </footer>
  )
}
