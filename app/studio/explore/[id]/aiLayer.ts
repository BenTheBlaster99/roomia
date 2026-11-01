import * as THREE from 'three'

/**
 * The AI layer of the free walk (31 Oct): the AI 360°s painted back onto the walk's model, each only where it really
 * saw the surface. projection.json and depth-<point>.png come from the depth job (one ray per pixel through the full
 * model from each AI point, the 360°'s own layout: middle = the point's direction, right = right of it, top = up).
 * The walk's model is a simplified copy, so a surface takes a 360°'s colour only where its distance from that point
 * agrees with the full model's depth there: what the walk lacks (a chair leg) is not painted onto what is behind it.
 */
export interface AiSource {
  index: number
  name?: string
  ai: string
  depth: string
  /** glTF coordinates */
  eye: [number, number, number]
  target: [number, number, number]
}

export interface AiProjection {
  width: number
  height: number
  views: AiSource[]
  /** The AI 360°s' light against the plain model's, per channel in linear light: the plain model is graded by it. */
  plainGain?: [number, number, number]
}

/**
 * 0: the plain walk; 1: the AI layer; 2: where it comes from (green: AI, red: the plain model; blue: which 360°);
 * 3: the walk's surfaces against the full model's depth (green: agree, blue: in front of it, red: behind it)
 */
export type AiMode = 0 | 1 | 2 | 3

const MAX = 16

const VERTEX = /* glsl */ `
#include <project_vertex>
vec4 aiWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	aiWorld = instanceMatrix * aiWorld;
#endif
vAiWorld = ( modelMatrix * aiWorld ).xyz;
`

const FRAGMENT_HEAD = /* glsl */ `
#define AI_MAX ${MAX}
#define AI_PI 3.141592653589793
uniform int aiCount;
uniform int aiMode;
uniform vec3 aiCam;
uniform vec3 aiEye[ AI_MAX ];
uniform vec2 aiFwd[ AI_MAX ];
uniform vec3 aiGain[ AI_MAX ];
uniform vec3 aiPlainGain;
uniform highp sampler2DArray aiPano;
uniform highp sampler2DArray aiDepth;
varying vec3 vAiWorld;
`

