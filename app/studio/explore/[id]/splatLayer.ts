import * as THREE from 'three'
import { SparkRenderer, SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType, SplatMesh } from '@sparkjsdev/spark'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'

/**
 * The walk at Cycles quality: a Gaussian splat trained on Cycles renders of the apartment (lib/splat-capture.ts,
 * scripts/splat_train.py). The model stays loaded for the walking rules and the plan, untouched.
 *
 * v3 (7 Nov): the splat holds the LIGHT only (Cycles' picture divided by each surface's own colour), and the walk
 * multiplies it by the model's textures drawn unlit: the textures stay sharp at any distance (a splat of the whole
 * picture smeared them: 6 Nov), the light is Cycles'. Without `light` (v1/v2) the splat is the whole picture.
 *
 * Light is stored on one log curve for the whole apartment (lo/hi), so a dark corridor and a sunny room keep their
 * real ratio; each frame is exposed like an eye that adapts (the median brought to 0.18 · 2^bias in about half a
 * second), then AgX as the 360°s.
 *
 * Mirrors: the capture saw through them; here the eye's reflection in each mirror's plane sees the model and the splat
 * in front of the mirror (a plane edit hides what is behind it), drawn where the mirror is not hidden by the model.
 */
export interface SplatInfo {
  file: string
  lo: number
  hi: number
  splats?: number
  builtAt?: string
  /** EV added to the eye's own exposure (the 360°s are a little brighter than the median rule alone) */
  bias?: number
  /** v3: the splat is light only, to multiply by the surfaces' colours (never below albedoFloor) */
  light?: boolean
  albedoFloor?: number
  /** the mirrors' triangles (9 numbers each, glTF world) */
  mirrors?: number[][]
  /** materials the capture saw through (mirrors, glass): not drawn in the colour pass */
  seeThrough?: string[]
  /** v3: the colour model exported from the capture's own scene (tour file) */
  model?: string
  /** investigation 3: small Cycles 360s (Radiance .hdr) the walk reflects in each material, by its roughness */
  probes?: { file: string; eye: number[] }[]
  /** false: no gloss pass (to compare) */
  gloss?: boolean
  /** tests: 1 the light alone, 2 the colours alone, 3 the gloss alone */
  view?: number
  /** Blender's material values for the gloss (tour file, materials.json) */
  materials?: string
  /** the rooms (tour file, rooms.json): mirrors prefer the visitor's room; with glossRooms each surface reflects its
   * own room's probe (not yet right) */
  rooms?: string
  glossRooms?: boolean
  /** 'atlas' (default with -ggx probes): GGX-prefiltered levels made offline; 'pmrem': three's prefilter (gave empty
   * textures here, 7 Nov); 'mip': plain mipmaps (to compare) */
  probeFilter?: 'atlas' | 'pmrem' | 'mip'
  /** a mirror's reflection is redrawn every nth frame (default 5) */
  mirrorEvery?: number
  /** false: reflections at full resolution (default half) */
  mirrorHalf?: boolean
  /** tests: which side Spark's plane edit hides (1 default, verified 7 Nov) */
  mirrorClipSign?: number
  /** a look recipe's grade (scripts/look_grade.py, the same as its Cycles stills), applied after AgX */
  grade?: { exposure?: number; whiteBalance?: number[]; contrast?: number; pivot?: number; saturation?: number; shadows?: number[]; highlights?: number[] }
  /** this file's look ('golden', 'day') and its sibling looks (same shape, other colours) */
  look?: string
  looks?: string[]
  /** the apartment's exposure (0.18 over its median light x colour, from the capture); the eye adapts only ±adapt stops */
  exposure?: number
  adapt?: number
  /** false: no screen-space reflections (probes only) */
  ssr?: boolean
}

/** The grade's shader values; no grade = AgX alone, as before. */
function gradeUniforms(g: SplatInfo['grade'] = {}) {
  const wb = g.whiteBalance ?? [1, 1, 1]
  const k = 0.2126 * wb[0] + 0.7152 * wb[1] + 0.0722 * wb[2] || 1
  const v3 = (a?: number[]) => new THREE.Vector3(...((a ?? [0, 0, 0]) as [number, number, number]))
  return {
    gEv: { value: g.exposure ?? 0 }, gWB: { value: new THREE.Vector3(wb[0] / k, wb[1] / k, wb[2] / k) }, gContrast: { value: g.contrast ?? 1 },
    gPivot: { value: g.pivot ?? 0.45 }, gSat: { value: g.saturation ?? 1 }, gShadow: { value: v3(g.shadows) }, gHigh: { value: v3(g.highlights) },
  }
}

/** The mirrors as planes: triangles on one plane, its normal and offset, a sphere around them. */
function mirrorPlanes(tris: number[][]) {
  const planes: { n: THREE.Vector3; d: number; pos: number[]; at: THREE.Vector3 }[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  for (const t of tris) {
    a.set(t[0], t[1], t[2])
    b.set(t[3], t[4], t[5])
    c.set(t[6], t[7], t[8])
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
    if (n.lengthSq() < 1e-12) continue
    n.normalize()
    const d = n.dot(a)
    // one plane per mirror: coplanar mirrors in different rooms stay apart (within 1.5 m of the group's first corner)
    let plane = planes.find(p => Math.abs(p.n.dot(n)) > 0.995 && Math.abs(p.d - Math.sign(p.n.dot(n)) * d) < 0.02 && p.at.distanceTo(a) < 1.5)
    if (!plane) planes.push((plane = { n, d, pos: [], at: a.clone() }))
    plane.pos.push(...t)
  }
  return planes
    .map(p => {
      let area = 0
      for (let k = 0; k < p.pos.length; k += 9) {
        a.fromArray(p.pos, k)
        b.fromArray(p.pos, k + 3)
        c.fromArray(p.pos, k + 6)
        area += new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3))
      geo.computeBoundingSphere()
      return { n: p.n, d: p.d, geo, sphere: geo.boundingSphere!.clone(), area }
    })
    // the reflecting faces, not a mirror's edges and frame strips (they made the walk pick a 1 cm strip, 7 Nov)
    .filter(p => p.area >= 0.08)
}

