import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import SiteNav from '@/components/marketing/SiteNav'
import StyleDetail from '@/components/marketing/StyleDetail'
import { isStyleId, STYLE_IDS, STYLE_VISUALS } from '@/lib/style-details'

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
  const visual = STYLE_VISUALS[id]

  return (
    <div className="min-h-screen bg-[var(--rm-bg)] text-[var(--rm-text)]">
      <SiteNav />
      <StyleDetail
        name={tHome(`styleName.${id}`)}
        visual={visual}
        traits={Array.isArray(traits) ? traits : []}
        labels={{
          palette: tDetail('palette'),
          materials: tDetail('materials'),
          traits: tDetail('traits'),
          photoLiving: tDetail('photoLiving'),
          photoBedroom: tDetail('photoBedroom'),
          photoKitchen: tDetail('photoKitchen'),
        }}
      />
    </div>
  )
}
