import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/** Files found next to a DAE, indexed so texture paths can only ever resolve inside that folder. */
export interface TextureIndex {
  byPath: Map<string, string>
  byName: Map<string, string[]>
}

export const emptyTextureIndex = (): TextureIndex => ({ byPath: new Map(), byName: new Map() })

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])

export async function buildTextureIndex(dir: string): Promise<TextureIndex> {
  const index = emptyTextureIndex()
  const root = path.resolve(dir)

  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
      if (!IMAGE_EXTENSIONS.has(ext)) continue
      const rel = path.relative(root, full).split(path.sep).join('/').toLowerCase()
      index.byPath.set(rel, full)
      const name = entry.name.toLowerCase()
      index.byName.set(name, [...(index.byName.get(name) ?? []), full])
    }
  }
  await walk(root)
  return index
}

function decode(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

/**
 * Maps the path written in the DAE ("CUISINE%20BELFAR/Wood_152.jpg") to an extracted file.
 * Tolerates a renamed folder and different letter case; never touches anything outside the index.
 */
export function resolveTexture(index: TextureIndex, url: string): string | null {
  const wanted = decode(url).replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase()
  const exact = index.byPath.get(wanted)
  if (exact) return exact
  for (const [rel, full] of index.byPath) {
    if (rel.endsWith(`/${wanted}`) || wanted.endsWith(`/${rel}`)) return full
  }
  const matches = index.byName.get(wanted.split('/').pop() ?? '')
  return matches && matches.length === 1 ? matches[0] : null
}

export interface TextureData {
  bytes: Uint8Array
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
}

/** Reads an image as-is when glTF supports it, otherwise converts it to PNG. */
export async function readTexture(file: string): Promise<TextureData | null> {
  try {
    const bytes = await readFile(file)
    const format = (await sharp(bytes).metadata()).format
    if (format === 'jpeg') return { bytes, mimeType: 'image/jpeg' }
    if (format === 'png') return { bytes, mimeType: 'image/png' }
    if (format === 'webp') return { bytes, mimeType: 'image/webp' }
    return { bytes: await sharp(bytes).png().toBuffer(), mimeType: 'image/png' }
  } catch {
    return null
  }
}
