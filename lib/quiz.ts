import { isStyleId, STYLE_VISUALS, styleHero, type StyleId } from '@/lib/style-details'

export const QUIZ_STYLE_IDS = [
  'art_deco',
  'bauhaus',
  'bohemian',
  'cottagecore',
  'exotic',
  'glamour',
  'industrial',
  'japandi',
  'maximalism',
  'minimalism',
  'rustic',
  'scandinavian',
] as const

export type QuizStyleId = (typeof QUIZ_STYLE_IDS)[number]
export type DensityId = 'empty' | 'chosen' | 'rich'
export type QuizRoomId = 'living' | 'bedroom' | 'office'
export type QuizAnswers = Record<string, string>

type ScoreMap = Partial<Record<QuizStyleId, number>>

export type QuizOption = {
  id: string
  image?: string
  swatches?: string[]
  scores?: ScoreMap
  density?: DensityId
  room?: QuizRoomId
}

export type QuizQuestion = {
  id: string
  titleKey: string
  layout: 'list' | 'visual' | 'room'
  options: QuizOption[]
}

function hero(id: StyleId) {
  return styleHero(STYLE_VISUALS[id])?.src
}

function material(id: StyleId, index = 0) {
  return STYLE_VISUALS[id].materials[index]?.src ?? hero(id)
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'density',
    titleKey: 'qDensity',
    layout: 'list',
    options: [
      {
        id: 'empty',
        density: 'empty',
        scores: { minimalism: 3, bauhaus: 2, japandi: 2, scandinavian: 1 },
      },
      {
        id: 'chosen',
        density: 'chosen',
        scores: { japandi: 3, scandinavian: 2, industrial: 1, rustic: 1, bauhaus: 1 },
      },
      {
        id: 'rich',
        density: 'rich',
        scores: { maximalism: 3, bohemian: 2, glamour: 2, art_deco: 2, exotic: 1, cottagecore: 1 },
      },
    ],
  },
  {
    id: 'color',
    titleKey: 'qColor',
    layout: 'visual',
    options: [
      {
        id: 'pale',
        image: hero('scandinavian'),
        swatches: ['#F7F5F0', '#E2DDD3', '#C8C8C4'],
        scores: { scandinavian: 3, japandi: 2, minimalism: 2, cottagecore: 1 },
      },
      {
        id: 'earth',
        image: hero('rustic'),
        swatches: ['#F0E5D0', '#8B6F47', '#B85C38'],
        scores: { rustic: 3, exotic: 2, bohemian: 2, cottagecore: 1, japandi: 1 },
      },
      {
        id: 'jewel',
        image: hero('art_deco'),
        swatches: ['#0D0D0D', '#6B1E3F', '#C9A227'],
        scores: { art_deco: 3, glamour: 3, maximalism: 1, exotic: 1 },
      },
      {
        id: 'metal',
        image: hero('industrial'),
        swatches: ['#2F2F2F', '#8C857C', '#8B4A32'],
        scores: { industrial: 3, bauhaus: 2, minimalism: 1 },
      },
    ],
  },
  {
    id: 'material',
    titleKey: 'qMaterial',
    layout: 'visual',
    options: [
      {
        id: 'raw',
        image: material('industrial', 0) ?? hero('industrial'),
        scores: { industrial: 3, bauhaus: 2, minimalism: 1 },
      },
      {
        id: 'natural',
        image: material('japandi', 0) ?? hero('japandi'),
        scores: { japandi: 3, scandinavian: 2, rustic: 2, cottagecore: 1 },
      },
      {
        id: 'refined',
        image: material('art_deco', 5) ?? hero('glamour'),
        scores: { art_deco: 3, glamour: 3, maximalism: 1 },
      },
      {
        id: 'mixed',
        image: hero('bohemian'),
        scores: { bohemian: 3, maximalism: 2, exotic: 2, cottagecore: 1 },
      },
    ],
  },
  {
    id: 'shape',
    titleKey: 'qShape',
    layout: 'visual',
    options: [
      {
        id: 'boxy',
        image: hero('bauhaus'),
        scores: { bauhaus: 3, minimalism: 2, industrial: 2 },
      },
      {
        id: 'soft',
        image: hero('japandi'),
        scores: { japandi: 3, scandinavian: 2, cottagecore: 1 },
      },
      {
        id: 'ornate',
        image: hero('glamour'),
        scores: { art_deco: 3, glamour: 3, exotic: 1 },
      },
      {
        id: 'collected',
        image: hero('maximalism'),
        scores: { bohemian: 3, maximalism: 2, rustic: 1, exotic: 1 },
      },
    ],
  },
  {
    id: 'pattern',
    titleKey: 'qPattern',
    layout: 'visual',
    options: [
      {
        id: 'none',
        image: hero('minimalism'),
        scores: { minimalism: 3, bauhaus: 2, japandi: 1 },
      },
      {
        id: 'texture',
        image: hero('scandinavian'),
        scores: { scandinavian: 3, japandi: 2, rustic: 1 },
      },
      {
        id: 'geometric',
        image: hero('art_deco'),
        scores: { art_deco: 3, bauhaus: 2, industrial: 1 },
      },
      {
        id: 'botanical',
        image: hero('cottagecore'),
        scores: { cottagecore: 3, bohemian: 2, exotic: 2 },
      },
      {
        id: 'everything',
        image: hero('maximalism'),
        scores: { maximalism: 3, glamour: 1, bohemian: 1 },
      },
    ],
  },
  {
    id: 'light',
    titleKey: 'qLight',
    layout: 'visual',
    options: [
      {
        id: 'day',
        image: hero('scandinavian'),
        scores: { scandinavian: 3, minimalism: 2, cottagecore: 1 },
      },
      {
        id: 'amber',
        image: hero('japandi'),
        scores: { japandi: 3, rustic: 2, bohemian: 1, exotic: 1 },
      },
      {
        id: 'gold',
        image: hero('art_deco'),
        scores: { art_deco: 3, glamour: 3, maximalism: 1 },
      },
      {
        id: 'loft',
        image: hero('industrial'),
        scores: { industrial: 3, bauhaus: 2, minimalism: 1 },
      },
    ],
  },
  {
    id: 'room',
    titleKey: 'qRoom',
    layout: 'room',
    options: [
      { id: 'living', room: 'living' },
      { id: 'bedroom', room: 'bedroom' },
      { id: 'office', room: 'office' },
    ],
  },
]