// After the colour space conversion: the AI 360° is a finished picture, its pixels go to the screen as they are.
const FRAGMENT_BODY = /* glsl */ `
#include <colorspace_fragment>
if ( aiMode > 0 && aiCount > 0 ) {
	vec3 P = vAiWorld;
	vec3 dPx = dFdx( P );
	vec3 dPy = dFdy( P );
	vec3 N = normalize( cross( dPx, dPy ) );
	// the best three sources: the third is taken off the first two, so a source leaving the top two fades out
	bool mode3 = aiMode == 3;
	vec3 dbg = vec3( 0.0 );
	float w1 = 0.0, w2 = 0.0, w3 = 0.0, q1 = 0.0, q2 = 0.0;
	vec3 c1 = vec3( 0.0 ), c2 = vec3( 0.0 );
	int k1 = -1;
	for ( int k = 0; k < AI_MAX; k ++ ) {
		if ( k >= aiCount ) break;
		vec3 d = P - aiEye[ k ];
		float dist = length( d );
		if ( dist < 0.05 ) continue;
		vec2 f = aiFwd[ k ];
		vec2 r = vec2( - f.y, f.x );
		float a = dot( d.xz, r );
		float b = dot( d.xz, f );
		float h = max( length( d.xz ), 1e-5 );
		float lon = atan( a, b );
		float lat = atan( d.y, h );
		vec2 uv = vec2( 0.5 + lon / ( 2.0 * AI_PI ), 0.5 - lat / AI_PI );
		// did this 360° see this very surface? its depth there, from the full model
		vec4 dc = floor( textureLod( aiDepth, vec3( uv, float( k ) ), 0.0 ) * 255.0 + 0.5 );
		float mm = dc.r * 256.0 + dc.g;
		// blue: 128 a mirror, 64 seen through glass, the 6 low bits how far the AI 360 kept the model's shapes there
		if ( mm < 0.5 || dc.b >= 128.0 ) continue;
		float kept = mod( dc.b, 64.0 ) / 63.0;
		if ( kept <= 0.0 ) continue;
		float cosT = abs( dot( N, d / dist ) );
		float tol = 0.025 + dist * 0.004 / max( cosT, 0.15 );
		float agree = 1.0 - smoothstep( tol, 2.0 * tol, abs( dist - mm * 0.001 ) );
		if ( mode3 ) {
			// where the walk's surface stands against the full model's depth: blue in front, red behind
			float e = dist - mm * 0.001;
			dbg = max( dbg, vec3( smoothstep( 0.0, 0.15, e ), 1.0 - smoothstep( 0.0, 0.15, abs( e ) ), smoothstep( 0.0, 0.15, - e ) ) );
		}
		if ( agree <= 0.0 ) continue;
		// quality: how much the picture stretches for the visitor. A wall the 360° saw edge-on is fine seen from the
		// same place (the first test dropped the side wall at its own point); it smears as the visitor faces it.
		float cosV = abs( dot( N, normalize( P - aiCam ) ) );
		float q = agree * kept * smoothstep( 0.02, 0.06, cosT ) * smoothstep( 0.2, 0.45, cosT / max( cosV, 0.02 ) );
		// rank: the 360°s taken near the visitor first (their perspective is the visitor's), then the sharper
		vec3 toCam = aiCam - aiEye[ k ];
		float w = q / ( 0.1 + dot( toCam, toCam ) ) / ( 1.0 + 0.15 * dist / max( cosT, 0.15 ) );
		if ( w <= w3 ) continue;
		// the texture's slope from the surface's, worked out by hand: inside this loop the GPU's own is undefined
		float da = dot( dPx.xz, r ), db = dot( dPx.xz, f ), ea = dot( dPy.xz, r ), eb = dot( dPy.xz, f );
		float h2 = h * h, l2 = h2 + d.y * d.y;
		vec2 gx = vec2( ( b * da - a * db ) / h2 / ( 2.0 * AI_PI ), - ( h * dPx.y - d.y * ( a * da + b * db ) / h ) / l2 / AI_PI );
		vec2 gy = vec2( ( b * ea - a * eb ) / h2 / ( 2.0 * AI_PI ), - ( h * dPy.y - d.y * ( a * ea + b * eb ) / h ) / l2 / AI_PI );
		vec3 c = textureGrad( aiPano, vec3( uv, float( k ) ), gx, gy ).rgb * aiGain[ k ];
		if ( w > w1 ) {
			w3 = w2; w2 = w1; q2 = q1; c2 = c1;
			w1 = w; q1 = q; c1 = c; k1 = k;
		} else if ( w > w2 ) {
			w3 = w2; w2 = w; q2 = q; c2 = c;
		} else {
			w3 = w;
		}
	}
	// The plain model under the layer, graded to the AI 360°s' light (measured on the place, aiPlainGain, in linear
	// light): uncovered surfaces stayed light grey in a warm room, and their edge showed (first test, 31 Oct).
	vec3 plain = pow( pow( max( gl_FragColor.rgb, 0.0 ), vec3( 2.2 ) ) * aiPlainGain, vec3( 1.0 / 2.2 ) );
	if ( mode3 ) {
		gl_FragColor.rgb = dbg;
	} else if ( k1 >= 0 ) {
		// The weights come from where things stand only, never from the colours: two AI 360s that disagree (sun
		// streaks on a wall in one, not in the other) cross-fade as the visitor walks. Deciding by colour drew the
		// streaks' outlines, pale (plain model there) or dark (one source inside, both outside) (31 Oct tests).
		float a1 = w1 - w3, a2 = max( w2 - w3, 0.0 );
		vec3 ai = ( a1 * c1 + a2 * c2 ) / ( a1 + a2 );
		float conf = ( a1 * q1 + a2 * q2 ) / ( a1 + a2 );
		if ( aiMode == 2 ) {
			gl_FragColor.rgb = vec3( 1.0 - conf, conf, float( k1 ) / float( max( aiCount - 1, 1 ) ) );
		} else {
			gl_FragColor.rgb = mix( plain, ai, conf );
		}
	} else if ( aiMode == 2 ) {
		gl_FragColor.rgb = vec3( 1.0, 0.0, 0.0 );
	} else {
		gl_FragColor.rgb = plain;
	}
}
`

async function pixels(url: string, width: number, height: number) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  // the bytes as they are: the depth is a number written in the colours, colour management would change it
  const bitmap = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const canvas = new OffscreenCanvas(width, height)
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return g.getImageData(0, 0, width, height).data
}

/**
 * The layer: shared uniforms every material of the walk reads, the AI 360°s and their depths as two texture arrays
 * (two texture units whatever their number), and a patch for the materials.
 */
