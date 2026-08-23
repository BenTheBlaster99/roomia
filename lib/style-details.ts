export const FEATURED_STYLE_IDS = ['minimalism', 'scandinavian', 'industrial'] as const

export const STYLE_IDS = [
  'minimalism',
  'scandinavian',
  'industrial',
  'maximalism',
  'japandi',
  'contemporary',
  'traditional',
  'art_deco',
  'modern',
  'glamour',
  'mid_century',
  'rustic',
] as const

export type StyleId = (typeof STYLE_IDS)[number]

const photo = (id: string, width = 1400) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`

const texture = (id: string) => photo(id, 600)

const MATERIALS = {
  oak: texture('photo-1541123356219-364ad6512ce4'),
  linen: texture('photo-1522771739844-6a9f6d5f14af'),
  wool: texture('photo-1544966503-7cc5ac882d5f'),
  birch: texture('photo-1415886541506-5a87e078ef86'),
  concrete: texture('photo-1545324418-cc1a3fa10c00'),
  steel: texture('photo-1504328345606-18bbc8c9d7d1'),
  reclaimed: texture('photo-1475483768296-6163e08872a1'),
  velvet: texture('photo-1567016432779-094069958ea5'),
  brass: texture('photo-1615529328331-f8917597711f'),
  marble: texture('photo-1583845112203-29329902332b'),
  walnut: texture('photo-1600566753086-00f18fb6b3ea'),
  rattan: texture('photo-1600210492493-0943842fee16'),
  ceramic: texture('photo-1578749556568-bc2c40e68b61'),
  leather: texture('photo-1540574163024-580df3465d7d'),
  chrome: texture('photo-1558618666-fcd25c85f82e'),
  glass: texture('photo-1600607687644-c7171b42498f'),
  stone: texture('photo-1615876234886-fd9a39fda97f'),
  teak: texture('photo-1600210491892-03d54c0aaf87'),
  damask: texture('photo-1617103996702-96ff29b1c467'),
  lacquer: texture('photo-1617104678098-de229db33a38'),
} as const

export type StyleMaterial = {
  src: string
  labelKey: string
}

export type StyleVisual = {
  palette: string[]
  materials: StyleMaterial[]
  photos: {
    living: string
    bedroom: string
    kitchen: string
  }
}

const mat = (src: string, labelKey: string): StyleMaterial => ({ src, labelKey })

export const STYLE_VISUALS: Record<StyleId, StyleVisual> = {
  minimalism: {
    palette: ['#F5F0EB', '#E6D5C3', '#C9B8A4', '#8A6E52', '#2C2C2C'],
    materials: [
      mat('/styles/minimalism/oak.jpg', 'oak'),
      mat('/styles/minimalism/concrete.jpg', 'concrete'),
      mat('/styles/minimalism/linen.jpg', 'linen'),
      mat(MATERIALS.glass, 'glass'),
      mat(MATERIALS.steel, 'metal'),
    ],
    photos: {
      living: '/styles/minimalism/living.jpg',
      bedroom: '/styles/minimalism/bedroom.jpg',
      kitchen: '/styles/minimalism/kitchen.jpg',
    },
  },
  scandinavian: {
    palette: ['#F7F4EE', '#C9B99A', '#7D8B78'],
    materials: [mat(MATERIALS.birch, 'birch'), mat(MATERIALS.wool, 'wool'), mat(MATERIALS.linen, 'linen')],
    photos: {
      living: photo('photo-1616486338812-3dadae4b4ace'),
      bedroom: photo('photo-1616594039964-ae9021a400a0'),
      kitchen: photo('photo-1600585152220-90363fe7e115'),
    },
  },
  industrial: {
    palette: ['#2F2F2F', '#8B4A32', '#8A8680'],
    materials: [
      mat(MATERIALS.concrete, 'concrete'),
      mat(MATERIALS.steel, 'steel'),
      mat(MATERIALS.reclaimed, 'reclaimed'),
    ],
    photos: {
      living: photo('photo-1600607687939-ce8a6c25118c'),
      bedroom: photo('photo-1505691938895-1758d7afa779'),
      kitchen: photo('photo-1565538810643-b5bdb714032a'),
    },
  },
  maximalism: {
    palette: ['#6A1F2B', '#0F4C5C', '#C4A35A'],
    materials: [mat(MATERIALS.velvet, 'velvet'), mat(MATERIALS.brass, 'brass'), mat(MATERIALS.damask, 'damask')],
    photos: {
      living: photo('photo-1618220179428-22790b461013'),
      bedroom: photo('photo-1615874959474-d78a0a14c24c'),
      kitchen: photo('photo-1556909172-54557c7e22ad'),
    },
  },
  japandi: {
    palette: ['#EFE8DC', '#A89880', '#3F3A36'],
    materials: [mat(MATERIALS.oak, 'oak'), mat(MATERIALS.linen, 'linen'), mat(MATERIALS.ceramic, 'ceramic')],
    photos: {
      living: photo('photo-1600210492486-724fe5c67fb0'),
      bedroom: photo('photo-1616628188540-55586f63dbe7'),
      kitchen: photo('photo-1600585154340-be6161a56a0c'),
    },
  },
  contemporary: {
    palette: ['#E4DDD4', '#8C857C', '#3A3A3A'],
    materials: [mat(MATERIALS.walnut, 'walnut'), mat(MATERIALS.glass, 'glass'), mat(MATERIALS.marble, 'marble')],
    photos: {
      living: photo('photo-1618221195710-dd6b41faaea6'),
      bedroom: photo('photo-1631679706909-1844bbd8728c'),
      kitchen: photo('photo-1600566752355-35792bedcfea'),
    },
  },
  traditional: {
    palette: ['#F3E6D4', '#7A2E2A', '#C4A35A'],
    materials: [mat(MATERIALS.walnut, 'walnut'), mat(MATERIALS.damask, 'damask'), mat(MATERIALS.marble, 'marble')],
    photos: {
      living: photo('photo-1615529182854-04c803ada8c4'),
      bedroom: photo('photo-1616593969747-4797dc7029c0'),
      kitchen: photo('photo-1556912173-46c336c7fd55'),
    },
  },
  art_deco: {
    palette: ['#111111', '#0F5C4C', '#C6A15B'],
    materials: [mat(MATERIALS.lacquer, 'lacquer'), mat(MATERIALS.brass, 'brass'), mat(MATERIALS.marble, 'marble')],
    photos: {
      living: photo('photo-1600210491369-e753d80a41f3'),
      bedroom: photo('photo-1617104678098-de229db33a38'),
      kitchen: photo('photo-1600585154363-67af9c56e8e0'),
    },
  },
  modern: {
    palette: ['#F5F5F3', '#1A1A1A', '#C5C5C5'],
    materials: [mat(MATERIALS.chrome, 'chrome'), mat(MATERIALS.leather, 'leather'), mat(MATERIALS.glass, 'glass')],
    photos: {
      living: photo('photo-1600210491892-03d54c0aaf87'),
      bedroom: photo('photo-1560448204-e02f11c3d0e2'),
      kitchen: photo('photo-1556909114-44e3e70034e2'),
    },
  },
  glamour: {
    palette: ['#E8C9C1', '#1A1A1A', '#D4C4A8'],
    materials: [mat(MATERIALS.velvet, 'velvet'), mat(MATERIALS.marble, 'marble'), mat(MATERIALS.glass, 'glass')],
    photos: {
      living: photo('photo-1617103996702-96ff29b1c467'),
      bedroom: photo('photo-1615874959471-b2b8e546e77c'),
      kitchen: photo('photo-1600607687920-4e2a09cf159d'),
    },
  },
  mid_century: {
    palette: ['#C9A227', '#6B4F2A', '#6B7A4A'],
    materials: [mat(MATERIALS.teak, 'teak'), mat(MATERIALS.leather, 'leather'), mat(MATERIALS.walnut, 'walnut')],
    photos: {
      living: photo('photo-1555041469-a586c61ea9bc'),
      bedroom: photo('photo-1513694203232-719a280e022f'),
      kitchen: photo('photo-1556911220-e15b55be3345'),
    },
  },
  rustic: {
    palette: ['#C47848', '#F0E6D8', '#3D5A45'],
    materials: [mat(MATERIALS.reclaimed, 'reclaimed'), mat(MATERIALS.stone, 'stone'), mat(MATERIALS.linen, 'linen')],
    photos: {
      living: photo('photo-1600573472550-8090b5e0741e'),
      bedroom: photo('photo-1505691938895-1758d7afa779'),
      kitchen: photo('photo-1556909114-f6e7ad7d3136'),
    },
  },
}

export function isStyleId(value: string): value is StyleId {
  return (STYLE_IDS as readonly string[]).includes(value)
}

export type StyleTrait = {
  title: string
  body?: string
}

export function normalizeStyleTraits(raw: unknown): StyleTrait[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(item => {
      if (typeof item === 'string') return { title: item }
      if (item && typeof item === 'object' && 'title' in item) {
        const title = String((item as { title: unknown }).title)
        const body = (item as { body?: unknown }).body
        return { title, body: typeof body === 'string' ? body : undefined }
      }
      return null
    })
    .filter((item): item is StyleTrait => Boolean(item?.title))
}
