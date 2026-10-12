import { readFile, stat } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { countTriangles, fitImportedRoom } from '../studio-import/fit-imported-room'
import { MAX_IMPORT_BYTES, MAX_IMPORT_TRIANGLES } from '../studio-import/formats'

export interface StudioCheck {
  ok: boolean
  problems: string[]
  /** Things Studio will tell the user about that come from the file itself, not from preparation. */
  warnings: string[]
  triangles: number
  room: { width: number; length: number; height: number }
}

/** world bounds [minX, minY, minZ, maxX, maxY, maxZ] the file should have */
export type ExpectedBounds = number[]

const BOUNDS_TOLERANCE_M = 0.02

/**
 * Loads a prepared file with the same loader and fitting code Studio uses and reports
 * whether Studio would accept it and see the room where the source has it.
 */
export async function checkStudioCompat(glbPath: string, expected: ExpectedBounds): Promise<StudioCheck> {
  const problems: string[] = []
  const warnings: string[] = []
  const buf = await readFile(glbPath)
  const bytes = (await stat(glbPath)).size
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  // Textures need a browser to decode; here only the geometry matters, so skip the images.
  const globals = globalThis as { self?: unknown }
  const hadSelf = 'self' in globals
  const prevLoad = THREE.TextureLoader.prototype.load
  if (!hadSelf) globals.self = globalThis
  THREE.TextureLoader.prototype.load = (_url, onLoad) => {
    const placeholder = new THREE.Texture() as THREE.Texture<HTMLImageElement>
    queueMicrotask(() => onLoad?.(placeholder))
    return placeholder
  }
  let scene: THREE.Group
  try {
    scene = await new Promise<THREE.Group>((resolve, reject) => {
      new GLTFLoader().parse(ab, '', gltf => resolve(gltf.scene), reject)
    })
  } finally {
    THREE.TextureLoader.prototype.load = prevLoad
    if (!hadSelf) delete globals.self
  }
  scene.updateMatrixWorld(true)

  const triangles = countTriangles(scene)
  if (triangles > MAX_IMPORT_TRIANGLES) problems.push(`${triangles} triangles (Studio max ${MAX_IMPORT_TRIANGLES})`)
  if (bytes > MAX_IMPORT_BYTES) problems.push(`${bytes} bytes (Studio max ${MAX_IMPORT_BYTES})`)

  const box = new THREE.Box3().setFromObject(scene)
  const got = [...box.min.toArray(), ...box.max.toArray()]
  const drift = Math.max(...got.map((v, i) => Math.abs(v - expected[i])))
  if (!(drift <= BOUNDS_TOLERANCE_M)) {
    problems.push(`Studio measures the scene ${(drift * 100).toFixed(0)} cm away from the source (stray geometry?)`)
  }

  const fit = fitImportedRoom(scene, { zUp: false, unit: 'auto' })
  if (fit.resolvedUnit !== 'm') problems.push(`Studio would read the unit as ${fit.resolvedUnit}, not metres`)
  if (fit.scaleWarning) warnings.push(fit.scaleWarning)

  return { ok: problems.length === 0, problems, warnings, triangles, room: fit.room }
}
