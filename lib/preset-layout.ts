import { nanoid } from 'nanoid'
import { CATEGORY_DIMS } from './studio-constants'
import { clampToRoom, itemFootprint } from './studio-footprint'
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
  roomType?: string,
): PlacedItem[] {
  const { width: w, length: l } = room
  const inset = 0.12
  const placed: PlacedItem[] = []
  const taken: { x: number; z: number; w: number; d: number }[] = []

  function overlaps(x: number, z: number, fw: number, fd: number) {
    return taken.some(
      t =>
        Math.abs(x - t.x) < (fw + t.w) / 2 + 0.15 &&
        Math.abs(z - t.z) < (fd + t.d) / 2 + 0.15,
    )
  }

  function dimsOf(item: CatalogItem) {
    return (
      item.dimensions ??
      CATEGORY_DIMS[item.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    )
  }

  function place(item: CatalogItem, x: number, z: number, rotationY = 0) {
    const dims = dimsOf(item)
    const pos = clampToRoom(x, z, dims, rotationY, room, false)
    const fp = itemFootprint(dims, rotationY)
    placed.push({
      id: nanoid(),
      furnitureId: item.id,
      name: item.name,
      category: item.category,
      modelUrl: item.modelUrl,
      position: pos,
      rotationY,
      dimensions: dims,
      color: item.color,
      price: item.price,
      notes: item.notes ?? null,
    })
    taken.push({ x: pos.x, z: pos.z, w: fp.w, d: fp.d })
  }

  if (roomType === 'Bedroom') {
    const bed = items.find(i => i.category === 'Bed')
    const wardrobe = items.find(i => i.category === 'Wardrobe')
    const sideTable = items.find(i => i.category === 'Side Table')
    const chair = items.find(i => i.category === 'Chair')
    const rug = items.find(i => i.category === 'Rug')
    const light = items.find(i => i.category === 'Light')
    const used = new Set(
      [bed, wardrobe, sideTable, chair, rug, light].filter(Boolean).map(i => i!.id),
    )

    if (bed) {
      const dims = dimsOf(bed)
      place(bed, inset + dims.width / 2, dims.depth / 2, 0)
    }

    if (wardrobe) {
      const dims = dimsOf(wardrobe)
      // Right wall, flush, doors facing into the room (+Z local → -X)
      place(wardrobe, w - dims.depth / 2, l * 0.45, Math.PI / 2)
    }

    if (sideTable && bed) {
      const bedDims = dimsOf(bed)
      const st = dimsOf(sideTable)
      place(
        sideTable,
        inset + bedDims.width + 0.12 + st.width / 2,
        st.depth / 2,
        0,
      )
    } else if (sideTable) {
      place(sideTable, w * 0.35, inset + 0.4, 0)
    }

    if (chair) {
      const dims = dimsOf(chair)
      place(chair, inset + 0.15 + dims.width / 2, l * 0.72, 0)
    }

    if (rug) {
      place(rug, w * 0.42, l * 0.58, 0)
    }

    if (light) {
      place(light, w * 0.45, l * 0.4, 0)
    }

    items.filter(i => !used.has(i.id)).forEach((item, i) => {
      const dims = dimsOf(item)
      place(item, inset + dims.width / 2 + i * (dims.width + 0.25), l - dims.depth / 2, 0)
    })

    return placed
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

  // Back wall (small z): pieces face into the room (+Z)
  wallItems.forEach((item, i) => {
    const dims = dimsOf(item)
    const spread = i - (wallItems.length - 1) / 2
    place(
      item,
      w / 2 + spread * (dims.width + 0.3),
      dims.depth / 2,
      0,
    )
  })

  frontItems.forEach(item => {
    place(item, w / 2, inset + 1.5, 0)
  })

  sideItems.forEach((item, i) => {
    const dims = dimsOf(item)
    place(item, w - dims.depth / 2, inset + 0.5 + i * 0.4, Math.PI / 2)
  })

  // Chairs face the camera / into the room so they aren't shown from behind
  flankItems.forEach((item, i) => {
    const side = i % 2 === 0 ? w * 0.22 : w * 0.78
    place(item, side, inset + 1.8 + Math.floor(i / 2) * 0.9, 0)
  })

  floorItems.forEach(item => {
    place(item, w / 2, l * 0.45, 0)
  })

  ceilItems.forEach((item, i) => {
    const x = i % 2 === 0 ? inset + 0.3 : w - inset - 0.3
    place(item, x, l - 0.35, 0)
  })

  restItems.forEach((item, i) => {
    const dims = dimsOf(item)
    let x = inset + dims.width / 2 + i * (dims.width + 0.3)
    let z = l - dims.depth / 2
    if (overlaps(x, z, dims.width, dims.depth)) z = l * 0.65
    place(item, x, z, 0)
  })

  return placed
}
