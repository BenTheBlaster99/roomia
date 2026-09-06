export const MAX_ZONES = 3

export type LookId = 'a' | 'b'

export const LOOKS: Record<
  LookId,
  { label: string; short: string; pin: string; ring: string; chip: string }
> = {
  a: {
    label: 'Look 1',
    short: '1',
    pin: '#c2410c',
    ring: 'ring-orange-700',
    chip: 'bg-orange-700 text-white',
  },
  b: {
    label: 'Look 2',
    short: '2',
    pin: '#2563eb',
    ring: 'ring-blue-600',
    chip: 'bg-blue-600 text-white',
  },
}
