'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { createSplatLayer, type SplatInfo, type SplatLayer } from './splatLayer'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { TourLevel, TourView } from '@/lib/scene-tour'
import PanoViewer, { type PanoSpot } from '../../tour/[id]/PanoViewer'
import { createAiLayer, type AiMode, type AiProjection } from './aiLayer'
import { roomEnvironment } from './roomLight'

/** The walkable map the tour build writes (nav.json): per level and per 25 cm spot, in Blender's floor plane. */
interface NavFile {
  x0: number
  y0: number
  step: number
  nx: number
  ny: number
  levels: { index: number; floor: number; suffix: string; dz: string; cl: string }[]
}

interface NavLevel {
  index: number
  floor: number
  /** Floor height of each spot, mm from the level's floor (-32768: no floor). */
  dz: Int16Array
  /** Room around each spot, cm to the nearest wall or piece of furniture (0: nobody can stand there). */
  cl: Uint8Array
}

interface TourData {
  plan: { file: string; width: number; height: number } | null
  levels: TourLevel[] | null
  builtAt: string | null
  views: TourView[]
}

type PlanShown = { file: string; width: number; height: number; index: number }

/**
 * The baked light the tour build can write with the model (explore.json, explore.glb, explore-light.png): Cycles'
 * light without the surfaces' colour, log-encoded (light = 2^(lo + v (hi - lo)), already at the walk's fixed
 * exposure), in a lightmap on the walls' second UVs and in the furniture's vertex colours.
 */
interface BakeInfo {
  lo: number
  hi: number
  exposureEv: number
  /** Each 360°'s own exposure, by point index: to look at a point exactly as its 360° does. */
  viewEv: Record<string, number>
}

const EYE = 1.6
/** Half the width of a person: how close the eye may come to a wall or a piece of furniture. */
const RADIUS = 0.24
const WALK = 1.4
const RUN = 2.6
/** A step up or down that is taken in one stride; more is a stair or a drop, and stops the walk. */
const STEP_UP = 0.35
const NONE = -32768

const decode = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))

/** glTF (Y up) to Blender's floor plane, the frame of the walkable map and of the plans. */
const toPlane = (p: THREE.Vector3) => ({ x: p.x, y: -p.z })

/** The walk's yaw (0 = +y, turning left) of a point's own direction: the middle of its 360°. */
const facing = (v: TourView) => {
  const p = toPlane(new THREE.Vector3(...v.position))
  const t = toPlane(new THREE.Vector3(...v.target))
  return Math.atan2(-(t.x - p.x), t.y - p.y)
}

/**
 * How the scene's walk is lit and graded (look.json in its tour, fitted from the walk's own 360°s to the AI ones; a
 * scene without one keeps the stock lights). Each scene has its own values (1 Nov, Restaurant first).
 */
interface LookFile {
  /** After AgX, on the display values: a gain per channel (exposure and white balance) and one shared contrast. */
  grade?: { gain: [number, number, number]; contrast: number }
  /** The lights, as LIGHTS; room: the room's own light (roomLight.ts) at that strength in place of the studio's. */
  light?: Partial<typeof LIGHTS> & { room?: number }
  /** Contact shadows' strength (GTAO), 0 = none. */
  ao?: number
  /**
   * AI-redrawn textures (2 Nov), by the model's texture name (or material name): the same layout and colour as the
   * designer's texture, photographed detail, and a relief map made from that detail. Files in the tour folder.
   */
  textures?: Record<string, { map: string; normal?: string; normalScale?: number }>
  /**
   * The lamps' own light (2 Nov): a warm light in each glowing lamp (candela), the strongest `shadows` of them casting
   * soft shadows (drawn once: nothing in the room moves). The walk had only sky and studio light, no pools under lamps.
   */
  lamps?: { light: number; shadows?: number; at?: [number, number, number][]; around?: number; angle?: number }
  /** Glow around lamps and daylight (bloom strength, 0 = none). */
  bloom?: number
}

