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
  /** The room's own lights (ceiling spots, pendants, LED strips) switched on. */
  interior: boolean
}

export const DEFAULT_LIGHTING: Lighting = { time: 'midi', sun: true, interior: true }

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

/**
 * White daylight, the same whatever time is asked: the capture then shows each material's own
 * colour, and the photo step adds the time-of-day mood (an evening capture is so blue that
 * light oak came out walnut).
 */
export const NEUTRAL_CAPTURE_LIGHT: BlenderLighting = {
  sunEnergy: 3,
  sunElevation: 45,
  sunAzimuth: 35,
  sunColor: [1, 1, 1],
  worldColor: [0.9, 0.9, 0.9],
  worldStrength: 1.0,
}

export function blenderLighting({ time, sun }: Lighting): BlenderLighting {
  return { ...SUN[time], ...SKY[time], sunEnergy: sun ? SUN[time].sunEnergy : 0 }
}

// Direct sun lands only where a real window would put it: the capture's own sun patches show where.
const SUN_ON: Record<TimeOfDay, string> = {
  matin: 'morning: soft warm sunlight entering through the existing windows, gentle shadows',
  midi: 'midday: bright natural daylight, sunlight on the floor only in front of the existing windows, short soft shadows',
  'apres-midi': 'late afternoon: warm low sunlight entering through the existing windows, longer soft shadows',
  soiree: 'dusk: deep blue sky outside, the last warm daylight fading, interior lights glowing warmly',
}

const SUN_OFF: Record<TimeOfDay, string> = {
  matin: 'soft overcast morning daylight, no direct sun and no sun patches, gentle even shadows',
  midi: 'soft diffuse overcast daylight at midday, no direct sunbeams, no sun patches on the floor, gentle even light',
  'apres-midi': 'soft grey late-afternoon daylight, overcast, no direct sun, no sun patches, calm even light',
  soiree: 'night: no sun at all, dark blue night outside the windows, the interior lit only by its own warm artificial lights',
}

const INTERIOR_ON =
  "the room's own light fittings are switched ON: the ceiling spots, pendants, LED strips and cove lights that exist in the capture glow and cast warm light"
const INTERIOR_OFF = "the room's own lights are switched off; only daylight lights the space"

/** Sentence for the image model describing the light. */
export function lightingPrompt({ time, sun, interior }: Lighting): string {
  return `${sun ? SUN_ON[time] : SUN_OFF[time]}; ${interior ? INTERIOR_ON : INTERIOR_OFF}`
}
