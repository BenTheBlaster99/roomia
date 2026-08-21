'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing, type AppLocale } from '@/i18n/routing'

export default function LanguageSelect({
  dark = false,
}: {
  dark?: boolean
}) {
  const t = useTranslations('nav')
  const locale = useLocale() as AppLocale
  const pathname = usePathname()
  const router = useRouter()

  return (
    <label className="flex flex-col gap-1.5">
      <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${dark ? 'text-[#f4efe4]/55' : 'text-[var(--rm-muted)]'}`}>
        {t('langLabel')}
      </span>
      <select
        value={locale}
        onChange={event => {
          const next = event.target.value as AppLocale
          if (next === locale) return
          router.replace(pathname, { locale: next })
        }}
        className={`h-11 w-full rounded-lg border px-3 text-sm font-semibold ${
          dark
            ? 'border-white/15 bg-[#1a2f26] text-[#f4efe4]'
            : 'border-[var(--rm-text)]/12 bg-[var(--rm-surface)] text-[var(--rm-ink)]'
        }`}
        aria-label={t('langLabel')}
      >
        {routing.locales.map(code => (
          <option key={code} value={code}>
            {code === 'fr' ? t('langFrName') : t('langEnName')}
          </option>
        ))}
      </select>
    </label>
  )
}
