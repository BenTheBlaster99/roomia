'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import StudioBootstrap from './StudioBootstrap'

const Studio = dynamic(() => import('./Studio'), { ssr: false })

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioBootstrap />
      <Studio />
    </Suspense>
  )
}
