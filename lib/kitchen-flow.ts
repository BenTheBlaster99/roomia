import { STYLE_LABEL_FR } from '@/lib/quiz'
import { STYLE_VISUALS, styleHero, type StyleId } from '@/lib/style-details'

export const KITCHEN_STYLE_IDS = [
  'japandi',
  'scandinavian',
  'minimalism',
  'industrial',
  'rustic',
  'art_deco',
  'glamour',
] as const

export type KitchenStyleId = (typeof KITCHEN_STYLE_IDS)[number]

export const KITCHEN_SHAPES = [
  { id: 'straight', label: 'Linéaire', prompt: 'straight single-run kitchen along one wall, no island' },
  { id: 'l', label: 'En L', prompt: 'L-shaped kitchen along two walls, open corner, no island unless space clearly has one' },
  { id: 'u', label: 'En U', prompt: 'U-shaped kitchen wrapping three sides' },
  { id: 'island', label: 'Avec îlot', prompt: 'kitchen with a central island, seating on one side if the room allows' },
] as const

export type KitchenShapeId = (typeof KITCHEN_SHAPES)[number]['id']

export type KitchenSwatch = {
  id: string
  label: string
  hex: string
  image?: string
  prompt: string
}

export const KITCHEN_DOORS: KitchenSwatch[] = [
  {
    id: 'oak',
    label: 'Chêne clair',
    hex: '#D6C7AE',
    image: 'https://i.pinimg.com/736x/af/02/b7/af02b7f6e85cbfd0d33345543d1d9590.jpg',
    prompt: 'light oak wood cabinet doors, vertical grain, matte finish',
  },
  {
    id: 'walnut',
    label: 'Noyer',
    hex: '#5C4033',
    image: 'https://i.pinimg.com/736x/78/0c/99/780c9952d31dcea6a0b435d9508b743d.jpg',
    prompt: 'walnut wood cabinet doors, warm dark grain',
  },
  {
    id: 'white',
    label: 'Laqué blanc',
    hex: '#F4F1EA',
    image: 'https://i.pinimg.com/736x/5b/c9/9c/5bc99cad9446ace17596583d7a5a81b8.jpg',
    prompt: 'flat white lacquer cabinet doors, handleless or slim',
  },
  {
    id: 'sage',
    label: 'Vert sauge',
    hex: '#8FA08A',
    prompt: 'sage green painted shaker or flat cabinet doors',
  },
  {
    id: 'black',
    label: 'Noir mat',
    hex: '#1A1A1A',
    prompt: 'matte black cabinet doors, modern kitchen',
  },
]

export const KITCHEN_WORKTOPS: KitchenSwatch[] = [
  {
    id: 'marble',
    label: 'Marbre',
    hex: '#F0EEE8',
    image: 'https://i.pinimg.com/1200x/3d/ad/c8/3dadc895282042a8c36f529c464a23e6.jpg',
    prompt: 'honed light marble worktop',
  },
  {
    id: 'wood',
    label: 'Bois',
    hex: '#C4A574',
    image: 'https://i.pinimg.com/736x/bf/2b/3a/bf2b3a217f94e4ae78830b90c2e40ade.jpg',
    prompt: 'thick butcher-block wood worktop',
  },
  {
    id: 'concrete',
    label: 'Béton',
    hex: '#9B9B9B',
    image: 'https://i.pinimg.com/736x/57/dd/be/57ddbe68c3926d834ef26202b1e59fe3.jpg',
    prompt: 'smooth concrete or microcement worktop',
  },
  {
    id: 'granite',
    label: 'Granit',
    hex: '#4A4A4A',
    image: 'https://i.pinimg.com/1200x/59/18/91/59189163b9a577958961b2e712091264.jpg',
    prompt: 'dark granite worktop, subtle speckle',
  },
  {
    id: 'cream',
    label: 'Pierre claire',
    hex: '#E8E4DC',
    prompt: 'pale stone or quartz worktop, soft beige',
  },
]

