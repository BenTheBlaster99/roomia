import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { WHATSAPP_DISPLAY } from '@/lib/contact'
import Wordmark from './Wordmark'
import { CONTACT_EMAIL, DEMO_WHATSAPP, HOME_SECTIONS, siteCopy } from './site-copy'
import './site.css'

/** The website's one footer, on every page: the landing's sections (all of them, so each stays one click away), and how to reach us. */
export default function SiteFooter() {
  const locale = useLocale()
  const t = siteCopy(locale)
  const home = locale === 'en' ? '/en' : '/'

  return (
    <footer className="site-footer">
      <div className="site-wrap site-footer-grid">
        <div className="site-footer-brand">
          <Link href="/" aria-label={`Roomia, ${t.home.toLowerCase()}`}>
            <Wordmark />
          </Link>
          <p>{t.tagline}</p>
        </div>

        <nav aria-label={t.onHome}>
          <h2>{t.onHome}</h2>
          <ul>
            {HOME_SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`${home}#${s.id}`}>{t.sections[s.id]}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2>{t.reach}</h2>
          <ul>
            <li>
              <a href={DEMO_WHATSAPP} target="_blank" rel="noopener noreferrer">
                {t.whatsapp} · <span className="site-footer-num">{WHATSAPP_DISPLAY}</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </li>
            <li>
              <Link href="/contact">{t.contact}</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="site-wrap site-footer-base">
        <span>{t.rights}</span>
        <span>room-ia.com</span>
      </div>
    </footer>
  )
}
