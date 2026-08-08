'use client'

import { useLocale } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing, type AppLocale } from '@/i18n/routing'

export default function LanguageToggle() {
  const locale = useLocale() as AppLocale
  const pathname = usePathname()
  const router = useRouter()

  function switchTo(next: AppLocale) {
    if (next === locale) return
    router.replace(pathname, { locale: next })
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[var(--rm-text)]/12 bg-[var(--rm-surface)]/80 p-0.5 text-xs font-bold">
      {routing.locales.map(code => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          className={`min-w-[2rem] rounded-md px-2 py-1 uppercase transition-colors ${
            locale === code
              ? 'bg-[var(--rm-primary)] text-[var(--rm-surface)]'
              : 'text-[var(--rm-muted)] hover:text-[var(--rm-text)]'
          }`}
          aria-pressed={locale === code}
        >
          {code}
        </button>
      ))}
    </div>
  )
}