export const KITCHEN_HANDLES: KitchenSwatch[] = [
  {
    id: 'integrated',
    label: 'Intégrées',
    hex: '#D6D3CC',
    prompt: 'handleless cabinets, integrated j-pull or push-to-open',
  },
  {
    id: 'brass',
    label: 'Laiton',
    hex: '#C9A227',
    image: 'https://i.pinimg.com/1200x/2b/69/ca/2b69ca14228195b9307a37d2508ce552.jpg',
    prompt: 'slim brass bar handles',
  },
  {
    id: 'black',
    label: 'Noir',
    hex: '#2A2A2A',
    image: 'https://i.pinimg.com/736x/c5/7c/a2/c57ca28d4c33aeb366ef9dc14295129c.jpg',
    prompt: 'matte black metal handles',
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hex: '#C8C8C4',
    image: 'https://i.pinimg.com/736x/44/15/eb/4415ebc69d75230c9b8d416847796da7.jpg',
    prompt: 'polished chrome handles',
  },
]

export type KitchenPart = {
  id: string
  label: string
  prompt: string
}

export const KITCHEN_BASES: KitchenPart[] = [
  { id: 'doors', label: 'Portes', prompt: 'base cabinets mostly with doors' },
  { id: 'drawers', label: 'Tiroirs', prompt: 'base cabinets mostly with stacked drawers' },
  { id: 'mix', label: 'Mixte', prompt: 'base run mixing doors and drawer banks' },
]

export const KITCHEN_UPPERS: KitchenPart[] = [
  { id: 'full', label: 'Rangée complète', prompt: 'a full row of wall cabinets' },
  { id: 'hob', label: 'Au-dessus du feu', prompt: 'wall cabinets only around the hob and hood, open shelves elsewhere' },
  { id: 'none', label: 'Aucun haut', prompt: 'no wall cabinets, open walls above the worktop' },
]

export const KITCHEN_TALL: KitchenPart[] = [
  { id: 'none', label: 'Aucune', prompt: 'no tall pantry or appliance towers' },
  { id: 'fridge', label: 'Colonne frigo', prompt: 'one tall fridge housing at the end of the run' },
  { id: 'oven', label: 'Colonne four', prompt: 'one tall oven tower with stacked ovens' },
  { id: 'both', label: 'Frigo + four', prompt: 'tall fridge housing and a separate oven tower' },
]

export const KITCHEN_ISLAND: KitchenPart[] = [
  { id: 'none', label: 'Pas d’îlot', prompt: 'no kitchen island' },
  { id: 'simple', label: 'Îlot simple', prompt: 'a simple work island without stools' },
  { id: 'seating', label: 'Îlot + assises', prompt: 'an island with seating on one side' },
]

export const KITCHEN_HOODS: KitchenPart[] = [
  { id: 'visible', label: 'Visible', prompt: 'a visible chimney or statement hood over the hob' },
  { id: 'integrated', label: 'Intégrée', prompt: 'hood integrated into a wall cabinet, discreet' },
  { id: 'none', label: 'Aucune', prompt: 'no visible hood' },
]

export const KITCHEN_SINKS: KitchenPart[] = [
  { id: 'run', label: 'Sur le linéaire', prompt: 'sink on the main run' },
  { id: 'window', label: 'Sous la fenêtre', prompt: 'sink under the window if a window exists' },
  { id: 'island', label: 'Sur l’îlot', prompt: 'sink on the island if an island is present, otherwise on the main run' },
]

export const KITCHEN_SPLASH: KitchenPart[] = [
  { id: 'none', label: 'Aucune', prompt: 'plain painted wall behind the worktop, no tile splashback' },
  { id: 'tile', label: 'Carrelage', prompt: 'tiled splashback behind the hob and sink' },
  { id: 'stone', label: 'Pierre', prompt: 'stone or matching-worktop splashback' },
]

