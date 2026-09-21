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
  {
    id: 'straight',
    label: 'Linéaire',
    prompt:
      'layout intention: keep a single-run kitchen on the wall(s) that already hold cabinets in this photo — do not add returns into empty floor',
  },
  {
    id: 'l',
    label: 'En L',
    prompt:
      'layout intention: L-shape ONLY if two walls already meet in this photo; wrap onto existing walls, never invent a new wing in empty space',
  },
  {
    id: 'u',
    label: 'En U',
    prompt:
      'layout intention: U-shape ONLY on walls already visible. If this kitchen is one run (with a table or TV in the rest of the room), KEEP that run — do not turn the dining area into more cabinets or a showroom U',
  },
  {
    id: 'island',
    label: 'Avec îlot',
    prompt:
      'layout intention: add an island only if the open floor in THIS photo can take one without deleting the table or shrinking the room',
  },
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
    prompt: 'refinish the existing cabinet doors in matte black, same boxes and sizes',
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
    prompt: 'replace the existing worktop with dark granite, subtle speckle, same depth and run',
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
    prompt: 'handleless existing cabinet doors, integrated j-pull or push-to-open — do not resize the cabinets',
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
  { id: 'drawers', label: 'Tiroirs', prompt: 'on the existing base run, prefer stacked drawers instead of cupboard doors' },
  { id: 'mix', label: 'Mixte', prompt: 'base run mixing doors and drawer banks' },
]

export const KITCHEN_UPPERS: KitchenPart[] = [
  { id: 'full', label: 'Rangée complète', prompt: 'keep or complete a row of wall cabinets along the SAME wall as the existing uppers' },
  { id: 'hob', label: 'Au-dessus du feu', prompt: 'wall cabinets only around the hob and hood, open shelves elsewhere' },
  { id: 'none', label: 'Aucun haut', prompt: 'no wall cabinets, open walls above the worktop' },
]

export const KITCHEN_TALL: KitchenPart[] = [
  { id: 'none', label: 'Aucune', prompt: 'no tall pantry or appliance towers' },
  { id: 'fridge', label: 'Colonne frigo', prompt: 'one tall fridge housing at the end of the run' },
  { id: 'oven', label: 'Colonne four', prompt: 'one tall oven tower at the end of the EXISTING run if there is room on that wall — do not place it in the middle of the room' },
  { id: 'both', label: 'Frigo + four', prompt: 'tall fridge housing and a separate oven tower' },
]

export const KITCHEN_ISLAND: KitchenPart[] = [
  { id: 'none', label: 'Pas d’îlot', prompt: 'no kitchen island, no peninsula, no extra block in the middle of the room' },
  {
    id: 'central',
    label: 'Îlot central sans assises',
    prompt: 'a central kitchen island used as a work surface only, no stools',
  },
  {
    id: 'central-seating',
    label: 'Îlot central + assises',
    prompt: 'a central kitchen island with bar stools on one side',
  },
  {
    id: 'bar',
    label: 'Îlot en bar avec assises',
    prompt: 'a breakfast-bar island or peninsula with stools along the bar side',
  },
]

export const KITCHEN_DISHWASHER: KitchenPart[] = [
  { id: 'none', label: 'Non', prompt: 'no dishwasher next to the sink' },
  { id: 'yes', label: 'Oui', prompt: 'an integrated dishwasher beside the sink' },
]

export const KITCHEN_DISHWASHER_SIDE: KitchenPart[] = [
  { id: 'left', label: 'À gauche de l’évier', prompt: 'dishwasher immediately to the left of the sink' },
  { id: 'right', label: 'À droite de l’évier', prompt: 'dishwasher immediately to the right of the sink' },
]

export const KITCHEN_GLASS: KitchenPart[] = [
  { id: 'none', label: 'Non', prompt: 'opaque cabinet fronts, no glass doors' },
  {
    id: 'elements',
    label: 'Dans les éléments',
    prompt: 'some wall cabinets with glass doors, a few plates and glasses visible inside',
  },
  {
    id: 'shelves',
    label: 'Étagères',
    prompt: 'open or glass shelves with a few random plates, bowls and glasses as styling',
  },
]

export const KITCHEN_UNDERLIGHT: KitchenPart[] = [
  { id: 'none', label: 'Non', prompt: 'no under-cabinet lighting' },
  {
    id: 'on',
    label: 'Oui',
    prompt: 'warm LED strip lighting under the wall cabinets, lighting the worktop',
  },
]

