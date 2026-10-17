import { fileExtension } from './formats'

const POLL_MS = 1500
const POLL_TIMEOUT_MS = 20 * 60_000

/** Formats the server can turn into a light copy. */
export function canPrepareOnServer(fileName: string): boolean {
  const ext = fileExtension(fileName)
  return ext === 'dae' || ext === 'glb' || ext === 'zip'
}

/** Files above this go up in small pieces, each retried on its own, so one dropped connection costs seconds, not minutes. */
const CHUNK_THRESHOLD = 8 * 1024 * 1024
const PIECE_ATTEMPTS = 5

async function sendPiece(sceneId: string, index: number, piece: Blob): Promise<void> {
  let lastError = ''
  for (let attempt = 1; attempt <= PIECE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`/api/scenes/${sceneId}/chunk?index=${index}`, { method: 'PUT', body: piece })
      if (res.ok) return
      lastError = ((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? `HTTP ${res.status}`
      if (res.status >= 400 && res.status < 500) break // a refused piece will not succeed on retry
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise(r => setTimeout(r, 700 * attempt))
  }
  throw new Error(lastError || 'connexion perdue')
}

async function uploadChunked(
  file: File,
  onPhase: (message: string) => void,
): Promise<{ id: string } | { error: string }> {
  try {
    const startRes = await fetch('/api/scenes/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, size: file.size }),
    })
    const start = (await startRes.json().catch(() => ({}))) as { id?: string; chunkBytes?: number; total?: number; detail?: string }
    if (!startRes.ok || !start.id || !start.chunkBytes || !start.total) {
      return { error: start.detail ?? 'Envoi refusé par le serveur.' }
    }

    const sendAll = async (indexes: number[]) => {
      for (const index of indexes) {
        const from = index * start.chunkBytes!
        await sendPiece(start.id!, index, file.slice(from, Math.min(file.size, from + start.chunkBytes!)))
        onPhase(`Envoi… ${Math.round(((index + 1) / start.total!) * 100)} %`)
      }
    }
    await sendAll(Array.from({ length: start.total }, (_, i) => i))

    for (let attempt = 0; attempt < 3; attempt++) {
      const done = await fetch(`/api/scenes/${start.id}/complete`, { method: 'POST' })
      if (done.ok) return { id: start.id }
      const body = (await done.json().catch(() => ({}))) as { detail?: string; missing?: number[] }
      if (done.status === 409 && body.missing?.length) await sendAll(body.missing) // resend what the server lacks
      else return { error: body.detail ?? 'Fin de l’envoi impossible.' }
    }
    return { error: 'Fin de l’envoi impossible.' }
  } catch (err) {
    return { error: `Envoi interrompu (${err instanceof Error ? err.message : 'connexion perdue'}). Réessayez.` }
  }
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
  const sent = file.size > CHUNK_THRESHOLD ? await uploadChunked(file, onPhase) : await upload(file, onPhase)
  if ('error' in sent) return { ok: false, message: sent.error }

  return waitForScene(sent.id, onPhase)
}

/**
 * Waits for a scene to be prepared on the server and downloads its light copy. Used right after an
 * upload, and to reopen a scene that is already on the server.
 */
export async function waitForScene(sceneId: string, onPhase: (message: string) => void): Promise<ServerPrepResult & { fileName?: string }> {
  onPhase('Préparation de la scène…')
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS))
    let status: { status: string; error?: string; fileName?: string; report?: { missingTextures?: string[] } }
    try {
      const res = await fetch(`/api/scenes/${sceneId}`)
      status = (await res.json()) as typeof status
      if (!res.ok) return { ok: false, message: 'Scène introuvable sur le serveur.' }
    } catch {
      continue
    }
    if (status.status === 'failed') {
      return {
        ok: false,
        message: status.error
          ? `Roomia n’a pas réussi à préparer cette scène : ${status.error}`
          : 'Roomia n’a pas réussi à préparer cette scène.',
      }
    }
    if (status.status === 'ready') {
      const downloaded = await downloadViewport(sceneId, status.report?.missingTextures ?? [], onPhase)
      return downloaded.ok ? { ...downloaded, fileName: status.fileName } : downloaded
    }
  }
  return { ok: false, message: 'La préparation prend trop de temps. Réessayez.' }
}
