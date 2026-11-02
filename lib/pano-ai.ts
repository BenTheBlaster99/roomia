import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { generatePhotoreal, isGatewayDown } from './photoreal'

/**
 * The photo-quality 360° made in one image edit (27 Oct, ChatGPT): six faces edited separately each decided
 * their own light, sun patches and wall lines, and no stitching could join them (Ecolodge, Restaurant). Here the
 * Blender panorama itself, with its real light, is edited once, so the whole room is decided together.
 */

const PYTHON = process.env.ROOMIA_PYTHON ?? 'python3'
/**
 * A Python with OpenCV for fitting the edit back onto the render (the upscaler's, see pano-upscale.ts). Without it
 * the edit is used as it comes, which only works while the image service keeps the framing.
 */
const VISION_PYTHON = process.env.ROOMIA_VISION_PYTHON ?? process.env.ROOMIA_UPSCALE_PYTHON ?? PYTHON
const exec = promisify(execFile)

/**
 * Sizes asked of the image service, largest first; one it refuses (instantly, unbilled) gives way to the next. At
 * 3072 px a 90° view held 768 pixels and looked soft in the viewer (ChatGPT, 28 Oct): 3840 is the model's largest side.
 * 16:9, not 2:1: since 28 Oct the service hands a 2:1 request back as a 16:9 picture inside black side bands, shrunk a
 * little differently each time. The panorama is sent squashed to 16:9 and stretched back, an exact round trip.
 */
const PANO_SIZES = ['3840x2160', '2048x1152']
/** The panorama's shape during the edit (16:9) against its own (2:1). */
const EDIT_ASPECT = 16 / 9

/**
 * A polished architectural render, not a photograph (28 Oct): asked for a "warm real-estate photograph", the model
 * relit the Cycles 360° golden and it read as an AI picture, less believable than the render itself (Aimen). The style
 * part is ChatGPT's; the opening and projection lines are what kept the model on the panorama's framing.
 */
export function panoPrompt(): string {
  return [
    'The supplied image is a Blender architectural visualization of a REAL interior design, shown as one continuous equirectangular 360-degree panorama',
    '(the whole room around the camera unrolled into a 2:1 image), not a conventional perspective photograph.',
    'This is an image-editing task: refine this existing render, do not generate a new room.',
    'Keep the equirectangular projection exactly: the same horizon line, the same curved wall-ceiling and wall-floor lines, the same position and size of everything in the image.',
    'The content fills the whole frame from edge to edge: no borders, no shrinking, zooming, cropping, straightening or re-projection.',
    'The image must stay 2:1 and cover the full 360 degrees. The top edge is the zenith, the bottom edge the nadir.',
    'TARGET STYLE: a high-quality, believable architectural CGI render with restrained photorealistic material detail, like a professionally produced architectural visualization.',
    'Not an AI-generated photograph, not an editorial or real-estate photo.',
    'PRESERVE: the exact layout, geometry, proportions and object positions; all doors, windows, furniture, mirrors and light fixtures;',
    "the source render's overall exposure, colour balance and lighting direction; existing shadow locations, wall-ceiling boundaries and floor geometry.",
    'ALLOWED: subtle refinement of material response and roughness; natural surface texture only where the source supports it;',
    'more convincing material depth and gentle light interaction; a cleaner, more polished render.',
    'LIGHTING: keep the same overall illumination and shadow structure as the source. Only fixtures already present in the source may emit light.',
    'DO NOT: add, remove, move or redesign anything; invent light fixtures, spotlights, LED strips, cove lights, windows or openings;',
    'add cinematic colour grading, warm or golden tint, dramatic sunlight, excessive contrast, glow, bloom, artificial depth of field or exaggerated texture.',
    'Mirrors stay mirrors reflecting this room, never windows. Glass keeps its tint.',
    'The left and right edges of the image are the same direction seen from both sides: they must continue each other seamlessly.',
  ].join(' ')
}

