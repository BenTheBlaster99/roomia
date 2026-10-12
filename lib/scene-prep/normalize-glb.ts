import { NodeIO, type Document } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { metalRough } from '@gltf-transform/functions'

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
export async function normalizeGlb(input: string, output: string, log: (line: string) => void = () => {}): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const doc = await io.read(input)
  makeGlassTranslucent(doc)
  const specGloss = doc
    .getRoot()
    .listExtensionsUsed()
    .some(ext => ext.extensionName === SPEC_GLOSS)
  if (!specGloss) {
    await io.write(output, doc)
    return
  }
  await doc.transform(metalRough())
  // The conversion carries the exporter's placeholder specular (0.5) over as IOR/specular
  // extensions, which turns every surface into a mirror. Drop them: plain dielectric finishes.
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (PLACEHOLDER_EXTENSIONS.has(ext.extensionName)) ext.dispose()
  }
  log(`glb: converted ${doc.getRoot().listMaterials().length} specular/glossiness materials to metal/roughness`)
  await io.write(output, doc)
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
