import type { FloorMaterial, PlacedItem, RoomConfig } from '@/store/useStudioStore'

export interface PresetFurniture
  extends Omit<PlacedItem, 'id'> {}

export interface RoomPresetRow {
  id: string
  name: string
  room_type: string
  style_id: string | null
  budget_tier: string
  thumbnail_url: string | null
  room_config: RoomConfig
  furniture: PresetFurniture[]
  created_at?: string
}

export interface RoomPresetPayload {
  room: RoomConfig
  furniture: PresetFurniture[]
  roomType: string
  styleId?: string | null
  name?: string
}
