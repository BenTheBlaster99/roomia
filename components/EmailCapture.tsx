'use client'

import { useState } from 'react'

export default function EmailCapture({ room, style, budget }: {
  room: string
  style: string
  budget: string
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <div className="w-full py-3 bg-amber-50 border border-amber-300 rounded-xl
                      text-center text-sm text-amber-700">
        ✓ Saved! We&apos;ll email your {style} design to {email} soon
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm
                   text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500"
      />
      <button
        onClick={() => email && setSent(true)}
        disabled={!email}
        className="px-5 py-3 bg-amber-500 text-white rounded-xl text-sm font-bold
                   disabled:opacity-30 hover:bg-amber-600 transition-all whitespace-nowrap"
      >
        Save Design
      </button>
    </div>
  )
}
