'use client'

import type { ReactNode } from 'react'
import SiteHeader from '@/components/site/SiteHeader'

/**
 * Kept for the older pages outside app/[locale] (catalog, room composer) that still import it: since the 16 Nov
 * redesign every page shows the one shared navbar (components/site/SiteHeader). `ctaHref`, `ctaLabel` and `tone` are
 * accepted and ignored, as they already were.
 */
export default function SiteNav({
  trailing,
}: {
  ctaHref?: string
  ctaLabel?: string
  trailing?: ReactNode
  tone?: 'light' | 'dark'
}) {
  return <SiteHeader trailing={trailing} />
}
