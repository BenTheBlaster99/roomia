'use client'

import { useEffect, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useStudioStore } from '@/store/useStudioStore'
import { fitImportedRoom } from '@/lib/studio-import/fit-imported-room'
import { getImportedSource } from '@/lib/studio-import/imported-room-cache'
import { registerCameraMover, registerHeavyCapture } from '@/lib/studio-import/heavy-view-camera'
import { verticalFov } from '@/lib/scene-cameras'
import { registerMaterialAccess } from '@/lib/studio-import/material-picker'

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
  const pickHandler = useRef<((name: string) => void) | null>(null)

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
      const aspect = size.width / Math.max(size.height, 1)
      return {
        position: [pos.x, pos.y, pos.z],
        quaternion: [modelQ.x, modelQ.y, modelQ.z, modelQ.w],
        fov,
        // Horizontal span of the screen, so a 3:2 photo of this view frames what was on screen.
        hfov: (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 180) / Math.PI,
      }
    })
    return () => registerHeavyCapture(null)
  }, [camera, object, size.width, size.height])

  // Matériaux panel: list the scene's materials, make one glow, and pick one by clicking a surface.
  useEffect(() => {
    if (!object) {
      registerMaterialAccess(null)
      return
    }
    const byName = new Map<string, THREE.MeshStandardMaterial[]>()
    const meshes = new Map<string, number>()
    object.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material?.name) continue
        const list = byName.get(material.name) ?? []
        if (!list.includes(material as THREE.MeshStandardMaterial)) list.push(material as THREE.MeshStandardMaterial)
        byName.set(material.name, list)
        meshes.set(material.name, (meshes.get(material.name) ?? 0) + 1)
      }
    })
    let lit: { material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }[] = []
    const originals = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; map: THREE.Texture | null }>()
    const restore = () => {
      for (const { material, emissive, intensity } of lit) {
        material.emissive.copy(emissive)
        material.emissiveIntensity = intensity
      }
      lit = []
    }
    registerMaterialAccess({
      list: () =>
        [...byName].map(([name, materials]) => ({
          name,
          color: materials[0].color ? `#${materials[0].color.getHexString()}` : '#999999',
          textured: Boolean(materials[0].map),
          seeThrough: materials[0].transparent && materials[0].opacity < 0.9,
          meshes: meshes.get(name) ?? 0,
        })),
      highlight: names => {
        restore()
        for (const name of names) {
          for (const material of byName.get(name) ?? []) {
            if (!material.emissive) continue
            lit.push({ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity })
            material.emissive.set('#ff7a00')
            material.emissiveIntensity = 0.9
          }
        }
      },
      previewColor: (name, color) => {
        for (const material of byName.get(name) ?? []) {
          if (!material.color) continue
          if (!originals.has(material)) originals.set(material, { color: material.color.clone(), map: material.map })
          const original = originals.get(material)!
          if (color) {
            material.color.set(color)
            material.map = null
          } else {
            material.color.copy(original.color)
            material.map = original.map
          }
          material.needsUpdate = true
        }
      },
      setPickHandler: handler => {
        pickHandler.current = handler
        document.body.style.cursor = handler ? 'crosshair' : ''
      },
    })
    return () => {
      restore()
      for (const [material, original] of originals) {
        material.color.copy(original.color)
        material.map = original.map
        material.needsUpdate = true
      }
      pickHandler.current = null
      document.body.style.cursor = ''
      registerMaterialAccess(null)
    }
  }, [object])

  function pickMaterial(event: ThreeEvent<MouseEvent>) {
    const handler = pickHandler.current
    if (!handler) return
    event.stopPropagation()
    const mesh = event.object as THREE.Mesh
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const material = materials[event.face?.materialIndex ?? 0] ?? materials[0]
    if (material?.name) handler(material.name)
  }

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
      <primitive object={object} onClick={pickMaterial} />
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
