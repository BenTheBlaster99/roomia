'use client'

import { useState, useRef } from 'react'
import { DEFAULT_HEIGHT } from '@/lib/design-params'
import { createRectangularFloorPlan } from '@/lib/floor-plan'
import { saveFloorPlan } from '@/lib/floor-plan-storage'
import type { FloorPlanData } from '@/types/floor-plan'

interface ScanResult {
  width_m: number
  length_m: number
  height_m: number
  confidence: 'high' | 'medium' | 'low'
  notes: string
  floorPlan: FloorPlanData
  modelUsed?: string
}

interface Props {
  room?: string | null
  width?: string
  length?: string
  height?: string
  onResult: (width: string, length: string, height?: string) => void
}

const CONFIDENCE_COLOR = {
  high: 'text-green-600',
  medium: 'text-amber-600',
  low: 'text-red-500',
}

export default function RoomScanner({ room, width, length, height, onResult }: Props) {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setScanning(true)
    setError(null)
    setResult(null)

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/scan-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type,
          room: room ?? undefined,
          height: height ? Number(height) : undefined,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        throw new Error(data.error ?? 'Scan failed')
      }

      saveFloorPlan(data.floorPlan)

      const scanResult: ScanResult = {
        width_m: data.width_m,
        length_m: data.length_m,
        height_m: data.height_m,
        confidence: data.confidence,
        notes: data.notes,
        floorPlan: data.floorPlan,
        modelUsed: data.modelUsed,
      }

      setResult(scanResult)

      const detectedHeight = data.height_m ? String(data.height_m) : undefined
      onResult(String(data.width_m), String(data.length_m), detectedHeight)
    } catch {
      const fallbackWidth =
        width && parseFloat(width) > 0 ? parseFloat(width) : 4
      const fallbackLength =
        length && parseFloat(length) > 0 ? parseFloat(length) : 5
      const fallbackHeight =
        height && parseFloat(height) > 0 ? parseFloat(height) : parseFloat(DEFAULT_HEIGHT)

      const fallbackPlan = createRectangularFloorPlan({
        room: room ?? undefined,
        width: fallbackWidth,
        length: fallbackLength,
        height: fallbackHeight,
        source: 'manual',
      })

      const planWithNote: FloorPlanData = {
        ...fallbackPlan,
        metadata: {
          ...fallbackPlan.metadata,
          scanConfidence: 'low',
          scanNotes: 'Scan unavailable — starter layout applied.',
        },
      }

      saveFloorPlan(planWithNote)

      setResult({
        width_m: fallbackWidth,
        length_m: fallbackLength,
        height_m: fallbackHeight,
        confidence: 'low',
        notes:
          "We couldn't read this sketch perfectly, so we set up a starter room. Adjust walls and furniture in the Design Studio.",
        floorPlan: planWithNote,
      })

      onResult(
        String(fallbackWidth),
        String(fallbackLength),
        String(fallbackHeight),
      )
    } finally {
      setScanning(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const structureSummary = result
    ? [
        `${result.floorPlan.walls.length} wall${result.floorPlan.walls.length === 1 ? '' : 's'}`,
        `${result.floorPlan.doors.length} door${result.floorPlan.doors.length === 1 ? '' : 's'}`,
        `${result.floorPlan.windows.length} window${result.floorPlan.windows.length === 1 ? '' : 's'}`,
        `${result.floorPlan.rooms.length} room zone${result.floorPlan.rooms.length === 1 ? '' : 's'}`,
      ].join(' · ')
    : ''

  return (
    <div className="space-y-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={scanning}
        className="w-full py-2.5 border border-dashed border-zinc-300 rounded-xl text-sm
                   text-zinc-500 hover:border-amber-400 hover:text-amber-600
                   transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-white"
      >
        {scanning ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent
                             rounded-full animate-spin" />
            Scanning floor plan...
          </span>
        ) : (
          '📐 Irregular room? Scan floor plan →'
        )}
      </button>

      {result && (
        <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-500">Detected floor plan</span>
            <span className={`text-xs font-medium ${CONFIDENCE_COLOR[result.confidence]}`}>
              {result.confidence} confidence
            </span>
          </div>
          <div className="text-sm font-bold text-amber-600">
            {result.width_m}m × {result.length_m}m × {result.height_m}m
          </div>
          <p className="text-xs text-zinc-600">{structureSummary}</p>
          {result.notes && (
            <p className="text-xs text-zinc-500">{result.notes}</p>
          )}
          {result.modelUsed && (
            <p className="text-[10px] text-zinc-400">Scanned with {result.modelUsed}</p>
          )}
          <p className="text-xs text-zinc-400 pt-1">
            Structured plan saved for 2D/3D. Edit dimensions above if needed.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
