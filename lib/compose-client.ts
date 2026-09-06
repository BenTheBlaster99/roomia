type ProgressStep = 'masking' | 'generating' | 'results'

export type ComposeRoomBody = {
  image_base64: string
  zones: Array<{
    x: number
    y: number
    prompt: string
    category?: string
    fidelity?: string
    reference_base64?: string | null
  }>
  atmosphere?: {
    wall?: { prompt: string; x: number; y: number } | null
    lighting?: { prompt: string; kind: string; x: number; y: number } | null
  } | null
  num_variations?: number
}

export async function composeRoom(
  body: ComposeRoomBody,
  onProgress?: (event: { step?: ProgressStep; pct?: number; detail?: string }) => void,
): Promise<{ variations: string[]; warning: string | null }> {
  const res = await fetch('/api/compose/room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, num_variations: body.num_variations ?? 1 }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail ?? `Compose error ${res.status}`)
  }
  if (!res.body) throw new Error('Compose stream unavailable')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let gotVariations: string[] | null = null
  let warning: string | null = null

  const applyEvent = (event: {
    type?: string
    step?: ProgressStep
    label?: string
    detail?: string
    pct?: number
    variations?: string[]
    failed_count?: number
  }) => {
    if (event.type === 'progress' && event.step) {
      onProgress?.({
        step: event.step,
        pct: event.pct,
        detail: event.detail ?? event.label,
      })
    } else if (event.type === 'done' && Array.isArray(event.variations)) {
      gotVariations = event.variations
      onProgress?.({ step: 'results', pct: 100, detail: 'Done' })
      if (event.failed_count && event.failed_count > 0) {
        warning = `${event.variations.length} image(s) ready, ${event.failed_count} failed.`
      }
    } else if (event.type === 'error') {
      throw new Error(event.detail ?? 'Compose failed')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        applyEvent(JSON.parse(trimmed))
      } catch {
        /* incomplete json chunk */
      }
    }
  }

  if (buffer.trim()) {
    try {
      applyEvent(JSON.parse(buffer.trim()))
    } catch {
      if (!gotVariations?.length) throw new Error('Stream ended unexpectedly (no results)')
    }
  }

  if (!gotVariations?.length) {
    throw new Error('No image returned (API failed or stream cut off)')
  }

  return { variations: gotVariations, warning }
}
