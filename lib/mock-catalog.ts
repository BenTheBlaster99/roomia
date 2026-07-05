export interface CatalogItem {
  id: string
  name: string
  category: string
  room: string[]
  style: string
  price: number
  color: string
  modelUrl: string | null
  imageKeyword: string
  available: boolean
  notes?: string
}

export const MOCK_CATALOG: CatalogItem[] = [
  // SOFAS
  { id: 'c-001', name: 'Oslo', category: 'Sofa', room: ['Living Room'], style: 'Industrial', price: 100000, color: '#6B7280', modelUrl: '/models/sofa.glb', imageKeyword: 'leather sofa metal legs', available: true, notes: 'Dark leather, metal legs' },
  { id: 'c-002', name: 'Orion', category: 'Sofa', room: ['Living Room'], style: 'Minimalism', price: 120000, color: '#D6CDBF', modelUrl: '/models/sofa.glb', imageKeyword: 'L shape beige sofa', available: true, notes: 'Beige fabric, L-shape' },
  { id: 'c-003', name: 'Ruffle', category: 'Sofa', room: ['Living Room'], style: 'Maximalism', price: 150000, color: '#D4A017', modelUrl: '/models/sofa.glb', imageKeyword: 'round sofa bold color', available: true, notes: 'Mustard velvet' },
  { id: 'c-004', name: 'Coupé', category: 'Sofa', room: ['Living Room'], style: 'Traditional Algerian', price: 200000, color: '#8B4513', modelUrl: null, imageKeyword: 'carved wood sofa', available: true },
  { id: 'c-005', name: 'Riley', category: 'Sofa', room: ['Living Room'], style: 'Mediterranean Coastal', price: 65000, color: '#F5F5F0', modelUrl: '/models/sofa.glb', imageKeyword: 'white low sofa', available: true },
  // BEDS
  { id: 'c-006', name: 'Dagger', category: 'Bed', room: ['Bedroom'], style: 'Industrial', price: 115000, color: '#374151', modelUrl: '/models/bed.glb', imageKeyword: 'metal frame bed', available: true },
  { id: 'c-007', name: 'Lils', category: 'Bed', room: ['Bedroom'], style: 'Minimalism', price: 100000, color: '#C4A882', modelUrl: '/models/bed.glb', imageKeyword: 'light wood floating bed', available: true },
  { id: 'c-008', name: 'Aurora', category: 'Bed', room: ['Bedroom'], style: 'Maximalism', price: 180000, color: '#7C1D3A', modelUrl: '/models/bed.glb', imageKeyword: 'velvet bed tall headboard', available: true },
  { id: 'c-009', name: 'Neptune', category: 'Bed', room: ['Bedroom'], style: 'Traditional Algerian', price: 200000, color: '#5C3D1E', modelUrl: null, imageKeyword: 'carved wood bed', available: true },
  { id: 'c-010', name: 'Saturn', category: 'Bed', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 70000, color: '#A0785A', modelUrl: '/models/bed.glb', imageKeyword: 'natural wood bed', available: true },
  // CHAIRS
  { id: 'c-011', name: 'Mid-Way', category: 'Chair', room: ['Living Room', 'Bedroom'], style: 'Industrial', price: 40000, color: '#4B3832', modelUrl: '/models/chair.glb', imageKeyword: 'metal leather chair', available: true },
  { id: 'c-012', name: 'Shine', category: 'Chair', room: ['Living Room'], style: 'Minimalism', price: 50000, color: '#E5DDD0', modelUrl: '/models/chair.glb', imageKeyword: 'beige textured chair', available: true },
  { id: 'c-013', name: 'Dorothy', category: 'Chair', room: ['Living Room', 'Bedroom'], style: 'Maximalism', price: 70000, color: '#1B4332', modelUrl: null, imageKeyword: 'throne chair green', available: true },
  // COFFEE TABLES
  { id: 'c-014', name: 'Audacious', category: 'Coffee Table', room: ['Living Room'], style: 'Industrial', price: 40000, color: '#111827', modelUrl: '/models/coffee_table.glb', imageKeyword: 'glass metal coffee table', available: true },
  { id: 'c-015', name: 'Feather', category: 'Coffee Table', room: ['Living Room'], style: 'Minimalism', price: 25000, color: '#C4A882', modelUrl: '/models/coffee_table.glb', imageKeyword: 'round wood coffee table', available: true },
  { id: 'c-016', name: 'Wave', category: 'Coffee Table', room: ['Living Room'], style: 'Mediterranean Coastal', price: 8000, color: '#6B4226', modelUrl: '/models/coffee_table.glb', imageKeyword: 'dark wood natural table', available: true },
  // DINING TABLES
  { id: 'c-017', name: 'Futura', category: 'Dining Table', room: ['Living Room'], style: 'Industrial', price: 80000, color: '#3D2B1F', modelUrl: '/models/dining_table.glb', imageKeyword: 'dark wood dining table', available: true },
  { id: 'c-018', name: 'Vivienne', category: 'Dining Table', room: ['Living Room'], style: 'Minimalism', price: 60000, color: '#E8E8E8', modelUrl: '/models/dining_table.glb', imageKeyword: 'oval white marble table', available: true },
  // LIGHTS
  { id: 'c-019', name: 'Accent', category: 'Light', room: ['Living Room', 'Bedroom'], style: 'Industrial', price: 35000, color: '#1F2937', modelUrl: '/models/light.glb', imageKeyword: 'black metal pendant light', available: true },
  { id: 'c-020', name: 'Leila', category: 'Light', room: ['Living Room'], style: 'Traditional Algerian', price: 60000, color: '#B87333', modelUrl: null, imageKeyword: 'copper arabesque light', available: true },
  // WARDROBES
  { id: 'c-021', name: 'Vault', category: 'Wardrobe', room: ['Bedroom'], style: 'Minimalism', price: 95000, color: '#FFFFFF', modelUrl: null, imageKeyword: 'white wardrobe sliding doors', available: true },
  { id: 'c-022', name: 'Dark Oak', category: 'Wardrobe', room: ['Bedroom'], style: 'Industrial', price: 120000, color: '#3D2B1F', modelUrl: null, imageKeyword: 'dark wood wardrobe', available: true },
  // RUGS
  { id: 'c-023', name: 'Sahara', category: 'Rug', room: ['Living Room', 'Bedroom'], style: 'Traditional Algerian', price: 25000, color: '#C4822A', modelUrl: null, imageKeyword: 'berber rug orange pattern', available: true },
  { id: 'c-024', name: 'Grey Flat', category: 'Rug', room: ['Living Room', 'Bedroom'], style: 'Minimalism', price: 12000, color: '#9CA3AF', modelUrl: null, imageKeyword: 'flat grey rug minimal', available: true },
  // SIDE TABLES
  { id: 'c-025', name: 'Orbit', category: 'Side Table', room: ['Bedroom'], style: 'Minimalism', price: 15000, color: '#C4A882', modelUrl: null, imageKeyword: 'round wood side table', available: true },

  // ── Maximalism Living Room ──────────────────────────────────────────────────
  { id: 'c-026', name: 'Gilded', category: 'Coffee Table', room: ['Living Room'], style: 'Maximalism', price: 55000, color: '#D4A017', modelUrl: '/models/coffee_table.glb', imageKeyword: 'gold glass coffee table', available: true },
  { id: 'c-027', name: 'Chandelier', category: 'Light', room: ['Living Room'], style: 'Maximalism', price: 85000, color: '#FFD700', modelUrl: '/models/light.glb', imageKeyword: 'crystal chandelier', available: true },
  { id: 'c-028', name: 'Persian', category: 'Rug', room: ['Living Room'], style: 'Maximalism', price: 45000, color: '#8B0000', modelUrl: null, imageKeyword: 'persian rug red gold', available: true },
  { id: 'c-029', name: 'Velvet', category: 'TV Unit', room: ['Living Room'], style: 'Maximalism', price: 90000, color: '#4A0E4E', modelUrl: null, imageKeyword: 'velvet tv unit purple', available: true },

  // ── Traditional Algerian Living Room ────────────────────────────────────────
  { id: 'c-030', name: 'Majlis', category: 'Chair', room: ['Living Room'], style: 'Traditional Algerian', price: 55000, color: '#8B4513', modelUrl: '/models/chair.glb', imageKeyword: 'carved wood chair', available: true },
  { id: 'c-031', name: 'Zellige', category: 'Coffee Table', room: ['Living Room'], style: 'Traditional Algerian', price: 35000, color: '#1F4E79', modelUrl: '/models/coffee_table.glb', imageKeyword: 'mosaic tile table', available: true },
  { id: 'c-032', name: 'Atlas', category: 'Dining Table', room: ['Living Room'], style: 'Traditional Algerian', price: 95000, color: '#5C3D1E', modelUrl: '/models/dining_table.glb', imageKeyword: 'carved wood dining table', available: true },
  { id: 'c-033', name: 'Souk', category: 'Rug', room: ['Living Room'], style: 'Traditional Algerian', price: 30000, color: '#C4822A', modelUrl: null, imageKeyword: 'handwoven rug orange', available: true },

  // ── Mediterranean Coastal Living Room ───────────────────────────────────────
  { id: 'c-034', name: 'Breeze', category: 'Chair', room: ['Living Room'], style: 'Mediterranean Coastal', price: 35000, color: '#4F84A6', modelUrl: '/models/chair.glb', imageKeyword: 'white wicker chair', available: true },
  { id: 'c-035', name: 'Harbor', category: 'Light', room: ['Living Room'], style: 'Mediterranean Coastal', price: 28000, color: '#FFFFFF', modelUrl: '/models/light.glb', imageKeyword: 'white pendant light', available: true },
  { id: 'c-036', name: 'Sand', category: 'Rug', room: ['Living Room'], style: 'Mediterranean Coastal', price: 18000, color: '#D9C3A5', modelUrl: null, imageKeyword: 'jute natural rug', available: true },
  { id: 'c-037', name: 'Coastal', category: 'TV Unit', room: ['Living Room'], style: 'Mediterranean Coastal', price: 42000, color: '#A0785A', modelUrl: null, imageKeyword: 'light wood tv stand', available: true },

  // ── Industrial Living Room extras ───────────────────────────────────────────
  { id: 'c-038', name: 'Forge', category: 'TV Unit', room: ['Living Room'], style: 'Industrial', price: 55000, color: '#1F2937', modelUrl: null, imageKeyword: 'metal wood tv unit', available: true },
  { id: 'c-039', name: 'Steel', category: 'Rug', room: ['Living Room'], style: 'Industrial', price: 15000, color: '#374151', modelUrl: null, imageKeyword: 'dark grey rug', available: true },

  // ── Minimalism Living Room extras ───────────────────────────────────────────
  { id: 'c-040', name: 'Zen', category: 'Light', room: ['Living Room'], style: 'Minimalism', price: 22000, color: '#FFFFFF', modelUrl: '/models/light.glb', imageKeyword: 'minimal white pendant', available: true },
  { id: 'c-041', name: 'Calm', category: 'Rug', room: ['Living Room'], style: 'Minimalism', price: 14000, color: '#E5DDD0', modelUrl: null, imageKeyword: 'beige flat rug', available: true },
  { id: 'c-042', name: 'Line', category: 'TV Unit', room: ['Living Room'], style: 'Minimalism', price: 48000, color: '#FFFFFF', modelUrl: null, imageKeyword: 'white low tv unit', available: true },

  // ── Maximalism Bedroom ──────────────────────────────────────────────────────
  { id: 'c-043', name: 'Baroque', category: 'Wardrobe', room: ['Bedroom'], style: 'Maximalism', price: 160000, color: '#4A0E4E', modelUrl: null, imageKeyword: 'ornate wardrobe purple', available: true },
  { id: 'c-044', name: 'Gilded Night', category: 'Side Table', room: ['Bedroom'], style: 'Maximalism', price: 35000, color: '#D4A017', modelUrl: null, imageKeyword: 'gold side table', available: true },
  { id: 'c-045', name: 'Opulent', category: 'Light', room: ['Bedroom'], style: 'Maximalism', price: 65000, color: '#FFD700', modelUrl: '/models/light.glb', imageKeyword: 'crystal bedside lamp', available: true },
  { id: 'c-046', name: 'Royal', category: 'Rug', room: ['Bedroom'], style: 'Maximalism', price: 38000, color: '#7C1D3A', modelUrl: null, imageKeyword: 'velvet burgundy rug', available: true },

  // ── Traditional Algerian Bedroom ────────────────────────────────────────────
  { id: 'c-047', name: 'Ksar', category: 'Wardrobe', room: ['Bedroom'], style: 'Traditional Algerian', price: 140000, color: '#5C3D1E', modelUrl: null, imageKeyword: 'carved wood wardrobe', available: true },
  { id: 'c-048', name: 'Mosaic', category: 'Side Table', room: ['Bedroom'], style: 'Traditional Algerian', price: 22000, color: '#1F4E79', modelUrl: null, imageKeyword: 'tile side table', available: true },
  { id: 'c-049', name: 'Lantern', category: 'Light', room: ['Bedroom'], style: 'Traditional Algerian', price: 45000, color: '#B87333', modelUrl: null, imageKeyword: 'brass lantern light', available: true },
  { id: 'c-050', name: 'Kilim', category: 'Rug', room: ['Bedroom'], style: 'Traditional Algerian', price: 28000, color: '#C4822A', modelUrl: null, imageKeyword: 'kilim rug geometric', available: true },
  { id: 'c-051', name: 'Majlis Bed', category: 'Chair', room: ['Bedroom'], style: 'Traditional Algerian', price: 48000, color: '#8B4513', modelUrl: '/models/chair.glb', imageKeyword: 'carved bedroom chair', available: true },

  // ── Mediterranean Coastal Bedroom ───────────────────────────────────────────
  { id: 'c-052', name: 'Driftwood', category: 'Wardrobe', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 85000, color: '#A0785A', modelUrl: null, imageKeyword: 'natural wood wardrobe', available: true },
  { id: 'c-053', name: 'Shell', category: 'Side Table', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 12000, color: '#FFFFFF', modelUrl: null, imageKeyword: 'white bedside table', available: true },
  { id: 'c-054', name: 'Seafoam', category: 'Light', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 24000, color: '#4F84A6', modelUrl: '/models/light.glb', imageKeyword: 'blue glass lamp', available: true },
  { id: 'c-055', name: 'Dune', category: 'Rug', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 16000, color: '#D9C3A5', modelUrl: null, imageKeyword: 'sand colored rug', available: true },
  { id: 'c-056', name: 'Reed', category: 'Chair', room: ['Bedroom'], style: 'Mediterranean Coastal', price: 30000, color: '#F5F5F0', modelUrl: '/models/chair.glb', imageKeyword: 'wicker bedroom chair', available: true },

  // ── Industrial Bedroom extras ─────────────────────────────────────────────────
  { id: 'c-057', name: 'Pipe', category: 'Side Table', room: ['Bedroom'], style: 'Industrial', price: 18000, color: '#374151', modelUrl: null, imageKeyword: 'metal pipe side table', available: true },
  { id: 'c-058', name: 'Concrete', category: 'Rug', room: ['Bedroom'], style: 'Industrial', price: 14000, color: '#6B7280', modelUrl: null, imageKeyword: 'grey industrial rug', available: true },

  // ── Minimalism Bedroom extras ─────────────────────────────────────────────────
  { id: 'c-059', name: 'Glow', category: 'Light', room: ['Bedroom'], style: 'Minimalism', price: 20000, color: '#FFFFFF', modelUrl: '/models/light.glb', imageKeyword: 'minimal bedside lamp', available: true },
  { id: 'c-060', name: 'Pebble', category: 'Chair', room: ['Bedroom'], style: 'Minimalism', price: 42000, color: '#E5DDD0', modelUrl: '/models/chair.glb', imageKeyword: 'minimal bedroom chair', available: true },
]

/** Items available for a given style + room type (used by preset generator). */
export function catalogForPreset(style: string, roomType: string): CatalogItem[] {
  return MOCK_CATALOG.filter(
    item =>
      item.available &&
      item.style === style &&
      item.room.includes(roomType),
  )
}
