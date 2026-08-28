'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing, type AppLocale } from '@/i18n/routing'

export default function LanguageToggle({
  dark = false,
}: {
  dark?: boolean
}) {
  const t = useTranslations('nav')
  const locale = useLocale() as AppLocale
  const pathname = usePathname()
  const router = useRouter()

  function switchTo(next: AppLocale) {
    if (next === locale) return
    router.replace(pathname, { locale: next })
  }

  return (
    <div
      className={`flex items-center gap-0.5 rounded-lg border p-0.5 text-xs font-bold ${
        dark
          ? 'border-white/15 bg-white/5'
          : 'border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/80'
      }`}
      role="group"
      aria-label={t('langLabel')}
    >
      {routing.locales.map(code => {
        const active = locale === code
        return (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            className={`min-w-[2rem] rounded-md px-2 py-1 uppercase transition-colors ${
              active
                ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
                : dark
                  ? 'text-[#f4efe4]/70 hover:text-[#f4efe4]'
                  : 'text-[var(--rm-muted)] hover:text-[var(--rm-text)]'
            }`}
            aria-pressed={active}
            aria-label={code === 'fr' ? t('langFrName') : t('langEnName')}
          >
            {code === 'fr' ? t('langFr') : t('langEn')}
          </button>
        )
      })}
    </div>
  )
}
