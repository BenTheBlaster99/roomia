'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { STYLE_CARD_COLORS } from '@/lib/style-room-presentation'

type PresetTeaser = {
  id: string
  name: string
  room_type?: string | null
  style_id?: string | null
  room_config?: { wallColor?: string } | null
}

const CATEGORIES = [
  {
    key: 'catSofas',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=800&q=80',
  },
  {
    key: 'catCoffee',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=800&q=80',
  },
  {
    key: 'catDining',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1617806118233-18e1de3d13f0?auto=format&fit=crop&w=800&q=80',
  },
  {
    key: 'catChairs',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?auto=format&fit=crop&w=800&q=80',
  },
  {
    key: 'catLights',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1543198126-a8ad8e47fb22?auto=format&fit=crop&w=800&q=80',
  },
  {
    key: 'catBeds',
    href: '/marketplace',
    image:
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80',
  },
] as const

const FALLBACK_PRESETS = [
  { id: 'industrial-living', nameKey: 'presetIndustrial' as const, styleId: 'industrial', href: '/rooms' },
  { id: 'minimal-bedroom', nameKey: 'presetMinimal' as const, styleId: 'minimalism', href: '/rooms' },
  { id: 'scandi-living', nameKey: 'presetScandi' as const, styleId: 'mediterranean_coastal', href: '/rooms' },
]

function usePresetCards(presets: PresetTeaser[]) {
  const t = useTranslations('home')

  if (presets.slice(0, 3).length === 3) {
    return presets.slice(0, 3).map(preset => {
      const colors = STYLE_CARD_COLORS[preset.style_id ?? ''] ?? {
        main: '#dce8e1',
        accent: '#9CA3AF',
      }
      return {
        id: preset.id,
        name: preset.name,
        href: `/studio?preset=${preset.id}`,
        wall: preset.room_config?.wallColor ?? colors.main,
        accent: colors.accent,
      }
    })
  }

  return FALLBACK_PRESETS.map(preset => {
    const colors = STYLE_CARD_COLORS[preset.styleId] ?? { main: '#dce8e1', accent: '#9CA3AF' }
    return {
      id: preset.id,
      name: t(preset.nameKey),
      href: preset.href,
      wall: colors.main,
      accent: colors.accent,
    }
  })
}

export default function CatalogMarquee() {
  const t = useTranslations('home')

  return (
    <section className="flex h-full min-h-0 flex-col justify-center pb-12 lg:pb-8">
      <div className="rm-page">
        <h2 className="rm-display text-[1.85rem] font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl lg:text-6xl">
          {t('catalogTitle')}
        </h2>

        <div className="rm-cat-rail mt-8 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:mt-14 lg:grid-cols-6">
          {CATEGORIES.map(item => (
            <Link key={item.key} href={item.href} className="rm-cat-item group">
              <div className="relative mx-auto aspect-square w-full max-w-[11rem]">
                <Image
                  src={item.image}
                  alt=""
                  fill
                  className="rm-cat-photo object-contain object-bottom"
                  sizes="180px"
                />
              </div>
              <span className="mt-4 block text-center text-sm font-bold text-[var(--rm-ink)] md:text-base">
                {t(item.key)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

export function CatalogPresets({ presets = [] }: { presets?: PresetTeaser[] }) {
  const t = useTranslations('home')
  const presetCards = usePresetCards(presets)

  return (
    <section className="flex h-full min-h-0 flex-col justify-center pb-12 lg:pb-8">
      <div className="rm-page">
        <h2 className="rm-display text-[1.85rem] font-bold tracking-tight text-[var(--rm-ink)] md:text-5xl lg:text-6xl">
          {t('presetsTitle')}
        </h2>

        <div className="rm-preset-rail mt-8 grid gap-6 md:grid-cols-3 lg:mt-10">
          {presetCards.map(card => (
            <a key={card.id} href={card.href} className="rm-preset-card group">
              <div
                className="aspect-[4/3] w-full"
                style={{
                  background: `linear-gradient(155deg, ${card.wall} 0%, ${card.accent}99 100%)`,
                }}
              />
              <div className="bg-white px-5 py-4">
                <div className="truncate text-base font-bold text-[var(--rm-ink)]">{card.name}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
