import { isStyleId, STYLE_VISUALS, styleHero, type StyleId } from '@/lib/style-details'

export const QUIZ_STYLE_IDS = [
  'art_deco',
  'bauhaus',
  'bohemian',
  'cottagecore',
  'exotic',
  'glamour',
  'high_tech',
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
export type QuizAnswers = Record<string, string | string[]>

export type CriterionId =
  | 'complexity'
  | 'palette'
  | 'mood'
  | 'furniture'
  | 'ornament'
  | 'symmetry'
  | 'nature'
  | 'tech'

type ScoreMap = Partial<Record<string, number>>

export type QuizOption = {
  id: string
  image?: string
  swatches?: string[]
  density?: DensityId
  room?: QuizRoomId
}

export type QuizQuestion = {
  id: CriterionId | 'room'
  titleKey: string
  hintKey?: string
  layout: 'list' | 'visual' | 'room'
  maxSelect?: number
  criterion?: CriterionId
  options: QuizOption[]
}

function hero(id: StyleId) {
  return styleHero(STYLE_VISUALS[id])?.src
}

const HIGH_TECH_HERO =
  'https://i.pinimg.com/1200x/b9/34/fa/b934fab7ab93a953f8f625e0cfa20933.jpg'

export const CRITERION_WEIGHT: Record<CriterionId, number> = {
  complexity: 1,
  palette: 1,
  mood: 1,
  furniture: 1,
  ornament: 1,
  symmetry: 1,
  nature: 2,
  tech: 3,
}

/** Sarah’s V1 matrix: style × criterion × answer → 0–3. Missing = 0. */
export const STYLE_MATRIX: Record<QuizStyleId, Record<CriterionId, ScoreMap>> = {
  art_deco: {
    complexity: { abundant: 3 },
    palette: { bold: 3 },
    mood: { elegant: 3, dramatic: 3 },
    furniture: { vintage: 3 },
    ornament: { complex: 3 },
    symmetry: { symmetric: 3 },
    nature: { low: 3 },
    tech: { quiet: 3 },
  },
  bauhaus: {
    complexity: { minimal: 3 },
    palette: { bold: 3 },
    mood: { functional: 3 },
    furniture: { modern: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { low: 3 },
    tech: { integrated: 3 },
  },
  bohemian: {
    complexity: { abundant: 3 },
    palette: { earth: 3 },
    mood: { warm: 3, dynamic: 2 },
    furniture: { eclectic: 3 },
    ornament: { none: 3 },
    symmetry: { asymmetric: 3 },
    nature: { high: 3 },
    tech: { quiet: 3 },
  },
  cottagecore: {
    complexity: { balanced: 3 },
    palette: { soft: 3 },
    mood: { warm: 3 },
    furniture: { vintage: 3 },
    ornament: { subtle: 3 },
    symmetry: { balanced: 3, symmetric: 2 },
    nature: { high: 3 },
    tech: { quiet: 3 },
  },
  exotic: {
    complexity: { abundant: 3 },
    palette: { bold: 3, earth: 2 },
    mood: { dynamic: 3, dramatic: 2 },
    furniture: { eclectic: 3 },
    ornament: { none: 3 },
    symmetry: { asymmetric: 3 },
    nature: { high: 3 },
    tech: { quiet: 3 },
  },
  glamour: {
    complexity: { balanced: 3 },
    palette: { soft: 3, bold: 1 },
    mood: { elegant: 3, dramatic: 2 },
    furniture: { modern: 3 },
    ornament: { subtle: 3 },
    symmetry: { symmetric: 3 },
    nature: { low: 3 },
    tech: { quiet: 3 },
  },
  high_tech: {
    complexity: { minimal: 3 },
    palette: { neutral: 3 },
    mood: { functional: 3 },
    furniture: { modern: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { low: 3 },
    tech: { featured: 3 },
  },
  industrial: {
    complexity: { balanced: 3 },
    palette: { bold: 3, earth: 2 },
    mood: { functional: 3 },
    furniture: { modern: 3, vintage: 1 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { mid: 2 },
    tech: { integrated: 2 },
  },
  japandi: {
    complexity: { minimal: 3 },
    palette: { soft: 3, neutral: 2 },
    mood: { calm: 3, warm: 2 },
    furniture: { modern: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { high: 3 },
    tech: { quiet: 3 },
  },
  maximalism: {
    complexity: { abundant: 3 },
    palette: { bold: 3 },
    mood: { dynamic: 3, dramatic: 3 },
    furniture: { eclectic: 3 },
    ornament: { subtle: 1 },
    symmetry: { asymmetric: 3 },
    nature: { mid: 2 },
    tech: { quiet: 3 },
  },
  minimalism: {
    complexity: { minimal: 3 },
    palette: { neutral: 3 },
    mood: { calm: 3, functional: 3 },
    furniture: { modern: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { low: 3 },
    tech: { integrated: 1 },
  },
  rustic: {
    complexity: { balanced: 3 },
    palette: { earth: 3 },
    mood: { warm: 3 },
    furniture: { vintage: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { high: 3 },
    tech: { quiet: 3 },
  },
  scandinavian: {
    complexity: { minimal: 3 },
    palette: { soft: 3, neutral: 2 },
    mood: { calm: 3, warm: 3 },
    furniture: { modern: 3 },
    ornament: { none: 3 },
    symmetry: { balanced: 3 },
    nature: { mid: 2 },
    tech: { quiet: 3 },
  },
}

const DENSITY_FROM_COMPLEXITY: Record<string, DensityId> = {
  minimal: 'empty',
  balanced: 'chosen',
  abundant: 'rich',
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'complexity',
    criterion: 'complexity',
    titleKey: 'qComplexity',
    layout: 'visual',
    options: [
      { id: 'minimal', image: hero('minimalism'), density: 'empty' },
      { id: 'balanced', image: hero('cottagecore'), density: 'chosen' },
      { id: 'abundant', image: hero('maximalism'), density: 'rich' },
    ],
  },
  {
    id: 'palette',
    criterion: 'palette',
    titleKey: 'qPalette',
    layout: 'visual',
    options: [
      {
        id: 'neutral',
        image: hero('minimalism'),
        swatches: ['#F2F0EB', '#D6D3CC', '#8B8175', '#333333'],
      },
      {
        id: 'soft',
        image: hero('japandi'),
        swatches: ['#F1EDE3', '#D6C7AE', '#A68A64', '#5F6B55'],
      },
      {
        id: 'earth',
        image: hero('rustic'),
        swatches: ['#F0E5D0', '#8B6F47', '#B85C38', '#6B705C'],
      },
      {
        id: 'bold',
        image: hero('art_deco'),
        swatches: ['#0D0D0D', '#6B1E3F', '#C9A227', '#1C3A3A'],
      },
    ],
  },
  {
    id: 'mood',
    criterion: 'mood',
    titleKey: 'qMood',
    hintKey: 'hintMood',
    layout: 'list',
    maxSelect: 2,
    options: [
      { id: 'calm' },
      { id: 'warm' },
      { id: 'elegant' },
      { id: 'functional' },
      { id: 'dynamic' },
      { id: 'dramatic' },
    ],
  },
  {
    id: 'furniture',
    criterion: 'furniture',
    titleKey: 'qFurniture',
    layout: 'list',
    options: [
      { id: 'vintage' },
      { id: 'modern' },
      { id: 'eclectic' },
    ],
  },
  {
    id: 'ornament',
    criterion: 'ornament',
    titleKey: 'qOrnament',
    layout: 'list',
    options: [
      { id: 'none' },
      { id: 'subtle' },
      { id: 'complex' },
    ],
  },
  {
    id: 'symmetry',
    criterion: 'symmetry',
    titleKey: 'qSymmetry',
    layout: 'list',
    options: [
      { id: 'asymmetric' },
      { id: 'balanced' },
      { id: 'symmetric' },
    ],
  },
  {
    id: 'nature',
    criterion: 'nature',
    titleKey: 'qNature',
    layout: 'list',
    options: [
      { id: 'low' },
      { id: 'mid' },
      { id: 'high' },
    ],
  },
  {
    id: 'tech',
    criterion: 'tech',
    titleKey: 'qTech',
    layout: 'list',
    options: [
      { id: 'quiet' },
      { id: 'integrated' },
      { id: 'featured' },
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
  totals: Record<QuizStyleId, number>
}

export function isQuizStyleId(value: string | null | undefined): value is QuizStyleId {
  return Boolean(value && (QUIZ_STYLE_IDS as readonly string[]).includes(value))
}

function pickedIds(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function scoreQuiz(answers: QuizAnswers): QuizResult {
  const totals: Record<QuizStyleId, number> = Object.fromEntries(
    QUIZ_STYLE_IDS.map(id => [id, 0]),
  ) as Record<QuizStyleId, number>

  let density: DensityId = 'chosen'
  let room: QuizRoomId = 'living'

  for (const question of QUIZ_QUESTIONS) {
    const picked = pickedIds(answers[question.id])
    if (picked.length === 0) continue

    for (const optionId of picked) {
      const option = question.options.find(item => item.id === optionId)
      if (option?.density) density = option.density
      if (option?.room) room = option.room
    }

    const criterion = question.criterion
    if (!criterion) continue
    const weight = CRITERION_WEIGHT[criterion]

    for (const style of QUIZ_STYLE_IDS) {
      for (const optionId of picked) {
        totals[style] += (STYLE_MATRIX[style][criterion][optionId] ?? 0) * weight
      }
    }
  }

  const complexity = pickedIds(answers.complexity)[0]
  if (complexity && DENSITY_FROM_COMPLEXITY[complexity]) {
    density = DENSITY_FROM_COMPLEXITY[complexity]
  }

  const ranked = [...QUIZ_STYLE_IDS].sort((a, b) => totals[b] - totals[a] || a.localeCompare(b))
  const primary = ranked[0]
  const runnerUp = ranked[1] && totals[ranked[1]] > 0 && ranked[1] !== primary ? ranked[1] : null

  return { primary, runnerUp, density, room, totals }
}

export function quizStyleHero(id: QuizStyleId): string | undefined {
  if (isStyleId(id)) return styleHero(STYLE_VISUALS[id])?.src
  return HIGH_TECH_HERO
}

export const STYLE_LABEL_FR: Record<string, string> = {
  art_deco: 'Art Déco',
  bauhaus: 'Bauhaus',
  bohemian: 'Bohème',
  cottagecore: 'Cottagecore',
  exotic: 'Exotique',
  glamour: 'Glamour',
  high_tech: 'High-tech',
  industrial: 'Industriel',
  japandi: 'Japandi',
  maximalism: 'Maximalisme',
  minimalism: 'Minimalisme',
  rustic: 'Rustique',
  scandinavian: 'Scandinave',
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
  styleId: QuizStyleId | StyleId | null
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
    styleId: style && (isQuizStyleId(style) || isStyleId(style)) ? style : null,
    room: roomId,
    density: densityId,
  }
}
