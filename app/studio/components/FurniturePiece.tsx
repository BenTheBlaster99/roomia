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
    <mesh
      position={[0, 0.04, 0]}
      rotation={[Math.PI / 2, 0, 0]}
      onPointerDown={e => {
        e.stopPropagation()
        startRotationMode(item.id, e.point.x, e.point.z)
      }}
    >
      <torusGeometry args={[radius, 0.045, 8, 48]} />
      <meshBasicMaterial color="#C9A84C" />
    </mesh>
  )
}

function needsGeneratedModelFix(url: string) {
  return url.includes('/models/generated-bed.glb') || url.includes('/models/generated-chair.glb')
}

function GLBModel({ url, dims }: { url: string; dims: PlacedItem['dimensions'] }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(
    () => normalizeGlbScene(scene, dims, { zUpToYUp: needsGeneratedModelFix(url) }),
    [scene, dims, url],
  )
  return <primitive object={cloned} castShadow />
}

function BoxModel({ item }: { item: PlacedItem }) {
  const { width, depth, height } = item.dimensions
  const color = CATEGORY_COLORS[item.category] ?? '#888'
  const isLight = item.category === 'Light'

  if (isLight) {
    return (
      <>
        <mesh position={[0, 1.2, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 2.4, 8]} />
          <meshStandardMaterial color="#aaa" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 2.45, 0]}>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
        </mesh>
      </>
    )
  }

  return (
    <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
    </mesh>
  )
}

export default function FurniturePiece({ item }: { item: PlacedItem }) {
  const selectedId = useStudioStore(s => s.selectedId)
  const selectItem = useStudioStore(s => s.selectItem)
  const startDrag = useStudioStore(s => s.startDrag)
  const isRotating = useStudioStore(s => s.isRotating)
  const isSelected = selectedId === item.id

  return (
    <group
      position={[item.position.x, 0, item.position.z]}
      rotation={[0, item.rotationY, 0]}
      onPointerDown={e => {
        e.stopPropagation()
        selectItem(item.id)
        if (!isRotating) {
          startDrag(item.id, {
            x: e.point.x - item.position.x,
            z: e.point.z - item.position.z,
          })
        }
      }}
    >
      {item.modelUrl ? (
        <Suspense fallback={<BoxModel item={item} />}>
          <GLBModel url={item.modelUrl} dims={item.dimensions} />
        </Suspense>
      ) : (
        <BoxModel item={item} />
      )}

      {isSelected && <SelectionBox dims={item.dimensions} />}
      {isSelected && <RotationHandle item={item} />}

      <Html position={[0, item.dimensions.height + 0.25, 0]} center distanceFactor={8} occlude>
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
    </group>
  )
}
