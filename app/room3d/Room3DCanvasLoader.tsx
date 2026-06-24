'use client'

import dynamic from 'next/dynamic'
import type { FurnitureItem } from '@/types'

const Room3DCanvas = dynamic(() => import('./Room3DCanvas'), { ssr: false })

interface Props {
  furniture: FurnitureItem[]
  room: string
  styleId: string
  budgetTier: string
  width: number
  length: number
  height: number
}

export default function Room3DCanvasLoader({
  furniture,
  room,
  styleId,
  budgetTier,
  width,
  length,
  height,
}: Props) {
  return (
    <Room3DCanvas
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
