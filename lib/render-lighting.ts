export const TIMES_OF_DAY = ['matin', 'midi', 'apres-midi', 'soiree'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const TIME_LABELS: Record<TimeOfDay, string> = {
  matin: 'Matin',
  midi: 'Midi',
  'apres-midi': 'Après-midi',
  soiree: 'Soirée',
}

export interface Lighting {
  time: TimeOfDay
  /** Direct sunlight coming in (true) or soft diffuse daylight (false). */
  sun: boolean
}

export const DEFAULT_LIGHTING: Lighting = { time: 'midi', sun: true }

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && (TIMES_OF_DAY as readonly string[]).includes(value)
}

type Rgb = [number, number, number]

/** What the Blender capture is lit with; it shows the image model where light and shadow fall. */
export interface BlenderLighting {
  sunEnergy: number
  sunElevation: number
  sunAzimuth: number
  sunColor: Rgb
  worldColor: Rgb
  worldStrength: number
}

const SUN: Record<TimeOfDay, Omit<BlenderLighting, 'worldColor' | 'worldStrength'>> = {
  matin: { sunEnergy: 3.0, sunElevation: 18, sunAzimuth: -70, sunColor: [1, 0.82, 0.62] },
  midi: { sunEnergy: 5.0, sunElevation: 68, sunAzimuth: 20, sunColor: [1, 0.97, 0.92] },
  'apres-midi': { sunEnergy: 3.5, sunElevation: 16, sunAzimuth: 115, sunColor: [1, 0.68, 0.4] },
  soiree: { sunEnergy: 1.2, sunElevation: 4, sunAzimuth: 130, sunColor: [1, 0.5, 0.3] },
}

const SKY: Record<TimeOfDay, { worldColor: Rgb; worldStrength: number }> = {
  matin: { worldColor: [0.75, 0.8, 0.9], worldStrength: 1.1 },
  midi: { worldColor: [0.82, 0.84, 0.86], worldStrength: 1.2 },
  'apres-midi': { worldColor: [0.8, 0.78, 0.76], worldStrength: 1.0 },
  soiree: { worldColor: [0.12, 0.15, 0.28], worldStrength: 0.5 },
}

export function blenderLighting({ time, sun }: Lighting): BlenderLighting {
  return { ...SUN[time], ...SKY[time], sunEnergy: sun ? SUN[time].sunEnergy : 0 }
}

const SUN_ON: Record<TimeOfDay, string> = {
  matin: 'early-morning light: low warm golden sun entering from the side, long soft shadows, cool fresh air',
  midi: 'bright midday light: strong clean white sunlight falling through the windows in crisp patches, short shadows',
  'apres-midi':
    'late-afternoon light: low orange golden-hour sun streaming in from the side, long warm shadows and glowing highlights',
  soiree:
    'dusk: last red-orange sun on the horizon, deep blue sky tones outside, interior lights switched on and glowing warmly',
}

const SUN_OFF: Record<TimeOfDay, string> = {
  matin: 'soft overcast morning daylight, no direct sun and no sun patches, gentle even shadows',
  midi: 'soft diffuse overcast daylight at midday, no direct sunbeams, no sun patches on the floor, gentle even light',
  'apres-midi': 'soft grey late-afternoon daylight, overcast, no direct sun, no sun patches, calm even light',
  soiree: 'night: no sun at all, dark blue night outside the windows, the interior lit only by its own warm artificial lights',
}

/** Sentence for the image model describing the light. */
export function lightingPrompt({ time, sun }: Lighting): string {
  return sun ? SUN_ON[time] : SUN_OFF[time]
}
