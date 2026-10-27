import { Suspense } from 'react'
import { connection } from 'next/server'
import { fetchRoomPreset } from '@/lib/room-preset'
import { pageUser } from '@/lib/page-session'
import StudioClient from './StudioClient'
import { firstSearchParam, type StudioQuery } from './studio-query'

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  // On the Studio PC the Studio needs a signed-in account (checked here, not only by the cookie).
  await pageUser('/studio')
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
