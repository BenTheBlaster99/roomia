'use client'

import { useState } from 'react'
import type { FurnitureItem } from '@/types'

interface Props {
  room: string
  styleId: string
  styleName: string
  budget: string
  width: string
  length: string
  furniture: FurnitureItem[]
  total: number
}

export default function EmailCapture({
  room, styleId, styleName, budget, width, length, furniture, total,
}: Props) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSave() {
    if (!email || status === 'sending') return
    setStatus('sending')

    try {
      const resultUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/result?room=${encodeURIComponent(room)}&style=${styleId}&budget=${budget}&width=${width}&length=${length}`

      const res = await fetch('/api/send-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          styleName,
          room,
          budget,
          width,
          length,
          furniture: furniture.map(f => ({
            name: f.name,
            category: f.category,
            price: f.price,
          })),
          total,
          resultUrl,
        }),
      })

      const data = await res.json()
      setStatus(data.success ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="w-full py-3 bg-amber-50 border border-amber-300 rounded-xl
                      text-center text-sm text-amber-700">
        ✓ Design sent to {email}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          className="flex-1 bg-white border border-zinc-200 rounded-xl px-4 py-3 text-sm
                     text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500
                     transition-colors"
        />
        <button
          onClick={handleSave}
          disabled={!email || status === 'sending'}
          className="px-5 py-3 bg-amber-500 text-white rounded-xl text-sm font-bold
                     disabled:opacity-30 hover:bg-amber-600 transition-all whitespace-nowrap"
        >
          {status === 'sending' ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-white border-t-transparent
                               rounded-full animate-spin" />
              Sending
            </span>
          ) : 'Save Design'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-xs text-red-500 px-1">
          Failed to send. Check your email and try again.
        </p>
      )}
    </div>
  )
}
