import { Suspense } from 'react'
import PlanEditor from './PlanEditor'

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-stone-50 text-zinc-500">
          Loading floor plan…
        </div>
      }
    >
      <PlanEditor />
    </Suspense>
  )
}