export const KITCHEN_CATEGORIES = ['Doors', 'Worktop', 'Handles', 'Hood'] as const

export function kitchenStyleLabel(id: KitchenStyleId) {
  return STYLE_LABEL_FR[id] ?? id
}

export function kitchenStylePhoto(id: KitchenStyleId) {
  return styleHero(STYLE_VISUALS[id as StyleId])?.src
}

export function kitchenShapeById(id: KitchenShapeId) {
  return KITCHEN_SHAPES.find(s => s.id === id)
}

export function kitchenSwatchById(list: KitchenSwatch[], id: string | null) {
  return list.find(s => s.id === id) ?? null
}

export function kitchenPartById(list: KitchenPart[], id: string | null) {
  return list.find(p => p.id === id) ?? null
}

export function buildKitchenComposePrompt(opts: {
  styleId: KitchenStyleId
  shapeId: KitchenShapeId
  doors: KitchenSwatch
  worktop: KitchenSwatch
  handles: KitchenSwatch | null
  bases?: KitchenPart | null
  uppers?: KitchenPart | null
  tall?: KitchenPart | null
  island?: KitchenPart | null
  hood?: KitchenPart | null
  sink?: KitchenPart | null
  splash?: KitchenPart | null
  notes?: string | null
}) {
  const shape = kitchenShapeById(opts.shapeId)
  const styleName = kitchenStyleLabel(opts.styleId)
  const notes = opts.notes?.trim()
  return [
    `${styleName} kitchen restyle of the existing kitchen space`,
    shape?.prompt,
    opts.bases?.prompt,
    opts.uppers?.prompt,
    opts.tall?.prompt,
    opts.island?.prompt,
    opts.hood?.prompt,
    opts.sink?.prompt,
    opts.splash?.prompt,
    opts.doors.prompt,
    opts.worktop.prompt,
    opts.handles?.prompt,
    notes ? `Client notes to follow as visual intention only, not a measured plan: ${notes}` : null,
    'This is a look, not a technical kitchen plan. Do not invent dimensions, millimetres, or a bill of quantities.',
    'keep the room architecture, windows, and camera angle',
    'photoreal interior, no people, no extra rooms',
  ]
    .filter(Boolean)
    .join(', ')
}

export type KitchenTweakAction = 'move' | 'change' | 'add'

export type KitchenPin = { x: number; y: number }

export const KITCHEN_SUBJECTS = [
  { id: 'microwave', label: 'Micro-ondes', prompt: 'the built-in microwave' },
  { id: 'oven', label: 'Four', prompt: 'the oven' },
  { id: 'fridge', label: 'Frigo', prompt: 'the fridge housing' },
  { id: 'hood', label: 'Hotte', prompt: 'the hood' },
  { id: 'sink', label: 'Évier', prompt: 'the sink' },
  { id: 'tower', label: 'Colonne', prompt: 'the tall appliance tower' },
  { id: 'uppers', label: 'Hauts', prompt: 'the wall cabinets' },
  { id: 'island', label: 'Îlot', prompt: 'the island' },
] as const

export const KITCHEN_SIDES = [
  { id: 'left', label: 'À gauche', prompt: 'the left side of the kitchen run' },
  { id: 'right', label: 'À droite', prompt: 'the right side of the kitchen run' },
  { id: 'center', label: 'Au centre', prompt: 'the center of the kitchen' },
] as const

export const KITCHEN_ADDONS = [
  { id: 'stools', label: 'Tabourets', prompt: 'bar stools at the island or peninsula' },
  { id: 'plants', label: 'Plantes', prompt: 'a few small plants as styling' },
  { id: 'light', label: 'Éclairage', prompt: 'pendant or under-cabinet lighting' },
  { id: 'shelves', label: 'Étagères', prompt: 'open shelves instead of a closed patch' },
  { id: 'tap', label: 'Robinet', prompt: 'a more visible tap at the sink' },
  { id: 'splash', label: 'Crédence', prompt: 'a clearer splashback behind the hob and sink' },
] as const

