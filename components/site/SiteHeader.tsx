'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { routing, type AppLocale } from '@/i18n/routing'
import Wordmark from './Wordmark'
import { DEMO_WHATSAPP, HOME_SECTIONS, siteCopy } from './site-copy'
import './site.css'

/**
 * The website's one navbar, on every page. It holds the real pages (the landing's main sections and Contact), the language
 * switch and the demo button (a WhatsApp conversation). Under 960 px the links fold into a menu.
 * `trailing` lets a page add one control of its own (the old marketplace's basket).
 */
export default function SiteHeader({ trailing }: { trailing?: ReactNode }) {
  const locale = useLocale()
  const t = siteCopy(locale)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const home = locale === 'en' ? '/en' : '/'

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const sections = HOME_SECTIONS.filter(s => s.nav)
  const onContact = pathname === '/contact'
  const close = () => setOpen(false)

  const links = (
    <>
      {sections.map(s => (
        <a key={s.id} href={`${home}#${s.id}`} onClick={close}>
          {t.sections[s.id]}
        </a>
      ))}
      <Link href="/contact" aria-current={onContact ? 'page' : undefined} onClick={close}>
        {t.contact}
      </Link>
    </>
  )

  return (
    <header className={`site-header${open ? ' is-open' : ''}`}>
      <div className="site-header-bar site-wrap">
        <Link href="/" className="site-header-home" aria-label={`Roomia, ${t.home.toLowerCase()}`}>
          <Wordmark />
        </Link>

        <nav className="site-header-links" aria-label={t.mainNav}>
          {links}
        </nav>

        <div className="site-header-end">
          <LocaleSwitch label={t.language} />
          {trailing}
          <a className="site-btn site-btn--primary site-header-demo" href={DEMO_WHATSAPP} target="_blank" rel="noopener noreferrer">
            <span className="site-only-wide">{t.demo}</span>
            <span className="site-only-narrow">{t.demoShort}</span>
          </a>
          <button
            type="button"
            className="site-header-menu"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? t.menuClose : t.menuOpen}
            onClick={() => setOpen(v => !v)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
              {open ? (
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M4 8h16M4 16h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <nav id="site-menu" className="site-header-panel" aria-label={t.mainNav} hidden={!open}>
        <div className="site-wrap">
          <a href={home} onClick={close}>
            {t.home}
          </a>
          {links}
        </div>
      </nav>
    </header>
  )
}

function LocaleSwitch({ label }: { label: string }) {
  const locale = useLocale() as AppLocale
  const pathname = usePathname()
  const router = useRouter()
  return (
    <div className="site-locale" role="group" aria-label={label}>
      {routing.locales.map(code => (
        <button
          key={code}
          type="button"
          aria-pressed={locale === code}
          lang={code}
          aria-label={code === 'fr' ? 'Français' : 'English'}
          onClick={() => code !== locale && router.replace(pathname, { locale: code })}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
