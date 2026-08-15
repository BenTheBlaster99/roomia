import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { CATEGORY_DIMS } from '@/lib/studio-constants'
import { clampToRoom } from '@/lib/studio-footprint'
import { SLUG_TO_STYLE } from '@/lib/style-room-presentation'
import type { CatalogItem } from '@/lib/mock-catalog'
import type { RoomPresetPayload } from '@/types/room-preset'

export type ViewMode = 'perspective' | 'top' | 'front' | 'back' | 'left' | 'right' | 'capture'
export type FloorMaterial = 'wood' | 'tile' | 'concrete' | 'carpet' | 'marble'

export interface RoomConfig {
  width: number
  length: number
  height: number
  floorMaterial: FloorMaterial
  wallColor: string
}

export interface PlacedItem {
  id: string
  furnitureId: string
  name: string
  category: string
  modelUrl: string | null
  position: { x: number; z: number }
  rotationY: number
  dimensions: { width: number; depth: number; height: number }
  color: string
  price: number
  notes?: string | null
}

export interface CartItem {
  furnitureId: string
  name: string
  category: string
  price: number
  quantity: number
}

type Snapshot = { items: PlacedItem[]; room: RoomConfig }
const MAX_HISTORY = 50

interface StudioState {
  room: RoomConfig
  setRoom: (updates: Partial<RoomConfig>) => void
  loadPreset: (payload: RoomPresetPayload) => void

  items: PlacedItem[]
  addItemFromCatalog: (catalog: CatalogItem) => void
  removeItem: (id: string) => void
  updateItem: (id: string, updates: Partial<PlacedItem>) => void
  duplicateItem: (id: string) => void
  moveItem: (id: string, x: number, z: number) => void
  clearRoom: () => void

  selectedId: string | null
  selectItem: (id: string | null) => void

  draggingId: string | null
  dragOffset: { x: number; z: number }
  dragPlaneY: number
  startDrag: (id: string, offset: { x: number; z: number }, planeY?: number) => void
  stopDrag: () => void

  isRotating: boolean
  rotatingItemId: string | null
  rotationData: { startAngle: number; itemStartRotation: number } | null
  startRotationMode: (id: string, pointerX: number, pointerZ: number) => void
  updateRotationFromPointer: (pointerX: number, pointerZ: number) => void
  stopRotationMode: () => void
  rotateItemBy: (id: string, deltaRadians: number) => void
  setItemRotation: (id: string, rotationY: number) => void

  entryGateOpen: boolean
  setEntryGateOpen: (open: boolean) => void

  past: Snapshot[]
  future: Snapshot[]
  snapshot: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  catalogOpen: boolean
  setCatalogOpen: (open: boolean) => void
  toggleCatalog: () => void
  activeRoom: string
  setActiveRoom: (room: string) => void
  activeCategory: string | null
  setActiveCategory: (cat: string | null) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  preFilterStyle: string | null
  setPreFilterStyle: (style: string | null) => void

  roomSettingsOpen: boolean
  setRoomSettingsOpen: (open: boolean) => void

  canvasRef: HTMLCanvasElement | null
  setCanvasRef: (canvas: HTMLCanvasElement | null) => void
  renderPanelOpen: boolean
  setRenderPanelOpen: (open: boolean) => void
  captureMode: boolean
  setCaptureMode: (v: boolean) => void

  cart: CartItem[]
  cartOpen: boolean
  toggleCart: () => void
  setCartOpen: (open: boolean) => void
  addToCart: (item: Omit<CartItem, 'quantity'>) => void
  removeFromCart: (furnitureId: string) => void
  clearCart: () => void
  cartTotal: () => number
}

