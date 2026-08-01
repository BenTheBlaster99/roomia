'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import RoomScanner from '@/components/RoomScanner'
import { DEFAULT_HEIGHT } from '@/lib/design-params'
import type { ConfigState } from '@/types'

export default function ConfiguratorPage() {
  const router = useRouter()
  const [config, setConfig] = useState<ConfigState>({
    room: null,
    width: '',
    length: '',
    height: DEFAULT_HEIGHT,
    styleId: null,
    budgetTier: null,
  })

  function canProceed() {
    return config.width && config.length && config.height
  }

  function openStudio() {
    if (!canProceed()) return

    const params = new URLSearchParams({
      width: config.width,
      length: config.length,
      height: config.height,
    })
    router.push(`/studio?${params.toString()}`)
  }

  return (
    <div className="min-h-screen bg-stone-50 text-zinc-900 flex flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-zinc-200 bg-white">
        <span className="text-xl font-bold text-amber-600">roomia</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12">
        <StepSpace config={config} setConfig={setConfig} />
      </div>

      <div className="flex justify-end items-center px-4 sm:px-6 py-4 sm:py-5 border-t border-zinc-200 bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={openStudio}
          disabled={!canProceed()}
          className="w-full sm:w-auto px-8 py-3 bg-amber-400 text-zinc-950 rounded-lg text-sm font-bold
                     disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-300 transition-all"
        >
          Open Design Studio →
        </button>
      </div>
    </div>
  )
}

function StepSpace({
  config,
  setConfig,
}: {
  config: ConfigState
  setConfig: React.Dispatch<React.SetStateAction<ConfigState>>
}) {
  return (
    <div className="w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold mb-1">Start with your space</h1>
        <p className="text-zinc-400 text-sm">
          Enter dimensions or scan a floor plan — then choose room, style, and furniture in the
          studio.
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-sm text-zinc-500">Room dimensions</p>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Width (m)', key: 'width', placeholder: 'e.g. 4' },
            { label: 'Length (m)', key: 'length', placeholder: 'e.g. 5' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-zinc-500 mb-1.5 block">{label}</label>
              <input
                type="number"
                min="1"
                step="0.1"
                placeholder={placeholder}
                value={config[key as keyof ConfigState] as string}
                onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                className="w-full bg-white border border-zinc-200 rounded-lg px-4 py-2.5
                           text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500"
              />
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-zinc-500 mb-1.5 block">Ceiling height (m)</label>
          <input
            type="number"
            min="2"
            step="0.1"
            placeholder="e.g. 2.8"
            value={config.height}
            onChange={e => setConfig(c => ({ ...c, height: e.target.value }))}
            className="w-full bg-white border border-zinc-200 rounded-lg px-4 py-2.5
                       text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500"
          />
          <p className="text-xs text-zinc-400 mt-1.5">
            Standard Algerian apartments are around 2.7–2.8m. Used for the 3D room view.
          </p>
        </div>

        {config.width && config.length && (
          <p className="text-xs text-amber-600">
            Floor area: {(parseFloat(config.width) * parseFloat(config.length)).toFixed(1)} m²
            {config.height &&
              ` · Volume: ${(parseFloat(config.width) * parseFloat(config.length) * parseFloat(config.height)).toFixed(1)} m³`}
          </p>
        )}

        <RoomScanner
          room={config.room}
          width={config.width}
          length={config.length}
          height={config.height}
        />
      </div>
    </div>
  )
}
