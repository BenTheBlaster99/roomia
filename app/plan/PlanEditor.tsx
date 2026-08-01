'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import FloorPlanCanvas from '@/app/plan/FloorPlanCanvas'
import { createRectangularFloorPlan } from '@/lib/floor-plan'
import { loadFloorPlan, saveFloorPlan } from '@/lib/floor-plan-storage'
import {
  addDoorToPlan,
  addWindowToPlan,
  deleteElementFromPlan,
  removeFurnitureFromPlan,
  updateDoorInPlan,
  updateWallInPlan,
  updateWindowInPlan,
} from '@/lib/plan-edit'
import type { FloorPlanData } from '@/types/floor-plan'

export default function PlanEditor() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dimensionWalls = searchParams.get('dimensionWalls') === '1'

  const [plan, setPlan] = useState<FloorPlanData | null>(null)

  useEffect(() => {
    const stored = loadFloorPlan()
    if (stored) {
      setPlan(stored)
      return
    }
    const fallback = createRectangularFloorPlan({ width: 4, length: 5, height: 2.8, source: 'manual' })
    setPlan(fallback)
    saveFloorPlan(fallback)
  }, [])

  const persist = useCallback((next: FloorPlanData) => {
    setPlan(next)
    saveFloorPlan(next)
  }, [])

  function openStudio() {
    if (!plan) return
    const params = new URLSearchParams({
      width: String(plan.dimensions.width),
      length: String(plan.dimensions.length),
      height: String(plan.dimensions.height),
    })
    router.push(`/studio?${params.toString()}`)
  }

  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 text-zinc-500">
        Loading floor plan…
      </div>
    )
  }

  const needsDimensions = plan.metadata?.needsWallDimensions || dimensionWalls

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-white">
        <Link href="/configure" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Configure
        </Link>
        <span className="font-bold text-amber-600">Floor plan editor</span>
        <button
          type="button"
          onClick={openStudio}
          disabled={needsDimensions}
          className="text-sm px-4 py-2 rounded-lg bg-amber-400 text-zinc-950 font-bold disabled:opacity-40"
        >
          Open Studio →
        </button>
      </header>

      {needsDimensions && (
        <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Step 2:</strong> Click each wall, enter its <strong>real length in metres</strong>, then
          press Apply. The first wall you dimension sets the scale for the whole plan.
        </div>
      )}

      <div className="flex-1 p-4 min-h-0">
        <FloorPlanCanvas
          plan={plan}
          fillHeight
          onPlanUpdate={persist}
          onAddDoor={(wallId, offset, width) => persist(addDoorToPlan(plan, wallId, offset, width))}
          onAddWindow={(wallId, offset, width) =>
            persist(addWindowToPlan(plan, wallId, offset, width))
          }
          onDeleteElement={(type, id) => persist(deleteElementFromPlan(plan, type, id))}
          onUpdateWall={(wallId, updates) => persist(updateWallInPlan(plan, wallId, updates))}
          onUpdateDoor={(doorId, updates) => persist(updateDoorInPlan(plan, doorId, updates))}
          onUpdateWindow={(windowId, updates) => persist(updateWindowInPlan(plan, windowId, updates))}
          onRemoveFurniture={id => persist(removeFurnitureFromPlan(plan, id))}
        />
      </div>
    </div>
  )
}
