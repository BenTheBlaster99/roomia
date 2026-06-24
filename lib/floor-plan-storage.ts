import type { FloorPlanData } from '@/types/floor-plan'

const STORAGE_KEY = 'roomia:floor-plan'

export function saveFloorPlan(plan: FloorPlanData): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(plan))
}

export function loadFloorPlan(): FloorPlanData | null {
  if (typeof window === 'undefined') return null

  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as FloorPlanData
  } catch {
    return null
  }
}

export function clearFloorPlan(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(STORAGE_KEY)
}
