'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { FurnitureItem } from '@/types'

const ROOM_HEIGHT = 2.8

const CATEGORY_COLORS: Record<string, string> = {
  'Sofa': '#4F84A6',
  'Bed': '#7C5C8A',
  'Chair': '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  'Light': '#E8C97A',
}

// width × depth × height (metres)
const CATEGORY_DIMS: Record<string, [number, number, number]> = {
  'Sofa': [2.1, 0.85, 0.80],
  'Bed': [1.6, 2.00, 0.50],
  'Chair': [0.65, 0.65, 0.85],
  'Coffee Table': [1.10, 0.60, 0.45],
  'Dining Table': [1.40, 0.80, 0.75],
  'Light': [0.30, 0.30, 1.60],
}

function computeLayout(
  furniture: FurnitureItem[],
  w: number,
  l: number,
): { item: FurnitureItem; position: [number, number, number] }[] {
  const m = 0.3
  const placed: { item: FurnitureItem; position: [number, number, number] }[] = []
  const taken: { x: number; z: number; w: number; d: number }[] = []

  function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val))
  }

  function overlaps(x: number, z: number, fw: number, fd: number) {
    return taken.some(t =>
      Math.abs(x - t.x) < (fw + t.w) / 2 + 0.15 &&
      Math.abs(z - t.z) < (fd + t.d) / 2 + 0.15
    )
  }

  function place(item: FurnitureItem, x: number, z: number) {
    const [fw, fd] = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]
    const cx = clamp(x, m + fw / 2, w - m - fw / 2)
    const cz = clamp(z, m + fd / 2, l - m - fd / 2)
    placed.push({ item, position: [cx, 0, cz] })
    taken.push({ x: cx, z: cz, w: fw, d: fd })
  }

  const sofas = furniture.filter(f => f.category === 'Sofa')
  const beds = furniture.filter(f => f.category === 'Bed')
  const tables = furniture.filter(f => f.category === 'Coffee Table')
  const dining = furniture.filter(f => f.category === 'Dining Table')
  const chairs = furniture.filter(f => f.category === 'Chair')
  const lights = furniture.filter(f => f.category === 'Light')
  const rest = furniture.filter(f =>
    !['Sofa', 'Bed', 'Coffee Table', 'Dining Table', 'Chair', 'Light'].includes(f.category)
  )

  sofas.forEach((item, i) => {
    const [fw] = CATEGORY_DIMS[item.category]
    place(item, w / 2 + i * (fw + 0.2) - (sofas.length - 1) * (fw + 0.2) / 2, m + 0.43)
  })

  beds.forEach((item, i) => {
    const [fw] = CATEGORY_DIMS[item.category]
    place(item, w / 2 + i * (fw + 0.2) - (beds.length - 1) * (fw + 0.2) / 2, m + 1.0)
  })

  tables.forEach(item => {
    place(item, w / 2, m + 0.43 + 0.85 + 0.5)
  })

  dining.forEach((item, i) => {
    const [fw] = CATEGORY_DIMS[item.category]
    place(item, w - m - fw / 2 - i * 0.3, m + 0.4)
  })

  chairs.forEach((item, i) => {
    const side = i % 2 === 0 ? w * 0.25 : w * 0.75
    const depth = m + 1.8 + Math.floor(i / 2) * 0.9
    place(item, side, depth)
  })

  lights.forEach((item, i) => {
    const x = i % 2 === 0 ? w * 0.3 : w * 0.7
    place(item, x, l * 0.4)
  })

  rest.forEach((item, i) => {
    const [fw, fd] = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]
    let x = m + fw / 2 + i * (fw + 0.3)
    let z = l - m - fd / 2
    if (overlaps(x, z, fw, fd)) {
      x = m + fw / 2
      z = l * 0.6 + i * (fd + 0.3)
    }
    place(item, x, z)
  })

  return placed
}

