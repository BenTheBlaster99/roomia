import { fileExtension } from './formats'

const POLL_MS = 1500
const POLL_TIMEOUT_MS = 20 * 60_000

/** Formats the server can turn into a light copy. */
export function canPrepareOnServer(fileName: string): boolean {
  const ext = fileExtension(fileName)
  return ext === 'dae' || ext === 'glb' || ext === 'zip'
}

export type ServerPrepResult =
  | { ok: true; viewport: ArrayBuffer; sceneId: string; missingTextures: string[] }
  | { ok: false; message: string }

function upload(file: File, onPhase: (message: string) => void): Promise<{ id: string } | { error: string }> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/scenes')
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onPhase(`Envoi… ${Math.round((e.loaded / e.total) * 100)} %`)
    }
    xhr.onerror = () => resolve({ error: 'Envoi impossible. Vérifiez votre connexion.' })
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string; detail?: string }
        if (xhr.status === 200 && body.id) return resolve({ id: body.id })
        resolve({ error: body.detail ?? 'Envoi refusé par le serveur.' })
      } catch {
        resolve({ error: 'Réponse inattendue du serveur.' })
      }
    }
    xhr.send(file)
  })
}

const CHUNK_BYTES = 2 * 1024 * 1024

async function fetchPiece(url: string, start: number): Promise<{ bytes: Uint8Array; total: number }> {
  let lastError = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` } })
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      // 206 carries "bytes a-b/total"; a plain 200 means the server sent the whole file.
      const total = Number(/\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')?.[1] ?? bytes.length)
      const expected = Number(res.headers.get('Content-Length') ?? bytes.length)
      if (bytes.length !== expected) throw new Error(`reçu ${bytes.length} / ${expected} octets`)
      return { bytes, total }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`viewport piece at ${start}, attempt ${attempt} failed:`, lastError)
      await new Promise(r => setTimeout(r, 400 * attempt))
    }
  }
  throw new Error(`${lastError} à l’octet ${start}`)
}

/**
 * Downloads the light copy in 2 MB pieces, each retried on its own, straight into memory
 * (no browser blob). A flaky connection costs one piece, not the whole file.
 */
async function downloadViewport(
  sceneId: string,
  missingTextures: string[],
  onPhase: (message: string) => void,
): Promise<ServerPrepResult> {
  const url = `/api/scenes/${sceneId}/viewport`
  try {
    const first = await fetchPiece(url, 0)
    const out = new Uint8Array(first.total)
    out.set(first.bytes, 0)
    let offset = first.bytes.length
    while (offset < first.total) {
      onPhase(`Téléchargement de l’aperçu… ${Math.round((offset / first.total) * 100)} %`)
      const piece = await fetchPiece(url, offset)
      out.set(piece.bytes, offset)
      offset += piece.bytes.length
    }
    return { ok: true, viewport: out.buffer, sceneId, missingTextures }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Impossible de télécharger l’aperçu allégé (${detail}).` }
  }
}

/**
 * Sends a heavy scene to the server, waits for it to be prepared, and returns the light
 * copy. The original stays on the server for rendering.
 */
export async function prepareOnServer(
  file: File,
  onPhase: (message: string) => void,
): Promise<ServerPrepResult> {
  onPhase('Envoi… 0 %')
  const sent = await upload(file, onPhase)
  if ('error' in sent) return { ok: false, message: sent.error }

  onPhase('Préparation de la scène…')
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS))
    let status: { status: string; error?: string; report?: { missingTextures?: string[] } }
    try {
      const res = await fetch(`/api/scenes/${sent.id}`)
      status = (await res.json()) as typeof status
      if (!res.ok) return { ok: false, message: 'Scène introuvable sur le serveur.' }
    } catch {
      continue
    }
    if (status.status === 'failed') {
      return {
        ok: false,
        message: `Roomia n’a pas réussi à préparer cette scène${status.error ? ` (${status.error})` : ''}.`,
      }
    }
    if (status.status === 'ready') {
      return downloadViewport(sent.id, status.report?.missingTextures ?? [], onPhase)
    }
  }
  return { ok: false, message: 'La préparation prend trop de temps. Réessayez.' }
}
