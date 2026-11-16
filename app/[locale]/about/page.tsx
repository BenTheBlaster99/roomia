import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import PageHero from '@/components/site/PageHero'
import RevealOnScroll from '@/components/site/RevealOnScroll'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'

// 16 Nov: restyled to the brand but not linked from the navbar: the text still describes the earlier consumer configurator.
export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('about')

  return (
    <div className="site-page">
      <SiteHeader />

      <main>
        <PageHero eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />

        <section className="site-section">
          <div className="site-wrap">
            <div className="site-stack site-lead">
              <p>{t('p1')}</p>
              <p>{t('p2')}</p>
            </div>
          </div>
        </section>

        <section className="site-section is-paper">
          <div className="site-wrap">
            <h2 className="site-h2" data-reveal="">
              {t('team')}
            </h2>
            <div className="site-grid site-grid--2">
              {[
                { name: 'Sarah', role: t('sarahRole'), desc: t('sarahDesc') },
                { name: 'Aimen', role: t('aimenRole'), desc: t('aimenDesc') },
              ].map(({ role, name, desc }, i) => (
                <article key={name} className="site-card" data-reveal={String(i + 1)}>
                  <p className="site-eyebrow">{role}</p>
                  <h3 className="site-h2">{name}</h3>
                  <p className="site-text">{desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="site-section">
          <div className="site-wrap">
            <div className="site-stack" data-reveal="">
              <h2 className="site-h2">{t('why')}</h2>
              <p className="site-lead">{t('whyBody')}</p>
            </div>
            <div className="site-card" data-reveal="1">
              <p className="site-eyebrow">{t('contact')}</p>
              <p className="site-text">{t('contactBody')}</p>
              <a href="mailto:contact@roomia.dz" className="site-link">
                contact@roomia.dz
              </a>
            </div>
            <div>
              <Link href="/generateur" className="site-btn site-btn--primary site-btn--lg">
                {t('try')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <RevealOnScroll />
    </div>
  )
}
