import * as THREE from 'three'
import type { TourView } from '@/lib/scene-tour'

/**
 * The room's own light for the free walk (1 Nov): the tour's 360°s (the AI ones where they exist), averaged into one
 * panorama in the model's axes and turned into the walk's environment, in place of three.js's stock studio, its sky
 * light and its sun. Floor, walls and ceiling then get the light the 360°s show there: the stock lights lit the floor
 * from above and left the ceiling dark (measured on the Restaurant: floor 0.6 stop too bright, the colour neutral where
 * the 360°s are warm).
 */

const WIDTH = 1024
/** The 360°s read in one pass (texture units a fragment shader can count on); more points: an even pick of them. */
const MAX = 12

// Each output pixel is a direction in three's equirect layout (what PMREMGenerator.fromEquirectangular reads); each 360°
// is read where it shows that direction: its middle column is the point's direction f, right of it is r, top is up. All
// in one pass, averaged in the shader: adding passes up with blending kept only one of them on half-float targets. The
// loop is unrolled because WebGL2 reads a texture array only at constant indices.
const fragment = (n: number) => `
precision highp float;
varying vec2 vUv;
uniform sampler2D panos[${n}];
uniform vec3 fwd[${n}];
uniform vec3 right[${n}];
const float PI = 3.14159265358979;
void main() {
  float phi = (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 d = vec3(cos(lat) * cos(phi), sin(lat), cos(lat) * sin(phi));
  vec3 sum = vec3(0.0);
  float lon;
${Array.from({ length: n }, (_, k) => `  lon = atan(dot(d, right[${k}]), dot(d, fwd[${k}]));
  sum += texture2D(panos[${k}], vec2(0.5 + lon / (2.0 * PI), 0.5 + lat / PI)).rgb;`).join('\n')}
  gl_FragColor = vec4(sum / ${n}.0, 1.0);
}`

/** The 360°s of these points averaged into one environment (PMREM), ready for scene.environment. */
export async function roomEnvironment(renderer: THREE.WebGLRenderer, pmrem: THREE.PMREMGenerator, views: TourView[], base: string, version: string) {
  const loader = new THREE.TextureLoader()
  const panos = (
    await Promise.all(
      views.map(v =>
        loader
          .loadAsync(`${base}/${v.pano}?v=${version}`)
          .then(t => ({ v, t }))
          .catch(() => null),
      ),
    )
  ).filter((p): p is { v: TourView; t: THREE.Texture<HTMLImageElement> } => p !== null)
  if (!panos.length) return null

  const used = panos.length <= MAX ? panos : Array.from({ length: MAX }, (_, k) => panos[Math.floor((k * panos.length) / MAX)])
  for (const { t } of used) t.colorSpace = THREE.SRGBColorSpace
  const dirs = used.map(({ v }) => new THREE.Vector3(v.target[0] - v.position[0], 0, v.target[2] - v.position[2]).normalize())
  const target = new THREE.WebGLRenderTarget(WIDTH, WIDTH / 2, { type: THREE.HalfFloatType, depthBuffer: false })
  const material = new THREE.ShaderMaterial({
    uniforms: {
      panos: { value: used.map(p => p.t) },
      fwd: { value: dirs },
      right: { value: dirs.map(f => new THREE.Vector3(-f.z, 0, f.x)) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: fragment(used.length),
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  const flat = new THREE.Scene()
  flat.add(quad)
  const before = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  renderer.render(flat, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1))
  renderer.setRenderTarget(before)
  for (const { t } of panos) t.dispose()
  material.dispose()
  quad.geometry.dispose()

  target.texture.mapping = THREE.EquirectangularReflectionMapping
  const env = pmrem.fromEquirectangular(target.texture).texture
  return { env, panorama: target }
}