/**
 * prep <pano> <out.png> <aspect>: the panorama turned so its left/right edge falls on the plainest column (a bare wall,
 * not a window or a sofa), squashed to the edit's aspect at its full height; prints the shift in pixels.
 * finish <ai> <pano> <shift> <out.jpg>: the edit stretched back and fitted onto the render, its edges matched, turned
 * back; prints the size received and the checks (see PanoAiCheck).
 */
const PANO_AI_SCRIPT = String.raw`
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

if sys.argv[1] == "prep":
    pano = Image.open(sys.argv[2]).convert("RGB")
    W, H = pano.size
    small = np.asarray(pano.convert("L").resize((512, 256), Image.BILINEAR), np.float32)
    band = small[256 // 2 - 70: 256 // 2 + 70]
    energy = np.abs(ndimage.sobel(band, 1)) + np.abs(ndimage.sobel(band, 0))
    cols = energy.sum(0)
    window = np.convolve(np.concatenate([cols[-12:], cols, cols[:12]]), np.ones(25), "valid")
    seam = int(np.argmin(window))
    shift = seam * W // 512
    rolled = Image.fromarray(np.roll(np.asarray(pano), -shift, axis=1))
    # Squashed to the edit's shape (see PANO_SIZES); finish stretches it back.
    rolled.resize((round(H * float(sys.argv[4])), H), Image.LANCZOS).save(sys.argv[3])
    print(json.dumps({"shift": shift}))
else:
    ai, pano, shift, out = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5]
    # The render as the model saw it (turned), and the edit at the same size.
    src = np.roll(np.asarray(Image.open(pano).convert("RGB")), -shift, axis=1)
    H, W = src.shape[:2]
    got = Image.open(ai).convert("RGB")
    img = np.asarray(got.resize((W, H), Image.LANCZOS), np.float32)
    lum = lambda x: x.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    # A few black rows at the poles (the service's own margin): the nearest real row is repeated over them.
    # The stretch smears the margin into its first real rows: those are skipped too.
    rows = np.where(lum(img).mean(1) > 12)[0]
    if len(rows) and (rows[0] > 0 or rows[-1] < H - 1):
        top, bottom = (rows[0] + 4 if rows[0] > 0 else 0), (rows[-1] - 4 if rows[-1] < H - 1 else H - 1)
        img[:top] = img[top]
        img[bottom + 1:] = img[bottom]
    gs, ga = lum(src), lum(img)
    report = {"received": list(got.size)}

    # Drift: blocks of edges compared by phase correlation (poles and plain walls skipped), in pixels of the panorama.
    def edges(g):
        g = np.asarray(Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).resize((2048, 1024), Image.BILINEAR), np.float32)
        return ndimage.gaussian_filter(np.hypot(ndimage.sobel(g, 0), ndimage.sobel(g, 1)), 1.5)
    es = edges(gs)
    blocks = 0
    def drift(g):
        ea, B, moved = edges(g), 128, []
        win = np.outer(np.hanning(B), np.hanning(B))
        for y in range(B, 1024 - 2 * B + 1, B // 2):
            for x in range(0, 2048 - B + 1, B // 2):
                a, b = es[y:y + B, x:x + B], ea[y:y + B, x:x + B]
                if a.std() < 4 or b.std() < 4:
                    continue
                F = np.fft.fft2((a - a.mean()) * win) * np.conj(np.fft.fft2((b - b.mean()) * win))
                r = np.fft.ifft2(F / (np.abs(F) + 1e-6)).real
                if r.max() > 0.08:
                    dy, dx = np.unravel_index(np.argmax(r), r.shape)
                    moved.append(np.hypot((dx + B // 2) % B - B // 2, (dy + B // 2) % B - B // 2) * W / 2048)
        global blocks
        blocks = len(moved)
        # Fewer than 40 blocks with edges (a corridor of plain walls): the number says little.
        return (float(np.median(moved)), float(np.percentile(moved, 90))) if len(moved) >= 40 else (None, None)
    # 1. The edit moves the room by a few pixels; an affine fit on the middle of the picture (ECC) puts it back where
    #    the render has it, and is kept only if it brings the edges closer. Should the service add black side bands
    #    again (28 Oct, to a 2:1 request: a 16:9 picture shrunk to ~90%), they set the fit's starting point.
    cols = np.where(ga.mean(0) > 10)[0]
    x0, x1 = (int(cols[0]), int(cols[-1]) + 1) if len(cols) else (0, W)
    report["bands"] = int(W - (x1 - x0))
    try:
        import cv2
        f = 4
        s4 = cv2.resize(gs, (W // f, H // f), interpolation=cv2.INTER_AREA)
        a4 = cv2.resize(ga, (W // f, H // f), interpolation=cv2.INTER_AREA)
        m = np.zeros(s4.shape, np.uint8)
        m[s4.shape[0] // 6: -s4.shape[0] // 6, 40: -40] = 1
        w = np.eye(2, 3, dtype=np.float32)
        w[0, 0], w[0, 2] = (x1 - x0) / W, x0 / f
        try:
            _, w = cv2.findTransformECC(s4, a4, w, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), m, 5)
        except cv2.error:
            pass  # the pillarbox guess alone
        w[:, 2] *= f
        fitted = cv2.warpAffine(img, w, (W, H), flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        # The fit is kept only if it brings the edges closer: on an edit without bands it once sheared the room
        # (Ecolodge Point 4, 28 Oct: 18 px of drift).
        before, after = drift(ga), drift(lum(fitted))
        if report["bands"] or (after[0] is not None and (before[0] is None or after[0] < before[0])):
            img, ga = fitted, lum(fitted)
            report["fit"] = [[round(float(v), 4) for v in r] for r in w]
        else:
            report["fit"] = None
    except ImportError:
        report["fit"] = None
    # 2. The edit's left and right edges meet badly: the model does not match them (a line down the ceiling, Ecolodge
    #    Point 4, 27 Oct), and the fitted shrink is least exact there (a line and a bent wall, 28 Oct). Around the edge,
    #    which prep put on the plainest wall, the edit fades into the render, which is whole all the way round.
    #    There the render gives only its fine detail; the colour comes from the edit, bridged across the edge from both
    #    sides with the edit's own edge columns left out. Matching the render's tone row by row left its local colour
    #    (a warmer wall by a window) as a stripe (Point 1).
    band = W * 4 // 100
    x = np.arange(W, dtype=np.float32)
    t = np.clip((np.minimum(x, W - 1 - x) - band * 0.2) / band, 0, 1)
    keep = (t * t * (3 - 2 * t))[None, :, None]
    sig = (band / 2, band / 2, 0)
    modes = ["nearest", "wrap", "nearest"]
    low = lambda a: ndimage.gaussian_filter(a, sig, mode=modes)
    trust = keep[0, :, 0][None, :, None] * np.ones((H, 1, 1), np.float32)
    colour = low(img * trust) / np.maximum(low(trust), 1e-3)
    detail = src.astype(np.float32) - low(src.astype(np.float32))
    img = np.clip((colour + detail) * (1 - keep) + img * keep + 0.5, 0, 255).astype(np.uint8)
    # 3. Drift left after the fit.
    d50, d90 = drift(lum(img))
    report["drift"] = round(d50, 1) if d50 is not None else None
    report["driftP90"] = round(d90, 1) if d90 is not None else None
    report["blocks"] = blocks
    # 4. Light the render does not have (ChatGPT, 28 Oct): compact spots bright in the edit where the render is not
    #    bright, away from the poles. A warning for the reviewer, not a verdict (a sunlit wall can do it too).
    ss = np.asarray(Image.fromarray(gs.astype(np.uint8)).resize((512, 256), Image.BILINEAR), np.float32)
    sa = np.asarray(Image.fromarray(lum(img).astype(np.uint8)).resize((512, 256), Image.BILINEAR), np.float32)
    new = (sa > 215) & (ss < 160) & (sa > ss * 1.5)
    new[:20], new[-20:] = False, False
    labels, n = ndimage.label(ndimage.binary_opening(new))
    spots = []
    for k in range(1, n + 1):
        ys, xs = np.nonzero(labels == k)
        if 3 <= len(ys) <= 1500:
            # Where to look: degrees from the panorama's middle (+ right) and above the horizon.
            spots.append([round(((xs.mean() * W / 512 + shift) % W / W - 0.5) * 360), round(90 - ys.mean() / 256 * 180)])
    report["lights"] = spots[:12]
    Image.fromarray(np.roll(img, shift, axis=1)).save(out, quality=90, optimize=True, progressive=True)
    print(json.dumps(report))
`