const AGX = `
const mat3 SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 R2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
vec3 agxContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 c) {
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  c = inset * (SRGB_TO_2020 * c);
  c = clamp((log2(max(c, 1e-10)) + 12.47393) / (4.026069 + 12.47393), 0., 1.);
  c = outset * agxContrast(c);
  c = R2020_TO_SRGB * pow(max(vec3(0.), c), vec3(2.2));
  return clamp(c, 0., 1.);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.0031308, c)); }
`

const FRAG = `
uniform sampler2D tLight, tAlbedo, tLight2, tAlbedo2, tMask, tSpec, tEnv;
uniform float lo, hi, exposure, floorA, tint; uniform int meter, useAlbedo, mirror, useSpec, view, useEnv; varying vec2 vUv;
uniform mat4 invVP; uniform vec3 camPos;
uniform float gEv, gContrast, gPivot, gSat; uniform vec3 gWB, gShadow, gHigh;
${AGX}
vec3 graded(vec3 lin) {
  // the look's grade (scripts/look_grade.py): white balance before AgX, contrast / saturation / split toning after
  vec3 c = srgb(agx(lin * exp2(gEv) * gWB));
  c = gPivot + (c - gPivot) * gContrast;
  float y = dot(c, vec3(.2126, .7152, .0722));
  c = y + (c - y) * gSat;
  float yy = clamp(y, 0., 1.);
  return clamp(c + gShadow * (1. - yy) * (1. - yy) + gHigh * yy * yy, 0., 1.);
}
vec3 lightAt(sampler2D t, vec2 uv) {
  // Spark writes sRGB-decoded colours into a linear target: back to the stored values, then to light
  vec3 e = srgb(clamp(texture2D(t, uv).rgb, 0., 1.));
  return exp2(e * (hi - lo) + lo);
}
vec3 lightOf(sampler2D t) { return lightAt(t, vUv); }
vec3 pictureAt(sampler2D tl, sampler2D ta, vec2 uv) {
  vec3 l = lightAt(tl, uv);
  return useAlbedo == 1 ? l * max(texture2D(ta, uv).rgb, vec3(floorA)) : l;
}
vec3 pictureOf(sampler2D tl, sampler2D ta) { return pictureAt(tl, ta, vUv); }
void main() {
  vec3 lin = pictureOf(tLight, tAlbedo);
  // where the splat covers nothing (the street through a window, a hole): the nearest Cycles 360 in that direction
  if (useEnv == 1) {
    float cov = texture2D(tLight, vUv).a;
    if (cov < 0.95) {
      vec4 w = invVP * vec4(vUv * 2. - 1., 1., 1.);
      vec3 d = normalize(w.xyz / w.w - camPos);
      float u = atan(d.z, d.x) * 0.15915494 + 0.5;
      float v = clamp(asin(clamp(d.y, -1., 1.)) * 0.31830989 + 0.5, 0.5 / 128., 1. - 0.5 / 128.);
      vec3 env = texture2D(tEnv, vec2(u, (5. + v) / 6.)).rgb;
      lin = mix(env, lin, smoothstep(0.15, 0.95, cov));
    }
  }
  // the gloss the walk draws itself: each material's Fresnel and roughness over the nearest Cycles 360
  if (useSpec == 1) lin += max(texture2D(tSpec, vUv).rgb, vec3(0.));
  if (mirror == 1 && texture2D(tMask, vUv).r > 0.5) lin = pictureAt(tLight2, tAlbedo2, vec2(1. - vUv.x, vUv.y)) * tint;
  // ?view= in tests: 1 the light alone, 2 the colours alone, 3 the gloss alone
  if (view == 1) lin = lightOf(tLight) * 0.18;
  if (view == 2) lin = texture2D(tAlbedo, vUv).rgb * 0.18 / exposure;
  if (view == 3) lin = texture2D(tSpec, vUv).rgb;
  if (view == 4) lin = lightAt(tLight2, vec2(1. - vUv.x, vUv.y)) * 0.18;
  if (view == 5) lin = texture2D(tAlbedo2, vec2(1. - vUv.x, vUv.y)).rgb * 0.18 / exposure;
  if (view == 6) lin = texture2D(tMask, vUv).rgb * 0.18 / exposure;
  if (meter == 1) { gl_FragColor = vec4(vec3(log2(max(dot(lin, vec3(.2126, .7152, .0722)), 1e-6))), 1.); return; }
  gl_FragColor = vec4(graded(lin * exposure), 1.);
}`

/** where a mirror is seen: its triangles, kept only where the model's depth does not hide them */
const MASK_FRAG = `
uniform sampler2D tDepth; uniform vec2 size; uniform float near, far;
float dist(float z) { return near * far / (far - z * (far - near)); }
void main() {
  // in metres: the mirror's own backing and the wall it hangs on lie within a few centimetres and must not hide it
  float d = dist(texture2D(tDepth, gl_FragCoord.xy / size).r);
  if (dist(gl_FragCoord.z) > d + 0.04) discard;
  gl_FragColor = vec4(1.);
}`

