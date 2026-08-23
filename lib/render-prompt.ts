/** Port of roomia-ai-backend/models/prompt_builder.py build_render_prompt */

export function buildRenderPrompt(opts: {
  floorMaterial?: string
  wallColor?: string
  roomType?: string
}): { prompt: string; negative: string } {
  const parts = [
    'professional real estate interior photography, DSLR photo, 35mm lens',
    opts.roomType ? `furnished ${opts.roomType} interior` : 'furnished interior room',
  ]
  if (opts.floorMaterial) {
    parts.push(`real ${opts.floorMaterial} flooring with visible grain and texture`)
  }
  if (opts.wallColor) {
    parts.push(`walls painted ${opts.wallColor}`)
  }
  parts.push(
    'warm natural window light, soft realistic shadows, ' +
      'fabric and wood texture detail, cozy lived-in atmosphere, ' +
      'shot on Canon 5D, architectural digest style, ultra realistic, 8k, ' +
      'same furniture layout, same object positions and proportions, same camera angle',
  )

  const negative =
    'cartoon, 3d render, video game, cgi, low poly, flat colors, plastic, ' +
    'empty room, sparse, unrealistic, blurry, distorted, watermark, text, ' +
    'people, humans, deformed, floor grid, wireframe, ' +
    'changed furniture layout, different furniture, moved objects, ' +
    'different camera angle, extra furniture, missing furniture'

  return { prompt: parts.join(', '), negative }
}

/**
 * Soft furnishings may reshape to the masked footprint.
 * Rigid catalog products must keep exact product identity from the reference photo.
 */
export type ReferenceFidelity = 'strict' | 'placement_adaptive'

const PLACEMENT_ADAPTIVE_CATEGORIES = new Set(['Rug', 'Curtains'])

export function getReferenceFidelity(category?: string | null): ReferenceFidelity {
  if (category && PLACEMENT_ADAPTIVE_CATEGORIES.has(category)) {
    return 'placement_adaptive'
  }
  return 'strict'
}

export function buildComposeEditPrompt(opts: {
  catalogPrompt: string
  variationIndex: number
  hasReference: boolean
  fidelity: ReferenceFidelity
  category?: string | null
}): string {
  return buildMultiZoneComposePrompt({
    zones: [
      {
        catalogPrompt: opts.catalogPrompt,
        category: opts.category,
        fidelity: opts.fidelity,
        hasReference: opts.hasReference,
        referenceImageIndex: opts.hasReference ? 2 : null,
        x: 0.5,
        y: 0.5,
      },
    ],
    variationIndex: opts.variationIndex,
  })
}

export interface ComposeZonePromptInput {
  catalogPrompt: string
  category?: string | null
  fidelity: ReferenceFidelity
  hasReference: boolean
  /** 1-based index in the images[] array sent to GPT Image (room is always 1). */
  referenceImageIndex: number | null
  x: number
  y: number
  autoPlace?: boolean
}

export interface ComposeAtmosphere {
  wall?: { prompt: string; x: number; y: number }
  lighting?: {
    prompt: string
    kind: string
    x: number
    y: number
    hasReference: boolean
    referenceImageIndex: number | null
  }
}

/** One GPT Image call for all pins — keeps API usage at exactly N variations. */
export function buildMultiZoneComposePrompt(opts: {
  zones: ComposeZonePromptInput[]
  variationIndex: number
  atmosphere?: ComposeAtmosphere | null
}): string {
  const hasRestyle = Boolean(opts.atmosphere?.wall || opts.atmosphere?.lighting)
  const variationHints = hasRestyle
    ? [
        'Variation A: slightly warmer evening interior light; products and wall color stay identical.',
        'Variation B: slightly cooler daylight through the windows; products and wall color stay identical.',
        'Variation C: slightly softer shadows; products and wall color stay identical.',
        'Variation D: slightly richer contrast; products and wall color stay identical.',
      ]
    : [
        'Variation A: only change ambient room light slightly; furniture products must stay identical.',
        'Variation B: only change ambient room light slightly warmer; furniture products must stay identical.',
        'Variation C: only change ambient room light slightly cooler; furniture products must stay identical.',
        'Variation D: only change soft room shadows; furniture products must stay identical.',
      ]
  const hint = variationHints[opts.variationIndex % variationHints.length]

  const placement = (x: number, y: number) => {
    const horiz = x < 0.33 ? 'left' : x > 0.66 ? 'right' : 'center'
    const vert = y < 0.33 ? 'top' : y > 0.66 ? 'bottom' : 'middle'
    return `${vert}-${horiz} of the photo (click ~${Math.round(x * 100)}%, ${Math.round(y * 100)}%)`
  }

  const itemLines = opts.zones.map((z, i) => {
    const cat = z.category?.trim() || 'furniture'
    const ref =
      z.hasReference && z.referenceImageIndex
        ? `Use image ${z.referenceImageIndex} as the exact product reference.`
        : 'No product photo — follow the text description only.'
    const fidelity =
      z.fidelity === 'placement_adaptive'
        ? 'May adapt fold/orientation to fit the mask, but keep the same product design.'
        : 'STRICT identity lock to the reference (same model, materials, colors). Only perspective/scale/lighting may change.'
    const where = z.autoPlace
      ? `Place this ${cat} in the best professional interior-design location for this room (the click at ${placement(z.x, z.y)} is only a hint). Prefer the natural designer spot: sofa against the main seating wall, rug under the seating group, coffee table in front of the sofa, dining table centered in the dining zone, wardrobe on a side wall, pendant/chandelier on the ceiling.`
      : `at ${placement(z.x, z.y)}`
    return `Item ${i + 1} (${cat}) ${where}: ${z.catalogPrompt}. ${ref} ${fidelity}`
  })

  const restyle: string[] = []
  if (opts.atmosphere?.wall) {
    restyle.push(
      `WALLS: repaint the masked wall surfaces to ${opts.atmosphere.wall.prompt} (tap at ${placement(opts.atmosphere.wall.x, opts.atmosphere.wall.y)}). Keep windows, doors, mouldings, and floor. The wall color change must be obvious.`,
    )
  }
  if (opts.atmosphere?.lighting) {
    const L = opts.atmosphere.lighting
    const ref =
      L.hasReference && L.referenceImageIndex
        ? `Use image ${L.referenceImageIndex} as the exact lighting product.`
        : 'Invent a photoreal fixture that matches the description.'
    restyle.push(
      `LIGHTING (${L.kind}) at ${placement(L.x, L.y)}: ${L.prompt}. ${ref} The fixture is ON with a believable glow and new contact shadows. The room must feel newly lit — not the original empty lighting.`,
    )
  }

  const lines = [
    'Edit the room photo (image 1). Transparent mask areas are the regions to change.',
    hasRestyle
      ? 'This is a full interior restyle: the result must look like a redesigned space, still the same room and camera.'
      : `Replace every masked furniture region in ONE pass with these ${opts.zones.length} item(s):`,
  ]
  if (restyle.length > 0) {
    lines.push('ROOM RESTYLE (must be clearly visible — this is the wow):', ...restyle)
  }
  if (itemLines.length > 0) {
    lines.push(
      `FURNITURE (${itemLines.length}) — map each product to the masked blob nearest its click:`,
      ...itemLines,
      'Do not redesign, recolor, or invent different catalog products.',
    )
  }
  lines.push(
    'Keep camera angle, window views, and unmasked architecture. Photoreal interior photography, correct perspective, seamless shadows.',
    hint,
  )
  return lines.join(' ')
}
