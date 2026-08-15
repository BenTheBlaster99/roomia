export const COMPOSER_WALLS = [
  { id: 'plaster', label: 'Warm plaster', hex: '#F5F0EB', prompt: 'soft warm plaster ivory walls' },
  { id: 'sand', label: 'Sand', hex: '#D4C5B0', prompt: 'warm sand-beige painted walls' },
  { id: 'terracotta', label: 'Terracotta', hex: '#C9A07A', prompt: 'sunbaked terracotta clay walls' },
  { id: 'sage', label: 'Sage', hex: '#9BB5B0', prompt: 'muted sage green walls' },
  { id: 'coastal', label: 'Gallery white', hex: '#FFFFFF', prompt: 'crisp gallery-white walls' },
  { id: 'charcoal', label: 'Charcoal', hex: '#2F2F2F', prompt: 'matte charcoal gray walls' },
  { id: 'burgundy', label: 'Burgundy', hex: '#7C1D3A', prompt: 'rich burgundy wine-colored walls' },
  { id: 'ink', label: 'Ink', hex: '#1A1A1A', prompt: 'deep matte ink-black walls' },
] as const

export type ComposerWallId = (typeof COMPOSER_WALLS)[number]['id']

export const COMPOSER_LIGHTS = [
  {
    id: 'chandelier',
    label: 'Chandelier',
    hint: 'Tap the ceiling',
    place: 'ceiling',
    prompt:
      'a real chandelier hanging from the ceiling, warm bulbs on, metal or crystal, correct perspective, new fixture shadows on ceiling and floor',
  },
  {
    id: 'pendant',
    label: 'Pendant',
    hint: 'Tap the ceiling',
    place: 'ceiling',
    prompt:
      'a modern ceiling pendant light hanging from the ceiling, warm glow on, single fixture, realistic cord or stem, lit canopy',
  },
  {
    id: 'floor',
    label: 'Floor lamp',
    hint: 'Tap the floor',
    place: 'floor',
    prompt:
      'a tall standing floor lamp on the floor, fabric or metal shade, lamp switched ON, warm pool of light on nearby floor and wall',
  },
  {
    id: 'sconce',
    label: 'Sconce',
    hint: 'Tap a wall',
    place: 'wall',
    prompt:
      'a wall-mounted sconce fixed to the wall, warm indoor lighting ON, realistic fixture and wall wash',
  },
] as const

export type ComposerLightId = (typeof COMPOSER_LIGHTS)[number]['id']

export function wallById(id: string) {
  return COMPOSER_WALLS.find(w => w.id === id) ?? null
}

export function lightById(id: string) {
  return COMPOSER_LIGHTS.find(l => l.id === id) ?? null
}
