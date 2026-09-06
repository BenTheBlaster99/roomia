export type Room = 'Living Room' | 'Bedroom'
export type BudgetTier = 'tight' | 'comfortable' | 'premium'
export type * from './floor-plan'

export interface Style {
  id: string
  name: string
  tagline: string
  description: string
  main_color: string
  accent_color: string
  notes: string
}

export interface FurnitureItem {
  id: string
  name: string
  category: string
  room: string
  style_id: string
  price: number
  budget_tier: string
  image_keyword: string
  model_url: string | null
  image_url: string | null
  store_id?: string | null
  featured?: boolean
  partner_link: string | null
  notes: string | null
  width_m?: number | null
  depth_m?: number | null
  height_m?: number | null
}

export interface MoodboardImage {
  id: string
  style_id: string
  room: string
  image_url: string
  search_keyword: string
  description: string
}

export interface BudgetRange {
  room: string
  tight: string
  comfortable: string
  premium: string
  notes: string
}

export interface ConfigState {
  room: Room | null
  width: string
  length: string
  height: string
  styleId: string | null
  budgetTier: BudgetTier | null
}
