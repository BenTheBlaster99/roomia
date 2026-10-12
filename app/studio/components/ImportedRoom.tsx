'use client'

import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useStudioStore } from '@/store/useStudioStore'
import { fitImportedRoom } from '@/lib/studio-import/fit-imported-room'
import { getImportedSource } from '@/lib/studio-import/imported-room-cache'
import { registerCameraMover, registerHeavyCapture } from '@/lib/studio-import/heavy-view-camera'
import { verticalFov } from '@/lib/scene-cameras'

interface LookAtControls {
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, animate?: boolean) => unknown
}

function setPerspectiveFov(camera: THREE.PerspectiveCamera, fov: number) {
  camera.fov = fov
  camera.updateProjectionMatrix()
}

export default function ImportedRoom() {
  const importedRoom = useStudioStore(s => s.importedRoom)
  const captureMode = useStudioStore(s => s.captureMode)
  const applyImportedRoomDims = useStudioStore(s => s.applyImportedRoomDims)
  const { width, length, height } = useStudioStore(s => s.room)
  const [object, setObject] = useState<THREE.Group | null>(null)
  const camera = useThree(state => state.camera)
  const controls = useThree(state => state.controls) as LookAtControls | null
  const size = useThree(state => state.size)

  const objectUrl = importedRoom?.objectUrl
  const zUp = importedRoom?.zUp
  const unit = importedRoom?.unit
  const sceneId = importedRoom?.sceneId

  useEffect(() => {
    if (!objectUrl || zUp === undefined || !unit) {
      setObject(null)
      return
    }
    const source = getImportedSource(objectUrl)
    if (!source) {
      setObject(null)
      return
    }
    const fitted = fitImportedRoom(source, { zUp, unit, maxRoomMeters: sceneId ? 200 : 40 })
    setObject(fitted.object)
    applyImportedRoomDims(fitted.room)
    const current = useStudioStore.getState().importedRoom
    if (
      current &&
      (current.resolvedUnit !== fitted.resolvedUnit || current.warning !== fitted.scaleWarning)
    ) {
      useStudioStore.setState({
        importedRoom: {
          ...current,
          resolvedUnit: fitted.resolvedUnit,
          warning: fitted.scaleWarning,
        },
      })
    }
  }, [objectUrl, zUp, unit, sceneId, applyImportedRoomDims])

  useEffect(() => {
    if (!object) {
      registerHeavyCapture(null)
      return
    }
    registerHeavyCapture(() => {
      const model = object.children[0]
      if (!model) return null
      model.updateWorldMatrix(true, false)
      camera.updateWorldMatrix(true, false)
      const pos = new THREE.Vector3()
      const camQ = new THREE.Quaternion()
      const modelQ = new THREE.Quaternion()
      camera.getWorldPosition(pos)
      camera.getWorldQuaternion(camQ)
      pos.applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert())
      model.getWorldQuaternion(modelQ)
      modelQ.invert().multiply(camQ)
      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50
      return {
        position: [pos.x, pos.y, pos.z],
        quaternion: [modelQ.x, modelQ.y, modelQ.z, modelQ.w],
        fov,
      }
    })
    return () => registerHeavyCapture(null)
  }, [camera, object])

  // Jump to a saved SketchUp scene: its camera is in the file's frame, Studio's room is shifted.
  useEffect(() => {
    if (!object || !controls) {
      registerCameraMover(null)
      return
    }
    registerCameraMover(view => {
      const model = object.children[0]
      if (!model) return
      model.updateWorldMatrix(true, false)
      const eye = new THREE.Vector3(...view.position).applyMatrix4(model.matrixWorld)
      const target = new THREE.Vector3(...view.target).applyMatrix4(model.matrixWorld)
      if (camera instanceof THREE.PerspectiveCamera) {
        setPerspectiveFov(camera, verticalFov(view.hfov, size.width / Math.max(size.height, 1)))
      }
      controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true)
    })
    return () => registerCameraMover(null)
  }, [camera, controls, object, size.width, size.height])

  if (!importedRoom || !object) return null

  const cx = width / 2
  const cz = length / 2

  return (
    <group>
      <primitive object={object} />
      {!captureMode && (
        <>
          <Html position={[cx, -0.3, length + 0.1]} center>
            <div className="whitespace-nowrap rounded bg-zinc-900/80 px-2 py-0.5 text-xs font-bold text-amber-400">
              {width.toFixed(1)} m
            </div>
          </Html>
          <Html position={[-0.4, height / 2, cz]} center>
            <div className="whitespace-nowrap rounded bg-zinc-900/80 px-2 py-0.5 text-xs font-bold text-amber-400">
              {length.toFixed(1)} m
            </div>
          </Html>
          <Html position={[width + 0.3, height / 2, 0]} center>
            <div className="whitespace-nowrap rounded bg-zinc-900/80 px-2 py-0.5 text-xs font-bold text-amber-400">
              {height.toFixed(1)} m ↕
            </div>
          </Html>
        </>
      )}
    </group>
  )
}
