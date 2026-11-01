/** Why an AI 360° was rejected (ChatGPT, 28 Oct: count each kind of failure apart, to see what a change improves). */
export const PANO_REJECT_REASONS = ['geometrie', 'lumiere-inventee', 'raccord', 'poles', 'flou', 'autre'] as const
export type PanoRejectReason = (typeof PANO_REJECT_REASONS)[number]

export const REJECT_LABELS: Record<PanoRejectReason, string> = {
  geometrie: 'Géométrie changée (mur, porte, meuble)',
  'lumiere-inventee': 'Lumière ou luminaire inventé',
  raccord: 'Raccord ou ligne visible',
  poles: 'Plafond ou sol déformé',
  flou: 'Image floue',
  autre: 'Autre',
}
