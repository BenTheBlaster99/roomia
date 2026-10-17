import { NodeIO, type Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { metalRough } from '@gltf-transform/functions'
import { loadSharp } from '../load-sharp'

const SPEC_GLOSS = 'KHR_materials_pbrSpecularGlossiness'
/** SketchUp glass lives in a material's opacity setting, which GLB/DAE exports often drop. */
export const GLASS_NAME = /glass|verre|vitre|window/i
export const GLASS_ALPHA = 0.25

const PLACEHOLDER_EXTENSIONS = new Set(['KHR_materials_ior', 'KHR_materials_specular'])

/**
 * Copies an uploaded GLB to the source path, converting old-style specular/glossiness
 * materials (written by some SketchUp exporters, e.g. SimLab) to standard metal/roughness.
 * three.js no longer reads specular/glossiness and falls back to the exporter's placeholder
 * values (50% metallic), which renders wood and paint nearly black.
 */
export async function normalizeGlb(input: string, output: string, log: (line: string) => void = () => {}): Promise<number> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const doc = await io.read(input)
  makeGlassTranslucent(doc)
  const placeholders = await removePlaceholderTextures(doc)
  if (placeholders) log(`glb: removed ${placeholders} "invalid Texture" placeholder images left by the exporter`)
  const specGloss = doc
    .getRoot()
    .listExtensionsUsed()
    .some(ext => ext.extensionName === SPEC_GLOSS)
  if (!specGloss) {
    await io.write(output, doc)
    return placeholders
  }
  await doc.transform(metalRough())
  // The conversion carries the exporter's placeholder specular (0.5) over as IOR/specular
  // extensions, which turns every surface into a mirror. Drop them: plain dielectric finishes.
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (PLACEHOLDER_EXTENSIONS.has(ext.extensionName)) ext.dispose()
  }
  log(`glb: converted ${doc.getRoot().listMaterials().length} specular/glossiness materials to metal/roughness`)
  await io.write(output, doc)
  return placeholders
}

/** SimLab's GLB export writes a 518×392 image ("invalid Texture" on flat orange, or plain green/black) for each texture it failed to export. */
const PLACEHOLDER_SIZE = { width: 518, height: 392 }
const PLACEHOLDER_FLAT_SHARE = 0.85

async function isPlaceholderImage(image: Uint8Array): Promise<boolean> {
  const sharp = loadSharp()
  const meta = await sharp(Buffer.from(image)).metadata().catch(() => null)
  if (meta?.width !== PLACEHOLDER_SIZE.width || meta?.height !== PLACEHOLDER_SIZE.height) return false
  const { data, info } = await sharp(Buffer.from(image)).raw().toBuffer({ resolveWithObject: true })
  const counts = new Map<number, number>()
  for (let i = 0; i < data.length; i += info.channels) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const top = Math.max(...counts.values())
  return top / (info.width * info.height) >= PLACEHOLDER_FLAT_SHARE
}

/**
 * Drops the exporter's placeholder images so those surfaces keep their plain material colour
 * instead of showing the words "invalid Texture" (which the photo step then faithfully copies).
 */
export async function removePlaceholderTextures(doc: Document): Promise<number> {
  let removed = 0
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage()
    if (image && (await isPlaceholderImage(image))) {
      texture.dispose()
      removed++
    }
  }
  return removed
}

/** Opaque materials named like glass become translucent, so windows stay see-through. */
export function makeGlassTranslucent(doc: Document): number {
  let changed = 0
  for (const material of doc.getRoot().listMaterials()) {
    const [r, g, b, a] = material.getBaseColorFactor()
    if (!GLASS_NAME.test(material.getName()) || a <= GLASS_ALPHA) continue
    material.setBaseColorFactor([r, g, b, GLASS_ALPHA]).setAlphaMode('BLEND')
    changed++
  }
  return changed
}