export type QuizResult = {
  primary: QuizStyleId
  runnerUp: QuizStyleId | null
  density: DensityId
  room: QuizRoomId
}

export function isQuizStyleId(value: string | null | undefined): value is QuizStyleId {
  return Boolean(value && (QUIZ_STYLE_IDS as readonly string[]).includes(value))
}

export function scoreQuiz(answers: QuizAnswers): QuizResult {
  const totals: Record<QuizStyleId, number> = Object.fromEntries(
    QUIZ_STYLE_IDS.map(id => [id, 0]),
  ) as Record<QuizStyleId, number>

  let density: DensityId = 'chosen'
  let room: QuizRoomId = 'living'

  for (const question of QUIZ_QUESTIONS) {
    const picked = question.options.find(option => option.id === answers[question.id])
    if (!picked) continue
    if (picked.density) density = picked.density
    if (picked.room) room = picked.room
    for (const [style, points] of Object.entries(picked.scores ?? {}) as [QuizStyleId, number][]) {
      totals[style] += points
    }
  }

  const ranked = [...QUIZ_STYLE_IDS].sort((a, b) => totals[b] - totals[a] || a.localeCompare(b))
  const primary = ranked[0]
  const runnerUp = ranked[1] && totals[ranked[1]] > 0 && ranked[1] !== primary ? ranked[1] : null

  return { primary, runnerUp, density, room }
}

export const STYLE_LABEL_FR: Record<string, string> = {
  art_deco: 'Art Déco',
  bauhaus: 'Bauhaus',
  bohemian: 'Bohème',
  cottagecore: 'Cottagecore',
  exotic: 'Exotique',
  glamour: 'Glamour',
  industrial: 'Industriel',
  japandi: 'Japandi',
  maximalism: 'Maximalisme',
  minimalism: 'Minimalisme',
  rustic: 'Rustique',
  scandinavian: 'Scandinave',
  contemporary: 'Contemporain',
  high_tech: 'High-tech',
  traditional: 'Traditionnel',
  modern: 'Moderne',
  pop_art: 'Pop Art',
  vintage: 'Vintage',
  international: 'International',
  de_stijl: 'De Stijl',
}

const ROOM_LABEL_FR: Record<QuizRoomId, string> = {
  living: 'salon',
  bedroom: 'chambre',
  office: 'bureau',
}

const DENSITY_HINT_FR: Record<DensityId, string> = {
  empty: 'Pièce plutôt vide — pose 2 ou 3 pièces du style, puis génère.',
  chosen: 'Il y a déjà une ou deux pièces — garde-les, ajoute 1 ou 2 du style.',
  rich: 'Pièce déjà pleine — ne rajoute pas. Peinture, lumière, 1 à 3 échanges.',
}

export function styleLabelFr(id: string | null | undefined) {
  if (!id) return ''
  return STYLE_LABEL_FR[id] ?? id.replaceAll('_', ' ')
}

export function quizRoomLabelFr(room: QuizRoomId | null) {
  return room ? ROOM_LABEL_FR[room] : null
}

export function densityHintFr(density: DensityId | null) {
  return density ? DENSITY_HINT_FR[density] : null
}

export function composerHrefFromQuiz(result: Pick<QuizResult, 'primary' | 'density' | 'room'>) {
  const params = new URLSearchParams({
    style: result.primary,
    room: result.room,
    density: result.density,
  })
  return `/room-composer?${params.toString()}`
}

export function parseComposerStyleParams(search: string): {
  styleId: StyleId | null
  room: QuizRoomId | null
  density: DensityId | null
} {
  const params = new URLSearchParams(search)
  const style = params.get('style')
  const room = params.get('room')
  const density = params.get('density')
  const roomId: QuizRoomId | null =
    room === 'bedroom' || room === 'office' || room === 'living' ? room : null
  const densityId: DensityId | null =
    density === 'empty' || density === 'chosen' || density === 'rich' ? density : null
  return {
    styleId: style && isStyleId(style) ? style : null,
    room: roomId,
    density: densityId,
  }
}
