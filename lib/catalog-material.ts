export type CatalogMaterial =
  | 'wood'
  | 'metal'
  | 'fabric'
  | 'leather'
  | 'glass'
  | 'marble'
  | 'rattan'
  | 'other'

const CATEGORY_MATERIAL_DEFAULT: Partial<Record<string, CatalogMaterial>> = {
  Rug: 'fabric',
  Light: 'metal',
  Curtains: 'fabric',
  Sofa: 'fabric',
  Bed: 'wood',
  Chair: 'wood',
  Wardrobe: 'wood',
  'Coffee Table': 'wood',
  'Dining Table': 'wood',
  'Side Table': 'wood',
  'TV Unit': 'wood',
  Bookshelf: 'wood',
}

/** Infer primary material from free-text notes / keywords / category. */
export function inferCatalogMaterial(
  notes?: string | null,
  category?: string,
  imageKeyword?: string,
): CatalogMaterial | undefined {
  const text = `${notes ?? ''} ${imageKeyword ?? ''} ${category ?? ''}`.toLowerCase()

  if (/leather|cuir/.test(text)) return 'leather'
  if (/velvet|fabric|textile|linen|cotton|wool|berber|kilim|persian/.test(text)) return 'fabric'
  if (/marble|stone|tile|zellige|mosaic|concrete/.test(text)) return 'marble'
  if (/glass|crystal/.test(text)) return 'glass'
  if (/wicker|rattan|jute|reed|cane/.test(text)) return 'rattan'
  if (/metal|steel|iron|brass|copper|pipe|pendant/.test(text)) return 'metal'
  if (/wood|oak|walnut|timber|carved|driftwood/.test(text)) return 'wood'

  if (category && CATEGORY_MATERIAL_DEFAULT[category]) {
    return CATEGORY_MATERIAL_DEFAULT[category]
  }

  return undefined
}
