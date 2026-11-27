/**
 * Roomia: the clients' tour links when the PC is off (25 Nov). In front of studio.room-ia.com: every request goes to the
 * PC through the tunnel as before; when the tunnel does not answer (PC off, Cloudflare error 5xx/530, or no answer within
 * 8 s), a GET is answered from the copy in R2 that lib/tour-mirror.ts keeps (keys: the path without its leading slash;
 * "?cover=1" adds "@cover"; ?v= and the rest of the query are ignored).
 */
const TIMEOUT_MS = 8000

function keyOf(url) {
  let key = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '')
  if (url.searchParams.get('cover') === '1') key += '@cover'
  return key
}

async function fromCopy(request, env) {
  const url = new URL(request.url)
  const key = keyOf(url)
  if (!key || key.includes('..')) return null
  const obj = await env.TOURS.get(key)
  if (!obj) return null
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('etag', obj.httpEtag)
  // the scripts and styles carry their content in their name; the rest may change at the next publication
  headers.set('cache-control', key.startsWith('_next/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
  headers.set('x-roomia-copy', '1')
  return new Response(request.method === 'HEAD' ? null : obj.body, { headers })
}

export default {
  async fetch(request, env) {
    const reading = request.method === 'GET' || request.method === 'HEAD'
    // 26 Nov: the 8 s limit is for the PC's first answer only (an abort signal would also cut a big 360° still downloading)
    let timer
    const late = new Promise(resolve => (timer = setTimeout(() => resolve(null), TIMEOUT_MS)))
    const live = await (reading ? Promise.race([fetch(request), late]) : fetch(request)).catch(() => null)
    clearTimeout(timer)
    if (!reading || (live && live.status < 500)) return live ?? new Response('Roomia est momentanément indisponible.', { status: 503 })
    const copy = await fromCopy(request, env).catch(() => null)
    if (copy) return copy
    return live ?? new Response('Roomia est momentanément indisponible.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  },
}
