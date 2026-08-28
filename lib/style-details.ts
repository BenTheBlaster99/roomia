export const FEATURED_STYLE_IDS = ['art_deco', 'japandi', 'industrial'] as const

export const STYLE_IDS = [
  'art_deco',
  'bauhaus',
  'bohemian',
  'contemporary',
  'cottagecore',
  'exotic',
  'glamour',
  'high_tech',
  'industrial',
  'japandi',
  'maximalism',
  'minimalism',
  'pop_art',
  'rustic',
  'scandinavian',
  'traditional',
  'vintage',
  'international',
  'modern',
  'de_stijl',
] as const

export type StyleId = (typeof STYLE_IDS)[number]

const photo = (id: string, width = 1400) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`

const texture = (id: string) => photo(id, 600)

const FALLBACK = {
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
  ceramic: texture('photo-1578749556568-bc2c40e68b61'),
  leather: texture('photo-1540574163024-580df3465d7d'),
  chrome: texture('photo-1558618666-fcd25c85f82e'),
  glass: texture('photo-1600607687644-c7171b42498f'),
  stone: texture('photo-1615876234886-fd9a39fda97f'),
  damask: texture('photo-1617103996702-96ff29b1c467'),
} as const

/** Shared texture photos from Sarah’s Styles v2 sheet. */
const TX = {
  wood: 'https://i.pinimg.com/736x/bf/2b/3a/bf2b3a217f94e4ae78830b90c2e40ade.jpg',
  marble: 'https://i.pinimg.com/1200x/3d/ad/c8/3dadc895282042a8c36f529c464a23e6.jpg',
  chrome: 'https://i.pinimg.com/736x/44/15/eb/4415ebc69d75230c9b8d416847796da7.jpg',
  lacquer: 'https://i.pinimg.com/736x/5b/c9/9c/5bc99cad9446ace17596583d7a5a81b8.jpg',
  velvet: 'https://i.pinimg.com/736x/11/34/33/1134337e7ae131764827db470d17d4c7.jpg',
  brass: 'https://i.pinimg.com/1200x/2b/69/ca/2b69ca14228195b9307a37d2508ce552.jpg',
  glass: 'https://i.pinimg.com/736x/80/c2/6d/80c26d0467d16bc17b99d9c4e1c8adaf.jpg',
  mirror: 'https://i.pinimg.com/736x/95/7c/71/957c71d1b47cfe63cde37e792ae493a5.jpg',
  wallpaper: 'https://i.pinimg.com/736x/ea/21/53/ea21532574f098a77d0e0a938cf01fdc.jpg',
  leather: 'https://i.pinimg.com/736x/b2/ce/5d/b2ce5d758e48f00b2857e2459f97dd3d.jpg',
  concrete: 'https://i.pinimg.com/736x/57/dd/be/57ddbe68c3926d834ef26202b1e59fe3.jpg',
  plywood: 'https://i.pinimg.com/1200x/be/d0/73/bed0735e54f441c837b46de5c96f2b53.jpg',
  rattan: 'https://i.pinimg.com/736x/08/c2/3b/08c23b1884d3f1e76e75230e11ea2a80.jpg',
  fibers: 'https://i.pinimg.com/736x/82/e4/06/82e4062cd80d7bb113a7b448117b4b51.jpg',
  ceramic: 'https://i.pinimg.com/736x/66/ad/1e/66ad1eda009560995d7c772ffb88f36c.jpg',
  stone: 'https://i.pinimg.com/1200x/05/01/da/0501da1b8eba4a004708268bc34d403b.jpg',
  iron: 'https://i.pinimg.com/736x/29/ff/c0/29ffc01593c6cbb4e79f753007bd5dd5.jpg',
  wicker: 'https://i.pinimg.com/736x/9a/77/92/9a77923bba88ca744c58b1f3970e25a1.jpg',
  cottagePaper: 'https://i.pinimg.com/1200x/54/38/54/543854b889fe50f7d7111c66ff8da368.jpg',
  bamboo: 'https://i.pinimg.com/736x/83/9c/5a/839c5a500fc77f7babf4434e27505b06.jpg',
  prints: 'https://i.pinimg.com/1200x/2f/3b/c5/2f3bc590766964cd0555a545651c1204.jpg',
  lacqueredWood: 'https://i.pinimg.com/736x/5a/45/48/5a4548f4639abac40510f85df9dbdc28.jpg',
  refined: 'https://i.pinimg.com/736x/77/e6/a8/77e6a8cddb6dfc5667cfe0ef204f49dd.jpg',
  steel: 'https://i.pinimg.com/1200x/be/53/34/be53349e92013dd91ffdb23ff2f6b22d.jpg',
  brick: 'https://i.pinimg.com/1200x/99/bd/e2/99bde263f64af63f0108225ab94ed3ba.jpg',
  darkWood: 'https://i.pinimg.com/736x/59/cf/7a/59cf7a9653444740a494c2f0eb542770.jpg',
  bronze: 'https://i.pinimg.com/1200x/55/a8/87/55a88772610261ff869ed4a066146ef6.jpg',
  copper: 'https://i.pinimg.com/736x/8f/39/62/8f39627a40c20697954d06f297f02462.jpg',
  polishedWood:
    'https://png.pngtree.com/background/20250108/original/pngtree-exquisite-wooden-grain-captivating-natural-dark-brown-wood-texture-with-oak-picture-image_15129097.jpg',
} as const

export type StyleMaterial = {
  src: string | null
  labelKey: string
}

export type StylePhoto = {
  src: string
  kind?: string
}

export type StyleVisual = {
  palette: string[]
  materials: StyleMaterial[]
  photos: StylePhoto[]
}

const mat = (labelKey: string, src: string | null): StyleMaterial => ({ labelKey, src })
const pic = (src: string, kind?: string): StylePhoto => (kind ? { src, kind } : { src })

const EMPTY: StyleVisual = { palette: [], materials: [], photos: [] }

const unsplashSheet = (
  palette: string[],
  materials: StyleMaterial[],
  living: string,
  bedroom: string,
  kitchen: string,
): StyleVisual => ({
  palette,
  materials,
  photos: [pic(living), pic(bedroom), pic(kitchen)],
})

export const STYLE_VISUALS: Record<StyleId, StyleVisual> = {
  art_deco: {
    palette: ['#F2E8D5', '#0D0D0D', '#1C3A3A', '#DDA28F', '#6B1E3F', '#7D2826', '#232935', '#C9A227'],
    materials: [
      mat('polished_wood', TX.polishedWood),
      mat('marble', TX.marble),
      mat('leather', TX.leather),
      mat('chrome', TX.chrome),
      mat('lacquer', TX.lacquer),
      mat('velvet', TX.velvet),
      mat('brass', TX.brass),
      mat('glass', TX.glass),
      mat('mirror', TX.mirror),
      mat('wallpaper', TX.wallpaper),
    ],
    photos: [
      pic('https://i.pinimg.com/1200x/e8/9f/c2/e89fc2064bb74b6f9818be9ccd021334.jpg'),
      pic('https://i.pinimg.com/736x/cf/86/ee/cf86ee96d0efb269375ee8c725ddb0ba.jpg'),
      pic('https://i.pinimg.com/736x/07/f4/72/07f4723ea54a7e74f23fc46cbd1b758b.jpg'),
      pic('https://i.pinimg.com/1200x/69/e1/5b/69e15baa284aa8e374f0a07313952222.jpg'),
      pic('https://i.pinimg.com/736x/06/f0/cb/06f0cbf6cf61f6f69678033e308f9351.jpg'),
      pic('https://i.pinimg.com/736x/5c/1f/9d/5c1f9d96c1b43a3cbd4a414f5bb9e26c.jpg'),
      pic('https://i.pinimg.com/1200x/dd/f7/ca/ddf7ca130e70ad1e0961bae1ed6ac56a.jpg'),
    ],
  },
  bauhaus: {
    palette: ['#F5F1E8', '#1A1A1A', '#8C5A3C', '#D7261E', '#F2C230', '#1455A0', '#6F98C1', '#0D6348'],
    materials: [
      mat('tubular_steel', null),
      mat('glass', TX.glass),
      mat('concrete', TX.concrete),
      mat('plywood', TX.plywood),
      mat('leather', TX.leather),
      mat('chrome', TX.chrome),
      mat('wood', TX.wood),
    ],
    photos: [
      pic('https://cdn.itsoverflowing.com/wp-content/uploads/2026/05/Functional-Furniture-DesignOne.jpg'),
      pic('https://i.pinimg.com/736x/92/62/6e/92626e74430d4297069fff4713066673.jpg'),
      pic('https://i.pinimg.com/736x/07/dd/e2/07dde2f7a574d909a809a5fa2af6c16e.jpg'),
      pic('https://florgeous.com/wp-content/uploads/2024/07/bauhaus-guest-bedroom-idea-1024x1024.jpg'),
      pic(
        'https://cdn.prod.website-files.com/64ff4af0c17a2fc91280f149/678da22b07aa363b4c3484b0_678d911a8064ce7ba09f2580_29%2520Luxurious%2520Mid-Century%2520Modern%2520Decor%2520Ideas%2520for%2520Sophisticated%2520Spaces.jpeg',
      ),
      pic(
        'https://cdn.prod.website-files.com/64ff4af0c17a2fc91280f149/67899e9cbd7123c8b8f4a2d9_67899e6f193e03c3c6b6e081_The%2520Evolution%2520of%2520Modernist%2520Furniture_%2520Bauhaus%2520example%2520Brno%2520villa.jpeg',
      ),
      pic('https://cdn.itsoverflowing.com/wp-content/uploads/2026/05/Abstract-Art-Incorporation.jpg'),
    ],
  },
  bohemian: {
    palette: ['#FFFFFF', '#E8D5B5', '#F3E9D2', '#A67C52', '#8C5A3C', '#DB932E', '#C65D3B', '#6B705C'],
    materials: [
      mat('wood', TX.wood),
      mat('rattan', TX.rattan),
      mat('natural_fibers', TX.fibers),
      mat('leather', TX.leather),
      mat('ceramic', TX.ceramic),
    ],
    photos: [
      pic('https://i.pinimg.com/1200x/16/81/b9/1681b9c620c9a27c7df09ceb57bb1360.jpg'),
      pic('https://i.pinimg.com/1200x/85/af/0a/85af0a933965655bb9449806dde799e4.jpg'),
      pic('https://i.pinimg.com/736x/8a/f5/85/8af5857753927b8fdc5fd0b36ee54354.jpg'),
      pic('https://i.pinimg.com/1200x/e4/b6/79/e4b679083eb95aa30386eadfcd8791dd.jpg'),
      pic('https://i.pinimg.com/1200x/10/b0/3e/10b03e8f0cdda83997cc59e86f4345d4.jpg'),
      pic('https://i.pinimg.com/736x/05/18/6d/05186daebd1d68e87a4b0fc26396ed19.jpg'),
      pic('https://i.pinimg.com/1200x/b1/08/f0/b108f063ce684bba68b49c0cf3f69a5a.jpg'),
    ],
  },
  contemporary: unsplashSheet(
    ['#E4DDD4', '#8C857C', '#3A3A3A'],
    [mat('walnut', FALLBACK.walnut), mat('glass', FALLBACK.glass), mat('marble', FALLBACK.marble)],
    photo('photo-1618221195710-dd6b41faaea6'),
    photo('photo-1631679706909-1844bbd8728c'),
    photo('photo-1600566752355-35792bedcfea'),
  ),
  cottagecore: {
    palette: ['#F4EBDD', '#D8C7A8', '#A9B59A', '#C98F8F', '#F4D6D4', '#7A8FA6', '#B88652', '#FBB59B'],
    materials: [
      mat('wood', TX.wood),
      mat('stone', TX.stone),
      mat('ceramic', TX.ceramic),
      mat('wrought_iron', TX.iron),
      mat('rattan', TX.rattan),
      mat('wicker', TX.wicker),
      mat('natural_fibers', TX.fibers),
      mat('wallpaper', TX.cottagePaper),
    ],
    photos: [
      pic(
        'https://www.thespruce.com/thmb/p-L1WGRJe4oY43mhGi82cmtlM_s=/750x0/filters:no_upscale():max_bytes(150000):strip_icc():format(webp)/20230117_BeccaInteriors-282-min-6724dc3ef4274f4fa5951eefe8c495a8.jpg',
      ),
      pic(
        'https://www.thespruce.com/thmb/e_JCPmD8RQU1njH8QREKndJh6to=/750x0/filters:no_upscale():max_bytes(150000):strip_icc():format(webp)/258105_fe0f1213dfed4b368e3e1008c9bc9528mv2-3cbe5fe7132d4fd9b73c2b1bf3c4c729.jpeg',
      ),
      pic(
        'https://hips.hearstapps.com/hmg-prod/images/hbx050123napiers-002-preview-642dc8078857e.jpg?crop=1.00xw:0.751xh;0,0.218xh&resize=1120:*',
      ),
      pic('https://i.pinimg.com/1200x/7e/0c/8c/7e0c8cbef9f3a961249c2393b7ff17cb.jpg'),
      pic(
        'https://media.abiinteriors.com/8266KQUL/at/8qch47rstbx8qgxstvjvrxh/Cottagecore-Powder-Room-Printed-Wallpaper-Vintage-Mirror-Artwork.jpg?format=webp&width=1040',
      ),
      pic(
        'https://media.abiinteriors.com/8266KQUL/at/s3cxc3fqn6k2cghqmfxjwb4/Cottagecore-Bedroom-Vj-Panneling-Walls-Timber-Drawers-Floral-Bedding-Vintage-Curtains.jpg?format=webp&width=1040',
      ),
      pic('https://i.pinimg.com/736x/df/b7/53/dfb753ea5b170ce5f0f49e57a4589ae3.jpg'),
    ],
  },
  exotic: {
    palette: ['#D9B48F', '#A85D3B', '#386641', '#D4A72C', '#176B87', '#8C3F5D', '#BA3E04'],
    materials: [
      mat('wood', TX.wood),
      mat('stone', TX.stone),
      mat('ceramic', TX.ceramic),
      mat('natural_fibers', TX.fibers),
      mat('rattan', TX.rattan),
      mat('bamboo', TX.bamboo),
      mat('printed_fabrics', TX.prints),
    ],
    photos: [
      pic('https://i.pinimg.com/1200x/a4/ce/61/a4ce61ddc4e67658c152f843272777fd.jpg'),
      pic('https://i.pinimg.com/1200x/cf/b5/04/cfb504e52ad95f31438561ecb35b8342.jpg'),
      pic('https://i.pinimg.com/736x/98/2f/ba/982fbacd337b1066b8f87df4ad2f0832.jpg'),
      pic('https://i.pinimg.com/1200x/02/e8/42/02e842ca586c10e06c8b1005ed510129.jpg'),
      pic('https://i.pinimg.com/736x/34/d3/83/34d383db306647a1aa6d70b0f30e7d53.jpg'),
      pic('https://i.pinimg.com/736x/a3/6d/84/a36d8474ab2bd0c1ba1ef6dca0a71034.jpg'),
      pic('https://i.pinimg.com/1200x/af/5a/cb/af5acbda3202620849a64d9e4c7ec81e.jpg'),
    ],
  },
  glamour: {
    palette: ['#F5EFE6', '#1A1818', '#D8C7A8', '#F4D6D4', '#B76E79', '#34495E', '#00381F', '#C9A227'],
    materials: [
      mat('velvet', TX.velvet),
      mat('marble', TX.marble),
      mat('glass', TX.glass),
      mat('mirror', TX.mirror),
      mat('chrome', TX.chrome),
      mat('brass', TX.brass),
      mat('lacquered_wood', TX.lacqueredWood),
      mat('refined_fabrics', TX.refined),
    ],
    photos: [],
  },
  high_tech: {
    palette: ['#F2F3F4', '#9EA3A8', '#181A1B', '#4A90A4', '#6E7B83'],
    materials: [
      mat('steel', TX.steel),
      mat('aluminum', TX.chrome),
      mat('plastic', null),
      mat('concrete', TX.concrete),
      mat('glass', TX.glass),
      mat('glossy', TX.lacquer),
    ],
    photos: [
      pic('https://i.pinimg.com/1200x/b9/34/fa/b934fab7ab93a953f8f625e0cfa20933.jpg'),
      pic('https://i.pinimg.com/1200x/f1/e0/76/f1e07632901f0b0eea6f77f0967654d5.jpg'),
      pic('https://miro.medium.com/v2/resize:fit:2000/format:webp/1*YslSynFBEsk8vICgYkFefg.jpeg'),
      pic('https://naryafoto.com/wp-content/uploads/2022/02/4.jpg'),
    ],
  },
  industrial: {
    palette: ['#292929', '#706B63', '#8A5A3B', '#A63D2F', '#B07A3A', '#D0C7B8'],
    materials: [
      mat('concrete', TX.concrete),
      mat('brick', TX.brick),
      mat('dark_wood', TX.darkWood),
      mat('steel', TX.steel),
      mat('leather', TX.leather),
    ],
    photos: [
      pic('https://i.pinimg.com/1200x/61/bd/85/61bd8512458b966baf191521d1bc6331.jpg'),
      pic('https://i.pinimg.com/1200x/ed/ba/d3/edbad3c5ef86ad1c0a6ccd828f328c0b.jpg'),
      pic('https://i.pinimg.com/1200x/c9/9a/6f/c99a6fbc8d9ce5fabd2874c4f3380aaa.jpg'),
      pic('https://i.pinimg.com/736x/05/6c/e0/056ce0429802e2097ee6015b749d6d8e.jpg'),
      pic('https://i.pinimg.com/736x/4b/82/2d/4b822d9654ce5e11312e610663321f5e.jpg'),
      pic(
        'https://media.abiinteriors.com/8266KQUL/at/kws5rgh554qtr2m6mb6ph/Industrial_Interior_Design_Brick_Exposed_Wall.jpg?format=webp&width=1040',
      ),
    ],
  },
  japandi: {
    palette: ['#F1EDE3', '#D6C7AE', '#8B7355', '#5F6B55', '#2E302C', '#A68A64'],
    materials: [
      mat('warm_light_wood', TX.wood),
      mat('warm_dark_wood', TX.darkWood),
      mat('stone', TX.stone),
      mat('artisan_ceramic', TX.ceramic),
      mat('natural_fibers', TX.fibers),
      mat('brass', TX.brass),
      mat('bronze', TX.bronze),
      mat('untreated_copper', TX.copper),
    ],
    photos: [
      pic(
        'https://interiordesign.net/wp-content/uploads/2024/10/Interior-Design-The-Rasidence-Studio-Right-Angle-the-rasidence-10.jpg',
      ),
      pic('https://interiordesign.net/wp-content/uploads/2025/06/InteriorDesign_KipsBayTowers-2.jpg'),
      pic('https://interiordesign.net/wp-content/uploads/2025/03/idx250401_RoisinLaffert09.jpg'),
      pic('https://interiordesign.net/wp-content/uploads/2022/06/Interior-Design-OWIU-Los-Angeles-99220558-189.jpg'),
      pic('https://i.pinimg.com/736x/24/89/a5/2489a5b9114acf82e476d723b0b4e074.jpg'),
      pic('https://i.pinimg.com/1200x/86/f4/a4/86f4a4d2a4e873b78c75e23eb432af44.jpg'),
      pic('https://i.pinimg.com/736x/f6/ee/64/f6ee64aa3b529211ccc6a6dc8b23863a.jpg'),
      pic('https://i.pinimg.com/1200x/cf/1a/26/cf1a2623a5da82fb0b4408689ef02f26.jpg'),
      pic('https://i.pinimg.com/736x/f4/08/93/f40893895b099f6844e3003b97179d1d.jpg'),
      pic('https://i.pinimg.com/736x/ec/c4/b6/ecc4b65e3261c4c1b5adbe56448ed35e.jpg'),
    ],
  },
  maximalism: unsplashSheet(
    ['#6A1F2B', '#0F4C5C', '#C4A35A'],
    [mat('velvet', FALLBACK.velvet), mat('brass', FALLBACK.brass), mat('damask', FALLBACK.damask)],
    photo('photo-1618220179428-22790b461013'),
    photo('photo-1615874959474-d78a0a14c24c'),
    photo('photo-1556909172-54557c7e22ad'),
  ),
  minimalism: {
    palette: ['#F5F0EB', '#E6D5C3', '#C9B8A4', '#8A6E52', '#2C2C2C'],
    materials: [
      mat('oak', '/styles/minimalism/oak.jpg'),
      mat('concrete', '/styles/minimalism/concrete.jpg'),
      mat('linen', '/styles/minimalism/linen.jpg'),
      mat('glass', FALLBACK.glass),
      mat('metal', FALLBACK.steel),
    ],
    photos: [
      pic('/styles/minimalism/living.jpg'),
      pic('/styles/minimalism/bedroom.jpg'),
      pic('/styles/minimalism/kitchen.jpg'),
    ],
  },
  pop_art: EMPTY,
  rustic: unsplashSheet(
    ['#C47848', '#F0E6D8', '#3D5A45'],
    [mat('reclaimed', FALLBACK.reclaimed), mat('stone', FALLBACK.stone), mat('linen', FALLBACK.linen)],
    photo('photo-1600573472550-8090b5e0741e'),
    photo('photo-1505691938895-1758d7afa779'),
    photo('photo-1556909114-f6e7ad7d3136'),
  ),
  scandinavian: unsplashSheet(
    ['#F7F4EE', '#C9B99A', '#7D8B78'],
    [mat('birch', FALLBACK.birch), mat('wool', FALLBACK.wool), mat('linen', FALLBACK.linen)],
    photo('photo-1616486338812-3dadae4b4ace'),
    photo('photo-1616594039964-ae9021a400a0'),
    photo('photo-1600585152220-90363fe7e115'),
  ),
  traditional: unsplashSheet(
    ['#F3E6D4', '#7A2E2A', '#C4A35A'],
    [mat('walnut', FALLBACK.walnut), mat('damask', FALLBACK.damask), mat('marble', FALLBACK.marble)],
    photo('photo-1615529182854-04c803ada8c4'),
    photo('photo-1616593969747-4797dc7029c0'),
    photo('photo-1556912173-46c336c7fd55'),
  ),
  vintage: EMPTY,
  international: EMPTY,
  modern: unsplashSheet(
    ['#F5F5F3', '#1A1A1A', '#C5C5C5'],
    [mat('chrome', FALLBACK.chrome), mat('leather', FALLBACK.leather), mat('glass', FALLBACK.glass)],
    photo('photo-1600210491892-03d54c0aaf87'),
    photo('photo-1560448204-e02f11c3d0e2'),
    photo('photo-1556909114-44e3e70034e2'),
  ),
  de_stijl: EMPTY,
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

export function normalizeStyleMotifs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(item => String(item).trim()).filter(Boolean)
}
