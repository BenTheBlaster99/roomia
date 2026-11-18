'use client'

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { registerWalkHome } from './walk-bridge'

/**
 * Walking through a project at eye level (18 Nov, the owner and Sarah: "no upper view or any view, just a way to actually
 * navigate through the thing"). Replaces the orbit of drei's CameraControls for imported projects only.
 *
 * - Left drag looks around (the camera stays put), wheel / ZQSD / WASD / arrows walk, Shift walks faster, right drag
 *   sidesteps, double-click on the floor glides there. Touch: one finger looks, two fingers move.
 * - The eye is kept 1.6 m above the floor under it (a ray down), walls stop the walk 0.35 m before them (rays ahead).
 * - It registers itself as the scene's `controls` with the one method ImportedRoom uses, setLookAt: a SketchUp view is
 *   framed exactly (its own height), the eye only settles at 1.6 m once the person walks.
 * - The rays use a BVH per mesh (three-mesh-bvh), built a few meshes per frame so a 40 MB model never freezes the page;
 *   walking waits until it is built (looking around does not).
 */

const EYE = 1.6
/** the highest step walked onto: a bed or a table top stops the walk */
const STEP = 0.45
const WALL_GAP = 0.35
/** deeper than this under the feet: no floor */
const MAX_DROP = 6
const WALK_SPEED = 1.6
const RUN_SPEED = 3.6
const MAX_PITCH = (80 * Math.PI) / 180
const LOOK_SPEED = 0.0042
const GLIDE_SECONDS = 0.6
const BUILD_BUDGET_MS = 10

const DOWN = new THREE.Vector3(0, -1, 0)
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

interface Entry {
  mesh: THREE.Mesh
  bvh: MeshBVH
  inverse: THREE.Matrix4
  box: THREE.Box3
}

interface Pose {
  position: THREE.Vector3
  yaw: number
  pitch: number
  fov: number | null
}

interface Glide {
  from: Pose
  to: Pose
  t: number
  /** where it ends: a SketchUp view keeps its own height, a floor glide puts the eye at 1.6 m */
  floor: number | null
  framed: boolean
}

interface Hit {
  distance: number
  point: THREE.Vector3
  normalY: number
}

class WalkApi extends THREE.EventDispatcher {
  constructor(readonly setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, animate?: boolean) => void) {
    super()
  }
}

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)

