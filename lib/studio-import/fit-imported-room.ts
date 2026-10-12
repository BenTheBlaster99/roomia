import * as THREE from 'three'

export type LengthUnit = 'm' | 'cm' | 'mm' | 'in'
export type ImportLengthUnit = 'auto' | LengthUnit

export const UNIT_TO_METERS: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
}

export const UNIT_LABELS: Record<ImportLengthUnit, string> = {
  auto: 'Auto',
  m: 'Mètres',
  cm: 'Centimètres',
  mm: 'Millimètres',
  in: 'Pouces',
}

const UNIT_GUESS_ORDER: LengthUnit[] = ['m', 'cm', 'mm', 'in']
const ROOM_MIN_M = 2.4
const ROOM_MAX_M = 28
const ROOM_TARGET_M = 10

/**
 * Pick the unit that turns the longest edge into a plausible apartment
 * (about 2.4–28 m). Prefers metric. 1100 was wrongly read as mm (1.1 m)
 * instead of cm (11 m) — that's why Roomia sofas looked like buildings.
 */
export function guessLengthUnit(maxDim: number): LengthUnit {
  if (!Number.isFinite(maxDim) || maxDim <= 0) return 'm'

  const candidates = UNIT_GUESS_ORDER.map(unit => {
    const meters = maxDim * UNIT_TO_METERS[unit]
    const inRange = meters >= ROOM_MIN_M && meters <= ROOM_MAX_M
    const dist = Math.abs(Math.log(Math.max(meters, 1e-6) / ROOM_TARGET_M))
    return { unit, meters, inRange, dist }
  })

  const inRange = candidates.filter(c => c.inRange)
  const pool = inRange.length ? inRange : candidates
  const metric = pool.filter(c => c.unit !== 'in')
  const pickFrom = metric.length ? metric : pool
  return pickFrom.sort((a, b) => a.dist - b.dist)[0].unit
}

export function countTriangles(root: THREE.Object3D): number {
  let n = 0
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const index = mesh.geometry.index
    if (index) {
      n += index.count / 3
      return
    }
    const pos = mesh.geometry.getAttribute('position')
    if (pos) n += pos.count / 3
  })
  return Math.round(n)
}

function measure(root: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  return { box, size }
}

export function configureImportedMaterials(root: THREE.Object3D) {
  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of materials) {
      if (!mat) continue
      mat.side = THREE.DoubleSide
      const std = mat as THREE.MeshStandardMaterial
      if (std.map) std.map.colorSpace = THREE.SRGBColorSpace
      mat.needsUpdate = true
    }
  })
}

export interface FitImportedRoomOptions {
  zUp: boolean
  unit: ImportLengthUnit
  /** Rooms larger than this get a "suspicious scale" warning. A whole site is fine for prepared scenes. */
  maxRoomMeters?: number
}

export interface FittedImportedRoom {
  object: THREE.Group
  room: { width: number; length: number; height: number }
  resolvedUnit: LengthUnit
  maxDimMeters: number
  scaleWarning: string | null
}

export function fitImportedRoom(
  source: THREE.Object3D,
  options: FitImportedRoomOptions,
): FittedImportedRoom {
  const root = new THREE.Group()
  root.name = 'imported-room'
  const clone = source.clone(true)
  root.add(clone)

  if (options.zUp) {
    clone.rotation.x += -Math.PI / 2
  }

  const first = measure(root)
  const maxRaw = Math.max(first.size.x, first.size.y, first.size.z)
  const resolvedUnit = options.unit === 'auto' ? guessLengthUnit(maxRaw) : options.unit
  const scale = UNIT_TO_METERS[resolvedUnit]
  if (scale !== 1) clone.scale.multiplyScalar(scale)

  const scaled = measure(root)
  clone.position.x -= scaled.box.min.x
  clone.position.y -= scaled.box.min.y
  clone.position.z -= scaled.box.min.z

  const final = measure(root)
  configureImportedMaterials(root)

  const width = Math.max(final.size.x, 1)
  const length = Math.max(final.size.z, 1)
  const height = Math.min(Math.max(final.size.y, 2.2), 12)
  const maxDimMeters = Math.max(width, length, height)

  let scaleWarning: string | null = null
  const maxRoomMeters = options.maxRoomMeters ?? 40
  if (maxDimMeters > maxRoomMeters) {
    scaleWarning =
      `Échelle suspecte (pièce > ${maxRoomMeters} m). Changez l’unité dans les options (mm / cm / m).`
  } else if (maxDimMeters < 1.6) {
    scaleWarning =
      'Échelle suspecte (pièce < 1,6 m). Changez l’unité ci-dessus (mm / cm / m).'
  }

  return {
    object: root,
    room: { width, length, height },
    resolvedUnit,
    maxDimMeters,
    scaleWarning,
  }
}