const STOCK_CHUNK = THREE.ShaderChunk.tonemapping_pars_fragment
const gradeChunk = (g: NonNullable<LookFile['grade']>) =>
  STOCK_CHUNK.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
      vec3 c = max( AgXToneMapping( color ), 0.0 );
      return min( vec3( ${g.gain.map(x => x.toFixed(4)).join(', ')} ) * pow( c, vec3( ${g.contrast.toFixed(4)} ) ), vec3( 1.0 ) );
    }`,
  )

/**
 * A finish by kind of material, from its name (SketchUp writes no roughness: everything came in fully matte, so the
 * stone floor and the wood showed none of the soft sheen the 360°s have). English, French and the Chinese of the
 * 3D Warehouse models. Fabric, plaster, paint and the rest stay matte.
 */
const FINISHES: [RegExp, { roughness: number; metalness?: number }][] = [
  [/metal|steel|chrome|silver|brass|inox|alumin|金属|不锈钢/i, { roughness: 0.35, metalness: 1 }],
  [/paver|flagstone|stone|concrete|marble|ceramic|tile|terrazzo|granite|pierre|marbre|béton|carrelage|石|砖|瓷/i, { roughness: 0.45 }],
  [/wood|oak|walnut|parquet|board|bois|chêne|noyer|木/i, { roughness: 0.6 }],
]

/** Arrows inside a photo-quality 360° to the points it can see that have one too (as in the tour): within 9 m, aimed
 *  at the floor where the next point stands. */
const photoSpots = (from: TourView, views: TourView[]): PanoSpot[] => {
  const linked = new Set(from.links)
  const [px, py, pz] = from.position
  const fx = from.target[0] - px
  const fz = from.target[2] - pz
  return views
    .filter(v => v.index !== from.index && v.panoAi && v.pano && (linked.size ? linked.has(v.index) : true))
    .map(v => {
      const vx = v.position[0] - px
      const vz = v.position[2] - pz
      const dist = Math.hypot(vx, vz)
      return { key: String(v.index), label: v.name, dist, yaw: Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz), pitch: Math.atan2(v.position[1] - 1.25 - py, dist) }
    })
    .filter(s => s.dist <= 9)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
}

/** The walk's studio environment (intensity), sky light (intensity, ground colour) and sun (intensity, height of its
 *  direction over (6, ·, 4)). */
const LIGHTS = { env: 1, sky: 1.1, ground: '7a6a58', sun: 1.4, sunHeight: 9 }

/** What glows in the Blender renders glows in the walk too: Enscape's and D5's light objects, and light materials by
 *  name (lib/blender-render.ts, role "light"). */
// three's loader drops the dot from node names (Enscape.RectangularLight → EnscapeRectangularLight): the glow had never
// matched in the walk (2 Nov)
const LAMP_OBJECT = /Enscape\.?\w*Light|D5RenderLight/i
const LAMP_MATERIAL = /^(led|light|lights|lamp|spot)$|\bled\b|bedside lights|lumin|plafonnier|neon/i
const GLOW = new THREE.Color(1.0, 0.86, 0.62)

/** How near a point the visitor must stand to step into its photo-quality 360°, metres. */
const PHOTO_NEAR = 0.8

/** published: a tour sent from Roomia Desktop for the architect's clients — walking only, no Studio tools. */
export default function ExploreClient({ sceneId, title, published = false }: { sceneId: string; title: string; published?: boolean }) {
  const mount = useRef<HTMLDivElement>(null)
  const [tour, setTour] = useState<TourData | null>(null)
  const [nav, setNav] = useState<NavFile | null>(null)
  /** undefined while asked, null when the tour has no baked model */
  const [bake, setBake] = useState<BakeInfo | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [locked, setLocked] = useState(false)
  const [level, setLevel] = useState(0)
  const [here, setHere] = useState<{ x: number; y: number; yaw: number } | null>(null)
  /** Set by the 3D loop; called by the plan and the point list to move the visitor. */
  const jump = useRef<(x: number, y: number, yaw?: number, level?: number) => void>(() => undefined)
  /** undefined while asked, null when the scene has no grade (look.json) or ?look=0 */
  const [lookFile, setLookFile] = useState<LookFile | null | undefined>(undefined)
  /** ?edit=1: the reviewer, who also steps into AI 360°s that are not approved yet */
  const [edit, setEdit] = useState(false)
  /** undefined while asked, null when the tour has no AI 360° to paint with (projection.json) */
  const [projection, setProjection] = useState<AiProjection | null | undefined>(undefined)
  /** ?ai=0 starts without the AI layer, ?ai=2 shows where each surface's colour comes from */
  const [aiMode, setAiMode] = useState<AiMode>(1)
  /** how many AI 360°s are in (0 while they load) */
  const [aiReady, setAiReady] = useState(0)
  const layerMode = useRef<(mode: AiMode) => void>(() => undefined)
  const aiModeNow = useRef<AiMode>(1)
  /** The point the visitor stands at, when it has a photo-quality 360° to step into */
  const [near, setNear] = useState<TourView | null>(null)
  /** Inside a point's AI 360° ("Voir en qualité photo"): which, and where to look first, relative to its direction */
  const [photo, setPhoto] = useState<{ view: TourView; yaw: number; pitch: number } | null>(null)
  /** The AI 360° has loaded and faded in over the walk */
  const [photoIn, setPhotoIn] = useState(false)
  /** Where the visitor looks inside the AI 360°, for the walk to turn the same way on the way out */
  const photoLook = useRef({ yaw: 0, pitch: 0 })
  /** Set by the 3D loop: glide to a point's eye and hand over to its AI 360°; take the walk back from it */
  const enterPhoto = useRef<(v: TourView) => void>(() => undefined)
  /** undefined while asked, null when the tour has no splat (splat.json) or ?splat=0 */
  const [splatInfo, setSplatInfo] = useState<SplatInfo | null | undefined>(undefined)
  /** the walk drawn from the splat ("Rendu réel") instead of the model */
  const [splatOn, setSplatOn] = useState(true)
  const splatOnNow = useRef(true)
  const [splatLoaded, setSplatLoaded] = useState(false)
  const leavePhoto = useRef<(v: TourView, yaw: number, pitch: number) => void>(() => undefined)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setEdit(!published && query.get('edit') === '1')
    Promise.all([
      // ?edit=1: the reviewer also steps into AI 360°s that are not approved yet
      fetch(`/api/scenes/${sceneId}/tour${!published && query.get('edit') === '1' ? '?edit=1' : ''}`, { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error('Visite introuvable.')))),
      fetch(`/api/scenes/${sceneId}/tour/nav.json`, { cache: 'no-store' }).then(r =>
        r.ok ? r.json() : Promise.reject(new Error('Cette visite n’a pas encore de carte des zones où l’on peut marcher : reconstruisez la visite.')),
      ),
    ])
      .then(([t, n]) => {
        setTour(t)
        setNav(n)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
    // The baked light only when asked (?bake=1, 2 Nov): an experiment, never the walk a visitor gets by default.
    ;(query.get('bake') === '1' ? fetch(`/api/scenes/${sceneId}/tour/explore.json`, { cache: 'no-store' }) : Promise.resolve(null))
      .then(r => (r?.ok ? r.json() : null))
      .then(b => setBake(b && typeof b.lo === 'number' ? b : null))
      .catch(() => setBake(null))
    // ?grade=r,g,b,contrast tries another grade than the scene's own (look.json); ?look=0 shows the walk without one
    const tryGrade = query.get('grade')?.split(',').map(Number)
    if (query.get('look') === '0') setLookFile(null)
    else if (tryGrade?.length === 4 && tryGrade.every(Number.isFinite))
      setLookFile({ grade: { gain: [tryGrade[0], tryGrade[1], tryGrade[2]], contrast: tryGrade[3] } })
    else
      fetch(`/api/scenes/${sceneId}/tour/look.json`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(l => setLookFile(l && (Array.isArray(l.grade?.gain) || l.light) ? l : null))
        .catch(() => setLookFile(null))
    // The AI 360°s painted onto the model (aiLayer.ts) tore apart between the points and were dropped (31 Oct): only
    // ?ai=1 (2, 3: its diagnostics) still loads them, to look at.
    if (query.has('ai'))
      fetch(`/api/scenes/${sceneId}/tour/projection.json`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(p => setProjection(p && Array.isArray(p.views) && p.views.length ? p : null))
        .catch(() => setProjection(null))
    else setProjection(null)
    // The walk at Cycles quality (splatLayer.ts), when the tour has one; ?splat=0 shows the model's walk
    if (query.get('splat') === '0') setSplatInfo(null)
    else
      fetch(`/api/scenes/${sceneId}/tour/splat${/^[a-z0-9]{1,8}$/.test(query.get('sv') ?? '') ? '-' + query.get('sv') : ''}.json`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(i => setSplatInfo(i && typeof i.lo === 'number' && typeof i.file === 'string' ? i : null))
        .catch(() => setSplatInfo(null))
    const m = Number(query.get('ai') ?? 1)
    setAiMode(m === 0 || m === 2 || m === 3 ? m : 1)
  }, [sceneId, published])

  useEffect(() => {
    splatOnNow.current = splatOn
  }, [splatOn])

  useEffect(() => {
    aiModeNow.current = aiMode
    layerMode.current(aiMode)
  }, [aiMode])

  const levels = useMemo(() => {
    if (!nav) return [] as NavLevel[]
    return nav.levels.map(l => ({ index: l.index, floor: l.floor, dz: new Int16Array(decode(l.dz).buffer), cl: decode(l.cl) }))
  }, [nav])

  const views = useMemo(() => (tour?.views ?? []).filter(v => !v.hidden && v.pano), [tour])

  useEffect(() => {
    const host = mount.current
    if (!host || !nav || !tour || !levels.length || bake === undefined || projection === undefined || lookFile === undefined || splatInfo === undefined) return
    let disposed = false
    // ?at=<point>: stand exactly where that 360° was taken, looking its way (&match=1: with its exposure), to set the
    // walk beside the 360° it should look like.
    const query = new URLSearchParams(window.location.search)
    const at = views.find(v => String(v.index) === query.get('at'))

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // ?tone=neutral|none: other tone mappings, to compare (AgX greys and pales the colours the 360°s show)
    const tone = query.get('tone')
    renderer.toneMapping = tone === 'neutral' ? THREE.NeutralToneMapping : tone === 'none' ? THREE.NoToneMapping : THREE.AgXToneMapping
    // the scene's grade rides on AgX as three's custom tone mapping, so every material (and the walk's 360° tool) has it
    const grade = !bake && !tone && lookFile?.grade ? lookFile.grade : null
    if (grade) {
      THREE.ShaderChunk.tonemapping_pars_fragment = gradeChunk(grade)
      renderer.toneMapping = THREE.CustomToneMapping
    }
    const matchEv = bake && at && query.get('match') ? bake.viewEv[String(at.index)] : undefined
    renderer.toneMappingExposure = matchEv !== undefined && bake ? 2 ** (matchEv - bake.exposureEv) : 1
    host.appendChild(renderer.domElement)
    const splat: SplatLayer | null = splatInfo
      ? createSplatLayer(renderer, splatInfo, `/api/scenes/${sceneId}/tour/${splatInfo.file}?v=${encodeURIComponent(splatInfo.builtAt ?? '')}`)
      : null
    const scene = new THREE.Scene()
    // baked: the daylight outside the windows, burnt white as in the 360° exposed for the room
    // graded: daylight bright enough to stay white through the grade (the stock grey-blue turned beige under it)
    const daylight = () => (bake ? new THREE.Color(0xf4f6f7) : lookFile?.grade ? new THREE.Color(2.4, 2.45, 2.55) : new THREE.Color(0xcfd6d9))
    scene.background = daylight()
    const pmrem = new THREE.PMREMGenerator(renderer)
    // The walk's lights: three's studio environment, a sky light and a sun. Its sky lit the floor from above and its dark
    // ground colour left the ceiling in shadow (measured against the 360°s: floor 0.6 stop too bright, ceiling too dark),
    // so the ground colour is light and the sun lower and weaker, reaching the walls more than the floor.
    // &hground= &hint= &sunint= &sunh= try other values.
    const num0 = (k: string, d: number) => (query.get(k) === null ? d : Number(query.get(k)))
    const lights = { ...LIGHTS, ...(bake ? {} : lookFile?.light) }
    const stock = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = stock
    scene.environmentIntensity = num0('stockint', lights.env)
    const sky = new THREE.HemisphereLight(0xfff6e8, new THREE.Color(`#${query.get('hground') ?? lights.ground}`), num0('hint', lights.sky))
    scene.add(sky)
    const sun = new THREE.DirectionalLight(0xfff1dd, num0('sunint', lights.sun))
    sun.position.set(6, num0('sunh', lights.sunHeight), 4)
    scene.add(sun)
    let room: Awaited<ReturnType<typeof roomEnvironment>> = null
    // ?light=room (the room's light alone) | mix (with the sky light and sun) | stock; the scene's look decides otherwise
    const lightMode = query.get('light') ?? (!bake && lookFile?.light?.room ? 'mix' : 'stock')
    const ROOM_INTENSITY = num0('envint', lookFile?.light?.room ?? 1)
    const mix = lightMode === 'mix'
    const useLight = (which: 'room' | 'stock') => {
      const on = which === 'room' && room !== null
      scene.environment = on ? room!.env : stock
      scene.environmentIntensity = on ? ROOM_INTENSITY : num0('stockint', lights.env)
      // ?light=mix: the room's light added at low intensity to the stock sky light and sun, not in their place
      sky.visible = sun.visible = !on || mix
      // &sun= &sky=: those two at another strength beside the room's light
      if (on && query.get('sun') !== null) [sun.visible, sun.intensity] = [true, Number(query.get('sun'))]
      if (on && query.get('sky') !== null) [sky.visible, sky.intensity] = [true, Number(query.get('sky'))]
    }
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500)
    camera.rotation.order = 'YXZ'

    // ?ao=<strength>: light contact shadows where furniture meets the floor and the walls (screen-space GTAO), drawn
    // through a composer whose last pass does the tone mapping and the grade
    const aoStrength = num0('ao', bake ? 0 : (lookFile?.ao ?? 0))
    // ?bloom=: glow around what is brighter than white (lamps, daylight), before the tone mapping
    const bloomStrength = num0('bloom', bake ? 0 : (lookFile?.bloom ?? 0))
    // ?lamp=<candela>&lampshadows=<n>: the lamps' own light
    const lampLight = num0('lamp', bake ? 0 : (lookFile?.lamps?.light ?? 0))
    const lampShadows = Math.min(8, num0('lampshadows', lookFile?.lamps?.shadows ?? 6))
    if (lampLight > 0 && lampShadows > 0) {
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.shadowMap.autoUpdate = false
    }
    let composer: EffectComposer | null = null
    if (aoStrength > 0 || bloomStrength > 0) {
      composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
      composer.addPass(new RenderPass(scene, camera))
    }
    if (composer && aoStrength > 0) {
      const gtao = new GTAOPass(scene, camera, 1, 1)
      gtao.blendIntensity = aoStrength
      gtao.updateGtaoMaterial({ radius: 0.4, distanceFallOff: 1, thickness: 1, scale: 1, samples: 16 })
      // Glass out of its depth too (it leaves out only points and lines): a window was a wall to it, and the shading it
      // laid there turned the daylight beige.
      const pass = gtao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] }
      pass._overrideVisibility = () => {
        scene.traverse(o => {
          const m = (o as THREE.Mesh).material
          const clear = (o as THREE.Mesh).isMesh && (Array.isArray(m) ? m.some(x => x.transparent) : m?.transparent)
          if ((clear || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && o.visible) {
            o.visible = false
            pass._visibilityCache.push(o)
          }
        })
      }
      composer.addPass(gtao)
    }
    // only what is brighter than the daylight behind the windows (2.4-2.55 when graded): the lamps; at 1.2 the windows
    // fogged the whole room
    if (composer && bloomStrength > 0) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), bloomStrength, 0.4, num0('bloomt', 2.7)))
    if (composer) composer.addPass(new OutputPass())

    // Where a person can stand: the room around a point, read smoothly between the 25 cm spots so the walk slides
    // along walls instead of stepping from spot to spot.
    let lv = levels.find(l => l.index === (views[0]?.level ?? levels[0].index)) ?? levels[0]
    const { x0, y0, step, nx, ny } = nav
    const spot = (x: number, y: number) => {
      const fi = (x - x0) / step - 0.5
      const fj = (y0 - y) / step - 0.5
      const i = Math.floor(fi)
      const j = Math.floor(fj)
      const u = fi - i
      const w = fj - j
      let room = 0
      let floor = 0
      let weight = 0
      for (const [di, dj, k] of [[0, 0, (1 - u) * (1 - w)], [1, 0, u * (1 - w)], [0, 1, (1 - u) * w], [1, 1, u * w]] as const) {
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue
        const c = jj * nx + ii
        room += (lv.cl[c] / 100) * k
        if (lv.dz[c] !== NONE) {
          floor += (lv.dz[c] / 1000) * k
          weight += k
        }
      }
      return { room, floor: weight > 0 ? lv.floor + floor / weight : null }
    }
    const standable = (x: number, y: number, from: number | null) => {
      const s = spot(x, y)
      return s.room >= RADIUS && s.floor !== null && (from === null || Math.abs(s.floor - from) <= STEP_UP) ? s.floor : null
    }
    /** The nearest place a person can stand, around (x, y). */
    const nearestStandable = (x: number, y: number) => {
      let best: { x: number; y: number; d: number } | null = null
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const c = j * nx + i
          if (lv.cl[c] / 100 < RADIUS + 0.06 || lv.dz[c] === NONE) continue
          const cx = x0 + (i + 0.5) * step
          const cy = y0 - (j + 0.5) * step
          const d = Math.hypot(cx - x, cy - y)
          if (!best || d < best.d) best = { x: cx, y: cy, d }
        }
      return best
    }

    const pos = { x: 0, y: 0, floor: lv.floor, eye: lv.floor + EYE }
    let yaw = 0
    let pitch = 0
    /** The eye kept at a 360°'s own height (?at=) until the visitor walks. */
    let pinned = false
    const place = (x: number, y: number, look?: number, levelIndex?: number) => {
      if (levelIndex !== undefined) lv = levels.find(l => l.index === levelIndex) ?? lv
      let f = standable(x, y, null)
      if (f === null) {
        const n = nearestStandable(x, y)
        if (!n) return
        ;[x, y] = [n.x, n.y]
        f = standable(x, y, null) ?? lv.floor
      }
      Object.assign(pos, { x, y, floor: f, eye: f + EYE })
      if (look !== undefined) yaw = look
      pitch = 0
      setLevel(lv.index)
    }
    jump.current = place

    // The visit starts where the tour starts, looking the way its first point looks.
    const first = at ?? views[0]
    if (first) {
      const p = toPlane(new THREE.Vector3(...first.position))
      const t = toPlane(new THREE.Vector3(...first.target))
      place(p.x, p.y, Math.atan2(-(t.x - p.x), t.y - p.y), at?.level ?? undefined)
      if (at) {
        Object.assign(pos, { x: p.x, y: p.y, eye: at.position[1] })
        pinned = true
      }
    } else {
      const n = nearestStandable(x0 + (nx * step) / 2, y0 - (ny * step) / 2)
      if (n) place(n.x, n.y, 0)
    }
    // Test spots for the AI layer, the same every time: &right= &ahead= metres from ?at= (the eye kept at its 360°'s
    // height); ?between=a,b&t= on the way from point a to point b, looking at b; ?x=&y=&look= anywhere (Blender's
    // plane; degrees, 0 = +y, turning left); &turn= degrees more to the left.
    const num = (k: string) => (query.get(k) === null ? null : Number(query.get(k)))
    if (at && (num('right') || num('ahead'))) {
      const r = num('right') ?? 0
      const a = num('ahead') ?? 0
      pos.x += r * Math.cos(yaw) - a * Math.sin(yaw)
      pos.y += r * Math.sin(yaw) + a * Math.cos(yaw)
    }
    const between = query.get('between')?.split(',').map(s => views.find(v => String(v.index) === s))
    if (between?.length === 2 && between[0] && between[1]) {
      const [va, vb] = between as [TourView, TourView]
      const t = num('t') ?? 0.5
      const pa = toPlane(new THREE.Vector3(...va.position))
      const pb = toPlane(new THREE.Vector3(...vb.position))
      Object.assign(pos, { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, eye: va.position[1] + (vb.position[1] - va.position[1]) * t })
      yaw = Math.atan2(-(pb.x - pa.x), pb.y - pa.y)
      pinned = true
    }
    if (num('x') !== null && num('y') !== null) place(num('x')!, num('y')!, ((num('look') ?? 0) * Math.PI) / 180)
    if (num('turn')) yaw += (num('turn')! * Math.PI) / 180

    // the AI 360°s painted back onto the model (aiLayer.ts), when the tour has them and the light is not baked
    const ai = projection && !bake ? createAiLayer(renderer) : null
    ai?.setMode(aiModeNow.current)
    layerMode.current = mode => ai?.setMode(mode)

    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    if (splat && splatInfo?.model) {
      loader.load(`/api/scenes/${sceneId}/tour/${splatInfo.model}?v=${encodeURIComponent(splatInfo.builtAt ?? '')}`, g => {
        if (!disposed) splat.setModel(g.scene)
      })
    }
    const version = encodeURIComponent(tour.builtAt ?? '')
    const lightmap = bake
      ? new THREE.TextureLoader().loadAsync(`/api/scenes/${sceneId}/tour/explore-light.png?v=${version}`).then(t => {
          // glTF's UVs start at the top of the image; the values are codes of the log, not colours
          t.flipY = false
          t.colorSpace = THREE.NoColorSpace
          t.channel = 1
          t.anisotropy = renderer.capabilities.getMaxAnisotropy()
          return t
        })
      : null
    /**
     * The baked surfaces drawn unlit: their own colour and texture times the light Cycles found there. Glass, mirrors
     * and lamps keep their material (reflections, light of their own).
     */
    const unlit = new Map<THREE.Material, THREE.Material>()
    const bakedMaterial = (m: THREE.Material, kind: 'lightmap' | 'vertex', map: THREE.Texture | null, b: BakeInfo) => {
      const made = unlit.get(m)
      if (made) return made
      const std = m as THREE.MeshStandardMaterial
      const basic = new THREE.MeshBasicMaterial({
        color: std.color,
        map: std.map,
        alphaMap: std.alphaMap,
        transparent: std.transparent,
        opacity: std.opacity,
        alphaTest: std.alphaTest,
        side: std.side,
        vertexColors: kind === 'vertex',
        lightMap: kind === 'lightmap' ? map : null,
      })
      const decode = (v: string) => `exp2( ${b.lo.toFixed(4)} + ${v} * ${(b.hi - b.lo).toFixed(4)} )`
      basic.onBeforeCompile = shader => {
        shader.fragmentShader =
          kind === 'lightmap'
            ? shader.fragmentShader.replace(
                'reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;',
                `reflectedLight.indirectDiffuse += ${decode('lightMapTexel.rgb')} * lightMapIntensity;`,
              )
            : shader.fragmentShader.replace('#include <color_fragment>', `diffuseColor.rgb *= ${decode('vColor.rgb')};`)
      }
      basic.customProgramCacheKey = () => `roomia-baked-${kind}`
      unlit.set(m, basic)
      return basic
    }
    // The AI-redrawn textures (look.json, ?tex=0 without), placed exactly like the ones they replace; every texture
    // filtered for grazing views (the floor went soft a few metres ahead).
    const anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy())
    const upgrades = !bake && query.get('tex') !== '0' ? (lookFile?.textures ?? {}) : {}
    const textureFiles = new Map<string, THREE.Texture>()
    const textureLoader = new THREE.TextureLoader()
    const fileTexture = (file: string, like: THREE.Texture, color: boolean) => {
      const key = `${file}|${like.uuid}`
      let t = textureFiles.get(key)
      if (!t) {
        t = textureLoader.load(`/api/scenes/${sceneId}/tour/${file}?v=${version}`)
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
        t.flipY = false
        t.wrapS = like.wrapS
        t.wrapT = like.wrapT
        t.offset.copy(like.offset)
        t.repeat.copy(like.repeat)
        t.rotation = like.rotation
        t.center.copy(like.center)
        t.channel = like.channel
        t.anisotropy = anisotropy
        textureFiles.set(key, t)
      }
      return t
    }
    const upgrade = (std: THREE.MeshStandardMaterial) => {
      for (const t of [std.map, std.normalMap, std.roughnessMap]) if (t) t.anisotropy = anisotropy
      const map = std.map
      const up = map && (upgrades[map.name] ?? upgrades[std.name.replace(/\.\d{3}$/, '')])
      if (!map || !up) return
      std.map = fileTexture(up.map, map, true)
      if (up.normal && !std.normalMap) {
        std.normalMap = fileTexture(up.normal, map, false)
        // three's own glTF rule for normal maps on meshes without tangents
        std.normalScale.set(up.normalScale ?? 1, -(up.normalScale ?? 1))
      }
      std.needsUpdate = true
    }
    // One warm light per lamp (lamp meshes closer than 40 cm are one lamp), a little under its middle; the ones nearest
    // the start cast shadows. Lamp shades never cast: the light sits inside them.
    const lamps: THREE.Mesh[] = []
    const addLampLights = (model: THREE.Object3D) => {
      model.updateMatrixWorld(true)
      // The lamp shapes can come merged into one mesh (the browser model joins objects): each lamp is found as a group of
      // touching 20 cm cells of their vertices.
      const CELL = 0.2
      const cells = new Map<string, { x: number; y: number; z: number; sum: THREE.Vector3; n: number }>()
      const v = new THREE.Vector3()
      for (const m of lamps) {
        const pos = m.geometry.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
          const [x, y, z] = [Math.floor(v.x / CELL), Math.floor(v.y / CELL), Math.floor(v.z / CELL)]
          const key = `${x},${y},${z}`
          const c = cells.get(key) ?? { x, y, z, sum: new THREE.Vector3(), n: 0 }
          c.sum.add(v)
          c.n += 1
          cells.set(key, c)
        }
      }
      const spots: { at: THREE.Vector3; n: number }[] = []
      // the lamp markers of the full model when the scene's look lists them (the browser model merges them away)
      for (const p of lookFile?.lamps?.at ?? []) {
        const at = new THREE.Vector3(...p)
        const near = spots.find(s => s.at.distanceTo(at) < 0.4)
        if (near) near.at.lerp(at, 1 / ++near.n)
        else spots.push({ at, n: 1 })
      }
      if (spots.length) cells.clear()
      const seen = new Set<string>()
      for (const [key, c0] of cells) {
        if (seen.has(key)) continue
        seen.add(key)
        const sum = new THREE.Vector3()
        let n = 0
        const queue = [c0]
        while (queue.length) {
          const c = queue.pop()!
          sum.add(c.sum)
          n += c.n
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dz = -1; dz <= 1; dz++) {
                const k = `${c.x + dx},${c.y + dy},${c.z + dz}`
                const next = cells.get(k)
                if (next && !seen.has(k)) {
                  seen.add(k)
                  queue.push(next)
                }
              }
        }
        spots.push({ at: sum.divideScalar(n), n })
      }
      const start = views[0] ? new THREE.Vector3(...views[0].position) : new THREE.Vector3()
      spots.sort((a, b) => a.at.distanceTo(start) - b.at.distanceTo(start))
      spots.forEach((s, k) => {
        // a wide cone downwards, as a pendant throws it: lit all round, the lamps made the ceiling 0.1 brighter than the
        // 360°s' (measured 2 Nov)
        const light = new THREE.SpotLight(0xffe2bd, lampLight, 10, num0('lampangle', lookFile?.lamps?.angle ?? 1.2), 0.9, 2)
        light.position.copy(s.at).add(new THREE.Vector3(0, -0.12, 0))
        light.target.position.copy(light.position).add(new THREE.Vector3(0, -1, 0))
        scene.add(light.target)
        // and what a shade lets through all round (walls and ceiling), without shadows: with the cone alone the walls
        // and the ceiling came out 0.05-0.06 darker than in the 360°s
        const around = lampLight * num0('lampup', lookFile?.lamps?.around ?? 0.35)
        if (around > 0) {
          const glow = new THREE.PointLight(0xffe2bd, around, 9, 2)
          glow.position.copy(light.position)
          scene.add(glow)
        }
        if (renderer.shadowMap.enabled && k < lampShadows) {
          light.castShadow = true
          light.shadow.mapSize.set(2048, 2048)
          // the shade around the light (merged into other objects, so it cannot be told apart) is nearer than this:
          // it cast hard cones on the walls
          light.shadow.camera.near = num0('lampnear', 0.45)
          light.shadow.camera.far = 9
          light.shadow.bias = -0.0015
          light.shadow.normalBias = 0.02
          light.shadow.radius = 4
        }
        scene.add(light)
      })
      renderer.shadowMap.needsUpdate = true
      console.log('walk lamps:', spots.length, 'lights,', Math.min(spots.length, renderer.shadowMap.enabled ? lampShadows : 0), 'with shadows')
    }
    loader.load(
      bake ? `/api/scenes/${sceneId}/tour/explore.glb?v=${version}` : `/api/scenes/${sceneId}/viewport`,
      async gltf => {
        const map = lightmap ? await lightmap.catch(() => null) : null
        if (disposed) return
        gltf.scene.traverse(o => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          const kind = !bake ? null : mesh.geometry.getAttribute('uv1') && map ? 'lightmap' : mesh.geometry.getAttribute('color') ? 'vertex' : null
          let lampObject = false
          for (let o: THREE.Object3D | null = mesh; o && !lampObject; o = o.parent) lampObject = LAMP_OBJECT.test(o.name)
          const lampMesh = lampObject || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => LAMP_MATERIAL.test(m.name.replace(/\.\d{3}$/, '')))
          if (lampMesh) lamps.push(mesh)
          if (renderer.shadowMap.enabled) {
            const clear = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(m => m.transparent)
            mesh.castShadow = !lampMesh && !clear
            mesh.receiveShadow = true
          }
          if (query.get('glow') !== '0') {
            const lit = (m: THREE.Material) => {
              const std = m as THREE.MeshStandardMaterial
              if (!std.isMeshStandardMaterial || !(lampObject || LAMP_MATERIAL.test(std.name.replace(/\.\d{3}$/, '')))) return m
              const glow = std.clone()
              glow.emissive.copy(GLOW)
              glow.emissiveIntensity = num0('glow', 3)
              return glow
            }
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map(lit) : lit(mesh.material)
          }
          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of list) {
            const std = m as THREE.MeshStandardMaterial
            // SketchUp leaves metallic at 1 when it writes no value: everything came out as dark metal (28 Oct).
            if (std.isMeshStandardMaterial && std.metalness >= 0.99 && std.roughness >= 0.99 && !std.metalnessMap) std.metalness = 0
            // ?finish=0: everything matte, as it came
            const finish = std.isMeshStandardMaterial && std.roughness >= 0.99 && !std.roughnessMap && query.get('finish') !== '0'
              ? FINISHES.find(([re]) => re.test(std.name))?.[1]
              : undefined
            if (finish) Object.assign(std, finish)
            if (std.isMeshStandardMaterial) upgrade(std)
            ai?.patch(m)
          }
          if (kind && bake) {
            const swapped = list.map(m => bakedMaterial(m, kind, map, bake))
            mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0]
          }
        })
        scene.add(gltf.scene)
        // the splat's colours come from the capture's own model when it has one (splat.json model), else this one
        if (!splatInfo?.model) splat?.setModel(gltf.scene)
        if (lampLight > 0) addLampLights(gltf.scene)
        // draw distance sized to the model: 500 m left the contact shadows' depth too coarse indoors (everything darkened)
        const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).length()
        camera.far = Math.min(500, Math.max(30, size * 1.2))
        camera.updateProjectionMatrix()
        setReady(true)
        // the room's own light, when the scene's look (or ?light=) asks for it: alone it came out flat and pink (1 Nov),
        // with a sky light and a low sun beside it it gives the balance of the 360°s
        if (!bake && (lightMode === 'room' || lightMode === 'mix')) {
          const only = query.get('envonly')
          const sources = only === null ? views : views.filter(v => String(v.index) === only)
          roomEnvironment(renderer, pmrem, sources, `/api/scenes/${sceneId}/tour`, version)
            .then(r => {
              if (disposed) return r?.env.dispose()
              room = r
              useLight('room')
            })
            .catch(e => console.error('room light:', e))
        }
        if (ai && projection)
          ai.load(`/api/scenes/${sceneId}/tour`, projection, version)
            .then(n => !disposed && setAiReady(n))
            .catch(e => console.error('AI layer:', e))
      },
      e => setProgress(e.total ? e.loaded / e.total : 0),
      () => setError('Le modèle 3D n’a pas pu être chargé.'),
    )

    // Looking: the mouse moves the view while the pointer is captured (click), or while a button is held.
    const keys = new Set<string>()
    let dragging = false
    const look = (dx: number, dy: number) => {
      yaw -= dx * 0.0022
      pitch = Math.max(-1.45, Math.min(1.45, pitch - dy * 0.0022))
    }
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === renderer.domElement || dragging) look(e.movementX, e.movementY)
    }
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      dragging = true
      renderer.domElement.requestPointerLock?.()
    }
    const onUp = () => (dragging = false)
    const onLock = () => setLocked(document.pointerLockElement === renderer.domElement)
    // Keys by their place on the keyboard: W A S D on a QWERTY board are Z Q S D on an AZERTY one.
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        if (e.type === 'keydown') keys.add(e.code)
        else keys.delete(e.code)
        e.preventDefault()
      }
    }
    const onBlur = () => keys.clear()
    renderer.domElement.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLock)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)

    // "Voir en qualité photo": glide to the point's own eye, keeping the way the visitor looks, then hand over to its
    // AI 360° facing the same way (the page fades it in over the walk). Coming back, the walk turns the way the
    // visitor last looked inside it.
    const photoViews = views.filter(v => v.panoAi && v.pano)
    let glide: { fx: number; fy: number; fe: number; tx: number; ty: number; te: number; t0: number; view: TourView } | null = null
    let inPhoto = false
    let nearShown: TourView | null = null
    enterPhoto.current = v => {
      if (glide || inPhoto) return
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
      keys.clear()
      vel.x = vel.y = 0
      pinned = true
      const p = toPlane(new THREE.Vector3(...v.position))
      glide = { fx: pos.x, fy: pos.y, fe: pos.eye, tx: p.x, ty: p.y, te: v.position[1], t0: performance.now(), view: v }
    }
    leavePhoto.current = (v, lookYaw, lookPitch) => {
      const p = toPlane(new THREE.Vector3(...v.position))
      // the visitor may have gone on to another point from the plan while inside
      place(p.x, p.y, facing(v) - lookYaw, v.level ?? undefined)
      Object.assign(pos, { x: p.x, y: p.y, eye: v.position[1] })
      pitch = lookPitch
      pinned = true
      inPhoto = false
    }
    const onEnter = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && nearShown && !inPhoto && !(e.target instanceof Element && e.target.closest('input, textarea, select, button')))
        enterPhoto.current(nearShown)
    }
    window.addEventListener('keydown', onEnter)

    // ?tools=1: window.roomiaWalk360(point, width) renders the walk's own 360° at a point's eye, laid out as the tour's
    // 360°s (middle = the point's direction, right = right, top = up), to set beside its Blender and AI 360°s.
    const tools = query.get('tools') === '1'
    if (tools)
      Object.assign(window, {
        roomiaLight: (which: 'room' | 'stock', intensity?: number) => {
          useLight(which)
          if (intensity !== undefined && which === 'room') scene.environmentIntensity = intensity
          return room !== null
        },
        // stand at a point (metres to its right and ahead, degrees turned left and up), for pictures from fixed spots
        roomiaPose: (index: number, right = 0, ahead = 0, turn = 0, up = 0) => {
          const v = views.find(w => w.index === index)
          if (!v) return false
          const p = toPlane(new THREE.Vector3(...v.position))
          const y0 = facing(v)
          place(p.x + right * Math.cos(y0) - ahead * Math.sin(y0), p.y + right * Math.sin(y0) + ahead * Math.cos(y0), y0 + (turn * Math.PI) / 180, v.level ?? undefined)
          pos.eye = pos.floor + EYE
          pitch = (up * Math.PI) / 180
          return true
        },
        // the next frame as drawn on screen (with the composer's passes), once it is drawn
        roomiaShot: () =>
          new Promise<string>(done =>
            requestAnimationFrame(() => requestAnimationFrame(() => done(renderer.domElement.toDataURL('image/jpeg', 0.9)))),
          ),
        // the averaged room panorama around the eye, the model hidden: it must line up with the 360° (?envonly=<point>)
        roomiaPanoramaOnly: (on: boolean) => {
          scene.background = on && room ? room.panorama.texture : daylight()
          scene.children.forEach(o => o.type === 'Group' && (o.visible = !on))
        },
      })
    if (tools)
      (window as unknown as { roomiaWalk360?: (index: number, width?: number) => string }).roomiaWalk360 = (index, width = 2048) => {
        const v = views.find(w => w.index === index)
        if (!v) throw new Error(`no point ${index}`)
        const target = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType, generateMipmaps: false })
        const cube = new THREE.CubeCamera(0.05, 500, target)
        cube.position.set(...v.position)
        cube.update(renderer, scene)
        const f = new THREE.Vector3(v.target[0] - v.position[0], 0, v.target[2] - v.position[2]).normalize()
        const quad = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.ShaderMaterial({
            uniforms: { cube: { value: target.texture }, fwd: { value: f }, right: { value: new THREE.Vector3(-f.z, 0, f.x) } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: `
              uniform samplerCube cube; uniform vec3 fwd; uniform vec3 right; varying vec2 vUv;
              void main() {
                float lon = (vUv.x - 0.5) * 6.2831853;
                float lat = (vUv.y - 0.5) * 3.1415927;
                vec3 d = cos(lat) * (sin(lon) * right + cos(lon) * fwd) + vec3(0.0, sin(lat), 0.0);
                gl_FragColor = vec4(textureCube(cube, d).rgb, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
              }`,
            depthTest: false,
            depthWrite: false,
          }),
        )
        const flat = new THREE.Scene()
        flat.add(quad)
        const size = renderer.getSize(new THREE.Vector2())
        const ratio = renderer.getPixelRatio()
        renderer.setPixelRatio(1)
        renderer.setSize(width, width / 2, false)
        renderer.render(flat, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1))
        const url = renderer.domElement.toDataURL('image/png')
        renderer.setPixelRatio(ratio)
        renderer.setSize(size.x, size.y, false)
        target.dispose()
        quad.geometry.dispose()
        quad.material.dispose()
        return url
      }

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      renderer.setSize(w, h)
      composer?.setSize(w, h)
      splat?.resize()
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    // Walking: speed eased in and out, the move tried whole, then along each axis (sliding along a wall).
    const vel = { x: 0, y: 0 }
    let last = performance.now()
    let shown = 0
    let frame = 0
    let splatShown = false
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
      const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK
      // forward in the floor plane: three's camera looks along -Z, which is +y in Blender's plane
      const fx = -Math.sin(yaw)
      const fy = Math.cos(yaw)
      let wx = fwd * fx + side * fy
      let wy = fwd * fy - side * fx
      const len = Math.hypot(wx, wy)
      if (len > 0) [wx, wy] = [(wx / len) * speed, (wy / len) * speed]
      const ease = 1 - Math.exp(-dt * 9)
      vel.x += (wx - vel.x) * ease
      vel.y += (wy - vel.y) * ease
      const mx = vel.x * dt
      const my = vel.y * dt
      if (glide) {
        const k = Math.min(1, (now - glide.t0) / 450)
        const e = k * k * (3 - 2 * k)
        pos.x = glide.fx + (glide.tx - glide.fx) * e
        pos.y = glide.fy + (glide.ty - glide.fy) * e
        pos.eye = glide.fe + (glide.te - glide.fe) * e
        if (k >= 1) {
          const v = glide.view
          glide = null
          inPhoto = true
          setPhoto({ view: v, yaw: facing(v) - yaw, pitch })
        }
      } else if (!inPhoto && Math.abs(mx) + Math.abs(my) > 1e-5) {
        pinned = false
        for (const [ax, ay] of [[mx, my], [mx, 0], [0, my]] as const) {
          const f = standable(pos.x + ax, pos.y + ay, pos.floor)
          if (f !== null) {
            pos.x += ax
            pos.y += ay
            pos.floor = f
            break
          }
        }
      }
      if (!pinned) pos.eye += (pos.floor + EYE - pos.eye) * (1 - Math.exp(-dt * 10))
      camera.position.set(pos.x, pos.eye, -pos.y)
      camera.rotation.set(pitch, yaw, 0)
      ai?.setCamera(camera.position)
      if (splat && splatOnNow.current) {
        splat.render(camera, dt)
        if (splat.loaded && !splatShown) {
          splatShown = true
          setSplatLoaded(true)
        }
      } else if (composer) composer.render(dt)
      else renderer.render(scene, camera)
      // the plan's dot, a few times a second; the photo-quality point the visitor stands at
      if (now - shown > 80) {
        shown = now
        setHere({ x: pos.x, y: pos.y, yaw })
        let close: TourView | null = null
        let best = PHOTO_NEAR
        for (const v of photoViews) {
          if (v.level !== null && v.level !== lv.index) continue
          const p = toPlane(new THREE.Vector3(...v.position))
          const d = Math.hypot(p.x - pos.x, p.y - pos.y)
          if (d < best) [close, best] = [v, d]
        }
        if (close !== nearShown) {
          nearShown = close
          setNear(close)
        }
      }
    }
    frame = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onLock)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onEnter)
      if (tools) delete (window as unknown as { roomiaWalk360?: unknown }).roomiaWalk360
      room?.env.dispose()
      room?.panorama.dispose()
      composer?.dispose()
      splat?.dispose()
      stock.dispose()
      enterPhoto.current = () => undefined
      leavePhoto.current = () => undefined
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock()
      scene.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.dispose()
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose()
      })
      for (const m of unlit.values()) m.dispose()
      lightmap?.then(t => t.dispose()).catch(() => undefined)
      ai?.dispose()
      layerMode.current = () => undefined
      pmrem.dispose()
      if (grade) THREE.ShaderChunk.tonemapping_pars_fragment = STOCK_CHUNK
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [sceneId, nav, tour, levels, views, bake, projection, lookFile, splatInfo])

  // The plan of the level the visitor is on, and how Blender's floor plane maps onto it: the level's frame when the
  // build wrote it, otherwise fitted on the tour's points (each has a place on the plan and in the model).
  const plan: PlanShown | null = useMemo(() => {
    if (!tour) return null
    const lvl = tour.levels?.find(l => l.index === level)
    if (lvl) return { file: lvl.file, width: lvl.width, height: lvl.height, index: lvl.index }
    return tour.plan ? { ...tour.plan, index: level } : null
  }, [tour, level])

  const mapping = useMemo(() => {
    if (!tour || !plan) return null
    const frame = tour.levels?.find(l => l.index === plan.index)?.frame
    if (frame) {
      const [fx0, fy0, fx1, fy1] = frame
      return { ax: plan.width / (fx1 - fx0), bx: (-fx0 * plan.width) / (fx1 - fx0), ay: -plan.height / (fy1 - fy0), by: (fy1 * plan.height) / (fy1 - fy0) }
    }
    const pts = views.filter(v => v.plan && (tour.levels ? v.level === plan.index : true))
    if (pts.length < 2) return null
    const fit = (xs: number[], ps: number[]) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length
      const mp = ps.reduce((a, b) => a + b, 0) / ps.length
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
      const a = sxx > 1e-9 ? xs.reduce((s, x, k) => s + (x - mx) * (ps[k] - mp), 0) / sxx : 0
      return [a, mp - a * mx]
    }
    const [ax, bx] = fit(pts.map(v => v.position[0]), pts.map(v => v.plan!.x))
    const [ay, by] = fit(pts.map(v => -v.position[2]), pts.map(v => v.plan!.y))
    return { ax, bx, ay, by }
  }, [tour, plan, views])

  // Out of the AI 360°: the walk takes over where the visitor stands, turned the way they last looked, then the
  // picture fades away.
  const closePhoto = useCallback(() => {
    if (!photo) return
    leavePhoto.current(photo.view, photoLook.current.yaw, photoLook.current.pitch)
    setPhotoIn(false)
    window.setTimeout(() => setPhoto(null), 500)
  }, [photo])

  useEffect(() => {
    if (!photo) return
    const onKey = (e: KeyboardEvent) => e.code === 'Escape' && closePhoto()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photo, closePhoto])

  if (error) return <div className="tour tour-message">{error}</div>

  const version = encodeURIComponent(tour?.builtAt ?? '')
  const dot = here && mapping ? { left: mapping.ax * here.x + mapping.bx, top: mapping.ay * here.y + mapping.by } : null
  // the view cone in plan pixels: x to the right, y downwards
  const cone = here ? (Math.atan2(-Math.cos(here.yaw), -Math.sin(here.yaw)) * 180) / Math.PI : 0

  return (
    <div className="tour explore">
      <header className="tour-bar">
        <a className="tour-back" href={published ? `/studio/tour/${sceneId}` : `/studio?scene=${sceneId}`}>
          {published ? '← Visite' : '← Studio'}
        </a>
        <div className="tour-title">
          <strong>{title}</strong>
          <span>Visite libre · prototype</span>
        </div>
        {projection && !bake && (
          <button
            type="button"
            className="explore-ai"
            aria-pressed={aiMode !== 0}
            disabled={!aiReady}
            title="Les images IA des points de vue, posées sur le modèle"
            onClick={() => setAiMode(aiMode === 0 ? 1 : 0)}
          >
            {aiReady ? 'Rendu IA' : 'Rendu IA…'}
          </button>
        )}
        {splatInfo && (
          <button
            type="button"
            className="explore-ai"
            aria-pressed={splatOn}
            title="La visite rendue comme les 360° (Cycles), ou le modèle 3D"
            onClick={() => setSplatOn(!splatOn)}
          >
            {splatOn && !splatLoaded ? 'Rendu réel…' : 'Rendu réel'}
          </button>
        )}
        {splatOn && splatInfo?.looks && splatInfo.looks.length > 1 && (
          <div className="tour-modes" role="group" aria-label="Moment de la journée">
            {splatInfo.looks.map(l => {
              const look = l.replace(/^splat-/, '')
              const label = look === 'golden' ? 'Coucher de soleil' : look === 'day' ? 'Journée' : look === 'night' ? 'Soirée' : look === 'ai' ? 'Coucher de soleil + IA' : look
              return (
                <a key={l} href={`/studio/explore/${sceneId}?sv=${look}${edit ? '&edit=1' : ''}`} aria-current={splatInfo.look === look ? 'page' : undefined}>
                  {label}
                </a>
              )
            })}
          </div>
        )}
        <div className="tour-modes" role="group" aria-label="Mode de visite">
          <a href={`/studio/tour/${sceneId}${edit ? '?edit=1' : ''}`}>360°</a>
          <a href={`/studio/explore/${sceneId}${edit ? '?edit=1' : ''}`} aria-current="page">
            Visite libre
          </a>
        </div>
      </header>
      <main className="explore-stage" ref={mount}>
        {!ready && (
          <div className="tour-loading">{tour ? `Chargement du modèle 3D… ${Math.round(progress * 100)} %` : 'Chargement…'}</div>
        )}
        {ready && near && !photo && (
          <button type="button" className="explore-photo" onClick={() => enterPhoto.current(near)}>
            Voir en qualité photo <kbd>Entrée</kbd>
          </button>
        )}
        {photo && (
          <div className={`explore-photo-view${photoIn ? ' is-in' : ''}`}>
            <PanoViewer
              key={photo.view.index}
              src={`/api/scenes/${sceneId}/tour/${photo.view.pano}?v=${version}`}
              hdSrc={photo.view.panoHd ? `/api/scenes/${sceneId}/tour/${photo.view.panoHd}?v=${version}` : undefined}
              initialYaw={photo.yaw}
              initialPitch={photo.pitch}
              initialFov={70}
              still
              spots={photoSpots(photo.view, views)}
              onSpot={key => {
                // on to that point's own photo-quality 360°, looking the same way
                const v = views.find(w => String(w.index) === key)
                if (!v) return
                const world = facing(photo.view) - photoLook.current.yaw
                setPhoto({ view: v, yaw: facing(v) - world, pitch: photoLook.current.pitch })
              }}
              onLook={(yaw, pitch) => (photoLook.current = { yaw, pitch })}
              onReady={() => setPhotoIn(true)}
            />
            <div className="explore-photo-bar">
              <span>{photo.view.name} · qualité photo</span>
              <button type="button" onClick={closePhoto}>
                ← Revenir à la visite libre <kbd>Échap</kbd>
              </button>
            </div>
          </div>
        )}
        {ready && !locked && !photo && (
          <p className="explore-hint">
            Cliquez pour regarder autour · <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> ou les flèches pour marcher · <kbd>Maj</kbd> pour aller plus
            vite · <kbd>Échap</kbd> pour libérer la souris
          </p>
        )}
        {plan && (
          <nav className="tour-plan" aria-label="Plan">
            {tour?.levels && tour.levels.length > 1 && (
              <div className="tour-levels" role="group" aria-label="Niveau">
                {tour.levels.map(l => {
                  const start = views.find(v => v.level === l.index)
                  return (
                    <button
                      key={l.index}
                      type="button"
                      aria-pressed={l.index === level}
                      disabled={!start}
                      onClick={() => {
                        if (!start) return
                        const p = toPlane(new THREE.Vector3(...start.position))
                        jump.current(p.x, p.y, undefined, l.index)
                      }}
                    >
                      {l.name}
                    </button>
                  )
                })}
              </div>
            )}
            <div
              className="tour-plan-inner explore-plan"
              style={{ aspectRatio: `${plan.width} / ${plan.height}` }}
              onClick={e => {
                if (!mapping) return
                // walk to the clicked spot of the plan (the nearest place one can stand)
                const r = e.currentTarget.getBoundingClientRect()
                const px = ((e.clientX - r.left) / r.width) * plan.width
                const py = ((e.clientY - r.top) / r.height) * plan.height
                jump.current((px - mapping.bx) / mapping.ax, (py - mapping.by) / mapping.ay)
              }}
            >
              <img src={`/api/scenes/${sceneId}/tour/${plan.file}?v=${version}`} alt="" aria-hidden="true" />
              {views
                .filter(v => v.plan && (!tour?.levels || v.level === plan.index))
                .map(v => (
                  <button
                    key={v.index}
                    type="button"
                    className="tour-dot explore-anchor"
                    style={{ left: `${(v.plan!.x / plan.width) * 100}%`, top: `${(v.plan!.y / plan.height) * 100}%` }}
                    aria-label={`Aller à ${v.name}`}
                    title={v.name}
                    onClick={e => {
                      e.stopPropagation()
                      // inside a photo-quality 360°: on to that point's own, looking the same way, when it has one
                      if (photo && v.panoAi && v.pano) {
                        const world = facing(photo.view) - photoLook.current.yaw
                        setPhoto({ view: v, yaw: facing(v) - world, pitch: photoLook.current.pitch })
                        return
                      }
                      if (photo) closePhoto()
                      const p = toPlane(new THREE.Vector3(...v.position))
                      const t = toPlane(new THREE.Vector3(...v.target))
                      jump.current(p.x, p.y, Math.atan2(-(t.x - p.x), t.y - p.y), v.level ?? undefined)
                    }}
                  />
                ))}
              {dot && (
                <span className="tour-dot here explore-me" style={{ left: `${(dot.left / plan.width) * 100}%`, top: `${(dot.top / plan.height) * 100}%` }}>
                  <span className="tour-cone" style={{ transform: `rotate(${cone}deg)` }} />
                </span>
              )}
            </div>
          </nav>
        )}
      </main>
    </div>
  )
}
