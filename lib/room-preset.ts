import { supabase } from '@/lib/supabase'
import type { RoomConfig } from '@/store/useStudioStore'
import type { PresetFurniture, RoomPresetPayload, RoomPresetRow } from '@/types/room-preset'

const DEFAULT_ROOM: RoomConfig = {
  width: 5,
  length: 6,
  height: 2.8,
  floorMaterial: 'wood',
  wallColor: '#F5F0EB',
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function presetRowToPayload(row: RoomPresetRow): RoomPresetPayload {
  const furniture = asArray(row.furniture).filter(
    (item): item is PresetFurniture => Boolean(item) && typeof item === 'object',
  )

  return {
    room: { ...DEFAULT_ROOM, ...(row.room_config ?? {}) },
    furniture,
    roomType: row.room_type || 'Living Room',
    styleId: row.style_id,
    name: row.name,
  }
}

export async function fetchRoomPreset(id: string): Promise<RoomPresetPayload | null> {
  const { data, error } = await supabase
    .from('room_presets')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    console.error('Failed to load preset:', error?.message)
    return null
  }

  return presetRowToPayload(data as RoomPresetRow)
}