export function createAiLayer(renderer: THREE.WebGLRenderer) {
  const uniforms = {
    aiCount: { value: 0 },
    aiMode: { value: 1 as number },
    aiCam: { value: new THREE.Vector3() },
    aiEye: { value: Array.from({ length: MAX }, () => new THREE.Vector3()) },
    aiFwd: { value: Array.from({ length: MAX }, () => new THREE.Vector2(0, -1)) },
    aiGain: { value: Array.from({ length: MAX }, () => new THREE.Vector3(1, 1, 1)) },
    aiPlainGain: { value: new THREE.Vector3(1, 1, 1) },
    aiPano: { value: null as THREE.DataArrayTexture | null },
    aiDepth: { value: null as THREE.DataArrayTexture | null },
  }
  // until the 360°s are in: one black layer each, never read (aiCount stays 0)
  const empty = () => {
    const t = new THREE.DataArrayTexture(new Uint8Array(4), 1, 1, 1)
    t.needsUpdate = true
    return t
  }
  uniforms.aiPano.value = empty()
  uniforms.aiDepth.value = empty()

  const patched = new WeakSet<THREE.Material>()
  /** Gives a material the layer (opaque ones only: glass shows what is behind it, painted or not). */
  const patch = (m: THREE.Material) => {
    if (patched.has(m) || m.transparent) return
    patched.add(m)
    const before = m.onBeforeCompile
    m.onBeforeCompile = (shader, r) => {
      before.call(m, shader, r)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vAiWorld;\nvoid main() {')
        .replace('#include <project_vertex>', VERTEX)
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${FRAGMENT_HEAD}\nvoid main() {`)
        .replace('#include <colorspace_fragment>', FRAGMENT_BODY)
    }
    const key = m.customProgramCacheKey.bind(m)
    m.customProgramCacheKey = () => `${key()}|roomia-ai`
    m.needsUpdate = true
  }

  /** Loads the AI 360°s and their depths; the layer shows once they are all in. */
  const load = async (base: string, projection: AiProjection, version: string, panoWidth = 4096) => {
    const views = projection.views.slice(0, MAX)
    const pw = panoWidth
    const ph = pw / 2
    const { width: dw, height: dh } = projection
    const pano = new Uint8Array(pw * ph * 4 * views.length)
    const depth = new Uint8Array(dw * dh * 4 * views.length)
    await Promise.all(
      views.map(async (v, k) => {
        const [p, d] = await Promise.all([
          pixels(`${base}/${v.ai}?v=${version}`, pw, ph),
          pixels(`${base}/${v.depth}?v=${version}`, dw, dh),
        ])
        pano.set(p, k * pw * ph * 4)
        depth.set(d, k * dw * dh * 4)
      }),
    )
    const pt = new THREE.DataArrayTexture(pano, pw, ph, views.length)
    pt.wrapS = THREE.RepeatWrapping
    pt.minFilter = THREE.LinearMipmapLinearFilter
    pt.magFilter = THREE.LinearFilter
    pt.generateMipmaps = true
    pt.anisotropy = renderer.capabilities.getMaxAnisotropy()
    pt.needsUpdate = true
    const dt = new THREE.DataArrayTexture(depth, dw, dh, views.length)
    dt.minFilter = THREE.NearestFilter
    dt.magFilter = THREE.NearestFilter
    dt.wrapS = THREE.RepeatWrapping
    dt.needsUpdate = true
    uniforms.aiPano.value?.dispose()
    uniforms.aiDepth.value?.dispose()
    uniforms.aiPano.value = pt
    uniforms.aiDepth.value = dt
    views.forEach((v, k) => {
      uniforms.aiEye.value[k].set(...v.eye)
      uniforms.aiFwd.value[k].set(v.target[0] - v.eye[0], v.target[2] - v.eye[2]).normalize()
    })
    if (projection.plainGain) uniforms.aiPlainGain.value.set(...projection.plainGain)
    uniforms.aiCount.value = views.length
    return views.length
  }

  return {
    patch,
    load,
    setMode: (mode: AiMode) => void (uniforms.aiMode.value = mode),
    setCamera: (p: THREE.Vector3) => void uniforms.aiCam.value.copy(p),
    dispose: () => {
      uniforms.aiPano.value?.dispose()
      uniforms.aiDepth.value?.dispose()
    },
  }
}
