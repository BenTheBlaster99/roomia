import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'
import CatalogMarquee from '@/components/marketing/CatalogMarquee'
import HomeStyles from '@/components/marketing/HomeStyles'
import {
  PhotoHero,
  StackedPaths,
  StackLayer,
} from '@/components/marketing/LandingMotion'
import WhyRoomia from '@/components/marketing/WhyRoomia'

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('home')

  const { data: presets } = await supabase
      .from('room_presets')
      .select('id, name, room_type, style_id, room_config')
      .order('style_id')
      .limit(4)

  const featuredPresets = presets ?? []

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />
      <div className="rm-stack">
        <PhotoHero />
        <StackedPaths />
        <WhyRoomia />
        <StackLayer z={4} pin={false}>
          <CatalogMarquee presets={featuredPresets} />
          <HomeStyles />

      <section className="relative overflow-hidden px-5 py-24 md:px-6">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="rm-display text-4xl font-bold tracking-tight md:text-5xl">
            {t('ctaTitle1')}
            <br />
            {t('ctaTitle2')}
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[var(--rm-muted)]">{t('ctaBody')}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/generateur" className="rm-btn-primary px-10 py-3.5 text-base">
              {t('ctaDesign')}
            </Link>
            <Link href="/quiz" className="rm-btn-accent px-10 py-3.5 text-base">
              {t('ctaQuiz')}
            </Link>
            <Link href="/marketplace" className="rm-btn-secondary px-10 py-3.5 text-base">
              {t('ctaShop')}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
        </StackLayer>
      </div>
    </div>
  )
}
