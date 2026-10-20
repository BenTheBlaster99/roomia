import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { sceneDir } from './scene-store'

/** A photo the user put on hold (the image service was too slow): the settings to run it again. */
export interface HeldRender {
  id: string
  createdAt: number
  /** Readable name for the list, e.g. "Scène 3 · après-midi". */
  label: string
  /** Same fields as a photo request, without sceneId: cameraIndex or current, time, sun, interior, lens. */
  request: Record<string, unknown>
}

const MAX_HELD = 20
const REQUEST_KEYS = ['cameraIndex', 'current', 'time', 'sun', 'interior', 'lens'] as const

const heldPath = (sceneId: string) => path.join(sceneDir(sceneId), 'held.json')

export async function readHeld(sceneId: string): Promise<HeldRender[]> {
  const raw = await readFile(heldPath(sceneId), 'utf8').catch(() => null)
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as HeldRender[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function writeHeld(sceneId: string, list: HeldRender[]) {
  await writeFile(heldPath(sceneId), JSON.stringify(list))
}

/** Keeps only the fields that describe the view and light, so a held render can't carry anything else. */
export function pickRequest(body: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {}
  for (const key of REQUEST_KEYS) if (body[key] !== undefined) request[key] = body[key]
  return request
}

export async function addHeld(sceneId: string, label: string, request: Record<string, unknown>): Promise<HeldRender[]> {
  const list = await readHeld(sceneId)
  const entry: HeldRender = { id: nanoid(10), createdAt: Date.now(), label: label.slice(0, 80), request }
  const next = [entry, ...list].slice(0, MAX_HELD)
  await writeHeld(sceneId, next)
  return next
}

export async function removeHeld(sceneId: string, id: string): Promise<HeldRender[]> {
  const next = (await readHeld(sceneId)).filter(h => h.id !== id)
  await writeHeld(sceneId, next)
  return next
}
