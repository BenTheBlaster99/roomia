import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { CATEGORY_DIMS } from '@/lib/studio-constants'
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
  startDrag: (id: string, offset: { x: number; z: number }) => void
  stopDrag: () => void

  isRotating: boolean
  rotatingItemId: string | null
  rotationData: { startAngle: number; itemStartRotation: number } | null
  startRotationMode: (id: string, pointerX: number, pointerZ: number) => void
  updateRotationFromPointer: (pointerX: number, pointerZ: number) => void
  stopRotationMode: () => void

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
    set({
      room: payload.room,
      items: payload.furniture.map(item => ({ ...item, id: nanoid() })),
      selectedId: null,
      activeRoom: payload.roomType,
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
    const newItem: PlacedItem = {
      id: nanoid(),
      furnitureId: catalog.id,
      name: catalog.name,
      category: catalog.category,
      modelUrl: catalog.modelUrl,
      position: { x, z },
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
    const newItem: PlacedItem = {
      ...item,
      id: nanoid(),
      position: {
        x: Math.min(item.position.x + 0.5, get().room.width - item.dimensions.width / 2),
        z: Math.min(item.position.z + 0.5, get().room.length - item.dimensions.depth / 2),
      },
    }
    set(state => ({ items: [...state.items, newItem], selectedId: newItem.id }))
  },

  moveItem: (id, x, z) => {
    const { room, items } = get()
    const item = items.find(i => i.id === id)
    if (!item) return
    const hw = item.dimensions.width / 2
    const hd = item.dimensions.depth / 2
    set(state => ({
      items: state.items.map(i =>
        i.id === id
          ? {
              ...i,
              position: {
                x: Math.max(hw, Math.min(room.width - hw, x)),
                z: Math.max(hd, Math.min(room.length - hd, z)),
              },
            }
          : i,
      ),
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
  startDrag: (id, offset) => {
    get().snapshot()
    set({ draggingId: id, dragOffset: offset })
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

  stopRotationMode: () => set({ isRotating: false, rotatingItemId: null, rotationData: null }),

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
