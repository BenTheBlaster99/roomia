import { nanoid } from 'nanoid'
import { CATEGORY_DIMS } from './studio-constants'
import type { CatalogItem } from './mock-catalog'
import type { PlacedItem } from '../store/useStudioStore'

const WALL_ROLE = ['Bed', 'Sofa', 'Wardrobe', 'TV Unit', 'Bookshelf']
const FRONT_ROLE = ['Coffee Table', 'Side Table']
const SIDE_ROLE = ['Dining Table']
const FLANK_ROLE = ['Chair']
const FLOOR_ROLE = ['Rug']
const CEILING_ROLE = ['Light']

export function placeFurnitureInRoom(
  items: CatalogItem[],
  room: { width: number; length: number },
): PlacedItem[] {
  const { width: w, length: l } = room
  const margin = 0.3
  const placed: PlacedItem[] = []
  const taken: { x: number; z: number; w: number; d: number }[] = []

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val))

  function overlaps(x: number, z: number, fw: number, fd: number) {
    return taken.some(
      t =>
        Math.abs(x - t.x) < (fw + t.w) / 2 + 0.15 &&
        Math.abs(z - t.z) < (fd + t.d) / 2 + 0.15,
    )
  }

  function place(item: CatalogItem, x: number, z: number, rotationY = 0) {
    const dims = CATEGORY_DIMS[item.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    const cx = clamp(x, margin + dims.width / 2, w - margin - dims.width / 2)
    const cz = clamp(z, margin + dims.depth / 2, l - margin - dims.depth / 2)
    placed.push({
      id: nanoid(),
      furnitureId: item.id,
      name: item.name,
      category: item.category,
      modelUrl: item.modelUrl,
      position: { x: cx, z: cz },
      rotationY,
      dimensions: dims,
      color: item.color,
      price: item.price,
      notes: item.notes ?? null,
    })
    taken.push({ x: cx, z: cz, w: dims.width, d: dims.depth })
  }

  const byRole = (roles: string[]) => items.filter(i => roles.includes(i.category))
  const wallItems = byRole(WALL_ROLE)
  const frontItems = byRole(FRONT_ROLE)
  const sideItems = byRole(SIDE_ROLE)
  const flankItems = byRole(FLANK_ROLE)
  const floorItems = byRole(FLOOR_ROLE)
  const ceilItems = byRole(CEILING_ROLE)
  const placedRoles = [
    ...WALL_ROLE,
    ...FRONT_ROLE,
    ...SIDE_ROLE,
    ...FLANK_ROLE,
    ...FLOOR_ROLE,
    ...CEILING_ROLE,
  ]
  const restItems = items.filter(i => !placedRoles.includes(i.category))

  wallItems.forEach((item, i) => {
    const dims = CATEGORY_DIMS[item.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    const spread = i - (wallItems.length - 1) / 2
    place(
      item,
      w / 2 + spread * (dims.width + 0.3),
      margin + dims.depth / 2,
    )
  })

  frontItems.forEach(item => {
    place(item, w / 2, margin + 1.6)
  })

  sideItems.forEach((item, i) => {
    const dims = CATEGORY_DIMS[item.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    place(item, w - margin - dims.width / 2, margin + 0.5 + i * 0.4)
  })

  flankItems.forEach((item, i) => {
    const side = i % 2 === 0 ? w * 0.22 : w * 0.78
    place(item, side, margin + 1.9 + Math.floor(i / 2) * 0.9)
  })

  floorItems.forEach(item => {
    place(item, w / 2, l * 0.45)
  })

  ceilItems.forEach((item, i) => {
    const x = i % 2 === 0 ? margin + 0.3 : w - margin - 0.3
    place(item, x, l - margin - 0.3)
  })

  restItems.forEach((item, i) => {
    const dims = CATEGORY_DIMS[item.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    let x = margin + dims.width / 2 + i * (dims.width + 0.3)
    let z = l - margin - dims.depth / 2
    if (overlaps(x, z, dims.width, dims.depth)) z = l * 0.65
    place(item, x, z)
  })

  return placed
}
