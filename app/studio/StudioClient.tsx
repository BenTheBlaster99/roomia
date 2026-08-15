'use client'

import dynamic from 'next/dynamic'
import type { RoomPresetPayload } from '@/types/room-preset'
import type { StudioQuery } from './studio-query'

const Studio = dynamic(() => import('./Studio'), { ssr: false })

export default function StudioClient({
  initialPreset,
  query,
}: {
  initialPreset: RoomPresetPayload | null
  query: StudioQuery
}) {
  return <Studio initialPreset={initialPreset} query={query} />
}
