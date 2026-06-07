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

const CATEGORY_DIMS: Record<string, [number, number, number]> = {
  'Sofa': [2.1, 0.85, 0.80],
  'Bed': [1.6, 2.00, 0.50],
  'Chair': [0.65, 0.65, 0.85],
  'Coffee Table': [1.10, 0.60, 0.45],
  'Dining Table': [1.40, 0.80, 0.75],
  'Light': [0.30, 0.30, 0.30],
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
  const cloned = useMemo(() => {
    const clone = scene.clone()
    const box = new THREE.Box3().setFromObject(clone)
    const size = new THREE.Vector3()
    box.getSize(size)
    const scale = Math.min(
      targetDims[0] / size.x,
      targetDims[1] / size.z,
      targetDims[2] / size.y,
    )
    clone.scale.setScalar(scale)
    box.setFromObject(clone)
    clone.position.y = -box.min.y
    return clone
  }, [scene, targetDims])

  return <primitive object={cloned} position={position} castShadow />
}

function FurniturePiece({
  item,
  position,
}: {
  item: FurnitureItem
  position: [number, number, number]
}) {
  const dims = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]
  const [fw, fd, fh] = dims
  const color = CATEGORY_COLORS[item.category] ?? '#888888'

  if (item.model_url) {
    return (
      <Suspense fallback={null}>
        <GLBModel url={item.model_url} position={position} targetDims={dims} />
      </Suspense>
    )
  }

  return (
    <group position={position}>
      <mesh position={[0, fh / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[fw, fh, fd]} />
        <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
      </mesh>

      <Html position={[0, fh + 0.25, 0]} center distanceFactor={6}>
        <div
          style={{
            background: 'rgba(15,15,15,0.85)',
            color: '#F0EDE8',
            padding: '2px 7px',
            borderRadius: 5,
            fontSize: 11,
            whiteSpace: 'nowrap',
            border: '1px solid rgba(201,168,76,0.4)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
          }}
        >
          {item.name}
        </div>
      </Html>
    </group>
  )
}

function computeLayout(
  furniture: FurnitureItem[],
  w: number,
  l: number,
): { item: FurnitureItem; position: [number, number, number] }[] {
  const margin = 0.25
  let x = margin
  let z = margin
  let rowDepth = 0

  return furniture.map(item => {
    const [fw, fd] = CATEGORY_DIMS[item.category] ?? [0.8, 0.8, 0.8]

    if (x + fw + margin > w - margin) {
      x = margin
      z += rowDepth + margin
      rowDepth = 0
    }
    if (z + fd > l - margin) {
      x = margin
      z = margin
    }

    const pos: [number, number, number] = [x + fw / 2, 0, z + fd / 2]
    x += fw + margin
    rowDepth = Math.max(rowDepth, fd)

    return { item, position: pos }
  })
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
          position: [width * 1.4, width * 1.0, length * 1.6],
          fov: 50,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.6} />
          <directionalLight
            position={[width * 0.8, ROOM_HEIGHT * 2, length * 0.8]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-width * 2}
            shadow-camera-right={width * 2}
            shadow-camera-top={length * 2}
            shadow-camera-bottom={-length * 2}
          />
          <pointLight
            position={[width / 2, ROOM_HEIGHT * 0.85, length / 2]}
            intensity={0.4}
            color="#FFF5E0"
          />

          <Environment preset="apartment" />

          <Room w={width} l={length} />

          {layout.map(({ item, position }) => (
            <FurniturePiece key={item.id} item={item} position={position} />
          ))}

          <OrbitControls
            target={[width / 2, 0.4, length / 2]}
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={1.5}
            maxDistance={Math.max(width, length) * 3}
            enablePan
            enableDamping
            dampingFactor={0.08}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