const shortestAngle = (from: number, to: number) => {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

const visibleInTree = (node: THREE.Object3D) => {
  for (let n: THREE.Object3D | null = node; n; n = n.parent) if (!n.visible) return false
  return true
}

export default function WalkControls({ object }: { object: THREE.Object3D }) {
  const camera = useThree(state => state.camera)
  const gl = useThree(state => state.gl)
  const set = useThree(state => state.set)
  const get = useThree(state => state.get)

  const entries = useRef<Entry[]>([])
  const queue = useRef<THREE.Mesh[]>([])
  const built = useRef(new Map<THREE.BufferGeometry, MeshBVH>())
  const ready = useRef(false)
  const yaw = useRef(0)
  const pitch = useRef(0)
  /** the floor under the eye, null when there is none (a view from outside: then the walk keeps its height) */
  const floor = useRef<number | null>(null)
  const floorKnown = useRef(false)
  /** false right after a SketchUp view: its own height is kept until the person walks */
  const heightLocked = useRef(false)
  const keys = useRef(new Set<string>())
  const shift = useRef(false)
  const pendingForward = useRef(0)
  const glide = useRef<Glide | null>(null)
  const home = useRef<Pose | null>(null)
  const homeFromView = useRef(false)
  const viewed = useRef(false)

  // ── rays ──
  const worldRay = useRef(new THREE.Ray())
  const localRay = useRef(new THREE.Ray())
  const tmpPoint = useRef(new THREE.Vector3())

  function cast(origin: THREE.Vector3, direction: THREE.Vector3, far: number): Hit | null {
    const ray = worldRay.current.set(origin, direction)
    let best: Hit | null = null
    for (const e of entries.current) {
      const boxHit = ray.intersectBox(e.box, tmpPoint.current)
      if (!boxHit || boxHit.distanceTo(origin) > (best ? best.distance : far)) continue
      localRay.current.copy(ray).applyMatrix4(e.inverse)
      const hit = e.bvh.raycastFirst(localRay.current, THREE.DoubleSide)
      if (!hit) continue
      const point = hit.point.clone().applyMatrix4(e.mesh.matrixWorld)
      const distance = point.distanceTo(origin)
      if (distance > far || (best && distance >= best.distance)) continue
      const normalY = hit.face ? hit.face.normal.clone().transformDirection(e.mesh.matrixWorld).y : 0
      best = { distance, point, normalY }
    }
    return best
  }

  /** the floor under (x, z), searched from `fromY` down */
  function floorAt(x: number, z: number, fromY: number, depth = STEP + 0.05 + MAX_DROP): number | null {
    const hit = cast(new THREE.Vector3(x, fromY, z), DOWN, depth)
    return hit ? hit.point.y : null
  }

  function applyRotation() {
    camera.quaternion.setFromEuler(new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ'))
  }

  function readRotation() {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    yaw.current = e.y
    pitch.current = e.x
  }

  function pose(): Pose {
    return {
      position: camera.position.clone(),
      yaw: yaw.current,
      pitch: pitch.current,
      fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : null,
    }
  }

  /** the floor where the eye is now (after a jump): a camera up to 4 m above its floor counts */
  function acquireFloor() {
    if (!ready.current) return
    floor.current = floorAt(camera.position.x, camera.position.z, camera.position.y, 4)
    floorKnown.current = true
  }

  /** One step of the walk, horizontal. Walls stop it (sliding along them when the move is slanted); no floor or a floor too high stops it. */
  function tryMove(dx: number, dz: number, slide = true): boolean {
    if (!ready.current) return false
    const length = Math.hypot(dx, dz)
    if (length < 1e-5) return false
    if (!floorKnown.current) acquireFloor()
    const pos = camera.position
    const base = floor.current
    const dir = new THREE.Vector3(dx / length, 0, dz / length)
    const heights = base !== null ? [base + 0.55, base + 1.5] : [pos.y - 0.9, pos.y]
    for (const h of heights) {
      if (cast(new THREE.Vector3(pos.x, h, pos.z), dir, length + WALL_GAP)) {
        if (!slide) return false
        // along the wall: the two halves of the move on their own
        return tryMove(dx, 0, false) || tryMove(0, dz, false)
      }
    }
    const nx = pos.x + dx
    const nz = pos.z + dz
    if (base !== null) {
      const next = floorAt(nx, nz, base + STEP + 0.05)
      if (next === null || next > base + STEP) return false
      floor.current = next
      heightLocked.current = true
    } else {
      // walking outside a building: a floor found close under the eye is taken
      const next = floorAt(nx, nz, pos.y, EYE + 1)
      if (next !== null) {
        floor.current = next
        heightLocked.current = true
      }
    }
    pos.x = nx
    pos.z = nz
    return true
  }

  function move(forward: number, right: number) {
    const s = Math.sin(yaw.current)
    const c = Math.cos(yaw.current)
    // forward is (-sin yaw, 0, -cos yaw), right is (cos yaw, 0, -sin yaw)
    return tryMove(-s * forward + c * right, -c * forward - s * right)
  }

  function startGlide(to: Pose, opts: { floor: number | null; framed: boolean }) {
    glide.current = { from: pose(), to, t: 0, floor: opts.floor, framed: opts.framed }
  }

  function goHome() {
    const h = home.current
    if (!h) return
    pendingForward.current = 0
    startGlide({ ...h, position: h.position.clone() }, { floor: null, framed: homeFromView.current })
  }

  // ── the BVH, a few meshes per frame ──
  useEffect(() => {
    object.updateWorldMatrix(true, true)
    const meshes: THREE.Mesh[] = []
    object.traverse(node => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
      if (!mesh.geometry?.attributes?.position || !visibleInTree(mesh)) return
      meshes.push(mesh)
    })
    entries.current = []
    queue.current = meshes
    ready.current = meshes.length === 0
    floorKnown.current = false
    built.current = new Map()

    // until the walk starts somewhere better: the middle of the model at eye height, looking along its longest side
    const box = new THREE.Box3().setFromObject(object)
    if (!box.isEmpty() && !viewed.current) {
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      camera.position.set(center.x, box.min.y + EYE, center.z)
      yaw.current = size.x >= size.z ? -Math.PI / 2 : 0
      pitch.current = 0
      applyRotation()
      if (camera instanceof THREE.PerspectiveCamera && camera.fov !== 70) {
        camera.fov = 70
        camera.updateProjectionMatrix()
      }
      home.current = pose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per model
  }, [object])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)

    if (!ready.current && queue.current.length) {
      const started = performance.now()
      while (queue.current.length && performance.now() - started < BUILD_BUDGET_MS) {
        const mesh = queue.current.pop()!
        try {
          const geometry = mesh.geometry
          let bvh = built.current.get(geometry)
          if (!bvh) {
            bvh = new MeshBVH(geometry)
            built.current.set(geometry, bvh)
          }
          const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(mesh.matrixWorld)
          entries.current.push({ mesh, bvh, inverse: mesh.matrixWorld.clone().invert(), box })
        } catch {
          // a mesh the BVH cannot read is simply not solid
        }
      }
      if (!queue.current.length) {
        ready.current = true
        if (viewed.current) acquireFloor()
        else {
          // no SketchUp view came: stand on the floor in the middle of the model
          const p = camera.position
          const found = floorAt(p.x, p.z, p.y + 0.6, 0.6 + MAX_DROP)
          if (found !== null) {
            p.y = found + EYE
            floor.current = found
            floorKnown.current = true
            home.current = pose()
          }
        }
      }
    }

    const g = glide.current
    if (g) {
      g.t = Math.min(1, g.t + dt / GLIDE_SECONDS)
      const e = g.t < 0.5 ? 2 * g.t * g.t : 1 - Math.pow(-2 * g.t + 2, 2) / 2
      camera.position.lerpVectors(g.from.position, g.to.position, e)
      yaw.current = g.from.yaw + shortestAngle(g.from.yaw, g.to.yaw) * e
      pitch.current = g.from.pitch + (g.to.pitch - g.from.pitch) * e
      applyRotation()
      if (g.to.fov !== null && g.from.fov !== null && camera instanceof THREE.PerspectiveCamera) {
        camera.fov = g.from.fov + (g.to.fov - g.from.fov) * e
        camera.updateProjectionMatrix()
      }
      if (g.t >= 1) {
        glide.current = null
        if (g.framed) {
          heightLocked.current = false
          floorKnown.current = false
          acquireFloor()
        } else {
          floor.current = g.floor
          floorKnown.current = g.floor !== null
          heightLocked.current = g.floor !== null
          if (g.floor === null) acquireFloor()
        }
      }
      return
    }

    // keys and wheel
    const k = keys.current
    let forward = 0
    let right = 0
    if (k.has('KeyW') || k.has('ArrowUp')) forward += 1
    if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) right += 1
    if (k.has('KeyA') || k.has('ArrowLeft')) right -= 1
    const speed = (shift.current ? RUN_SPEED : WALK_SPEED) * dt
    const n = Math.hypot(forward, right)
    let f = n ? (forward / n) * speed : 0
    const r = n ? (right / n) * speed : 0
    if (pendingForward.current) {
      const step = pendingForward.current * Math.min(1, dt * 10)
      pendingForward.current -= step
      if (Math.abs(pendingForward.current) < 0.005) pendingForward.current = 0
      f += step
    }
    if (f || r) {
      if (!move(f, r)) pendingForward.current = 0
    }

    // the eye settles 1.6 m above the floor
    if (heightLocked.current && floor.current !== null) {
      const target = floor.current + EYE
      const p = camera.position
      p.y += (target - p.y) * Math.min(1, dt * 8)
    }
  })

  // ── setLookAt (SketchUp views), the controls of the scene, the home ──
  useEffect(() => {
    const api = new WalkApi((px, py, pz, tx, ty, tz, animate) => {
      const dx = tx - px
      const dy = ty - py
      const dz = tz - pz
      const to: Pose = {
        position: new THREE.Vector3(px, py, pz),
        yaw: Math.atan2(-dx, -dz),
        pitch: Math.atan2(dy, Math.hypot(dx, dz)),
        fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : null,
      }
      pendingForward.current = 0
      if (!homeFromView.current) {
        // the first SketchUp view shown is where the walk starts
        home.current = { ...to, position: to.position.clone() }
        homeFromView.current = true
      }
      viewed.current = true
      if (animate) {
        // the view's own field of view is already set on the camera (ImportedRoom): keep it during the glide
        startGlide(to, { floor: null, framed: true })
      } else {
        glide.current = null
        camera.position.copy(to.position)
        yaw.current = to.yaw
        pitch.current = to.pitch
        applyRotation()
        heightLocked.current = false
        floorKnown.current = false
        acquireFloor()
      }
    })
    set({ controls: api })
    registerWalkHome(goHome)
    return () => {
      registerWalkHome(null)
      if (get().controls === api) set({ controls: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, [camera, set, get])

  // ── mouse, touch, keys ──
  useEffect(() => {
    const el = gl.domElement
    const pressed = keys.current
    el.style.touchAction = 'none'
    readRotation()
    let mode: 'look' | 'move' | null = null
    let lastX = 0
    let lastY = 0
    const touches = new Map<number, { x: number; y: number }>()
    let pinch = 0

    const look = (dx: number, dy: number) => {
      glide.current = null
      yaw.current -= dx * LOOK_SPEED
      pitch.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch.current - dy * LOOK_SPEED))
      applyRotation()
    }

    const touchMid = () => {
      const [a, b] = [...touches.values()]
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
    }

    function onDown(e: PointerEvent) {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.size === 2) {
          const m = touchMid()
          lastX = m.x
          lastY = m.y
          pinch = m.d
        } else {
          lastX = e.clientX
          lastY = e.clientY
        }
        el.setPointerCapture?.(e.pointerId)
        return
      }
      if (e.button === 0) mode = 'look'
      else if (e.button === 1 || e.button === 2) mode = 'move'
      else return
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType === 'touch') {
        if (!touches.has(e.pointerId)) return
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.size === 1) {
          look(e.clientX - lastX, e.clientY - lastY)
          lastX = e.clientX
          lastY = e.clientY
        } else if (touches.size === 2) {
          const m = touchMid()
          glide.current = null
          move((m.y - lastY) * 0.01 + (m.d - pinch) * 0.012, -(m.x - lastX) * 0.01)
          lastX = m.x
          lastY = m.y
          pinch = m.d
        }
        return
      }
      if (!mode) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      if (mode === 'look') look(dx, dy)
      else {
        glide.current = null
        move(dy * 0.01, -dx * 0.01)
      }
    }

    function onUp(e: PointerEvent) {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId)
        const rest = [...touches.values()][0]
        if (rest) {
          lastX = rest.x
          lastY = rest.y
        }
        return
      }
      mode = null
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      glide.current = null
      const notch = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      pendingForward.current = Math.max(-3, Math.min(3, pendingForward.current - Math.max(-0.8, Math.min(0.8, notch * 0.005))))
    }

    function onDouble(e: MouseEvent) {
      if (!ready.current) return
      const rect = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const hit = cast(raycaster.ray.origin, raycaster.ray.direction, 200)
      if (!hit) return
      let ground: number | null = null
      let x = hit.point.x
      let z = hit.point.z
      if (Math.abs(hit.normalY) > 0.6 && hit.point.y < camera.position.y - 0.3) {
        ground = hit.point.y
      } else {
        // a wall or a piece of furniture: half a metre back towards the eye, on the floor there
        const back = new THREE.Vector3(raycaster.ray.direction.x, 0, raycaster.ray.direction.z)
        if (back.lengthSq() < 1e-6) return
        back.normalize().multiplyScalar(0.5)
        x -= back.x
        z -= back.z
        ground = floorAt(x, z, Math.max(hit.point.y, (floor.current ?? hit.point.y) + STEP) + 0.05)
      }
      if (ground === null) return
      pendingForward.current = 0
      startGlide(
        { position: new THREE.Vector3(x, ground + EYE, z), yaw: yaw.current, pitch: pitch.current, fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : null },
        { floor: ground, framed: false },
      )
    }

    function onKey(e: KeyboardEvent, down: boolean) {
      shift.current = e.shiftKey
      if (!KEYS.has(e.code)) return
      if (down && (e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement))) return
      if (down) {
        keys.current.add(e.code)
        glide.current = null
        if (e.code.startsWith('Arrow')) e.preventDefault()
      } else keys.current.delete(e.code)
    }
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true)
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false)
    const onBlur = () => {
      keys.current.clear()
      shift.current = false
      mode = null
      touches.clear()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDouble)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDouble)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      el.style.touchAction = ''
      pressed.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
  }, [camera, gl])

  return null
}
