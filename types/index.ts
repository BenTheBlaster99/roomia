export type Room = 'Living Room' | 'Bedroom'
export type BudgetTier = 'tight' | 'comfortable' | 'premium'

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
  partner_link: string | null
  notes: string | null
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
  styleId: string | null
  budgetTier: BudgetTier | null
}
