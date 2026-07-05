'use client'

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { loadFloorPlan } from '@/lib/floor-plan-storage'
import { supabase } from '@/lib/supabase'
import { useStudioStore } from '@/store/useStudioStore'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import type { RoomPresetRow } from '@/types/room-preset'

/** Hydrates Zustand from preset URL, /configure params, or scanned floor plan. Preset wins. */
export default function StudioBootstrap() {
  const searchParams = useSearchParams()
  const setRoom = useStudioStore(s => s.setRoom)
  const setActiveRoom = useStudioStore(s => s.setActiveRoom)
  const loadPreset = useStudioStore(s => s.loadPreset)
  const setPreFilterStyle = useStudioStore(s => s.setPreFilterStyle)
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    const presetId = searchParams.get('preset')
    const styleParam = searchParams.get('style')
    const roomParam = searchParams.get('room')

    if (presetId) {
      if (loadedRef.current === presetId) return
      loadedRef.current = presetId

      supabase
        .from('room_presets')
        .select('*')
        .eq('id', presetId)
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            console.error('Failed to load preset:', error?.message)
            return
          }
          const row = data as RoomPresetRow
          loadPreset({
            room: row.room_config,
            furniture: row.furniture ?? [],
            roomType: row.room_type,
            styleId: row.style_id,
            name: row.name,
          })
        })
      return
    }

    loadedRef.current = null
    const stored = loadFloorPlan()
    const width = parseFloat(searchParams.get('width') ?? '')
    const length = parseFloat(searchParams.get('length') ?? '')
    const height = parseFloat(searchParams.get('height') ?? '')

    const updates: { width?: number; length?: number; height?: number } = {}

    if (stored?.dimensions) {
      updates.width = stored.dimensions.width
      updates.length = stored.dimensions.length
      updates.height = stored.dimensions.height
    } else {
      if (Number.isFinite(width) && width > 0) updates.width = width
      if (Number.isFinite(length) && length > 0) updates.length = length
      if (Number.isFinite(height) && height > 0) updates.height = height
    }

    if (Object.keys(updates).length > 0) {
      setRoom(updates)
    }

    if (roomParam === 'Living Room' || roomParam === 'Bedroom') {
      setActiveRoom(roomParam)
    } else if (stored?.metadata?.room === 'Living Room' || stored?.metadata?.room === 'Bedroom') {
      setActiveRoom(stored.metadata.room)
    }

    if (styleParam) {
      const name = SLUG_TO_STYLE[styleParam]
      if (name) setPreFilterStyle(name)
    }
  }, [searchParams, setRoom, setActiveRoom, loadPreset, setPreFilterStyle])

  return null
}
