export const CATEGORY_DIMS: Record<string, { width: number; depth: number; height: number }> = {
  'Sofa':          { width: 2.1,  depth: 0.85, height: 0.80 },
  'Bed':           { width: 1.6,  depth: 2.00, height: 1.05 },
  'Chair':         { width: 0.80, depth: 1.20, height: 1.10 },
  'Coffee Table':  { width: 1.10, depth: 0.60, height: 0.45 },
  'Dining Table':  { width: 1.40, depth: 0.80, height: 0.75 },
  'Light':         { width: 0.30, depth: 0.30, height: 1.80 },
  'Wardrobe':      { width: 1.80, depth: 0.60, height: 2.10 },
  'TV Unit':       { width: 1.60, depth: 0.45, height: 0.55 },
  'Side Table':    { width: 0.50, depth: 0.50, height: 0.55 },
  'Rug':           { width: 2.00, depth: 1.40, height: 0.02 },
  'Bookshelf':     { width: 0.80, depth: 0.30, height: 1.80 },
  'Curtains':      { width: 1.50, depth: 0.05, height: 2.40 },
}

export const CATEGORY_COLORS: Record<string, string> = {
  'Sofa':         '#4F84A6',
  'Bed':          '#7C5C8A',
  'Chair':        '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  'Light':        '#E8C97A',
  'Wardrobe':     '#8B6347',
  'TV Unit':      '#5A5A6E',
  'Side Table':   '#A67C52',
  'Rug':          '#CF6679',
  'Bookshelf':    '#7D9B5E',
  'Curtains':     '#B8A9C9',
}

export const FLOOR_MATERIALS: Record<string, { label: string; color: string }> = {
  wood:      { label: 'Wood',     color: '#A0785A' },
  tile:      { label: 'Tile',     color: '#E8E4E0' },
  concrete:  { label: 'Concrete', color: '#9B9B9B' },
  carpet:    { label: 'Carpet',   color: '#C4B09A' },
  marble:    { label: 'Marble',   color: '#F0EEE8' },
}

export const WALL_PRESETS = [
  '#FFFFFF', '#F5F0EB', '#E8E2D9',
  '#D4C5B0', '#C2B89A', '#B5C4C1',
  '#9BB5B0', '#8FA8C8', '#C9A07A',
  '#1A1A1A', '#2F2F2F', '#4A4A4A',
]

export const ROOM_TYPES = ['Living Room', 'Bedroom'] as const

export const CATEGORIES_BY_ROOM: Record<string, string[]> = {
  'Living Room': ['Sofa', 'Coffee Table', 'Chair', 'Dining Table', 'TV Unit', 'Rug', 'Light', 'Curtains', 'Bookshelf'],
  'Bedroom':     ['Bed', 'Wardrobe', 'Side Table', 'Chair', 'Light', 'Rug', 'Curtains'],
}
