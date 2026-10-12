import { stat } from 'node:fs/promises'
import { Document, NodeIO, Primitive } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshGPUInstancing, type InstancedMesh } from '@gltf-transform/extensions'
import {
  dedup,
  getBounds,
  instance,
  normals,
  prune,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { checkStudioCompat, type StudioCheck } from './studio-check'

type Log = (line: string) => void

/** Studio refuses above 800k triangles; aim lower so the copy loads comfortably. */
const TARGET_TRIANGLES = 600_000
/** Simplifier error steps, relative to each mesh's size. Flat panels barely move at any of these. */
const ERROR_STEPS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02]
const TEXTURE_SIZE = 1024

export interface ViewportReport {
  inBytes: number
  outBytes: number
  trianglesIn: number
  trianglesOut: number
  instancedCopies: number
  seconds: number
  studio: StudioCheck
}

function primitiveTriangles(prim: Primitive): number {
  if (prim.getMode() !== Primitive.Mode.TRIANGLES) return 0
  const indices = prim.getIndices()
  if (indices) return indices.getCount() / 3
  return (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3
}

/** Same rule as Studio's countTriangles: each mesh node counts once, instanced or not. */
function drawnTriangles(doc: Document): number {
  let drawn = 0
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    for (const prim of mesh.listPrimitives()) drawn += primitiveTriangles(prim)
  }
  return Math.round(drawn)
}

function instancedCopies(doc: Document): number {
  let n = 0
  for (const node of doc.getRoot().listNodes()) {
    const ext = node.getExtension<InstancedMesh>(EXTMeshGPUInstancing.EXTENSION_NAME)
    n += ext?.getAttribute('TRANSLATION')?.getCount() ?? 0
  }
  return n
}

function sceneBounds(doc: Document): number[] {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
  const { min, max } = getBounds(scene)
  return [...min, ...max]
}

/**
 * SketchUp exports loose triangles, each with its own flat normal, so nothing is
 * connected and the simplifier can't collapse anything. For the viewport copy we
 * drop lines, normals (and UVs where no texture uses them), weld, simplify, then rebuild
 * normals.
 */
function stripSeamAttributes(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      // SketchUp guide/section lines can span kilometres; Studio would size the room around them.
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
        mesh.removePrimitive(prim)
        continue
      }
      prim.setAttribute('NORMAL', null)
      const material = prim.getMaterial()
      const textured =
        material &&
        (material.getBaseColorTexture() ||
          material.getNormalTexture() ||
          material.getMetallicRoughnessTexture() ||
          material.getOcclusionTexture() ||
          material.getEmissiveTexture())
      if (!textured) {
        for (const semantic of prim.listSemantics()) {
          if (semantic.startsWith('TEXCOORD_')) prim.setAttribute(semantic, null)
        }
      }
    }
    if (mesh.listPrimitives().length === 0) mesh.dispose()
  }
}

/**
 * Heavy GLB in → light GLB out for the Studio viewport. The input is never modified and
 * the output keeps the same world coordinates, so a camera picked on it is valid for the
 * heavy source. Throws if Studio would not accept or misread the result.
 */
export async function makeViewportGlb(input: string, output: string, log: Log = () => {}): Promise<ViewportReport> {
  const t0 = performance.now()
  const lap = (label: string, since: number) =>
    log(`  ${label.padEnd(22)} ${((performance.now() - since) / 1000).toFixed(1)}s`)

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  await MeshoptSimplifier.ready

  let t = performance.now()
  const doc = await io.read(input)
  lap('read', t)

  const trianglesIn = drawnTriangles(doc)
  const inBytes = (await stat(input)).size

  t = performance.now()
  stripSeamAttributes(doc)
  const expected = sceneBounds(doc)
  await doc.transform(dedup(), instance({ min: 2 }), prune(), weld())
  lap('dedup + instance', t)
  log(`     after dedup: ${drawnTriangles(doc)} drawn tris, ${instancedCopies(doc)} instanced copies`)

  t = performance.now()
  for (const error of ERROR_STEPS) {
    if (drawnTriangles(doc) <= TARGET_TRIANGLES) break
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0, error }))
    log(`     simplify error=${error}: ${drawnTriangles(doc)} drawn tris`)
  }
  await doc.transform(prune(), normals({ overwrite: true }))
  lap('simplify', t)

  t = performance.now()
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE] }),
  )
  lap('textures', t)

  t = performance.now()
  await io.write(output, doc)
  lap('write', t)

  const studio = await checkStudioCompat(output, expected)
  const report: ViewportReport = {
    inBytes,
    outBytes: (await stat(output)).size,
    trianglesIn,
    trianglesOut: drawnTriangles(doc),
    instancedCopies: instancedCopies(doc),
    seconds: (performance.now() - t0) / 1000,
    studio,
  }
  if (!studio.ok) throw new Error(`Light copy rejected by the Studio check: ${studio.problems.join('; ')}`)
  return report
}
