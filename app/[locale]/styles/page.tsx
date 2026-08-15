import { getTranslations, setRequestLocale } from 'next-intl/server'
import { supabase } from '@/lib/supabase'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import HaikeiBackdrop from '@/components/marketing/HaikeiBackdrop'
import StylesExplorer, {
  fallbackStyleSections,
  type StyleSection,
} from '@/components/marketing/StylesExplorer'

export default async function StylesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('stylesPage')

  const { data } = await supabase
    .from('styles')
    .select('id, name, tagline, description, main_color, accent_color')
    .order('name')

  const styles: StyleSection[] =
    data && data.length > 0
      ? (data as StyleSection[])
      : fallbackStyleSections()

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav ctaHref="/quiz" ctaLabel={t('quiz')} />

      <section className="relative overflow-hidden border-b border-[var(--rm-text)]/8">
        <HaikeiBackdrop variant="band" />
        <div className="relative mx-auto max-w-6xl px-5 py-16 md:px-6 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--rm-accent)]">
            {t('eyebrow')}
          </p>
          <h1 className="rm-display mt-3 text-4xl font-bold tracking-tight md:text-6xl">
            {t('title')}
          </h1>
          <p className="mt-4 max-w-xl text-[var(--rm-muted)] md:text-lg">{t('sub')}</p>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-5 py-10 md:px-6 md:py-14">
        <StylesExplorer styles={styles} />
      </main>

      <SiteFooter />
    </div>
  )
}