export const KITCHEN_HOODS: KitchenPart[] = [
  { id: 'visible', label: 'Visible', prompt: 'a visible chimney or statement hood over the hob' },
  { id: 'integrated', label: 'Intégrée', prompt: 'hood integrated into a wall cabinet on the existing run, discreet — not a new chimney in empty space' },
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
  { id: 'stone', label: 'Pierre', prompt: 'stone or matching-worktop splashback on the existing wall behind the run only' },
]

export const KITCHEN_CATEGORIES = ['Doors', 'Worktop', 'Handles', 'Hood'] as const

export function kitchenStyleLabel(id: KitchenStyleId) {
  return STYLE_LABEL_FR[id] ?? id
}

/** Finish language — never “build a Glamour apartment”. */
const KITCHEN_STYLE_FINISH: Record<KitchenStyleId, string> = {
  japandi: 'Japandi finish on these cabinets: quiet wood, soft edges, little clutter. Same home.',
  scandinavian: 'Scandinavian finish: light warm wood or paint, simple fronts. Same home.',
  minimalism: 'Minimal finish: flat doors, few objects. Same home — not an empty showroom.',
  industrial: 'Industrial finish: metal, darker wood, rawer splash. Same home.',
  rustic: 'Rustic finish: warmer wood grain, lived-in. Same home.',
  art_deco: 'Art Deco finish: a bit of geometry and shine on doors/handles only. Same home.',
  glamour:
    'Glamour as a FINISH on these cabinets only: deeper/darker fronts, richer stone, a little polish. Do not turn this into a vacant luxury listing, penthouse, or a different apartment.',
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
  dishwasher?: KitchenPart | null
  dishwasherSide?: KitchenPart | null
  glass?: KitchenPart | null
  underlight?: KitchenPart | null
  notes?: string | null
}) {
  const shape = kitchenShapeById(opts.shapeId)
  const notes = opts.notes?.trim()
  const dishwasher =
    opts.dishwasher?.id === 'yes'
      ? opts.dishwasherSide?.prompt ?? opts.dishwasher.prompt
      : opts.dishwasher?.prompt
  const underlight = opts.uppers?.id === 'none' ? null : opts.underlight?.prompt
  return [
    'SAME ROOM LOCK (non-negotiable): keep this exact apartment and camera.',
    'Keep the floor (pattern and colour), ceiling, windows, curtains, doors, wall clock, TV, dining table and chairs, and any furniture that is not a kitchen cabinet.',
    'Keep room size and wall positions. Do not invent a bigger empty flat, a glass wall, or a listing photo.',
    'Only restyle the EXISTING kitchen run: cabinet doors, worktop, splash, hood, handles, maybe one tall unit on that same wall.',
    KITCHEN_STYLE_FINISH[opts.styleId],
    shape?.prompt,
    opts.bases?.prompt,
    opts.uppers?.prompt,
    opts.tall?.prompt,
    opts.island?.prompt,
    opts.hood?.prompt,
    opts.sink?.prompt,
    dishwasher,
    opts.splash?.prompt,
    opts.glass?.prompt,
    underlight,
    opts.doors.prompt,
    opts.worktop.prompt,
    opts.handles?.prompt,
    notes ? `Client notes as visual intention only, not a measured plan: ${notes}` : null,
    'Keep sink and hob roughly where they already are in the photo.',
    'This is a look, not a technical kitchen plan. No millimetres, dimension overlays, or bill of quantities.',
    'Lived-in photoreal photo of THIS room, no people, no extra rooms.',
  ]
    .filter(Boolean)
    .join('. ')
}

export type KitchenTweakAction = 'move' | 'change' | 'add'

export type KitchenPin = { x: number; y: number }

export const KITCHEN_SUBJECTS = [
  { id: 'microwave', label: 'Micro-ondes', prompt: 'the built-in microwave' },
  { id: 'oven', label: 'Four', prompt: 'the oven' },
  { id: 'fridge', label: 'Frigo', prompt: 'the fridge housing' },
  { id: 'hood', label: 'Hotte', prompt: 'the hood' },
  { id: 'sink', label: 'Évier', prompt: 'the sink' },
  { id: 'dishwasher', label: 'Lave-vaisselle', prompt: 'the dishwasher' },
  { id: 'hob', label: 'Plaque', prompt: 'the hob or cooktop' },
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
  { id: 'underlight', label: 'LED sous les hauts', prompt: 'warm under-cabinet lighting on the worktop' },
  { id: 'glass', label: 'Vitrine', prompt: 'glass cabinet doors or shelves with a few plates visible' },
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
    'photoreal interior of THIS same room and camera — not a magazine empty kitchen',
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
    'photoreal interior of THIS same room and camera — not a magazine empty kitchen',
  ].join(' ')
}
