import { supabase } from '@/lib/supabase'
import type { BudgetRange, FurnitureItem, Room, Style } from '@/types'

export async function fetchGeneratedCatalog(): Promise<FurnitureItem[]> {
  const { data, error } = await supabase
    .from('furniture_items')
    .select('*')
    .in('name', ['Generated Bed', 'Generated Chair'])

  if (error) {
    console.error('Failed to load generated catalog:', error.message)
    return []
  }

  return (data ?? []) as FurnitureItem[]
}

export async function fetchStudioStyles(): Promise<Style[]> {
  const { data } = await supabase.from('styles').select('*').order('name')
  return (data ?? []) as Style[]
}

export async function fetchStudioBudgetRange(room: string): Promise<BudgetRange | null> {
  const { data } = await supabase.from('budget_ranges').select('*').eq('room', room).maybeSingle()
  return data as BudgetRange | null
}

export async function fetchStudioCatalog(
  room: Room | string,
  styleId: string,
  budgetTier: string,
): Promise<FurnitureItem[]> {
  const { data } = await supabase
    .from('furniture_items')
    .select('*')
    .eq('style_id', styleId)
    .ilike('room', `%${room}%`)
    .eq('budget_tier', budgetTier)

  return (data ?? []) as FurnitureItem[]
}
