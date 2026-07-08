'use client'

import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import {
  ROOM3D_COLORS,
  buildDoorMeshSpecs,
  buildWallMeshSpecs,
  buildWindowMeshSpecs,
  getSceneFrame,
  wallSegmentTransform,
  type WallMeshSpec,
} from '@/lib/room3d-view'
import { normalizeGlbScene } from '@/lib/normalize-glb'
import type { FloorPlanData, PlacedFurniture } from '@/types/floor-plan'

const CATEGORY_COLORS: Record<string, string> = {
  Sofa: '#4F84A6',
  Bed: '#7C5C8A',
  Chair: '#4CAF7D',
  'Coffee Table': '#C9A84C',
  'Dining Table': '#C9A84C',
  Light: '#E8C97A',
}

function GLBModel({
  url,
  position,
  rotationY,
  targetDims,
}: {
  url: string
  position: [number, number, number]
  rotationY: number
  targetDims: [number, number, number]
}) {
  const { scene } = useGLTF(url)

  const cloned = useMemo(
    () =>
      normalizeGlbScene(scene, {
        width: targetDims[0],
        depth: targetDims[1],
        height: targetDims[2],
      }),
    [scene, targetDims],
  )

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive object={cloned} castShadow />
    </group>
  )
}

function BoxFurniture({ item }: { item: PlacedFurniture }) {
  const { width, depth, height } = item.dimensions
  const color = CATEGORY_COLORS[item.category] ?? '#888'
  const isLight = item.category === 'Light'
  const position: [number, number, number] = [item.position.x, 0, item.position.z]
  const rotationY = (item.rotationDeg * Math.PI) / 180

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
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
        <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} />
        </mesh>
      )}

      <Html position={[0, (isLight ? 2.7 : height) + 0.2, 0]} center distanceFactor={7}>
        <div
          style={{
            background: 'rgba(15,15,15,0.88)',
            color: '#F0EDE8',
            padding: '2px 8px',
            borderRadius: 5,
            fontSize: 11,
            whiteSpace: 'nowrap',
            border: '1px solid rgba(201,168,76,0.35)',
            pointerEvents: 'none',
          }}
        >
          {item.name}
        </div>
      </Html>
    </group>
  )
}

function FurniturePiece({ item }: { item: PlacedFurniture }) {
  const dims: [number, number, number] = [
    item.dimensions.width,
    item.dimensions.depth,
    item.dimensions.height,
  ]
  const position: [number, number, number] = [item.position.x, 0, item.position.z]
  const rotationY = (item.rotationDeg * Math.PI) / 180

  if (item.modelUrl) {
    return (
      <Suspense fallback={<BoxFurniture item={item} />}>
        <GLBModel
          url={item.modelUrl}
          position={position}
          rotationY={rotationY}
          targetDims={dims}
        />
      </Suspense>
    )
  }

  return <BoxFurniture item={item} />
}

function WallMesh({ spec }: { spec: WallMeshSpec }) {
  const { position, rotationY, length } = wallSegmentTransform(spec)
  if (length < 0.01) return null

  const color =
    spec.kind === 'exterior' ? ROOM3D_COLORS.wallExterior : ROOM3D_COLORS.wallInterior

  return (
    <mesh
      position={position}
      rotation={[0, rotationY, 0]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[length, spec.height, spec.thickness]} />
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.02} />
    </mesh>
  )
}

function WindowMesh({
  spec,
}: {
  spec: ReturnType<typeof buildWindowMeshSpecs>[number]
}) {
  const y = spec.sillHeight + spec.height / 2

  return (
    <mesh
      position={[spec.center.x, y, spec.center.z]}
      rotation={[0, spec.rotationY, 0]}
    >
      <boxGeometry args={[spec.width, spec.height, 0.04]} />
      <meshStandardMaterial
        color={ROOM3D_COLORS.windowGlass}
        transparent
        opacity={0.55}
        roughness={0.1}
        metalness={0.1}
      />
    </mesh>
  )
}

function DoorMesh({
  spec,
}: {
  spec: ReturnType<typeof buildDoorMeshSpecs>[number]
}) {
  const midX = (spec.hinge.x + spec.leafEnd.x) / 2
  const midZ = (spec.hinge.z + spec.leafEnd.z) / 2
  const width = Math.hypot(spec.leafEnd.x - spec.hinge.x, spec.leafEnd.z - spec.hinge.z)

  return (
    <mesh
      position={[midX, spec.height / 2, midZ]}
      rotation={[0, spec.rotationY, 0]}
      castShadow
    >
      <boxGeometry args={[width, spec.height, 0.05]} />
      <meshStandardMaterial color={ROOM3D_COLORS.door} roughness={0.75} />
    </mesh>
  )
}

function PlanRoom({ plan }: { plan: FloorPlanData }) {
  const frame = useMemo(() => getSceneFrame(plan), [plan])
  const walls = useMemo(() => buildWallMeshSpecs(plan), [plan])
  const windows = useMemo(() => buildWindowMeshSpecs(plan), [plan])
  const doors = useMemo(() => buildDoorMeshSpecs(plan), [plan])

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[frame.centerX, 0, frame.centerZ]}
        receiveShadow
      >
        <planeGeometry args={[frame.width, frame.length]} />
        <meshStandardMaterial color={ROOM3D_COLORS.floor} roughness={0.85} />
      </mesh>

      {walls.map(wall => (
        <WallMesh key={wall.id} spec={wall} />
      ))}

      {windows.map(window => (
        <WindowMesh key={window.id} spec={window} />
      ))}

      {doors.map(door => (
        <DoorMesh key={door.id} spec={door} />
      ))}
    </group>
  )
}

interface Props {
  plan: FloorPlanData
}

export default function Room3DCanvas({ plan }: Props) {
  const frame = useMemo(() => getSceneFrame(plan), [plan])
  const activeFurniture = useMemo(
    () => plan.furniture.filter(item => item.status === 'active'),
    [plan],
  )

  return (
    <div className="w-full h-[560px] bg-zinc-900 overflow-hidden">
      <Canvas
        shadows
        camera={{
          position: [
            frame.centerX + frame.span * 1.1,
            frame.height * 1.1,
            frame.centerZ + frame.span * 1.35,
          ],
          fov: 48,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <Suspense fallback={null}>
          <color attach="background" args={['#1a1a1a']} />
          <hemisphereLight args={['#FFF5E0', '#E8E2D9', 0.55]} />
          <ambientLight intensity={0.35} />
          <directionalLight
            position={[
              frame.centerX + frame.span,
              frame.height * 2.5,
              frame.centerZ + frame.span,
            ]}
            intensity={1.3}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-frame.span * 2}
            shadow-camera-right={frame.span * 2}
            shadow-camera-top={frame.span * 2}
            shadow-camera-bottom={-frame.span * 2}
          />
          <pointLight
            position={[frame.centerX, frame.height * 0.9, frame.centerZ]}
            intensity={0.35}
            color="#FFF5E0"
          />
          <PlanRoom plan={plan} />
          {activeFurniture.map(item => (
            <FurniturePiece key={item.id} item={item} />
          ))}
          <OrbitControls
            target={[frame.centerX, frame.height * 0.35, frame.centerZ]}
            maxPolarAngle={Math.PI / 2 - 0.02}
            minDistance={1.5}
            maxDistance={frame.span * 3.5}
            enableDamping
            dampingFactor={0.08}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
