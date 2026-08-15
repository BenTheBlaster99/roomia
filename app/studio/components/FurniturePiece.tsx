'use client'

import { useMemo, Suspense } from 'react'
import { useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useStudioStore, type PlacedItem } from '@/store/useStudioStore'
import { CATEGORY_COLORS } from '@/lib/studio-constants'
import { normalizeGlbScene } from '@/lib/normalize-glb'

function SelectionBox({ dims }: { dims: PlacedItem['dimensions'] }) {
  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(dims.width + 0.05, dims.height + 0.05, dims.depth + 0.05)
    return new THREE.EdgesGeometry(box)
  }, [dims])
  return (
    <lineSegments geometry={geo} position={[0, dims.height / 2, 0]}>
      <lineBasicMaterial color="#C9A84C" />
    </lineSegments>
  )
}

function RotationHandle({ item }: { item: PlacedItem }) {
  const startRotationMode = useStudioStore(s => s.startRotationMode)
  const radius = Math.max(item.dimensions.width, item.dimensions.depth) / 2 + 0.28

  return (
    <group>
      <mesh
        position={[0, 0.04, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={e => {
          e.stopPropagation()
          ;(e.target as THREE.Mesh).setPointerCapture?.(e.pointerId)
          startRotationMode(item.id, e.point.x, e.point.z)
        }}
      >
        <torusGeometry args={[radius, 0.05, 10, 64]} />
        <meshBasicMaterial color="#C9A84C" />
      </mesh>
      {/* Larger invisible hit target */}
      <mesh
        position={[0, 0.04, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={e => {
          e.stopPropagation()
          startRotationMode(item.id, e.point.x, e.point.z)
        }}
      >
        <torusGeometry args={[radius, 0.14, 8, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

function GLBModel({ url, dims }: { url: string; dims: PlacedItem['dimensions'] }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(
    () => normalizeGlbScene(scene, dims),
    [scene, dims],
  )
  return <primitive object={cloned} castShadow />
}

function mixHex(hex: string, toward: string, t: number) {
  const parse = (h: string) => {
    const s = h.replace('#', '')
    const n = s.length === 3 ? s.split('').map(c => c + c).join('') : s
    return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) || 0)
  }
  const a = parse(hex)
  const b = parse(toward)
  const to = (c: number) => Math.round(c).toString(16).padStart(2, '0')
  return `#${[0, 1, 2].map(i => to(a[i] + (b[i] - a[i]) * t)).join('')}`
}

function BoxModel({ item }: { item: PlacedItem }) {
  const { width, depth, height } = item.dimensions
  const color = item.color || CATEGORY_COLORS[item.category] || '#888'
  const isLight = item.category === 'Light'
  const isTv = item.category === 'TV Unit'
  const isWardrobe = item.category === 'Wardrobe'
  const isSide = item.category === 'Side Table'
  const isRug = item.category === 'Rug'

  if (isLight) {
    const drop = Math.max(height, 0.35)
    return (
      <>
        <mesh position={[0, drop - 0.02, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.04, 16]} />
          <meshStandardMaterial color="#333" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, drop / 2, 0]}>
          <cylinderGeometry args={[0.012, 0.012, drop, 8]} />
          <meshStandardMaterial color="#444" metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <sphereGeometry args={[Math.min(width, depth) * 0.35, 16, 16]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.55}
            roughness={0.35}
          />
        </mesh>
      </>
    )
  }

  if (isTv) {
    const cabinetH = Math.min(height * 0.55, 0.42)
    const screenH = Math.min(0.48, height * 0.7)
    const leg = 0.04
    const drawerH = cabinetH * 0.42
    return (
      <group>
        {[
          [-width * 0.42, -depth * 0.35],
          [width * 0.42, -depth * 0.35],
          [-width * 0.42, depth * 0.35],
          [width * 0.42, depth * 0.35],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, leg / 2, z]} castShadow>
            <boxGeometry args={[0.045, leg, 0.045]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.8} />
          </mesh>
        ))}
        <mesh position={[0, leg + cabinetH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, cabinetH, depth]} />
          <meshStandardMaterial color={color} roughness={0.62} metalness={0.08} />
        </mesh>
        {[-0.28, 0.28].map((ox, i) => (
          <mesh key={`d${i}`} position={[width * ox, leg + drawerH * 0.55, depth / 2 + 0.006]}>
            <boxGeometry args={[width * 0.42, drawerH, 0.012]} />
            <meshStandardMaterial color="#1f1f1f" roughness={0.45} metalness={0.15} />
          </mesh>
        ))}
        <mesh position={[0, leg + cabinetH + screenH / 2 + 0.02, -depth * 0.12]} castShadow>
          <boxGeometry args={[width * 0.88, screenH, 0.05]} />
          <meshStandardMaterial color="#111" roughness={0.28} metalness={0.25} />
        </mesh>
        <mesh position={[0, leg + cabinetH + screenH / 2 + 0.02, -depth * 0.12 + 0.028]}>
          <boxGeometry args={[width * 0.8, screenH * 0.86, 0.01]} />
          <meshStandardMaterial color="#1c2330" emissive="#152030" emissiveIntensity={0.35} roughness={0.2} />
        </mesh>
      </group>
    )
  }

  if (isRug) {
    return (
      <mesh position={[0, Math.max(height, 0.015) / 2, 0]} receiveShadow>
        <boxGeometry args={[width, Math.max(height, 0.015), depth]} />
        <meshStandardMaterial color={color} roughness={0.95} metalness={0} />
      </mesh>
    )
  }

  if (isWardrobe) {
    const plinth = 0.08
    const carcassH = height - plinth
    const doorGap = 0.012
    const doorT = 0.03
    const doorW = (width - doorGap * 3) / 2
    const doorH = carcassH - 0.08
    const doorColor = mixHex(color, '#111111', 0.08)
    const frameColor = mixHex(color, '#000000', 0.16)
    return (
      <group>
        <mesh position={[0, plinth / 2, 0]} castShadow>
          <boxGeometry args={[width * 0.96, plinth, depth * 0.96]} />
          <meshStandardMaterial color={frameColor} roughness={0.7} />
        </mesh>
        <mesh position={[0, plinth + carcassH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, carcassH, depth]} />
          <meshStandardMaterial color={color} roughness={0.62} metalness={0.04} />
        </mesh>
        {[-1, 1].map(side => (
          <mesh
            key={side}
            position={[side * (doorW / 2 + doorGap / 2), plinth + 0.04 + doorH / 2, depth / 2 + doorT / 2]}
            castShadow
          >
            <boxGeometry args={[doorW, doorH, doorT]} />
            <meshStandardMaterial color={doorColor} roughness={0.55} metalness={0.06} />
          </mesh>
        ))}
        {[-1, 1].map(side => (
          <mesh
            key={`h${side}`}
            position={[side * 0.06, plinth + carcassH * 0.5, depth / 2 + doorT + 0.012]}
          >
            <boxGeometry args={[0.012, 0.22, 0.018]} />
            <meshStandardMaterial color="#c5c5c5" roughness={0.35} metalness={0.65} />
          </mesh>
        ))}
      </group>
    )
  }

  if (isSide) {
    const topT = 0.04
    const leg = 0.18
    const bodyH = Math.max(0.22, height - leg - topT)
    const topColor = mixHex(color, '#ffffff', 0.12)
    return (
      <group>
        {[
          [-width * 0.38, -depth * 0.38],
          [width * 0.38, -depth * 0.38],
          [-width * 0.38, depth * 0.38],
          [width * 0.38, depth * 0.38],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, leg / 2, z]} castShadow>
            <boxGeometry args={[0.04, leg, 0.04]} />
            <meshStandardMaterial color={mixHex(color, '#000000', 0.25)} roughness={0.75} />
          </mesh>
        ))}
        <mesh position={[0, leg + bodyH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width * 0.88, bodyH, depth * 0.88]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        <mesh position={[0, leg + bodyH + topT / 2, 0]} castShadow>
          <boxGeometry args={[width, topT, depth]} />
          <meshStandardMaterial color={topColor} roughness={0.5} />
        </mesh>
      </group>
    )
  }

  return (
    <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
    </mesh>
  )
}