function GLBModel({
  url,
  position,
  targetDims,
}: {
  url: string
  position: [number, number, number]
  targetDims: [number, number, number]
}) {
  const { scene } = useGLTF(url)

  const { cloned, yOffset } = useMemo(() => {
    const clone = scene.clone(true)

    const box0 = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3()
    box0.getSize(size)

    const sx = size.x > 0 ? targetDims[0] / size.x : 1
    const sy = size.y > 0 ? targetDims[2] / size.y : 1
    const sz = size.z > 0 ? targetDims[1] / size.z : 1
    const scale = Math.min(sx, sy, sz)
    clone.scale.setScalar(scale)

    const box1 = new THREE.Box3().setFromObject(clone)
    const yOff = -box1.min.y

    return { cloned: clone, yOffset: yOff }
  }, [scene, targetDims])

  return (
    <primitive
      object={cloned}
      position={[position[0], position[1] + yOffset, position[2]]}
      castShadow
    />
  )
}

function BoxFurniture({
  item,
  position,
}: {
  item: FurnitureItem
  position: [number, number, number]
}) {
  const [fw, fd, fh] = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]
  const color = CATEGORY_COLORS[item.category] ?? '#888'
  const isLight = item.category === 'Light'

  return (
    <group position={position}>
      {isLight ? (
        <>
          <mesh position={[0, 1.2, 0]} castShadow>
            <cylinderGeometry args={[0.03, 0.03, 2.4, 8]} />
            <meshStandardMaterial color="#aaa" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 2.4, 0]}>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, fh / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[fw, fh, fd]} />
          <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
        </mesh>
      )}

      <Html position={[0, (isLight ? 2.7 : fh) + 0.2, 0]} center distanceFactor={7}>
        <div style={{
          background: 'rgba(15,15,15,0.88)',
          color: '#F0EDE8',
          padding: '2px 8px',
          borderRadius: 5,
          fontSize: 11,
          whiteSpace: 'nowrap',
          border: '1px solid rgba(201,168,76,0.35)',
          pointerEvents: 'none',
        }}>
          {item.name}
        </div>
      </Html>
    </group>
  )
}

function FurniturePiece({
  item,
  position,
}: {
  item: FurnitureItem
  position: [number, number, number]
}) {
  const dims = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]

  if (item.model_url) {
    return (
      <Suspense fallback={<BoxFurniture item={item} position={position} />}>
        <GLBModel url={item.model_url} position={position} targetDims={dims} />
      </Suspense>
    )
  }

  return <BoxFurniture item={item} position={position} />
}

function Room({ w, l }: { w: number; l: number }) {
  const h = ROOM_HEIGHT
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, l / 2]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <meshStandardMaterial color="#E8E2D9" roughness={0.85} />
      </mesh>
      <mesh position={[w / 2, h / 2, 0]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#F4F0EB" roughness={0.9} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[0, h / 2, l / 2]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[l, h]} />
        <meshStandardMaterial color="#EEEAE4" roughness={0.9} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[w, h / 2, l / 2]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[l, h]} />
        <meshStandardMaterial color="#EEEAE4" roughness={0.9} side={THREE.FrontSide} />
      </mesh>
      <mesh position={[w / 2, 0.04, 0.01]}>
        <boxGeometry args={[w, 0.08, 0.02]} />
        <meshStandardMaterial color="#D4CFC8" />
      </mesh>
    </group>
  )
}

interface Props {
  furniture: FurnitureItem[]
  width: number
  length: number
}

export default function Room3DCanvas({ furniture, width, length }: Props) {
  const layout = useMemo(
    () => computeLayout(furniture, width, length),
    [furniture, width, length],
  )

  return (
    <div className="w-full h-[560px] bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
      <Canvas
        shadows
        camera={{
          position: [width * 1.2, width * 0.9, length * 1.5],
          fov: 48,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.7} />
          <directionalLight
            position={[width * 0.8, ROOM_HEIGHT * 2.5, length * 0.8]}
            intensity={1.3}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-width * 2}
            shadow-camera-right={width * 2}
            shadow-camera-top={length * 2}
            shadow-camera-bottom={-length * 2}
          />
          <pointLight
            position={[width / 2, ROOM_HEIGHT * 0.9, length / 2]}
            intensity={0.35}
            color="#FFF5E0"
          />
          <Environment preset="apartment" />
          <Room w={width} l={length} />
          {layout.map(({ item, position }) => (
            <FurniturePiece key={item.id} item={item} position={position} />
          ))}
          <OrbitControls
            target={[width / 2, 0.5, length / 2]}
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={1.5}
            maxDistance={Math.max(width, length) * 3.5}
            enableDamping
            dampingFactor={0.08}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
