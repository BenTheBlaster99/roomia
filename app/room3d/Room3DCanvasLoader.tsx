'use client'

import dynamic from 'next/dynamic'
import type { FurnitureItem } from '@/types'

const Room3DCanvas = dynamic(() => import('./Room3DCanvas'), { ssr: false })

interface Props {
  furniture: FurnitureItem[]
  width: number
  length: number
}

export default function Room3DCanvasLoader({ furniture, width, length }: Props) {
  return <Room3DCanvas furniture={furniture} width={width} length={length} />
}
