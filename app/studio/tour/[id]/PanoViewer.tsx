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
  hdSrc,
  spots,
  onSpot,
  onLook,
  onReady,
  initialYaw = 0,
  initialPitch = 0,
  initialFov = 75,
  still = false,
  arrive = false,
}: {
  src: string
  /** An 8192 px copy, swapped in after src on screens that can hold it (not phones: 128 MB of texture). */
  hdSrc?: string
  /** Where to look first, relative to the saved view's direction (radians, + = right). */
  initialYaw?: number
  /** Up (+) / down (−) to start with, radians. */
  initialPitch?: number
  /** Vertical field of view to start with, degrees (the free walk hands over its own, 70°). */
  initialFov?: number
  /** No slow turn while nobody touches it: the free walk opens it facing where the visitor was looking. */
  still?: boolean
  /** Coming from another point: opens a little zoomed in and settles (with the parent's fade, a step into the room). */
  arrive?: boolean
  spots: PanoSpot[]
  /** An arrow was clicked: the view has turned and zoomed towards it; `snapshot` is the last frame (JPEG data URL) to fade from. */
  onSpot: (key: string, snapshot?: string) => void
  onLook?: (yaw: number, pitch: number) => void
  onReady?: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const spotEls = useRef<Map<string, HTMLButtonElement>>(new Map())
  const spotsRef = useRef(spots)
  const lookRef = useRef(onLook)
  const readyRef = useRef(onReady)
  const spotRef = useRef(onSpot)
  /** Set by the viewer: turn and zoom towards an arrow, then hand over (see onSpot). */
  const flyRef = useRef<((spot: PanoSpot) => void) | null>(null)
  // The render loop reads the latest arrows and callbacks without restarting the viewer.
  useEffect(() => {
    spotsRef.current = spots
    lookRef.current = onLook
    readyRef.current = onReady
    spotRef.current = onSpot
  }, [spots, onLook, onReady, onSpot])

  useEffect(() => {
    const el = host.current
    if (!el) return
    // the last frame is read back for the fade to the next point (14 Nov)
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
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
    const use = (tex: THREE.Texture) => {
      if (disposed) return tex.dispose()
      tex.colorSpace = THREE.NoColorSpace
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.wrapS = THREE.RepeatWrapping
      texture?.dispose()
      texture = tex
      uniforms.tex.value = tex
    }
    // A large screen with a mouse and enough memory takes the sharper copy once the normal one shows; a phone or a
    // GPU that cannot hold an 8192 px texture keeps the normal one.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
    const hd = hdSrc && renderer.capabilities.maxTextureSize >= 8192 && !window.matchMedia('(pointer: coarse)').matches && memory >= 4
    new THREE.TextureLoader().load(src, tex => {
      use(tex)
      if (disposed) return
      if (arrive && !reduceMotion) anim = { from: { yaw, pitch, fov: fov * 0.72 }, to: { yaw, pitch, fov }, t0: performance.now(), dur: 650 }
      readyRef.current?.()
      if (hd) new THREE.TextureLoader().load(hdSrc, use)
    })

    let yaw = initialYaw
    let pitch = initialPitch
    let fov = initialFov
    let touched = still || arrive
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    /** a short move of the view (an arrow clicked, an arrival), eased */
    let anim: { from: { yaw: number; pitch: number; fov: number }; to: { yaw: number; pitch: number; fov: number }; t0: number; dur: number; done?: () => void } | null = null
    flyRef.current = spot => {
      touched = true
      // the shortest way round to the arrow, a little down towards the floor where it stands, zoomed in: a step forward
      const target = yaw + Math.atan2(Math.sin(spot.yaw - yaw), Math.cos(spot.yaw - yaw))
      const done = () => spotRef.current(spot.key, renderer.domElement.toDataURL('image/jpeg', 0.82))
      if (reduceMotion) return done()
      anim = { from: { yaw, pitch, fov }, to: { yaw: target, pitch: Math.max(-0.35, Math.min(0.1, spot.pitch * 0.5)), fov: Math.max(38, fov * 0.6) }, t0: performance.now(), dur: 420, done }
    }
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
    let lastPitch = NaN
    const frame = () => {
      if (anim) {
        const t = Math.min(1, (performance.now() - anim.t0) / anim.dur)
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * k
        pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * k
        fov = anim.from.fov + (anim.to.fov - anim.from.fov) * k
        if (t >= 1) {
          const done = anim.done
          anim = null
          if (done) {
            // drawn once more at the end position, then read back
            uniforms.yaw.value = yaw
            uniforms.pitch.value = pitch
            uniforms.tanHalf.value = Math.tan(((fov / 2) * Math.PI) / 180)
            renderer.render(scene, camera)
            done()
          }
        }
      }
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
      if (Math.abs(yaw - lastLook) > 0.002 || Math.abs(pitch - lastPitch) > 0.002 || Number.isNaN(lastLook)) {
        lastLook = yaw
        lastPitch = pitch
        lookRef.current?.(yaw, pitch)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      flyRef.current = null
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
  }, [src, hdSrc, initialYaw, initialPitch, initialFov, still, arrive])

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
          onClick={() => (flyRef.current ? flyRef.current(s) : onSpot(s.key))}
          aria-label={`Aller à ${s.label}`}
        >
          <SpotMark />
          <span className="spot-label">{s.label}</span>
        </button>
      ))}
    </div>
  )
}

/** The arrow towards another point: a ring lying on the floor with a chevron, the point's name under it. */
export function SpotMark() {
  return (
    <span className="spot-disc" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path d="M5 14.5 12 7.5l7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