/** What the automatic checks found on an AI 360° (finish step above), shown to the reviewer. */
export interface PanoAiCheck {
  /** Width of the black side bands the service added, in pixels of the panorama (fitted away when OpenCV is there). */
  bands: number
  /** The affine fit that put the edit back onto the render, or null without OpenCV. */
  fit: number[][] | null
  /** Median and 90th-percentile distance (px of the 4096 px panorama) between the edit's edges and the render's; null
   *  when too few parts of the picture have edges to compare (blocks under 40). */
  drift: number | null
  driftP90: number | null
  blocks?: number
  /** Compact spots lit in the edit and not in the render: [degrees right of the start, degrees up]. */
  lights: [number, number][]
}

export interface PanoAiResult {
  seconds: number
  /** The size asked for, and the one the service actually sent back. */
  size: string
  received: [number, number]
  quality: string
  shift: number
  check: PanoAiCheck
}

/** Edits the Blender panorama `pano` into a photo-quality panorama written to `out` (one paid image). */
export async function enhancePanorama(pano: string, out: string, prompt = panoPrompt()): Promise<PanoAiResult> {
  const work = await mkdtemp(path.join(tmpdir(), 'roomia-pano-ai-'))
  try {
    const script = path.join(work, 'pano_ai.py')
    await writeFile(script, PANO_AI_SCRIPT)
    const input = path.join(work, 'input.png')
    const { shift } = JSON.parse((await exec(PYTHON, [script, 'prep', pano, input, String(EDIT_ASPECT)])).stdout) as { shift: number }
    const image = await readFile(input)
    let lastError: unknown
    for (const size of PANO_SIZES) {
      try {
        // The panorama goes at its full size (it was reduced to 2048 px, the photos' limit, and lost detail).
        const photo = await generatePhotoreal(image, prompt, { size, maxInput: 4096 })
        // The service's own picture is kept beside the result (raw/), so a better finish can be applied later for free.
        const edited = path.join(path.dirname(out), 'raw', `${path.basename(out, '.jpg')}-raw-${shift}.jpg`)
        await mkdir(path.dirname(edited), { recursive: true })
        await writeFile(edited, Buffer.from(photo.base64, 'base64'))
        const finished = await exec(VISION_PYTHON, [script, 'finish', edited, pano, String(shift), out], { maxBuffer: 1 << 20 })
        const { received, ...check } = JSON.parse(finished.stdout) as PanoAiCheck & { received: [number, number] }
        return { seconds: photo.seconds, size: photo.size, received, quality: photo.quality, shift, check }
      } catch (err) {
        // Only a refused size moves on to the next one; anything else may have been billed.
        if ((err as { status?: number }).status !== 400 || !/size/i.test(String((err as Error).message))) throw err
        console.warn(`pano-ai: size ${size} refused, trying the next one`)
        lastError = err
      }
    }
    throw lastError
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * The photo-quality 360° from six photos (2 Nov). The whole panorama in one edit (above) came back as soft as a
 * 3840 px picture of the full sphere, about 4 px per degree: lattices turned to blotches and chair legs melted, and the
 * 8192 px enlarger then sharpened that mush (Aimen: "AI slop", the Cycles render looked better). Six 100° faces cut from
 * the Cycles panorama are edited as ordinary photos at 1024 px (10 px per degree, the model's own detail), then each is
 * locked back onto the render before they are joined:
 * - geometry: a dense flow from the render to the edit, smoothed and capped at 24 px, pulls the edit's detail onto the
 *   model's edges (the model moves things 1-20 px);
 * - light: the edit's low frequencies are replaced by the render's, so every face carries the same light and colour and
 *   no face can invent its own sun patch or glow (the six-face method of 24-27 Oct failed on that);
 * - joins: graph-cut seams through the overlaps (where both faces agree, e.g. along stone joints) and multi-band blending,
 *   so detail is never cross-faded (two different stone patterns would show double).
 * No enlarger afterwards. Six images per point (Restaurant: 9 points, 54 images).
 */
export function panoFacePrompt(): string {
  return [
    'Image 1 is a 3D render of a REAL interior design made by a professional designer for a client.',
    'It is one face of a 360° panorama of the room; the faces next to it are made separately and must join seamlessly.',
    'Make it look like a real photograph of exactly that room. This is a faithful render, not a redesign: the client must recognise every element of the design.',
    'FRAMING: keep exactly the same camera, field of view and framing as the render. Do not crop, zoom, reframe or change the perspective.',
    'Everything visible at the edges stays visible, at the same place.',
    'GEOMETRY: keep every wall, ceiling, window, opening, furniture piece, light fitting, decorative screen, object and plant exactly where it is,',
    'with the same shape and size. Add nothing, remove nothing. A plain wall stays a plain wall. Lattices, screens and patterns keep their exact pattern.',
    'MATERIALS: keep every material and colour exactly as in the render: same wood tone, same stone and its exact pattern of pieces and joints,',
    'same fabrics, same wall paint. Light may change how bright a surface looks, never its own colour or material.',
    "LIGHT: keep the render's lighting exactly: the same lamps and the same daylight from the windows, the same direction, brightness and colour everywhere. Do not relight the room.",
    'Only add photographic realism to the existing surfaces: fine natural texture, natural reflectance, soft contact shadows under furniture, gentle natural bounce light.',
    'MIRRORS: a mirror reflects the room in front of it and stays a mirror, never a window. GLASS keeps its tint; through clear glass only a soft, plain outdoor background.',
    'FORBIDDEN: invented sunbeams or light shafts, sun patches, window-shaped light on walls or floor, new lamps, LED strips or cove lights,',
    'lens flare, haze, vignetting, depth-of-field blur, colour grading or golden tint. The whole picture stays sharp.',
    'Style: professional architectural interior photograph, natural exposure, true-to-life colours.',
  ].join(' ')
}

const FACE_NAMES = ['front', 'right', 'back', 'left', 'up', 'down'] as const
/** Pixels and field of view of each face (100°: 10° of overlap on every side for the seams). */
const FACE_PX = 1024
const FACE_FOV = 100

/**
 * cut <pano> <dir>: the six faces as <name>-render.png + faces.json (centre column of the panorama = forward).
 * stitch <dir> <pano> <out.jpg>: <name>-ai.jpg locked onto <name>-render.png, joined into the panorama; prints JSON.
 */
const FACES_SCRIPT = String.raw`
import json, sys
import numpy as np, cv2
from PIL import Image

FACES = [("front", 0, 0), ("right", 90, 0), ("back", 180, 0), ("left", 270, 0), ("up", 0, 90), ("down", 0, -90)]

def basis(yaw, pitch):
    y, p = np.radians(yaw), np.radians(pitch)
    f = np.array([np.cos(p) * np.sin(y), np.sin(p), np.cos(p) * np.cos(y)])
    up = np.array([0, 0, 1.0 if pitch > 0 else -1.0]) if abs(pitch) >= 89 else np.array([0, 1.0, 0])
    r = np.cross(up, f); r /= np.linalg.norm(r)
    return f, r, np.cross(f, r)

def lin(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).astype(np.float32)

def srgb(a):
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055).astype(np.float32)

def blur(a, s):
    return cv2.GaussianBlur(a, (0, 0), s)

if sys.argv[1] == "cut":
    pano = np.asarray(Image.open(sys.argv[2]).convert("RGB"))
    d, n, fov = sys.argv[3], int(sys.argv[4]), float(sys.argv[5])
    H, W = pano.shape[:2]
    t = np.tan(np.radians(fov / 2))
    xs = ((np.arange(n) + 0.5) / n * 2 - 1) * t
    X, Y = np.meshgrid(xs, -xs)
    meta = []
    for name, yaw, pitch in FACES:
        f, r, u = basis(yaw, pitch)
        ray = f + X[..., None] * r + Y[..., None] * u
        ray /= np.linalg.norm(ray, axis=-1, keepdims=True)
        lon = np.arctan2(ray[..., 0], ray[..., 2]); lat = np.arcsin(np.clip(ray[..., 1], -1, 1))
        mx = (lon / (2 * np.pi) + 0.5) * W - 0.5; my = (0.5 - lat / np.pi) * H - 0.5
        img = cv2.remap(pano, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
        Image.fromarray(img).save(d + "/" + name + "-render.png")
        meta.append({"name": name, "f": f.tolist(), "r": r.tolist(), "u": u.tolist()})
    json.dump({"fov": fov, "size": n, "faces": meta}, open(d + "/faces.json", "w"))
    sys.exit(0)

d, panof, outf = sys.argv[2], sys.argv[3], sys.argv[4]
sigma = 20
meta = json.load(open(d + "/faces.json"))
N, fov = meta["size"], meta["fov"]
t = np.tan(np.radians(fov / 2))
H, W = Image.open(panof).size[::-1]
report = []

def lock(name):
    B = np.asarray(Image.open(d + "/" + name + "-render.png").convert("RGB")).astype(np.float32)
    A = np.asarray(Image.open(d + "/" + name + "-ai.jpg").convert("RGB").resize((N, N), Image.LANCZOS)).astype(np.float32)
    gb = cv2.cvtColor(B.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    ga = cv2.cvtColor(A.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    ga = ga * (blur(gb, 25) + 1) / (blur(ga, 25) + 1)
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(
        np.clip(gb, 0, 255).astype(np.uint8), np.clip(ga, 0, 255).astype(np.uint8), None)
    flow = np.stack([blur(flow[..., 0], 6), blur(flow[..., 1], 6)], -1)
    mag = np.linalg.norm(flow, axis=-1)
    flow *= np.minimum(1, 24 / np.maximum(mag, 1e-6))[..., None]
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    Aw = cv2.remap(lin(A), xx + flow[..., 0], yy + flow[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    Bl = lin(B)
    ratio = (blur(Bl, sigma) + 1e-4) / (blur(Aw, sigma) + 1e-4)
    report.append({"face": name, "flow": round(float(np.median(mag)), 1), "flowP95": round(float(np.percentile(mag, 95)), 1),
                   "light": [round(float(x), 2) for x in np.median(ratio.reshape(-1, 3), 0)]})
    return np.clip(Aw * np.clip(ratio, 0.4, 2.5), 0, 1)

def project(img, f, w, h):
    lon = ((np.arange(w) + 0.5) / w - 0.5) * 2 * np.pi
    lat = (0.5 - (np.arange(h) + 0.5) / h) * np.pi
    LON, LAT = np.meshgrid(lon, lat)
    D = np.stack([np.cos(LAT) * np.sin(LON), np.sin(LAT), np.cos(LAT) * np.cos(LON)], -1).astype(np.float32)
    F, R, U = (np.array(f[k], np.float32) for k in ("f", "r", "u"))
    z = D @ F
    x = (D @ R) / np.maximum(z, 1e-6) / t; y = (D @ U) / np.maximum(z, 1e-6) / t
    ok = (z > 0) & (np.abs(x) < 0.995) & (np.abs(y) < 0.995)
    mx = ((x + 1) / 2 * N - 0.5).astype(np.float32); my = ((1 - y) / 2 * N - 0.5).astype(np.float32)
    return cv2.remap(img, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), (ok * 255).astype(np.uint8)

faces = [(f, lock(f["name"])) for f in meta["faces"]]
small = [project(img, f, 1024, 512) for f, img in faces]
masks = cv2.detail_GraphCutSeamFinder("COST_COLOR_GRAD").find(
    [cv2.UMat(srgb(s)) for s, _ in small], [(0, 0)] * len(small), [cv2.UMat(m) for _, m in small])
blender = cv2.detail_MultiBandBlender(0, 6)
blender.prepare((0, 0, W, H))
for (f, img), m in zip(faces, masks):
    full, ok = project(img, f, W, H)
    seam = cv2.dilate(cv2.resize(m.get(), (W, H), interpolation=cv2.INTER_LINEAR), np.ones((3, 3), np.uint8))
    blender.feed((srgb(full) * 255).astype(np.int16), cv2.bitwise_and(seam, ok), (0, 0))
res, rmask = blender.blend(None, None)
Image.fromarray(np.clip(res, 0, 255).astype(np.uint8)).save(outf, quality=93)
print(json.dumps({"faces": report, "uncovered": int((rmask == 0).sum())}))
`

export interface PanoFacesResult {
  seconds: number
  /** Images bought (6, more when a face had to be asked again after a slow failure). */
  images: number
  faces: { face: string; flow: number; flowP95: number; light: number[] }[]
}

type Slot = <T>(job: () => Promise<T>) => Promise<T>

/**
 * The photo-quality 360° of the Cycles panorama `pano`, written to `out`, from six edited faces (see panoFacePrompt).
 * Each face request goes through `aiSlot` (the tour's global limit), the joining through `stitchSlot` (about 2 GB of
 * memory and 1-2 min of CPU each). The six edits are kept in tour/raw/ to join again later for free.
 */
export async function enhancePanoramaFaces(pano: string, out: string, aiSlot: Slot, stitchSlot: Slot, prompt = panoFacePrompt()): Promise<PanoFacesResult> {
  const work = await mkdtemp(path.join(tmpdir(), 'roomia-pano-faces-'))
  try {
    const script = path.join(work, 'faces.py')
    await writeFile(script, FACES_SCRIPT)
    await exec(VISION_PYTHON, [script, 'cut', pano, work, String(FACE_PX), String(FACE_FOV)], { timeout: 120_000 })
    const raw = path.join(path.dirname(out), 'raw')
    await mkdir(raw, { recursive: true })
    let images = 0
    let seconds = 0
    await Promise.all(
      FACE_NAMES.map(name =>
        aiSlot(async () => {
          const image = await readFile(path.join(work, `${name}-render.png`))
          let photo: Awaited<ReturnType<typeof generatePhotoreal>> | undefined
          for (let attempt = 0; !photo; attempt++) {
            const t = performance.now()
            try {
              photo = await generatePhotoreal(image, prompt)
            } catch (err) {
              // Asked again only when it failed fast with a connection or server error: not processed, so not paid for.
              if (attempt > 0 || !isGatewayDown(err) || performance.now() - t > 15_000) throw err
            }
          }
          images += 1
          seconds = Math.max(seconds, photo.seconds)
          const buffer = Buffer.from(photo.base64, 'base64')
          await writeFile(path.join(work, `${name}-ai.jpg`), buffer)
          await writeFile(path.join(raw, `${path.basename(out, '.jpg')}-${name}.jpg`), buffer)
        }),
      ),
    )
    const joined = await stitchSlot(() => exec(VISION_PYTHON, [script, 'stitch', work, pano, out], { timeout: 600_000, maxBuffer: 1 << 20 }))
    const { faces } = JSON.parse(joined.stdout) as { faces: PanoFacesResult['faces'] }
    return { seconds, images, faces }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
