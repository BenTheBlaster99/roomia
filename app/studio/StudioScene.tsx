'use client'

import { useRef, useEffect, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { CameraControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useStudioStore } from '@/store/useStudioStore'
import Room from './components/Room'
import FurniturePiece from './components/FurniturePiece'

function CameraController() {
  const ccRef = useRef<CameraControls>(null!)
  const viewMode = useStudioStore(s => s.viewMode)
  const room = useStudioStore(s => s.room)
  const draggingId = useStudioStore(s => s.draggingId)
  const isRotating = useStudioStore(s => s.isRotating)
  const { width, length, height } = room
  const cx = width / 2
  const cz = length / 2
  const pad = Math.max(width, length)

  useEffect(() => {
    const cc = ccRef.current
    if (!cc) return
    const views: Record<string, [number, number, number, number, number, number]> = {
      perspective: [cx + pad * 0.7, height * 1.4, cz + pad * 1.1, cx, height * 0.3, cz],
      top: [cx, pad * 2.5, cz + 0.001, cx, 0, cz],
      front: [cx, height * 0.5, cz + pad * 1.8, cx, height * 0.5, cz],
      back: [cx, height * 0.5, cz - pad * 1.8, cx, height * 0.5, cz],
      left: [cx - pad * 1.8, height * 0.5, cz, cx, height * 0.5, cz],
      right: [cx + pad * 1.8, height * 0.5, cz, cx, height * 0.5, cz],
      // Eye-level interior photo framing (closer, looking into the room)
      capture: [cx - pad * 0.35, 1.55, cz + pad * 0.55, cx + pad * 0.15, 1.2, cz - pad * 0.1],
    }
    const v = views[viewMode]
    if (v) cc.setLookAt(v[0], v[1], v[2], v[3], v[4], v[5], true)
  }, [viewMode, width, length, height, cx, cz, pad])

  return (
    <CameraControls
      ref={ccRef}
      enabled={!draggingId && !isRotating}
      maxPolarAngle={viewMode === 'top' ? 0.01 : Math.PI / 2 - 0.02}
      makeDefault
    />
  )
}

function DragPlane() {
  const room = useStudioStore(s => s.room)
  const draggingId = useStudioStore(s => s.draggingId)
  const dragOffset = useStudioStore(s => s.dragOffset)
  const moveItem = useStudioStore(s => s.moveItem)
  const stopDrag = useStudioStore(s => s.stopDrag)

  if (!draggingId) return null

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[room.width / 2, 0.001, room.length / 2]}
      onPointerMove={e => {
        e.stopPropagation()
        moveItem(draggingId, e.point.x - dragOffset.x, e.point.z - dragOffset.z)
      }}
      onPointerUp={() => stopDrag()}
      onPointerLeave={() => stopDrag()}
    >
      <planeGeometry args={[room.width * 6, room.length * 6]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

function RotationCapturePlane() {
  const isRotating = useStudioStore(s => s.isRotating)
  const updateRotationFromPointer = useStudioStore(s => s.updateRotationFromPointer)
  const stopRotationMode = useStudioStore(s => s.stopRotationMode)

  if (!isRotating) return null

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.003, 0]}
      onPointerMove={e => {
        e.stopPropagation()
        updateRotationFromPointer(e.point.x, e.point.z)
      }}
      onPointerUp={stopRotationMode}
      onPointerLeave={stopRotationMode}
    >
      <planeGeometry args={[500, 500]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export default function StudioScene() {
  const room = useStudioStore(s => s.room)
  const items = useStudioStore(s => s.items)
  const selectItem = useStudioStore(s => s.selectItem)
  const captureMode = useStudioStore(s => s.captureMode)
  const { width, length, height } = room

  return (
    <div className="w-full h-full min-h-[400px]">
      <Canvas
        shadows
        camera={{ position: [width * 0.7, height * 1.4, length * 1.1], fov: 50 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          preserveDrawingBuffer: true,
        }}
        onCreated={({ gl }) => {
          useStudioStore.getState().setCanvasRef(gl.domElement)
        }}
        onPointerMissed={() => selectItem(null)}
      >
        <Suspense fallback={null}>
          <color attach="background" args={['#eae6df']} />

          <ambientLight intensity={0.65} />
          <hemisphereLight args={['#ffffff', '#d4cfc6', 0.5]} />
          <directionalLight
            position={[width * 0.8, height * 3, length * 0.8]}
            intensity={1.3}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-width * 2}
            shadow-camera-right={width * 2}
            shadow-camera-top={length * 2}
            shadow-camera-bottom={-length * 2}
          />
          <pointLight
            position={[width / 2, height * 0.85, length / 2]}
            intensity={0.35}
            color="#FFF5E0"
          />

          <Room />

          {!captureMode && (
            <Grid
              position={[width / 2, 0.002, length / 2]}
              args={[width, length]}
              cellSize={1}
              cellThickness={0.5}
              cellColor="#bbb"
              sectionSize={0}
              fadeDistance={40}
              fadeStrength={1}
              infiniteGrid={false}
            />
          )}

          {items.map(item => (
            <FurniturePiece key={item.id} item={item} />
          ))}

          <DragPlane />
          <RotationCapturePlane />
          <CameraController />
        </Suspense>
      </Canvas>
    </div>
  )
}
