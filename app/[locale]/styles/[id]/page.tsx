import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import SiteFooter from '@/components/marketing/SiteFooter'
import StyleDetail from '@/components/marketing/StyleDetail'
import {
  isStyleId,
  normalizeStyleMotifs,
  normalizeStyleTraits,
  STYLE_IDS,
  STYLE_VISUALS,
} from '@/lib/style-details'

type PageProps = {
  params: Promise<{ locale: string; id: string }>
}

export function generateStaticParams() {
  return STYLE_IDS.map(id => ({ id }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, id } = await params
  if (!isStyleId(id)) return {}
  const t = await getTranslations({ locale, namespace: 'home' })
  return { title: t(`styleName.${id}`) }
}

export default async function StyleDetailPage({ params }: PageProps) {
  const { locale, id } = await params
  setRequestLocale(locale)

  if (!isStyleId(id)) notFound()

  const tHome = await getTranslations('home')
  const tDetail = await getTranslations('styleDetail')
  const traits = tDetail.raw(`${id}.traits`)
  const motifs = tDetail.raw(`${id}.motifs`)
  const visual = STYLE_VISUALS[id]

  return (
    <div className="min-h-screen bg-white text-[var(--rm-text)]">
      <SiteNav />
      <StyleDetail
        styleId={id}
        name={tHome(`styleName.${id}`)}
        body={tDetail(`${id}.body`)}
        visual={visual}
        traits={normalizeStyleTraits(traits)}
        motifs={normalizeStyleMotifs(motifs)}
        labels={{
          back: tDetail('back'),
          palette: tDetail('palette'),
          materials: tDetail('materials'),
          traits: tDetail('traits'),
          motifs: tDetail('motifs'),
          inspirations: tDetail('inspirations'),
          cta: tDetail('cta'),
          materialName: key => tDetail(`materialLabel.${key}`),
        }}
      />
      <SiteFooter />
    </div>
  )
}
