'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Forfait } from '@/lib/forfait'

/**
 * The signed-in desktop account's forfait (lib/forfait.ts), or null when it has none, is signed out or the app is offline.
 * `refresh` reads it again (after a photo or a 360 finish).
 */
export function useForfait(): { forfait: Forfait | null; refresh: () => void } {
  const [forfait, setForfait] = useState<Forfait | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { user?: { forfait?: Forfait | null } } | null) => {
        if (live) setForfait(data?.user?.forfait ?? null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [tick])
  const refresh = useCallback(() => setTick(t => t + 1), [])
  return { forfait, refresh }
}
