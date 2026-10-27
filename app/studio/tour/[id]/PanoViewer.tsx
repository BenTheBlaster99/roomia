'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface PanoSpot {
  key: string
  label: string
  /** Direction from the viewpoint, relative to the panorama's centre: right (+) / left (−), up (+) / down (−), radians. */
  yaw: number
  pitch: number
}

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

// Each screen pixel looks along a ray; the ray's longitude and latitude give the spot in the
// equirectangular panorama (centre column = the saved view's direction, left to right = turning right).
const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tex;
uniform float yaw;
uniform float pitch;
uniform float tanHalf;
uniform float aspect;
const float PI = 3.14159265358979;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec3 d = normalize(vec3(p.x * tanHalf * aspect, p.y * tanHalf, 1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  gl_FragColor = texture2D(tex, vec2(0.5 + lon / (2.0 * PI), 0.5 + lat / PI));
}`

/** Drag to look around a 360° panorama; wheel or pinch to zoom. Reports where it looks so the plan can follow. */
export default function PanoViewer({
  src,
  spots,
  onSpot,
  onLook,
  onReady,
  initialYaw = 0,
}: {
  src: string
  /** Where to look first, relative to the saved view's direction (radians, + = right). */
  initialYaw?: number
  spots: PanoSpot[]
  onSpot: (key: string) => void
  onLook?: (yaw: number) => void
  onReady?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const spotEls = useRef<Map<string, HTMLButtonElement>>(new Map())
  const spotsRef = useRef(spots)
  const lookRef = useRef(onLook)
  const readyRef = useRef(onReady)
  // The render loop reads the latest arrows and callbacks without restarting the viewer.
  useEffect(() => {
    spotsRef.current = spots
    lookRef.current = onLook
    readyRef.current = onReady
  }, [spots, onLook, onReady])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.prepend(renderer.domElement)
    renderer.domElement.className = 'pano-canvas'

    const uniforms = {
      tex: { value: null as THREE.Texture | null },
      yaw: { value: 0 },
      pitch: { value: 0 },
      tanHalf: { value: Math.tan(((75 / 2) * Math.PI) / 180) },
      aspect: { value: 1 },
    }
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT })))

    let disposed = false
    let texture: THREE.Texture | null = null
    new THREE.TextureLoader().load(src, tex => {
      if (disposed) return tex.dispose()
      tex.colorSpace = THREE.NoColorSpace
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.wrapS = THREE.RepeatWrapping
      texture = tex
      uniforms.tex.value = tex
      readyRef.current?.()
    })

    let yaw = initialYaw
    let pitch = 0
    let fov = 75
    let touched = false
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h, false)
      uniforms.aspect.value = w / Math.max(1, h)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(el)

    // Drag: the panorama follows the finger. Two fingers: zoom.
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.pano-spot')) return
      touched = true
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId)
      if (!last) return
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const before = Math.hypot(a.x - b.x, a.y - b.y)
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const [c, d] = [...pointers.values()]
        const after = Math.hypot(c.x - d.x, c.y - d.y)
        if (pinch && before > 0) fov = Math.min(100, Math.max(35, fov * (before / after)))
        pinch = after
        return
      }
      const perPixel = (2 * Math.tan(((fov / 2) * Math.PI) / 180)) / Math.max(1, el.clientHeight)
      yaw -= (e.clientX - last.x) * perPixel
      pitch = Math.min(1.45, Math.max(-1.45, pitch + (e.clientY - last.y) * perPixel))
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinch = 0
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      touched = true
      fov = Math.min(100, Math.max(35, fov + e.deltaY * 0.04))
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let lastLook = NaN
    const frame = () => {
      // A slow turn until the visitor takes over, so the page shows at once that it is a 360°.
      if (!touched && !reduce && texture) yaw += 0.0012
      uniforms.yaw.value = yaw
      uniforms.pitch.value = pitch
      const tanHalf = Math.tan(((fov / 2) * Math.PI) / 180)
      uniforms.tanHalf.value = tanHalf
      renderer.render(scene, camera)
      const aspect = uniforms.aspect.value
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
      for (const spot of spotsRef.current) {
        const node = spotEls.current.get(spot.key)
        if (!node) continue
        const x = Math.cos(spot.pitch) * Math.sin(spot.yaw)
        const y = Math.sin(spot.pitch)
        const z = Math.cos(spot.pitch) * Math.cos(spot.yaw)
        const x1 = x * cy - z * sy
        const z1 = x * sy + z * cy
        const y2 = y * cp - z1 * sp
        const z2 = y * sp + z1 * cp
        const sx = x1 / (z2 * tanHalf * aspect)
        const syy = y2 / (z2 * tanHalf)
        const visible = z2 > 0.05 && Math.abs(sx) < 1.05 && Math.abs(syy) < 1.05
        node.style.opacity = visible ? '1' : '0'
        node.style.pointerEvents = visible ? 'auto' : 'none'
        if (visible) node.style.transform = `translate(-50%, -50%) translate(${((sx + 1) / 2) * el.clientWidth}px, ${((1 - syy) / 2) * el.clientHeight}px)`
      }
      if (Math.abs(yaw - lastLook) > 0.002 || Number.isNaN(lastLook)) {
        lastLook = yaw
        lookRef.current?.(yaw)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      texture?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [src, initialYaw])

  return (
    <div className="pano" ref={host}>
      {spots.map(s => (
        <button
          key={s.key}
          type="button"
          className="pano-spot"
          ref={node => {
            if (node) spotEls.current.set(s.key, node)
            else spotEls.current.delete(s.key)
          }}
          onClick={() => onSpot(s.key)}
        >
          <span aria-hidden="true">↑</span> {s.label}
        </button>
      ))}
    </div>
  )
}
