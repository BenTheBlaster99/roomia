import { Suspense } from 'react'
import { connection } from 'next/server'
import { fetchRoomPreset } from '@/lib/room-preset'
import StudioClient from './StudioClient'
import { firstSearchParam, type StudioQuery } from './studio-query'

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const raw = await searchParams
  const query: StudioQuery = {
    preset: firstSearchParam(raw.preset),
    create: firstSearchParam(raw.create),
    saved: firstSearchParam(raw.saved),
    style: firstSearchParam(raw.style),
    room: firstSearchParam(raw.room),
    width: firstSearchParam(raw.width),
    length: firstSearchParam(raw.length),
    height: firstSearchParam(raw.height),
  }

  const initialPreset = query.preset ? await fetchRoomPreset(query.preset) : null

  return (
    <Suspense fallback={null}>
      <StudioClient initialPreset={initialPreset} query={query} />
    </Suspense>
  )
}