function beginDrag(
  e: { stopPropagation: () => void; ray: THREE.Ray },
  item: PlacedItem,
  planeY: number,
  isRotating: boolean,
  selectItem: (id: string | null) => void,
  startDrag: (id: string, offset: { x: number; z: number }, planeY?: number) => void,
) {
  e.stopPropagation()
  selectItem(item.id)
  if (isRotating) return
  const hit = new THREE.Vector3()
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const from = e.ray.intersectPlane(plane, hit) ? hit : null
  startDrag(
    item.id,
    {
      x: (from?.x ?? item.position.x) - item.position.x,
      z: (from?.z ?? item.position.z) - item.position.z,
    },
    planeY,
  )
}

export default function FurniturePiece({ item }: { item: PlacedItem }) {
  const selectedId = useStudioStore(s => s.selectedId)
  const selectItem = useStudioStore(s => s.selectItem)
  const startDrag = useStudioStore(s => s.startDrag)
  const isRotating = useStudioStore(s => s.isRotating)
  const captureMode = useStudioStore(s => s.captureMode)
  const roomHeight = useStudioStore(s => s.room.height)
  const isSelected = selectedId === item.id
  const isLight = item.category === 'Light'
  const hangY = isLight ? Math.max(0.05, roomHeight - item.dimensions.height) : 0
  const labelY = isLight
    ? item.dimensions.height + 0.15
    : item.dimensions.height + 0.25
  const floorY = -hangY + 0.012

  return (
    <group
      position={[item.position.x, hangY, item.position.z]}
      rotation={[0, item.rotationY, 0]}
      onPointerDown={e => {
        beginDrag(e, item, hangY || 0.002, isRotating, selectItem, startDrag)
      }}
    >
      {item.modelUrl ? (
        <Suspense fallback={<BoxModel item={item} />}>
          <GLBModel url={item.modelUrl} dims={item.dimensions} />
        </Suspense>
      ) : (
        <BoxModel item={item} />
      )}

      {isLight && (
        <>
          {/* Fat click target — the globe/cord are too thin to grab reliably */}
          <mesh position={[0, Math.max(item.dimensions.height, 0.35) * 0.35, 0]}>
            <sphereGeometry args={[0.32, 16, 16]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {!captureMode && (
            <group position={[0, floorY, 0]}>
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                onPointerDown={e => {
                  beginDrag(e, item, 0.002, isRotating, selectItem, startDrag)
                }}
              >
                <circleGeometry args={[0.28, 28]} />
                <meshBasicMaterial
                  color="#C9A84C"
                  transparent
                  opacity={isSelected ? 0.35 : 0.16}
                  depthWrite={false}
                />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.28, 0.34, 28]} />
                <meshBasicMaterial
                  color="#C9A84C"
                  transparent
                  opacity={isSelected ? 0.95 : 0.45}
                  depthWrite={false}
                />
              </mesh>
            </group>
          )}
          {isSelected && !captureMode && (
            <mesh position={[0, floorY / 2, 0]}>
              <cylinderGeometry args={[0.01, 0.01, Math.max(0.2, hangY), 8]} />
              <meshBasicMaterial color="#C9A84C" transparent opacity={0.4} />
            </mesh>
          )}
        </>
      )}

      {!captureMode && isSelected && (
        <SelectionBox
          dims={item.dimensions}
        />
      )}
      {!captureMode && isSelected && !isLight && <RotationHandle item={item} />}

      {!captureMode && (
        <Html position={[0, labelY, 0]} center distanceFactor={8} occlude>
          <div
            className={`text-xs px-2 py-0.5 rounded whitespace-nowrap pointer-events-none shadow-sm ${
              isSelected
                ? 'bg-amber-500 text-white font-bold'
                : 'bg-white/90 text-zinc-700 border border-zinc-200'
            }`}
          >
            {item.name}
          </div>
        </Html>
      )}
    </group>
  )
}
