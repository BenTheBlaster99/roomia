/** World-space footprint after Y rotation (90° swaps width/depth). */
export function itemFootprint(
  dims: { width: number; depth: number },
  rotationY: number,
): { w: number; d: number } {
  const quarter = Math.round(Math.abs(rotationY / (Math.PI / 2))) % 2
  return quarter === 1
    ? { w: dims.depth, d: dims.width }
    : { w: dims.width, d: dims.depth }
}

const WALL_EPS = 0.002
const WALL_SNAP = 0.22

/** Keep a piece inside the room. `snap` pulls it flush when close to a wall. */
export function clampToRoom(
  x: number,
  z: number,
  dims: { width: number; depth: number },
  rotationY: number,
  room: { width: number; length: number },
  snap = false,
): { x: number; z: number } {
  const fp = itemFootprint(dims, rotationY)
  const minX = WALL_EPS + fp.w / 2
  const maxX = room.width - WALL_EPS - fp.w / 2
  const minZ = WALL_EPS + fp.d / 2
  const maxZ = room.length - WALL_EPS - fp.d / 2
  let cx = Math.max(minX, Math.min(maxX, x))
  let cz = Math.max(minZ, Math.min(maxZ, z))
  if (snap) {
    if (cx - minX < WALL_SNAP) cx = minX
    if (maxX - cx < WALL_SNAP) cx = maxX
    if (cz - minZ < WALL_SNAP) cz = minZ
    if (maxZ - cz < WALL_SNAP) cz = maxZ
  }
  return { x: cx, z: cz }
}
