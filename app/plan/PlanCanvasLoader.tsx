'use client'

import dynamic from 'next/dynamic'
import type { FurnitureItem } from '@/types'

const FloorPlanCanvas = dynamic(() => import('./FloorPlanCanvas'), { ssr: false })

interface Props {
  furniture: FurnitureItem[]
  width: number
  length: number
}

export default function PlanCanvasLoader({ furniture, width, length }: Props) {
  return <FloorPlanCanvas furniture={furniture} width={width} length={length} />
}
