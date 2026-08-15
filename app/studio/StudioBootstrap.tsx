'use client'

import { useEffect, useRef } from 'react'
import { loadFloorPlan } from '@/lib/floor-plan-storage'
import { fetchRoomPreset } from '@/lib/room-preset'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import { useStudioStore } from '@/store/useStudioStore'
import type { RoomPresetPayload } from '@/types/room-preset'
import type { StudioQuery } from './studio-query'

/** Hydrates Zustand from preset URL, /configure params, or scanned floor plan. Preset wins. */
export default function StudioBootstrap({
  initialPreset,
  query,
}: {
  initialPreset: RoomPresetPayload | null
  query: StudioQuery
}) {
  const loadedRef = useRef<string | null>(null)
  const presetId = query.preset
  const styleParam = query.style
  const roomParam = query.room
  const widthParam = query.width
  const lengthParam = query.length
  const heightParam = query.height

  useEffect(() => {
    const { setRoom, setActiveRoom, loadPreset, setPreFilterStyle } = useStudioStore.getState()

    if (presetId) {
      if (loadedRef.current === presetId) return
      loadedRef.current = presetId
      if (initialPreset) {
        loadPreset(initialPreset)
        return
      }
      fetchRoomPreset(presetId).then(payload => {
        if (payload) loadPreset(payload)
      })
      return
    }

    loadedRef.current = null
    const stored = loadFloorPlan()
    const width = parseFloat(widthParam ?? '')
    const length = parseFloat(lengthParam ?? '')
    const height = parseFloat(heightParam ?? '')

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
  }, [
    presetId,
    initialPreset,
    styleParam,
    roomParam,
    widthParam,
    lengthParam,
    heightParam,
  ])

  return null
}
