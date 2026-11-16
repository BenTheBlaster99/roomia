import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import PageHero from '@/components/site/PageHero'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'

// 16 Nov: linked from the navbar. Note: /contact (French, no prefix) needs '/contact' in proxy.ts's matcher to be served.
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contact')

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('body')} />

        <section className="site-section is-paper">
          <div className="site-wrap">
            <div className="site-grid site-grid--2">
              <div id="launch" className="site-card">
                <h2 className="site-h3">{t('launchTitle')}</h2>
                <p className="site-text">{t('launchBody')}</p>
                <div>
                  <a href="mailto:contact@room-ia.com?subject=Launch%20notification" className="site-btn site-btn--primary">
                    {t('launchCta')}
                  </a>
                </div>
              </div>
              <div className="site-card">
                <h2 className="site-h3">{t('emailTitle')}</h2>
                <p>
                  <a href="mailto:contact@room-ia.com" className="site-link">
                    contact@room-ia.com
                  </a>
                </p>
                <p>
                  <Link href="/generateur" className="site-link">
                    {t('tryAi')}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