export type KitchenTweak = {
  action: KitchenTweakAction
  subjectId: string | null
  addonId: string | null
  sideId: string | null
  from: KitchenPin | null
  to: KitchenPin | null
  detail: string
}

function kitchenPlacement(pin: KitchenPin) {
  const horiz = pin.x < 0.33 ? 'left' : pin.x > 0.66 ? 'right' : 'center'
  const vert = pin.y < 0.33 ? 'top' : pin.y > 0.66 ? 'bottom' : 'middle'
  return `${vert}-${horiz} of the photo (~${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%)`
}

export function kitchenTweakLabel(tweak: KitchenTweak, notes?: string) {
  const subject = KITCHEN_SUBJECTS.find(s => s.id === tweak.subjectId)?.label
  const addon = KITCHEN_ADDONS.find(a => a.id === tweak.addonId)?.label
  const side = KITCHEN_SIDES.find(s => s.id === tweak.sideId)?.label
  const extra = (notes ?? tweak.detail).trim()
  const pin =
    tweak.action === 'move'
      ? `Déplacer · ${subject ?? 'élément'} ${side ? `→ ${side}` : 'vers le nouveau point'}`
      : tweak.action === 'change'
        ? `Changer · ${subject ?? 'élément'}`
        : `Ajouter · ${addon ?? 'détail'}`
  return extra ? `${pin} · ${extra}` : pin
}

export function buildKitchenTweakPrompt(tweak: KitchenTweak, notes?: string) {
  const subject = KITCHEN_SUBJECTS.find(s => s.id === tweak.subjectId)
  const addon = KITCHEN_ADDONS.find(a => a.id === tweak.addonId)
  const side = KITCHEN_SIDES.find(s => s.id === tweak.sideId)
  const extra = (notes ?? tweak.detail).trim()
  const from = tweak.from ? kitchenPlacement(tweak.from) : null
  const to = tweak.to ? kitchenPlacement(tweak.to) : side?.prompt ?? null
  const what = subject?.prompt ?? 'the tapped kitchen element'

  const lines =
    tweak.action === 'move'
      ? [
          'Keep this exact kitchen look, same doors, worktop, handles, camera, and room.',
          `Visually move ${what}${from ? ` currently at ${from}` : ''} to ${to ?? 'a new natural place in this kitchen'}.`,
          'The old spot must become matching cabinets or worktop — not an empty hole.',
        ]
      : tweak.action === 'change'
        ? [
            'Keep this kitchen look. Only change the tapped element.',
            `At ${from ?? 'the tapped spot'}, change ${what}.`,
            extra ? null : 'Make that element clearer and better fitted to this kitchen.',
          ]
        : [
            'Keep this kitchen look. Add one layer only — do not redesign the kitchen.',
            `Add ${addon?.prompt ?? (extra || 'a small kitchen detail')} at ${from ?? 'the tapped spot'}.`,
          ]

  return [
    ...lines,
    extra ? `Also apply this extra visual intention in the same pass: ${extra}` : null,
    'Do both requests in one edit. Do not start a new kitchen.',
    'This is a look edit of the current image, not a technical kitchen plan.',
    'Do not invent millimetres, modules, or a bill of quantities.',
    'photoreal interior, same architecture and camera',
  ]
    .filter(Boolean)
    .join(' ')
}

export function buildKitchenRefinePrompt(notes: string) {
  const extra = notes.trim()
  return [
    'Keep this kitchen look. Apply only this visual intention, do not start a new kitchen.',
    extra ? `Client visual note: ${extra}` : 'Clarify the current composition slightly.',
    'This is a look edit, not a technical plan. Do not invent dimensions.',
    'photoreal interior, same architecture and camera',
  ].join(' ')
}
