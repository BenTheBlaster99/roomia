'use client'

import { useRef, useEffect, Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CameraControls, Grid } from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import * as THREE from 'three'

const { ACTION } = CameraControlsImpl
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

  // Free look in 3D / photo modes; orthographic-ish presets stay constrained
  const lockedTop = viewMode === 'top'
  const freeLook = viewMode === 'perspective' || viewMode === 'capture'

  return (
    <CameraControls
      ref={ccRef}
      enabled={!draggingId && !isRotating}
      makeDefault
      minDistance={0.8}
      maxDistance={pad * 6}
      dollySpeed={0.85}
      truckSpeed={1.2}
      polarRotateSpeed={freeLook ? 0.9 : 0.35}
      azimuthRotateSpeed={freeLook ? 0.9 : 0.5}
      maxPolarAngle={lockedTop ? 0.01 : Math.PI * 0.92}
      minPolarAngle={lockedTop ? 0 : 0.08}
      mouseButtons={{
        left: ACTION.ROTATE,
        middle: ACTION.TRUCK,
        right: ACTION.TRUCK,
        wheel: ACTION.DOLLY,
      }}
      // Mobile: one finger reserved for selecting/dragging furniture;
      // two fingers orbit+zoom so camera does not fight placement.
      touches={{
        one: ACTION.NONE,
        two: ACTION.TOUCH_DOLLY_ROTATE,
        three: ACTION.TOUCH_TRUCK,
      }}
    />
  )
}

function DragController() {
  const draggingId = useStudioStore(s => s.draggingId)
  const { camera, gl } = useThree()

  useEffect(() => {
    if (!draggingId) return
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const hit = new THREE.Vector3()
    const plane = new THREE.Plane()
    const up = new THREE.Vector3(0, 1, 0)

    function onMove(ev: PointerEvent) {
      const { draggingId: id, dragOffset, dragPlaneY, moveItem } = useStudioStore.getState()
      if (!id) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      plane.set(up, -dragPlaneY)
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      moveItem(id, hit.x - dragOffset.x, hit.z - dragOffset.z)
    }
    function onUp() {
      useStudioStore.getState().stopDrag()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [draggingId, camera, gl])

  return null
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
          // Allow right-drag pan without the browser context menu
          gl.domElement.addEventListener('contextmenu', e => e.preventDefault())
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

          <DragController />
          <RotationCapturePlane />
          <CameraController />
        </Suspense>
      </Canvas>
    </div>
  )
}
