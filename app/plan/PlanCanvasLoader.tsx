'use client'

import dynamic from 'next/dynamic'
import type { FurnitureItem } from '@/types'

const FloorPlanCanvas = dynamic(() => import('./FloorPlanCanvas'), { ssr: false })

interface Props {
  furniture: FurnitureItem[]
  room: string
  styleId: string
  budgetTier: string
  width: number
  length: number
  height: number
}

export default function PlanCanvasLoader({
  furniture,
  room,
  styleId,
  budgetTier,
  width,
  length,
  height,
}: Props) {
  return (
    <FloorPlanCanvas
      key={`${room}-${styleId}-${budgetTier}-${width}-${length}-${height}`}
      furniture={furniture}
      room={room}
      styleId={styleId}
      budgetTier={budgetTier}
      width={width}
      length={length}
      height={height}
    />
  )
}
