/**
 * Normalize OpenAI / OpenAI-compatible image edit|generate responses.
 * Some gateways return `url` instead of `b64_json`, or nest fields differently.
 */

function stripDataUrl(b64: string): string {
  const i = b64.indexOf(',')
  return i >= 0 ? b64.slice(i + 1) : b64
}

async function fetchUrlAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download generated image (${res.status})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.toString('base64')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** Pull first image as raw base64 from a gateway response object. */
export async function extractImageBase64(response: unknown): Promise<string> {
  const root = asRecord(response) ?? {}
  const data = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.images)
      ? root.images
      : Array.isArray(root.output)
        ? root.output
        : null

  const first = data && data.length > 0 ? asRecord(data[0]) : null

  const b64Direct = pickString(
    first?.b64_json,
    first?.b64,
    first?.base64,
    first?.image_base64,
    root.b64_json,
    root.base64,
    root.result_base64,
  )

  if (b64Direct) {
    return stripDataUrl(b64Direct)
  }

  const url = pickString(first?.url, first?.image_url, root.url, root.image_url)
  if (url) {
    return fetchUrlAsBase64(url)
  }

  // Nested image_url object: { image_url: { url: "..." } }
  const nestedUrlObj = asRecord(first?.image_url)
  const nestedUrl = pickString(nestedUrlObj?.url)
  if (nestedUrl) {
    return fetchUrlAsBase64(nestedUrl)
  }

  const keys = Object.keys(root)
  const firstKeys = first ? Object.keys(first) : []
  console.error('Unrecognized image API response shape', {
    rootKeys: keys,
    firstKeys,
    hasData: Boolean(data),
    dataLength: Array.isArray(data) ? data.length : 0,
  })

  throw new Error(
    'GPT Image 2 returned no image data (unexpected response shape). Check server logs for response keys.',
  )
}