export function createSplatLayer(renderer: THREE.WebGLRenderer, info: SplatInfo, url: string) {
  const useAlbedo = Boolean(info.light)
  const floorA = info.albedoFloor ?? 0.02
  const see = new Set((info.seeThrough ?? []).map(n => n.replace(/\.\d{3}$/, '')))

  const scene = new THREE.Scene()
  scene.add(new SparkRenderer({ renderer }))
  let loaded = false
  const planes = info.mirrors?.length ? mirrorPlanes(info.mirrors) : []
  const reflScene = new THREE.Scene()
  let reflMesh: SplatMesh | null = null
  const splat = new SplatMesh({
    url,
    onLoad: () => {
      loaded = true
      if (planes.length) {
        reflMesh = new SplatMesh({ packedSplats: splat.packedSplats })
        reflScene.add(reflMesh)
      }
    },
  })
  scene.add(splat)

  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const rt = (depthTexture?: THREE.DepthTexture) =>
    new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, colorSpace: THREE.NoColorSpace, depthBuffer: true, ...(depthTexture ? { depthTexture } : {}) })
  const tLight = rt()
  const tAlbedo = rt(new THREE.DepthTexture(size.x, size.y))
  const mirrorShift = info.mirrorHalf === false ? 0 : 1
  const tLight2 = rt()
  const tAlbedo2 = rt()
  tLight2.setSize(Math.max(1, size.x >> mirrorShift), Math.max(1, size.y >> mirrorShift))
  tAlbedo2.setSize(Math.max(1, size.x >> mirrorShift), Math.max(1, size.y >> mirrorShift))
  const tMask = new THREE.WebGLRenderTarget(size.x, size.y)
  const tSpec = rt()
  const meterTarget = new THREE.WebGLRenderTarget(32, 32, { type: THREE.FloatType })
  const decode = new THREE.ShaderMaterial({
    uniforms: {
      tLight: { value: tLight.texture }, tAlbedo: { value: tAlbedo.texture }, tLight2: { value: tLight2.texture }, tAlbedo2: { value: tAlbedo2.texture },
      tMask: { value: tMask.texture }, tSpec: { value: tSpec.texture }, useSpec: { value: 0 }, tEnv: { value: null }, useEnv: { value: 0 }, invVP: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() }, view: { value: info.view ?? 0 }, lo: { value: info.lo }, hi: { value: info.hi }, exposure: { value: 1 }, meter: { value: 0 },
      useAlbedo: { value: useAlbedo ? 1 : 0 }, floorA: { value: floorA }, mirror: { value: 0 }, tint: { value: 0.82 },
      ...gradeUniforms(info.grade),
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), decode)
  quad.frustumCulled = false
  const post = new THREE.Scene()
  post.add(quad)
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // ---- the colour pass: the model's own textures, unlit (glass and mirrors left out: the capture saw through them)
  let model: THREE.Object3D | null = null
  const swaps: { mesh: THREE.Mesh; own: THREE.Material | THREE.Material[]; flat: THREE.Material | THREE.Material[] }[] = []
  const flatOf = (m: THREE.Material) => {
    const std = m as THREE.MeshStandardMaterial & { transmission?: number }
    const name = m.name.replace(/\.\d{3}$/, '')
    const clear = see.has(name) || /mirror|miroir/i.test(name) || (std.transparent && std.opacity < 0.6) || (std.transmission ?? 0) > 0.5
    return new THREE.MeshBasicMaterial({
      map: std.map ?? null,
      color: std.color ? std.color.clone() : new THREE.Color(1, 1, 1),
      alphaMap: std.alphaMap ?? null,
      alphaTest: std.alphaTest || (std.map && std.transparent ? 0.5 : 0),
      side: THREE.DoubleSide,
      visible: !clear,
      toneMapped: false,
    })
  }
  const hidden = new THREE.MeshBasicMaterial({ visible: false })
  // ---- gloss (7 Nov, ChatGPT steps 2-5): the model drawn with only its reflections.
  // - each material with Blender's own values (materials.json: IOR, specular level and tint, metal, roughness, sheen,
  //   coat), and a glossScale fitted against Cycles' glossy pass;
  // - probes (small Cycles 360s) prefiltered for roughness (PMREM; 'mip' keeps plain mipmaps, to compare);
  // - each room's surfaces reflect a probe taken in that room (rooms.json from the walk map), corrected for the room's
  //   box (parallax); a surface's room is looked up where it faces, so a bathroom wall seen from the hallway reflects
  //   the bathroom.
  const probes = useAlbedo && info.gloss !== false ? (info.probes ?? []) : []
  const filterMode = info.probeFilter ?? (probes.some(p => /-ggx\.hdr$/.test(p.file)) ? 'atlas' : 'mip')
  const pmrem = probes.length && filterMode === 'pmrem' ? new THREE.PMREMGenerator(renderer) : null
  const probeTex: (THREE.Texture | null)[] = probes.map(() => null)
  const probeAt = probes.map(p => new THREE.Vector3(...p.eye))
  let cubeUV: { w: number; h: number; mip: number } | null = null
  const specMats: THREE.ShaderMaterial[] = []
  const setDefines = (m: THREE.ShaderMaterial) => {
    if (filterMode === 'atlas') {
      m.defines = { ATLAS: '' }
      m.needsUpdate = true
    }
    if (filterMode === 'pmrem' && cubeUV) {
      m.defines = { ENVMAP_TYPE_CUBE_UV: '', CUBE_UV: '', CUBEUV_TEXEL_WIDTH: cubeUV.w, CUBEUV_TEXEL_HEIGHT: cubeUV.h, CUBEUV_MAX_MIP: cubeUV.mip.toFixed(1) }
      m.needsUpdate = true
    }
  }
  probes.forEach((p, i) => {
    new HDRLoader().load(url.replace(info.file, p.file), tex => {
      if (pmrem) {
        tex.mapping = THREE.EquirectangularReflectionMapping
        const rtP = pmrem.fromEquirectangular(tex)
        const t = rtP.texture
        tex.dispose()
        const h = (t.image as { height: number }).height
        const mip = Math.log2(h) - 2
        const first = !cubeUV
        cubeUV = { w: 1 / (3 * Math.max(2 ** mip, 7 * 16)), h: 1 / h, mip }
        if (first) specMats.forEach(setDefines)
        probeTex[i] = t
      } else if (filterMode === 'atlas') {
        tex.generateMipmaps = false
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.wrapS = THREE.RepeatWrapping
        tex.needsUpdate = true
        probeTex[i] = tex
      } else {
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.wrapS = THREE.RepeatWrapping
        tex.needsUpdate = true
        probeTex[i] = tex
      }
    })
  })
  // Blender's material values
  type Mat = Record<string, number | number[] | { value: number | number[]; linked: boolean } | string | null>
  let manifest: Record<string, Mat> | null = null
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : v && typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'number' ? (v as { value: number }).value : d)
  const vec = (v: unknown, d: number[]) => (Array.isArray(v) ? v : v && typeof v === 'object' && 'value' in v && Array.isArray((v as { value: unknown }).value) ? (v as { value: number[] }).value : d)
  const applyManifest = (m: THREE.ShaderMaterial) => {
    const e = manifest?.[m.name]
    if (!e) return
    const u = m.uniforms
    const ior = num(e.ior, 1.5)
    const f = ((ior - 1) / (ior + 1)) ** 2 * 2 * num(e.specular, 0.5)
    const tint = vec(e.specularTint, [1, 1, 1])
    u.f0.value.setRGB(Math.min(f * tint[0], 1), Math.min(f * tint[1], 1), Math.min(f * tint[2], 1))
    u.rough.value = num(e.roughness, u.rough.value)
    u.metal.value = num(e.metallic, u.metal.value)
    u.sheen.value = num(e.sheen, 0)
    u.sheenTint.value.setRGB(...(vec(e.sheenTint, [1, 1, 1]) as [number, number, number]))
    u.sheenRough.value = num(e.sheenRoughness, 0.5)
    u.coat.value = num(e.coat, 0)
    u.coatRough.value = num(e.coatRoughness, 0.03)
    u.scale.value = num(e.glossScale, 1)
  }
  if (info.materials) {
    fetch(url.replace(info.file, info.materials).split('?')[0])
      .then(r => r.json())
      .then(j => {
        manifest = j
        specMats.forEach(applyManifest)
      })
      .catch(() => {})
  }
  // rooms
  type Room = { id: number; box: number[]; probes: number[] }
  let rooms: Room[] = []
  const roomU = { value: null as THREE.Texture | null }
  const gridU = { value: new THREE.Vector4(0, 0, 1, 0) }
  const gridN = { value: new THREE.Vector2(1, 1) }
  const roomIdU = { value: 0 }
  const useRoomU = { value: 0 }
  const boxMinU = { value: new THREE.Vector3() }
  const boxMaxU = { value: new THREE.Vector3() }
  const probePosU = { value: new THREE.Vector3() }
  const meshRooms = new Map<THREE.Mesh, Set<number>>()
  let roomLabels: Uint8Array | null = null
  let grid = { x0: 0, y0: 0, step: 1, nx: 1, ny: 1 }
  if (info.rooms) {
    fetch(url.replace(info.file, info.rooms).split('?')[0])
      .then(r => r.json())
      .then(j => {
        grid = j
        roomLabels = Uint8Array.from(atob(j.labels), c => c.charCodeAt(0))
        const t = new THREE.DataTexture(roomLabels, j.nx, j.ny, THREE.RedFormat, THREE.UnsignedByteType)
        t.minFilter = t.magFilter = THREE.NearestFilter
        // one byte a cell, rows not a multiple of 4 wide: the default alignment scrambled it (7 Nov)
        t.unpackAlignment = 1
        t.needsUpdate = true
        roomU.value = t
        gridU.value.set(j.x0, j.y0, j.step, 0)
        gridN.value.set(j.nx, j.ny)
        rooms = j.rooms
        assignRooms()
      })
      .catch(() => {})
  }
  const assignRooms = () => {
    meshRooms.clear()
    if (!roomLabels || !model) return
    const box = new THREE.Box3()
    for (const sp of specs) {
      box.setFromObject(sp.mesh)
      const set = new Set<number>()
      const i0 = Math.max(0, Math.floor((box.min.x - grid.x0) / grid.step) - 2), i1 = Math.min(grid.nx - 1, Math.floor((box.max.x - grid.x0) / grid.step) + 2)
      const j0 = Math.max(0, Math.floor((grid.y0 + box.max.z) / grid.step) - 2), j1 = Math.min(grid.ny - 1, Math.floor((grid.y0 + box.min.z) / grid.step) + 2)
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) set.add(roomLabels[j * grid.nx + i])
      if (!set.size) set.add(0)
      meshRooms.set(sp.mesh, set)
    }
  }
  const SPEC_VERT = `varying vec3 vN; varying vec3 vP;
void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`
  const SPEC_FRAG = `uniform sampler2D env, roomTex; uniform float lod, rough, metal, sheen, sheenRough, coat, coatRough, scale;
uniform vec3 base, f0, sheenTint, boxMin, boxMax, probePos; uniform vec4 grid; uniform vec2 gridN; uniform int roomId, useRoom;
uniform sampler2D sLight, sAlbedo, sDepth; uniform float sLo, sHi, sFloor, sNear, sFar; uniform int useSSR, sUseAlbedo; uniform mat4 sProj;
varying vec3 vN; varying vec3 vP;
// Screen-space reflections (7 Nov, Phase 6): what this frame already shows (splat light x model colour, before any
// gloss) is looked up along the reflected ray, marched through the model's depth; the probe stays where it misses.
vec3 srgbS(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - 0.055, step(0.0031308, c)); }
float viewZ(vec2 uv) { float z = texture2D(sDepth, uv).r * 2. - 1.; return 2. * sNear * sFar / (sFar + sNear - z * (sFar - sNear)); }
vec3 pictureS(vec2 uv) {
  vec3 l = exp2(srgbS(clamp(texture2D(sLight, uv).rgb, 0., 1.)) * (sHi - sLo) + sLo);
  return sUseAlbedo == 1 ? l * max(texture2D(sAlbedo, uv).rgb, vec3(sFloor)) : l;
}
vec2 toScreen(vec3 q, out float w) { vec4 c = sProj * viewMatrix * vec4(q, 1.); w = c.w; return c.xy / max(c.w, 1e-4) * 0.5 + 0.5; }
vec4 ssr(vec3 R) {
  vec3 start = vP + R * 0.02;
  float t = 0.0, w;
  for (int i = 0; i < 40; i++) {
    float st = 0.04 + t * 0.07;
    t += st;
    vec2 uv = toScreen(start + R * t, w);
    if (w <= 0. || uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) break;
    float sz = viewZ(uv);
    if (w > sz + 0.01 && w - sz < 0.2 + t * 0.06) {
      float a = t - st, b = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (a + b);
        vec2 um = toScreen(start + R * m, w);
        if (w > viewZ(um) + 0.01) b = m; else a = m;
      }
      uv = toScreen(start + R * b, w);
      vec2 e = smoothstep(0., 0.08, uv) * smoothstep(0., 0.08, 1. - uv);
      return vec4(pictureS(uv), e.x * e.y * (1. - float(i) / 40.));
    }
  }
  return vec4(0.);
}
#ifdef CUBE_UV
${THREE.ShaderChunk.cube_uv_reflection_fragment}
#endif
vec3 envAt(vec3 dir, float r) {
#ifdef CUBE_UV
  return textureCubeUV(env, dir, r).rgb;
#elif defined(ATLAS)
  // six GGX-prefiltered levels (roughness 0, 0.2 ... 1) stacked top to bottom (scripts/splat_probes.py)
  float u = atan(dir.z, dir.x) * 0.15915494 + 0.5;
  float v = clamp(asin(clamp(dir.y, -1., 1.)) * 0.31830989 + 0.5, 0.5 / 128., 1. - 0.5 / 128.);
  float lv = clamp(r, 0., 1.) * 5.;
  float l0 = floor(lv);
  float l1 = min(l0 + 1., 5.);
  vec3 a = texture2D(env, vec2(u, (5. - l0 + v) / 6.)).rgb;
  vec3 b = texture2D(env, vec2(u, (5. - l1 + v) / 6.)).rgb;
  return mix(a, b, lv - l0);
#else
  vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1., 1.)) * 0.31830989 + 0.5);
  return textureLod(env, uv, r * lod).rgb;
#endif
}
vec3 parallax(vec3 R) {
  if (useRoom == 0) return R;
  vec3 a = (boxMax - vP) / R, b = (boxMin - vP) / R;
  vec3 f = max(a, b);
  float t = min(min(f.x, f.y), f.z);
  return t > 0. ? normalize(vP + R * t - probePos) : R;
}
void main() {
  vec3 V = normalize(cameraPosition - vP);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.) N = -N;
  if (useRoom == 1) {
    // the room this side of the surface belongs to: looked up 30 cm in front of it
    vec3 q = vP + N * 0.3;
    vec2 cell = vec2((q.x - grid.x) / grid.z, (grid.y + q.z) / grid.z);
    float id = texture2D(roomTex, cell / gridN).r * 255.;
    if (abs(id - float(roomId)) > 0.5) discard;
  }
  vec3 R = reflect(-V, N);
  float c = 1. - max(dot(N, V), 0.);
  float c5 = c * c * c * c * c;
  vec3 F0 = mix(f0, base, metal);
  vec3 F = F0 + (max(vec3(1. - rough), F0) - F0) * c5;
  vec3 spec = envAt(parallax(normalize(mix(R, N, rough * rough))), rough) * F;
  vec4 hit = vec4(0.);
  if (useSSR == 1 && (rough < 0.35 || (coat > 0. && coatRough < 0.35))) hit = ssr(R);
  if (hit.a > 0.) spec = mix(spec, hit.rgb * F, hit.a * (1. - smoothstep(0.12, 0.35, rough)));
  if (coat > 0.) {
    float fc = 0.04 + 0.96 * c5 * (1. - coatRough);
    vec3 ce = envAt(parallax(R), coatRough);
    if (hit.a > 0.) ce = mix(ce, hit.rgb, hit.a * (1. - smoothstep(0.12, 0.35, coatRough)));
    spec = spec * (1. - coat * fc) + coat * fc * ce;
  }
  // sheen (fabrics): a soft grazing glow in the sheen colour
  if (sheen > 0.) spec += sheen * sheenTint * envAt(N, 1.) * c * c * c * c * (1. - 0.5 * sheenRough);
  gl_FragColor = vec4(spec * scale, 1.);
}`
  const specs: { mesh: THREE.Mesh; spec: THREE.Material | THREE.Material[] }[] = []
  const specOf = (m: THREE.Material): THREE.Material => {
    const std = m as THREE.MeshStandardMaterial
    if (!std.isMeshStandardMaterial) return hidden
    const name = m.name.replace(/\.\d{3}$/, '')
    // a mirror: a perfect mirror of the nearest probe (the one mirror drawn live covers it; the others showed the
    // empty space behind them, black, 7 Nov F5 wardrobes)
    const isMirror = /mirror|miroir/i.test(name) || (see.has(name) && /mirror|miroir/i.test(m.name))
    const clear = !isMirror && (see.has(name) || (std.transparent && std.opacity < 0.6) || ((std as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0.5)
    if (clear) return hidden
    const phys = std as THREE.MeshPhysicalMaterial
    const ior = phys.isMeshPhysicalMaterial ? phys.ior : 1.5
    const f = ((ior - 1) / (ior + 1)) ** 2 * (phys.isMeshPhysicalMaterial ? phys.specularIntensity : 1)
    const g = new THREE.ShaderMaterial({
      name: m.name,
      uniforms: {
        env: envU, lod: lodU, roomTex: roomU, grid: gridU, gridN, roomId: roomIdU, useRoom: useRoomU, boxMin: boxMinU, boxMax: boxMaxU, probePos: probePosU,
        rough: { value: isMirror ? 0 : std.roughness }, metal: { value: isMirror ? 1 : std.metalness }, base: { value: isMirror ? new THREE.Color(0.85, 0.85, 0.85) : std.color.clone() }, f0: { value: new THREE.Color(f, f, f) },
        sheen: { value: 0 }, sheenTint: { value: new THREE.Color(1, 1, 1) }, sheenRough: { value: 0.5 }, coat: { value: 0 }, coatRough: { value: 0.03 }, scale: { value: 1 },
        ...ssrU,
      },
      vertexShader: SPEC_VERT,
      fragmentShader: SPEC_FRAG,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    setDefines(g)
    if (!isMirror) applyManifest(g)
    specMats.push(g)
    return g
  }
  const envU = { value: null as THREE.Texture | null }
  const lodU = { value: 8 }
  // screen-space reflections: this frame's splat light, colours and model depth (?ssr=0 / info.ssr false: probes only)
  const ssrU = {
    sLight: { value: tLight.texture }, sAlbedo: { value: tAlbedo.texture }, sDepth: { value: tAlbedo.depthTexture }, sLo: { value: info.lo }, sHi: { value: info.hi },
    sFloor: { value: floorA }, sNear: { value: 0.05 }, sFar: { value: 300 }, sProj: { value: new THREE.Matrix4() }, useSSR: { value: info.ssr === false ? 0 : 1 }, sUseAlbedo: { value: useAlbedo ? 1 : 0 },
  }
  const frustumG = new THREE.Frustum()
  const pvG = new THREE.Matrix4()
  const roomBox = new THREE.Box3()
  const nearestProbe = (list: number[], at: THREE.Vector3) => {
    let best = -1
    let bd = Infinity
    for (const i of list) {
      if (!probeTex[i]) continue
      const d = probeAt[i].distanceToSquared(at)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }
  const specPass = (camera: THREE.PerspectiveCamera) => {
    if (!model || !probes.length || (filterMode === 'pmrem' && !cubeUV)) return false
    renderer.setRenderTarget(tSpec)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    ssrU.sNear.value = camera.near
    ssrU.sFar.value = camera.far
    ssrU.sProj.value.copy(camera.projectionMatrix)
    for (const s of specs) s.mesh.material = s.spec
    let drawn = false
    // per-room reflections: not yet right (the room filter dropped most walls in the 7 Nov test), so only on request
    if (info.glossRooms && rooms.length && meshRooms.size) {
      pvG.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustumG.setFromProjectionMatrix(pvG)
      useRoomU.value = 1
      for (const rm of rooms) {
        roomBox.min.set(rm.box[0], rm.box[1], rm.box[2])
        roomBox.max.set(rm.box[3], rm.box[4], rm.box[5])
        if (!frustumG.intersectsBox(roomBox)) continue
        const pi = nearestProbe(rm.probes, camera.position)
        if (pi < 0) continue
        envU.value = probeTex[pi]
        lodU.value = Math.log2(Math.max(((probeTex[pi]!.image as { width?: number }).width ?? 512), 1)) - 1
        roomIdU.value = rm.id
        boxMinU.value.copy(roomBox.min)
        boxMaxU.value.copy(roomBox.max)
        probePosU.value.copy(probeAt[pi])
        for (const s of specs) s.mesh.visible = meshRooms.get(s.mesh)?.has(rm.id) ?? false
        renderer.render(model, camera)
        drawn = true
      }
      for (const s of specs) s.mesh.visible = true
    }
    if (!drawn) {
      // no rooms: the nearest probe for everything
      const pi = nearestProbe(probes.map((_, i) => i), camera.position)
      if (pi >= 0) {
        useRoomU.value = 0
        envU.value = probeTex[pi]
        lodU.value = Math.log2(Math.max(((probeTex[pi]!.image as { width?: number }).width ?? 512), 1)) - 1
        renderer.render(model, camera)
        drawn = true
      }
    }
    for (const s of swaps) s.mesh.material = s.own
    return drawn
  }

  const albedoPass = (camera: THREE.Camera, target: THREE.WebGLRenderTarget) => {
    renderer.setRenderTarget(target)
    // where no surface is (sky through a window): white, the splat's light there is the sky itself (the trainer
    // divides by white there too)
    renderer.setClearColor(useAlbedo ? 0xffffff : 0x000000, 1)
    renderer.clear()
    if (!model) return
    for (const s of swaps) s.mesh.material = s.flat
    renderer.render(model, camera)
    for (const s of swaps) s.mesh.material = s.own
  }

  // ---- mirrors
  const clip = new SplatEditSdf({ type: SplatEditSdfType.PLANE, opacity: 0 })
  const edit = new SplatEdit({ rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, sdfs: [clip] })
  edit.add(clip)
  reflScene.add(edit)
  if (planes.length) reflScene.add(new SparkRenderer({ renderer }))
  const reflCam = new THREE.PerspectiveCamera()
  reflCam.matrixAutoUpdate = false
  reflCam.matrixWorldAutoUpdate = false
  const maskMat = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: tAlbedo.depthTexture }, size: { value: new THREE.Vector2(size.x, size.y) }, near: { value: 0.05 }, far: { value: 100 } },
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: MASK_FRAG,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const maskScene = new THREE.Scene()
  const maskMeshes = planes.map(p => {
    const m = new THREE.Mesh(p.geo, maskMat)
    m.frustumCulled = false
    maskScene.add(m)
    return m
  })
  const frustum = new THREE.Frustum()
  const pv = new THREE.Matrix4()
  const refl = new THREE.Matrix4()
  const toward = new THREE.Vector3()
  const mirrorPlane = new THREE.Plane()
  const flipX = new THREE.Matrix4().makeScale(-1, 1, 1)
  const look = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const nearestMirror = (camera: THREE.PerspectiveCamera) => {
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(pv)
    const eye = camera.position
    camera.getWorldDirection(look)
    let best: { i: number; side: number; dist: number } | null = null
    let bestScore = 0
    planes.forEach((p, i) => {
      const side = p.n.dot(eye) - p.d
      const dist = p.sphere.center.distanceTo(eye)
      // the biggest mirror as seen from here (its area over the distance squared), first those in the room the eye
      // is in: a big mirror behind a wall must not win (7 Nov, F2)
      let score = p.area / Math.max(dist * dist, 0.25)
      // ... and how squarely it is in front of the eye (a big mirror off to the side won over one straight ahead)
      const ahead = fwd.subVectors(p.sphere.center, eye).normalize().dot(look)
      score *= Math.max(0, ahead) ** 2
      if (roomLabels) {
        const at = (x: number, z: number) => {
          const i = Math.floor((x - grid.x0) / grid.step), j = Math.floor((grid.y0 + z) / grid.step)
          return i >= 0 && j >= 0 && i < grid.nx && j < grid.ny ? roomLabels![j * grid.nx + i] : 0
        }
        const toward = Math.sign(side)
        const mr = at(p.sphere.center.x + p.n.x * toward * 0.3, p.sphere.center.z + p.n.z * toward * 0.3)
        if (mr && mr === at(eye.x, eye.z)) score *= 10
      }
      if (Math.abs(side) > 0.02 && dist < 9 && frustum.intersectsSphere(p.sphere) && score > bestScore) {
        bestScore = score
        best = { i, side, dist }
      }
    })
    return best as { i: number; side: number; dist: number } | null
  }
  /** the reflection in mirror i into tLight2/tAlbedo2, and where it shows into tMask */
  let lastMirror = -1
  const drawMirror = (camera: THREE.PerspectiveCamera, m: { i: number; side: number }, fresh = true) => {
    const p = planes[m.i]
    const n = p.n.clone().multiplyScalar(Math.sign(m.side))
    const d = p.d * Math.sign(m.side)
    refl.set(
      1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 2 * d * n.x,
      -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 2 * d * n.y,
      -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 2 * d * n.z,
      0, 0, 0, 1,
    )
    reflCam.projectionMatrix.copy(camera.projectionMatrix)
    reflCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
    // the eye's reflection with its own x flipped back: a proper camera (Spark holds a camera as a rotation and a
    // position, which a mirror image is not: it lost a band of the reflection, 7 Nov unit test); its picture is
    // left-right flipped and read back flipped
    reflCam.matrixWorld.multiplyMatrices(refl, camera.matrixWorld).multiply(flipX)
    reflCam.matrixWorldInverse.copy(reflCam.matrixWorld).invert()
    reflCam.matrixWorld.decompose(reflCam.position, reflCam.quaternion, reflCam.scale)
    // hide what is behind the mirror (the wall it hangs on, the next room). Spark's plane edits the side its local +z
    // points to (7 Nov: pointing it at the eye hid the whole reflected room), so +z goes away from the eye.
    clip.position.copy(n).multiplyScalar(d - 0.005)
    clip.lookAt(toward.copy(clip.position).addScaledVector(n, info.mirrorClipSign ?? 1))
    clip.updateMatrixWorld(true)
    if (fresh) {
    renderer.setRenderTarget(tLight2)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(reflScene, reflCam)
    // the model too: only what is in front of the mirror (the reflected eye stands behind the mirror's own wall)
    mirrorPlane.set(n, -d + 0.002)
    renderer.clippingPlanes = [mirrorPlane]
    if (useAlbedo) albedoPass(reflCam, tAlbedo2)
    renderer.clippingPlanes = []
    }
    renderer.setRenderTarget(tMask)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    maskMat.uniforms.near.value = camera.near
    maskMat.uniforms.far.value = camera.far
    maskMeshes.forEach((mesh, j) => (mesh.visible = j === m.i))
    renderer.render(maskScene, camera)
  }

  const buf = new Float32Array(32 * 32 * 4)
  const bias = 2 ** (info.bias ?? 0.3)
  let exposure: number | null = null
  let frames = 0
  const meter = () => {
    decode.uniforms.meter.value = 1
    // the room's light without the gloss (the probe is chosen by it)
    const spec = decode.uniforms.useSpec.value
    decode.uniforms.useSpec.value = 0
    renderer.setRenderTarget(meterTarget)
    renderer.render(post, postCam)
    renderer.readRenderTargetPixels(meterTarget, 0, 0, 32, 32, buf)
    decode.uniforms.meter.value = 0
    decode.uniforms.useSpec.value = spec
    const logs: number[] = []
    for (let i = 0; i < 32 * 32; i++) logs.push(buf[i * 4])
    logs.sort((a, b) => a - b)
    return (0.18 / 2 ** logs[logs.length >> 1]) * bias
  }

  return {
    get loaded() {
      return loaded
    },
    get exposureEv() {
      return Math.log2(exposure ?? 1)
    },
    /** the walk's model: its textures give the colours (v3), its depth hides mirrors behind furniture */
    setModel(root: THREE.Object3D | null) {
      model = root
      swaps.length = 0
      specs.length = 0
      specMats.length = 0
      root?.traverse(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const own = mesh.material
        // D5's light icons: Blender hides them and puts a real light in their place (lib/blender-render.ts)
        let icon = false
        for (let p: THREE.Object3D | null = mesh; p && !icon; p = p.parent) icon = /D5RenderLight/i.test(p.name)
        const flat = icon ? hidden : Array.isArray(own) ? own.map(flatOf) : flatOf(own)
        swaps.push({ mesh, own, flat })
        if (probes.length) specs.push({ mesh, spec: icon ? hidden : Array.isArray(own) ? own.map(specOf) : specOf(own) })
      })
      assignRooms()
    },
    /** One frame of the walk: the splat (times the colours) seen from the camera, exposed and tone-mapped, on screen. */
    render(camera: THREE.PerspectiveCamera, dt: number) {
      const tone = renderer.toneMapping
      const space = renderer.outputColorSpace
      const autoClear = renderer.autoClear
      // Spark keeps the stored values as they are only when the output is sRGB; the decode does its own tone mapping
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.NoToneMapping
      renderer.autoClear = false
      renderer.setRenderTarget(tLight)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      renderer.render(scene, camera)
      if (useAlbedo || planes.length) albedoPass(camera, tAlbedo)
      decode.uniforms.useSpec.value = specPass(camera) ? 1 : 0
      // the fallback for what the splat does not cover: the nearest probe (GGX atlas, its sharp level)
      const envI = filterMode === 'atlas' ? nearestProbe(probes.map((_, i) => i), camera.position) : -1
      decode.uniforms.useEnv.value = envI >= 0 ? 1 : 0
      if (envI >= 0) {
        decode.uniforms.tEnv.value = probeTex[envI]
        decode.uniforms.invVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert()
        decode.uniforms.camPos.value.copy(camera.position)
      }
      const m = loaded && planes.length ? nearestMirror(camera) : null
      // the reflection every third frame (a second view of the splat is what costs: 61 -> 26 fps facing a mirror, 7 Nov);
      // the mask follows the eye every frame
      if (m && reflMesh) drawMirror(camera, m, m.i !== lastMirror || frames % (info.mirrorEvery ?? 5) === 0)
      lastMirror = m?.i ?? -1
      decode.uniforms.mirror.value = m && reflMesh ? 1 : 0
      if (loaded && frames++ % 6 === 0) {
        // one exposure for the whole apartment (info.exposure, measured over the capture), and only a little
        // adaptation around it, slowly, like a camera on a walkthrough: re-exposing every view in a tenth of a second
        // made the light jump as one stepped back and forth, and burnt bright corners (8 Nov, F5)
        const base = info.exposure ? info.exposure * bias : null
        let want = meter()
        if (base) want = Math.min(base * 2 ** (info.adapt ?? 0.6), Math.max(base * 2 ** -(info.adapt ?? 0.6), want))
        exposure = exposure ? exposure * Math.pow(want / exposure, Math.min(1, dt * (base ? 1.5 : 12))) : (base ?? want)
      }
      decode.uniforms.exposure.value = exposure ?? 1
      renderer.setRenderTarget(null)
      renderer.render(post, postCam)
      renderer.toneMapping = tone
      renderer.outputColorSpace = space
      renderer.autoClear = autoClear
    },
    /** tests: a pass in true light (float RGB, rows from the bottom) */
    readPass(which: 'spec' | 'light' | 'albedo') {
      const t = which === 'spec' ? tSpec : which === 'light' ? tLight : tAlbedo
      const px = new Uint16Array(size.x * size.y * 4)
      renderer.readRenderTargetPixels(t, 0, 0, size.x, size.y, px)
      const out = new Float32Array(size.x * size.y * 3)
      for (let i = 0, k = 0; i < px.length; i += 4) {
        out[k++] = THREE.DataUtils.fromHalfFloat(px[i])
        out[k++] = THREE.DataUtils.fromHalfFloat(px[i + 1])
        out[k++] = THREE.DataUtils.fromHalfFloat(px[i + 2])
      }
      return { w: size.x, h: size.y, data: out }
    },
    resize() {
      renderer.getDrawingBufferSize(size)
      for (const t of [tLight, tAlbedo, tMask, tSpec]) t.setSize(size.x, size.y)
      // the reflection at half resolution: a mirror shows it smaller and softer, and it costs a second splat render
      for (const t of [tLight2, tAlbedo2]) t.setSize(Math.max(1, size.x >> mirrorShift), Math.max(1, size.y >> mirrorShift))
      maskMat.uniforms.size.value.set(size.x, size.y)
    },
    dispose() {
      splat.dispose()
      reflMesh?.dispose()
      for (const t of [tLight, tAlbedo, tLight2, tAlbedo2, tMask, tSpec, meterTarget]) t.dispose()
      for (const t of probeTex) t?.dispose()
      pmrem?.dispose()
      roomU.value?.dispose()
      for (const s of specs) for (const m of Array.isArray(s.spec) ? s.spec : [s.spec]) if (m !== hidden) m.dispose()
      for (const s of swaps) for (const f of Array.isArray(s.flat) ? s.flat : [s.flat]) f.dispose()
      hidden.dispose()
      decode.dispose()
      maskMat.dispose()
      for (const p of planes) p.geo.dispose()
      quad.geometry.dispose()
    },
  }
}

export type SplatLayer = ReturnType<typeof createSplatLayer>