export const useStudioStore = create<StudioState>((set, get) => ({
  room: {
    width: 5,
    length: 6,
    height: 2.8,
    floorMaterial: 'wood',
    wallColor: '#F5F0EB',
  },
  setRoom: updates => {
    get().snapshot()
    set(state => ({ room: { ...state.room, ...updates } }))
  },

  loadPreset: payload => {
    const styleName = payload.styleId ? SLUG_TO_STYLE[payload.styleId] : null
    const furniture = Array.isArray(payload.furniture) ? payload.furniture : []
    const room: RoomConfig = {
      width: 5,
      length: 6,
      height: 2.8,
      floorMaterial: 'wood',
      wallColor: '#F5F0EB',
      ...payload.room,
    }
    set({
      room,
      items: furniture.map(item => ({
        furnitureId: item.furnitureId,
        name: item.name,
        category: item.category,
        modelUrl: item.modelUrl ?? null,
        position: item.position ?? { x: room.width / 2, z: room.length / 2 },
        rotationY: item.rotationY ?? 0,
        dimensions: item.dimensions ?? { width: 0.8, depth: 0.8, height: 0.8 },
        color: item.color ?? '#888888',
        price: item.price ?? 0,
        notes: item.notes ?? null,
        id: nanoid(),
      })),
      selectedId: null,
      activeRoom: payload.roomType || 'Living Room',
      preFilterStyle: styleName ?? null,
      cart: [],
      past: [],
      future: [],
    })
  },

  items: [],

  addItemFromCatalog: catalog => {
    get().snapshot()
    const { room, items } = get()
    const dims = catalog.dimensions ?? CATEGORY_DIMS[catalog.category] ?? { width: 0.8, depth: 0.8, height: 0.8 }
    let x = room.width / 2
    let z = room.length / 2
    let attempts = 0
    while (
      attempts < 20 &&
      items.some(
        it =>
          Math.abs(it.position.x - x) < (it.dimensions.width + dims.width) / 2 + 0.3 &&
          Math.abs(it.position.z - z) < (it.dimensions.depth + dims.depth) / 2 + 0.3,
      )
    ) {
      x += 0.4
      if (x > room.width - dims.width / 2) {
        x = dims.width / 2
        z += 0.4
      }
      attempts++
    }
    x = Math.max(dims.width / 2, Math.min(room.width - dims.width / 2, x))
    z = Math.max(dims.depth / 2, Math.min(room.length - dims.depth / 2, z))
    const pos = clampToRoom(x, z, dims, 0, room)
    const newItem: PlacedItem = {
      id: nanoid(),
      furnitureId: catalog.id,
      name: catalog.name,
      category: catalog.category,
      modelUrl: catalog.modelUrl,
      position: pos,
      rotationY: 0,
      dimensions: dims,
      color: catalog.color,
      price: catalog.price,
      notes: catalog.notes ?? null,
    }
    set(state => ({ items: [...state.items, newItem], selectedId: newItem.id }))
  },

  removeItem: id => {
    get().snapshot()
    set(state => ({
      items: state.items.filter(i => i.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    }))
  },

  updateItem: (id, updates) =>
    set(state => ({
      items: state.items.map(i => (i.id === id ? { ...i, ...updates } : i)),
    })),

  duplicateItem: id => {
    get().snapshot()
    const item = get().items.find(i => i.id === id)
    if (!item) return
    const pos = clampToRoom(
      item.position.x + 0.5,
      item.position.z + 0.5,
      item.dimensions,
      item.rotationY,
      get().room,
    )
    const newItem: PlacedItem = {
      ...item,
      id: nanoid(),
      position: pos,
    }
    set(state => ({ items: [...state.items, newItem], selectedId: newItem.id }))
  },

  moveItem: (id, x, z) => {
    const { room, items } = get()
    const item = items.find(i => i.id === id)
    if (!item) return
    const pos = clampToRoom(x, z, item.dimensions, item.rotationY, room, true)
    set(state => ({
      items: state.items.map(i => (i.id === id ? { ...i, position: pos } : i)),
    }))
  },

  clearRoom: () => {
    if (get().items.length === 0) return
    get().snapshot()
    set({ items: [], selectedId: null })
  },

  selectedId: null,
  selectItem: id => set({ selectedId: id }),

  draggingId: null,
  dragOffset: { x: 0, z: 0 },
  dragPlaneY: 0.002,
  startDrag: (id, offset, planeY = 0.002) => {
    get().snapshot()
    set({ draggingId: id, dragOffset: offset, dragPlaneY: planeY })
  },
  stopDrag: () => set({ draggingId: null, dragOffset: { x: 0, z: 0 } }),

  isRotating: false,
  rotatingItemId: null,
  rotationData: null,

  startRotationMode: (id, pointerX, pointerZ) => {
    const item = get().items.find(i => i.id === id)
    if (!item) return
    get().snapshot()
    const startAngle = Math.atan2(pointerX - item.position.x, pointerZ - item.position.z)
    set({
      isRotating: true,
      rotatingItemId: id,
      rotationData: { startAngle, itemStartRotation: item.rotationY },
    })
  },

  updateRotationFromPointer: (pointerX, pointerZ) => {
    const { rotatingItemId, rotationData, items } = get()
    if (!rotatingItemId || !rotationData) return
    const item = items.find(i => i.id === rotatingItemId)
    if (!item) return
    const currentAngle = Math.atan2(pointerX - item.position.x, pointerZ - item.position.z)
    const newRotation = rotationData.itemStartRotation + (currentAngle - rotationData.startAngle)
    set(state => ({
      items: state.items.map(i =>
        i.id === rotatingItemId ? { ...i, rotationY: newRotation } : i,
      ),
    }))
  },

  stopRotationMode: () => {
    const { rotatingItemId, room, items } = get()
    if (!rotatingItemId) {
      set({ isRotating: false, rotatingItemId: null, rotationData: null })
      return
    }
    const item = items.find(i => i.id === rotatingItemId)
    const pos = item
      ? clampToRoom(item.position.x, item.position.z, item.dimensions, item.rotationY, room, true)
      : null
    set({
      isRotating: false,
      rotatingItemId: null,
      rotationData: null,
      items: pos
        ? items.map(i => (i.id === rotatingItemId ? { ...i, position: pos } : i))
        : items,
    })
  },

  rotateItemBy: (id, deltaRadians) => {
    get().snapshot()
    const { room } = get()
    set(state => ({
      items: state.items.map(i => {
        if (i.id !== id) return i
        const rotationY = i.rotationY + deltaRadians
        return {
          ...i,
          rotationY,
          position: clampToRoom(i.position.x, i.position.z, i.dimensions, rotationY, room, true),
        }
      }),
    }))
  },

  setItemRotation: (id, rotationY) => {
    get().snapshot()
    const { room } = get()
    set(state => ({
      items: state.items.map(i =>
        i.id === id
          ? {
              ...i,
              rotationY,
              position: clampToRoom(i.position.x, i.position.z, i.dimensions, rotationY, room, true),
            }
          : i,
      ),
    }))
  },

  entryGateOpen: false,
  setEntryGateOpen: open => set({ entryGateOpen: open }),

  past: [],
  future: [],

  snapshot: () => {
    const { items, room, past } = get()
    const snap: Snapshot = {
      items: JSON.parse(JSON.stringify(items)),
      room: { ...room },
    }
    set({ past: [...past.slice(-(MAX_HISTORY - 1)), snap], future: [] })
  },

  undo: () => {
    const { past, items, room, future } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    const currentSnap: Snapshot = {
      items: JSON.parse(JSON.stringify(items)),
      room: { ...room },
    }
    set({
      past: past.slice(0, -1),
      future: [currentSnap, ...future.slice(0, MAX_HISTORY - 1)],
      items: previous.items,
      room: previous.room,
      selectedId: null,
    })
  },

  redo: () => {
    const { future, items, room, past } = get()
    if (future.length === 0) return
    const next = future[0]
    const currentSnap: Snapshot = {
      items: JSON.parse(JSON.stringify(items)),
      room: { ...room },
    }
    set({
      future: future.slice(1),
      past: [...past.slice(-(MAX_HISTORY - 1)), currentSnap],
      items: next.items,
      room: next.room,
      selectedId: null,
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  viewMode: 'perspective',
  setViewMode: mode => set({ viewMode: mode }),

  catalogOpen: true,
  setCatalogOpen: open => set({ catalogOpen: open }),
  toggleCatalog: () => set(state => ({ catalogOpen: !state.catalogOpen })),
  activeRoom: 'Living Room',
  setActiveRoom: room => set({ activeRoom: room, activeCategory: null }),
  activeCategory: null,
  setActiveCategory: cat => set({ activeCategory: cat }),
  searchQuery: '',
  setSearchQuery: q => set({ searchQuery: q }),
  preFilterStyle: null,
  setPreFilterStyle: style => set({ preFilterStyle: style }),

  roomSettingsOpen: false,
  setRoomSettingsOpen: open => set({ roomSettingsOpen: open }),

  canvasRef: null,
  setCanvasRef: canvas => set({ canvasRef: canvas }),
  renderPanelOpen: false,
  setRenderPanelOpen: open => set({ renderPanelOpen: open }),
  captureMode: false,
  setCaptureMode: v => set({ captureMode: v }),

  cart: [],
  cartOpen: false,
  toggleCart: () => set(state => ({ cartOpen: !state.cartOpen })),
  setCartOpen: open => set({ cartOpen: open }),
  addToCart: item =>
    set(state => {
      const existing = state.cart.find(c => c.furnitureId === item.furnitureId)
      if (existing) {
        return {
          cart: state.cart.map(c =>
            c.furnitureId === item.furnitureId ? { ...c, quantity: c.quantity + 1 } : c,
          ),
        }
      }
      return { cart: [...state.cart, { ...item, quantity: 1 }] }
    }),
  removeFromCart: furnitureId =>
    set(state => ({ cart: state.cart.filter(c => c.furnitureId !== furnitureId) })),
  clearCart: () => set({ cart: [] }),
  cartTotal: () => get().cart.reduce((sum, c) => sum + c.price * c.quantity, 0),
}))
