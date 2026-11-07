/**
 * Splat capture: the Visite libre at Cycles quality (experiment, 6 Nov).
 *
 * The tour build's Blender script prepares the scene exactly as for the Cycles 360° (lights, sky, slab, sheets apart),
 * then, instead of the panoramas, SPLAT_CAPTURE_PY renders the apartment from many walking spots: a 50 cm grid of the
 * floor a person can reach from the tour's points (through doors, never through walls), at eye heights 1.35-1.75 m,
 * 8 views each, plus 14 views at each tour point. Every view is saved in true light (linear EXR); then all are encoded
 * with ONE log curve for the trainer (8-bit, dithered), so a dark corridor and a sunny room keep their real ratio and
 * the walk adapts its exposure like an eye. Cameras are written in the walk's own glTF coordinates (Nerfstudio
 * transforms.json), with points sampled on the model's surfaces to start the training from.
 *
 * Out: <scene>/splat/capture/{images/*.png, transforms.json, points.ply, encoding.json, capture.json}
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BLENDER } from './blender-render'
import { TOUR_SCRIPT, tourDir, tourSceneSpec } from './scene-tour'
import { readCameras, sceneDir } from './scene-store'

export const splatDir = (sceneId: string) => path.join(sceneDir(sceneId), 'splat')

export interface SplatCaptureOptions {
  /** grid step between walking spots, metres */
  step?: number
  /** most walking spots kept (spread evenly when there are more) */
  maxPositions?: number
  /** views per walking spot around the horizon (plus one down, one up) */
  yaws?: number
  /** square image size */
  size?: number
  fov?: number
  samples?: number
  /** 'panos' (v2): the 360°s themselves with their depth, for scripts/splat_train.py; 'pano': one Cycles 360° per spot,
   * views cut from it; 'views': each view rendered */
  mode?: 'panos' | 'pano' | 'views'
  /** v2: mirrors and glass seen through by the camera (the walk draws them) */
  seeThrough?: boolean
  /** investigations: render the test views only, into splat/<outName> (mirrorOnly: the mirror views alone) */
  testsOnly?: boolean
  /** the walk model's texture size (default 2048, 1024 for a very big model) */
  textureSize?: number
  /** keep the renders a stopped capture left (same scene, same settings) */
  resume?: boolean
  mirrorOnly?: boolean
  outName?: string
  /** v2: real Cycles test views from places with no panorama (not part of the capture's time) */
  tests?: number
  testSize?: number
  testSamples?: number
  denoiser?: 'OPENIMAGEDENOISE' | 'OPTIX'
  noise?: number
  panoWidth?: number
  /** points sampled on surfaces to start the training */
  initPoints?: number
  /** grid steps around the walkable floor where spots over furniture are added */
  hover?: number
  /** a walking spot needs a ceiling within this many metres (indoors only) */
  ceilingWithin?: number
  /** relief from each big surface's own texture (0 = none, ~0.1-0.2 subtle) */
  bump?: number
  bumpArea?: number
  bumpDistance?: number
  /** a look recipe (scripts/look_apply.py): file, scripts dir, and each look as {light group: [r, g, b] weight} */
  recipe?: { file: string; scriptsDir: string; looks: Record<string, Record<string, number[]>> }
}

export const SPLAT_CAPTURE_PY = String.raw`
# Runs inside TOUR_SCRIPT (exec), the scene ready for Cycles: scene, cam, cam_data, ray, aim, all_eyes, GPU_KIND...
import json, math, os, random, sys, time
import numpy as np
import OpenImageIO as oiio
from mathutils import Vector, Matrix

SP = spec["splat"]
OUT = SP["outDir"]
os.makedirs(os.path.join(OUT, "exr"), exist_ok=True)
os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
t_cap = time.time()
# A look recipe (7 Nov, scripts/look_apply.py): the stills' sun, sky, fixtures and finishes, every emitter in a light
# group; each look (golden hour, day) is a weighted sum of the groups, made and denoised per panorama by the compositor
LOOK = SP.get("recipe")
if LOOK:
    sys.path.insert(0, LOOK["scriptsDir"])
    from look_grade import kelvin_rgb as _kr
    _ns = {"scene": scene, "vl": scene.view_layers[0], "R": json.load(open(LOOK["file"])), "LOOK_BAKE_HSV": True, "kelvin_rgb": _kr}
    exec(open(os.path.join(LOOK["scriptsDir"], "look_apply.py")).read(), _ns)
    print("SPLAT_INFO look recipe: %d light groups, looks %s" % (len(_ns["GROUPS"]), ", ".join(LOOK["looks"])), flush=True)
    print("SPLAT_TIME recipe %.1f" % (time.time() - t_cap), flush=True)
depsgraph = bpy.context.evaluated_depsgraph_get()
STEP = float(SP.get("step", 0.5))
EYE = 1.6

def floor_under(x, y, z_eye):
    h = ray(Vector((x, y, z_eye)), (0, 0, -1))
    if h is None:
        return None
    d = z_eye - h.z
    return h.z if EYE - 0.35 <= d <= EYE + 0.35 else None

def indoors(p):
    # a ceiling within 5 m: the walk stays inside (6 Nov, Bloc B F2: the grid had gone out through the balcony and
    # spent a third of the spots on the ground around the building)
    h = ray(p, (0, 0, 1))
    return h is not None and h.z - p.z < float(SP.get("ceilingWithin", 5.0))

def clearance(p, r):
    for k in range(8):
        a = k * math.pi / 4
        h = ray(p, (math.cos(a), math.sin(a), 0.0))
        if h is not None and (h - p).length < r:
            return False
    return True

seeds = [Vector(e) for e in all_eyes]
seed_floor = []
for e in seeds:
    h = ray(e, (0, 0, -1))
    seed_floor.append(h.z if h is not None else e.z - EYE)
sx = [e.x for e in seeds]
sy = [e.y for e in seeds]
BOUND = (min(sx) - 3.0, max(sx) + 3.0, min(sy) - 3.0, max(sy) + 3.0)
ox, oy = seeds[0].x, seeds[0].y

nodes = {}
outside = {}
queue = []
for e, f in zip(seeds, seed_floor):
    i, j = round((e.x - ox) / STEP), round((e.y - oy) / STEP)
    for di, dj in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        k = (i + di, j + dj)
        if k in nodes:
            break
        x, y = ox + k[0] * STEP, oy + k[1] * STEP
        fz = floor_under(x, y, f + EYE)
        if fz is None:
            continue
        p = Vector((x, y, fz + EYE))
        if clearance(p, 0.3) and indoors(p):
            nodes[k] = fz
            queue.append(k)
            break
while queue:
    k = queue.pop()
    fz = nodes[k]
    p = Vector((ox + k[0] * STEP, oy + k[1] * STEP, fz + EYE))
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = (k[0] + di, k[1] + dj)
        if n in nodes:
            continue
        x, y = ox + n[0] * STEP, oy + n[1] * STEP
        if not (BOUND[0] <= x <= BOUND[1] and BOUND[2] <= y <= BOUND[3]):
            continue
        h = ray(p, (di, dj, 0.0))
        if h is not None and (h - p).length < STEP + 0.3:
            continue
        nz = floor_under(x, y, fz + EYE)
        if nz is None:
            continue
        q = Vector((x, y, nz + EYE))
        if not clearance(q, 0.3):
            continue
        # a spot needs a ceiling (the grid went round the building on 6 Nov), except just outside a glass door: up to
        # OUT steps past an indoor spot (a balcony), so what is seen through the glass is captured (7 Nov, F5)
        o_ = 0 if indoors(q) else outside.get(k, 0) + 1
        if o_ > int(SP.get("outsideSteps", 2)):
            continue
        outside[n] = o_
        nodes[n] = nz
        queue.append(n)
walk_spots = [Vector((ox + k[0] * STEP, oy + k[1] * STEP, fz)) for k, fz in nodes.items()]
n_out = sum(1 for v in outside.values() if v > 0)
print("SPLAT_TIME walk spots %.1f (%d, %d just outside)" % (time.time() - t_cap, len(walk_spots), n_out), flush=True)
# Spots over furniture next to the walkable floor (6 Nov, Bloc B F2: beds left whole bedrooms almost unseen). The
# training needs views from there, not a place to stand: eye height over the neighbour's floor, a real ceiling
# above (not the inside of a cupboard), clear around, and in sight of the walkable spot.
HOVER = int(SP.get("hover", 2))
# a big apartment: the nearest ring only (on F5, 334 spots, the 5 x 5 rings cost most of an 80 s placement)
if len(nodes) > int(SP.get("hoverBigOver", 200)):
    HOVER = min(HOVER, 1)
hover = {}
for k, fz in nodes.items():
    q = Vector((ox + k[0] * STEP, oy + k[1] * STEP, fz + EYE))
    for di in range(-HOVER, HOVER + 1):
        for dj in range(-HOVER, HOVER + 1):
            n = (k[0] + di, k[1] + dj)
            if n in nodes or n in hover:
                continue
            p = Vector((ox + n[0] * STEP, oy + n[1] * STEP, fz + EYE))
            if not (BOUND[0] <= p.x <= BOUND[1] and BOUND[2] <= p.y <= BOUND[3]):
                continue
            up = ray(p, (0, 0, 1))
            if up is None or up.z - fz < 2.2 or up.z - p.z > float(SP.get("ceilingWithin", 5.0)):
                continue
            down = ray(p, (0, 0, -1))
            if down is None or p.z - down.z > EYE + 0.5 or p.z - down.z < 0.25:
                continue
            if not clearance(p, 0.25):
                continue
            d = p - q
            hit = ray(q, d.normalized())
            if hit is not None and (hit - q).length < d.length + 0.05:
                continue
            hover[n] = fz
hover_spots = [Vector((ox + k[0] * STEP, oy + k[1] * STEP, fz)) for k, fz in hover.items()]
spots = walk_spots + hover_spots
print("SPLAT_INFO %d walkable spots + %d over furniture (step %.2f m) from %d tour points" % (len(walk_spots), len(hover_spots), STEP, len(seeds)), flush=True)
MAXP = int(SP.get("maxPositions", 150))
if len(spots) > MAXP:
    # farthest-point sampling, starting from the tour points: even cover of the whole apartment
    pts = np.array([[s.x, s.y] for s in spots])
    d = np.full(len(pts), 1e9)
    for e in seeds:
        d = np.minimum(d, np.hypot(pts[:, 0] - e.x, pts[:, 1] - e.y))
    keep = []
    for _ in range(MAXP):
        k = int(np.argmax(d))
        keep.append(k)
        d = np.minimum(d, np.hypot(pts[:, 0] - pts[k, 0], pts[:, 1] - pts[k, 1]))
    rest = [spots[k] for k in range(len(spots)) if k not in set(keep)]
    spots = [spots[k] for k in keep]
    EXTRA = int(SP.get("extraComplex", 0))
    if EXTRA and rest:
        # 7 Nov (ChatGPT's investigation 2): a few more spots only where the model is finely shaped (slats, folds,
        # furniture), counted as small triangles within a metre
        cells = {}
        for ob in scene.objects:
            if ob.type != "MESH" or ob.hide_render or ob.name.startswith("roomia_"):
                continue
            me = ob.data
            if len(me.polygons) < 50:
                continue
            ar = np.empty(len(me.polygons), np.float32)
            me.polygons.foreach_get("area", ar)
            ce = np.empty(len(me.polygons) * 3, np.float32)
            me.polygons.foreach_get("center", ce)
            ce = ce.reshape(-1, 3)
            mw = np.array(ob.matrix_world, np.float32)
            sc_ = abs(np.linalg.det(mw[:3, :3])) ** (2 / 3)
            small_ = (ar * sc_ < 0.004)
            if not small_.any():
                continue
            cw = ce[small_] @ mw[:3, :3].T + mw[:3, 3]
            for cx, cy in np.floor(cw[:, :2] / 0.5).astype(np.int64):
                cells[(cx, cy)] = cells.get((cx, cy), 0) + 1
        def complexity(v):
            cx, cy = int(math.floor(v.x / 0.5)), int(math.floor(v.y / 0.5))
            return sum(cells.get((cx + i, cy + j), 0) for i in (-2, -1, 0, 1, 2) for j in (-2, -1, 0, 1, 2))
        rest.sort(key=complexity, reverse=True)
        extra_spots = rest[:EXTRA]
        spots += extra_spots
        print("SPLAT_INFO %d extra spots where the model is finely shaped (%s small triangles nearby)" % (len(extra_spots), ", ".join(str(complexity(v)) for v in extra_spots[:8])), flush=True)

rng = random.Random(7)
YAWS = int(SP.get("yaws", 6))
shots = []  # (eye, yaw, pitch, kind)
for e in seeds:
    for k in range(4):
        shots.append((Vector(e), k * math.pi / 2, 0.0, "stop"))
    shots.append((Vector(e), 0.0, math.radians(-80), "stop"))
    shots.append((Vector(e), 0.0, math.radians(80), "stop"))
    for k in range(4):
        shots.append((Vector(e), math.pi / 4 + k * math.pi / 2, math.radians(-35), "stop"))
        shots.append((Vector(e), math.pi / 4 + k * math.pi / 2, math.radians(35), "stop"))
for s in spots:
    eye = Vector((s.x + rng.uniform(-0.1, 0.1), s.y + rng.uniform(-0.1, 0.1), s.z + rng.uniform(1.35, 1.75)))
    base = rng.uniform(0, 2 * math.pi)
    for k in range(YAWS):
        shots.append((eye, base + k * 2 * math.pi / YAWS, math.radians(rng.uniform(-18, 6)), "walk"))
    shots.append((eye, rng.uniform(0, 2 * math.pi), math.radians(rng.uniform(-65, -45)), "walk"))
    shots.append((eye, rng.uniform(0, 2 * math.pi), math.radians(rng.uniform(40, 60)), "walk"))
print("SPLAT_INFO %d views: %d at tour points, %d at %d walking spots" % (len(shots), 14 * len(seeds), len(shots) - 14 * len(seeds), len(spots)), flush=True)
print("SPLAT_TIME placement %.1f" % (time.time() - t_cap), flush=True)

# Relief on the big textured surfaces (6 Nov): SketchUp materials have none, so plaster, wood and woven finishes
# look printed. Each gets a bump from its own texture (fine detail only), the same on every view. Pictures, books
# and small objects are left alone: only materials covering more than BUMP_AREA m², never glass or metal.
BUMP = float(SP.get("bump", 0.0))
if BUMP > 0:
    mat_area = {}
    for ob in scene.objects:
        if ob.type != "MESH" or ob.hide_render:
            continue
        sc = ob.matrix_world.to_3x3().determinant() ** (2 / 3) if ob.matrix_world.to_3x3().determinant() > 0 else 1.0
        for poly in ob.data.polygons:
            if poly.material_index < len(ob.material_slots):
                m = ob.material_slots[poly.material_index].material
                if m is not None:
                    mat_area[m.name] = mat_area.get(m.name, 0.0) + poly.area * sc
    bumped = []
    for m in bpy.data.materials:
        if mat_area.get(m.name, 0.0) < float(SP.get("bumpArea", 2.0)) or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None or bsdf.inputs["Normal"].is_linked:
            continue
        if bsdf.inputs["Metallic"].default_value > 0.5 or bsdf.inputs["Transmission Weight"].default_value > 0.3 or bsdf.inputs["Alpha"].default_value < 0.9:
            continue
        link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Base Color"]), None)
        tex = link.from_node if link else None
        # through a mix/multiply of the SketchUp colour: find the image
        hops = 0
        while tex is not None and tex.type != "TEX_IMAGE" and hops < 4:
            tex = next((l.from_node for l in nt.links if l.to_node == tex and l.from_node.type in ("TEX_IMAGE", "MIX", "MIX_RGB", "MATH", "VECT_MATH", "SEPARATE_COLOR", "COMBINE_COLOR", "CURVE_RGB", "HUE_SAT", "BRIGHTCONTRAST", "GAMMA", "INVERT")), None)
            hops += 1
        if tex is None or tex.type != "TEX_IMAGE" or tex.image is None:
            continue
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = BUMP
        bump.inputs["Distance"].default_value = float(SP.get("bumpDistance", 0.002))
        nt.links.new(tex.outputs["Color"], bw.inputs[0])
        nt.links.new(bw.outputs[0], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        bumped.append("%s (%.0f m²)" % (m.name, mat_area[m.name]))
    print("SPLAT_INFO bump %.2f on %d materials: %s" % (BUMP, len(bumped), ", ".join(bumped[:12])), flush=True)

SIZE = int(SP.get("size", 768))

def read_exr_any(p):
    inp = oiio.ImageInput.open(p)
    sp_ = inp.spec()
    px = inp.read_image(0, 0, 0, 3, "float").reshape(sp_.height, sp_.width, 3)
    inp.close()
    return np.nan_to_num(px, nan=0.0, posinf=0.0)
FOV = float(SP.get("fov", 90.0))
cam_data.type = "PERSP"
cam_data.sensor_fit = "VERTICAL"
cam_data.angle = math.radians(FOV)
cam_data.clip_start = 0.05
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.cycles.samples = int(SP.get("samples", 64))
scene.cycles.adaptive_threshold = float(SP.get("noise", 0.02))
scene.cycles.denoiser = "OPTIX" if GPU_KIND in ("OPTIX", "CUDA") else "OPENIMAGEDENOISE"
scene.view_settings.view_transform = "Standard"
scene.view_settings.exposure = 0.0
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_depth = "16"
scene.render.image_settings.exr_codec = "ZIP"
scene.render.use_persistent_data = True
if dome is not None:
    dome.visible_diffuse = False
    dome.visible_volume_scatter = False

G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender Z-up -> glTF Y-up
fl = SIZE / 2 / math.tan(math.radians(FOV) / 2)

def c2w(eye, yaw, pitch):
    # the same frame as aim(): columns right, up, back
    f = Vector((math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)))
    r = f.cross(Vector((0, 0, 1))).normalized()
    u = r.cross(f).normalized()
    m = Matrix((r, u, -f)).transposed().to_4x4()
    m.translation = eye
    return m

def write_exr(path, px):
    o = oiio.ImageOutput.create(path)
    spec_ = oiio.ImageSpec(px.shape[1], px.shape[0], 3, oiio.HALF)
    spec_.attribute("compression", "zip")
    o.open(path, spec_)
    o.write_image(px.astype(np.float32))
    o.close()

# pixel rays of the square pinhole view, camera space (x right, y up, -z forward)
gx, gy = np.meshgrid((np.arange(SIZE) + 0.5 - SIZE / 2) / fl, -(np.arange(SIZE) + 0.5 - SIZE / 2) / fl)
LOCAL = np.stack([gx, gy, -np.ones_like(gx)], -1).reshape(-1, 3)

def cut(pano, m):
    """A pinhole view out of an equirectangular Cycles panorama taken at yaw 0 (pano_dir's projection)."""
    H, W = pano.shape[:2]
    R = np.array(m.to_3x3(), np.float64)
    d = LOCAL @ R.T
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    az = np.arctan2(d[:, 1], d[:, 0])
    lat = np.arcsin(np.clip(d[:, 2], -1, 1))
    lon = (-az + math.pi) % (2 * math.pi) - math.pi
    col = (lon + math.pi) / (2 * math.pi) * W - 0.5
    row = (math.pi / 2 - lat) / math.pi * H - 0.5
    c0 = np.floor(col).astype(np.int64)
    r0 = np.clip(np.floor(row).astype(np.int64), 0, H - 2)
    fc, fr = (col - c0)[:, None], np.clip(row - r0, 0, 1)[:, None]
    c1 = (c0 + 1) % W
    c0 = c0 % W
    px = (pano[r0, c0] * (1 - fc) + pano[r0, c1] * fc) * (1 - fr) + (pano[r0 + 1, c0] * (1 - fc) + pano[r0 + 1, c1] * fc) * fr
    return px.reshape(SIZE, SIZE, 3)

MODE = SP.get("mode", "pano")
frames = []
nrng = np.random.default_rng(1)
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
def write_png(fr, px, lo, hi):
    v = (np.log2(np.maximum(px, 2.0 ** lo)) - lo) / (hi - lo)
    v = np.clip(v * 255.0 + nrng.uniform(-0.5, 0.5, v.shape), 0, 255).round().astype(np.uint8)
    path_ = os.path.join(OUT, fr["file_path"])
    o = oiio.ImageOutput.create(path_)
    o.open(path_, oiio.ImageSpec(v.shape[1], v.shape[0], 3, oiio.UINT8))
    o.write_image(v)
    o.close()
RANGE = None
t_r = time.time()
if MODE == "panos" and SP.get("materialOverrides"):
    # AI material pilot (7 Nov, step 7): a material's base colour replaced by a prepared texture before anything is
    # rendered, so Cycles, the colour pass and the exported walk model share it. Flat-colour materials get box-projected
    # UVs at the material's physical repeat (metres) on their own faces.
    import bmesh
    for ov in SP["materialOverrides"]:
        m = bpy.data.materials.get(ov["name"])
        if m is None or not m.use_nodes:
            print("SPLAT_INFO override: no material %s" % ov["name"], flush=True)
            continue
        nt = m.node_tree
        b_ = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b_ is None:
            continue
        img = bpy.data.images.load(ov["image"], check_existing=True)
        img.colorspace_settings.name = "sRGB"
        src = b_.inputs["Base Color"].links[0].from_node if b_.inputs["Base Color"].is_linked else None
        if src is not None and src.type == "TEX_IMAGE":
            src.image = img
            how = "texture replaced"
        else:
            for l in list(b_.inputs["Base Color"].links):
                nt.links.remove(l)
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            nt.links.new(node.outputs["Color"], b_.inputs["Base Color"])
            rep = float(ov.get("repeat", 1.0))
            n_faces = 0
            for ob in scene.objects:
                if ob.type != "MESH" or not any(sl.material == m for sl in ob.material_slots):
                    continue
                idx_ = {i for i, sl in enumerate(ob.material_slots) if sl.material == m}
                bm = bmesh.new()
                bm.from_mesh(ob.data)
                uv = bm.loops.layers.uv.active or bm.loops.layers.uv.new("UVMap")
                mw = ob.matrix_world
                n3 = mw.to_3x3()
                for f in bm.faces:
                    if f.material_index not in idx_:
                        continue
                    nn = (n3 @ f.normal)
                    ax = max(range(3), key=lambda k: abs(nn[k]))
                    for lp in f.loops:
                        w = mw @ lp.vert.co
                        a2 = [w[k] for k in range(3) if k != ax]
                        lp[uv].uv = (a2[0] / rep, a2[1] / rep)
                    n_faces += 1
                bm.to_mesh(ob.data)
                bm.free()
            how = "texture added, box UVs at %.2f m on %d faces" % (rep, n_faces)
        print("SPLAT_INFO override %s: %s" % (ov["name"], how), flush=True)

if MODE == "panos":
    # v2 (7 Nov): the panoramas themselves are the capture, in true light with their depth; the trainer
    # (scripts/splat_train.py) cuts its own views from them, any direction, and keeps the splats on the surfaces.
    PW = int(SP.get("panoWidth", 2048))
    os.makedirs(os.path.join(OUT, "panos"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "tests"), exist_ok=True)
    scene.cycles.samples = int(SP.get("samples", 16))
    scene.cycles.adaptive_threshold = float(SP.get("noise", 0.02))
    scene.cycles.denoiser = SP.get("denoiser", "OPENIMAGEDENOISE")
    if scene.cycles.denoiser == "OPENIMAGEDENOISE":
        scene.cycles.denoising_prefilter = "ACCURATE"
        scene.cycles.denoising_use_gpu = scene.cycles.device == "GPU"
    vl = scene.view_layers[0]
    vl.use_pass_z = True
    scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.exr_codec = "NONE"
    # Mirrors and glass are seen through by the camera (the wall behind a mirror, the room behind glass). A splat
    # cannot hold a reflection that moves with the eye: it learnt a fake room behind every mirror (6 Nov, F2
    # bathroom). They keep lighting and reflecting the room; the walk draws them itself.
    def is_glass_mat(m):
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        return b is not None and (b.inputs["Transmission Weight"].default_value > 0.5 or b.inputs["Alpha"].default_value < 0.6)
    def see_kind(m):
        if m is None or not m.use_nodes:
            return None
        r = role_of(m)
        if r == "mirror":
            return "mirror"
        if r in ("glass", "glass-name") or is_glass_mat(m):
            return "glass"
        return None
    SEE = {}
    for m in bpy.data.materials:
        k = see_kind(m)
        if k is None:
            continue
        if not SP.get("seeThrough", True):
            SEE[m.name] = k  # known, left as they are (tests of real mirrors)
            continue
        if True:
            nt = m.node_tree
            out_ = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if out_ is None or not out_.inputs["Surface"].is_linked:
                continue
            src = out_.inputs["Surface"].links[0].from_socket
            lp, tr, mx = nt.nodes.new("ShaderNodeLightPath"), nt.nodes.new("ShaderNodeBsdfTransparent"), nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(lp.outputs["Is Camera Ray"], mx.inputs[0])
            nt.links.new(src, mx.inputs[1])
            nt.links.new(tr.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out_.inputs["Surface"])
            SEE[m.name] = k
    print("SPLAT_INFO seen through: %s" % (", ".join("%s (%s)" % kv for kv in SEE.items()) or "nothing"), flush=True)
    # v3 (7 Nov): each surface's own colour (its base colour: texture times colour, as the walk's model draws it) as
    # a pass of the same render. The splat then holds only the light (picture / colour), which is smooth and trains
    # fast; the walk multiplies it by the model's textures, sharp at any distance.
    if SP.get("albedo", True):
        if not any(a.name == "roomia_albedo" for a in vl.aovs):
            aov_ = vl.aovs.add()
            aov_.name, aov_.type = "roomia_albedo", "COLOR"
        n_alb = 0
        for m in bpy.data.materials:
            if m.name in SEE or not m.use_nodes:
                continue
            nt = m.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b is None:
                continue
            node = nt.nodes.new("ShaderNodeOutputAOV")
            node.aov_name = "roomia_albedo"
            src = b.inputs["Base Color"]
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, node.inputs["Color"])
            else:
                node.inputs["Color"].default_value = src.default_value
            n_alb += 1
        print("SPLAT_INFO albedo pass on %d materials" % n_alb, flush=True)
    # Material ids (7 Nov, parity and gloss fitting): every pixel knows its material (value = (index + 1) / 4096)
    MAT_IDS = {}
    if not any(a.name == "roomia_mat" for a in vl.aovs):
        aov_ = vl.aovs.add()
        aov_.name, aov_.type = "roomia_mat", "VALUE"
    for m in bpy.data.materials:
        if m.name in SEE or not m.use_nodes:
            continue
        out_ = next((n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out_ is None:
            continue
        MAT_IDS[m.name] = len(MAT_IDS) + 1
        node = m.node_tree.nodes.new("ShaderNodeOutputAOV")
        node.aov_name = "roomia_mat"
        node.inputs["Value"].default_value = MAT_IDS[m.name] / 4096.0
    json.dump({str(v): k for k, v in MAT_IDS.items()}, open(os.path.join(OUT, "material-ids.json"), "w"))

    def read_layers(p):
        inp = oiio.ImageInput.open(p)
        sp_ = inp.spec()
        names = list(sp_.channelnames)
        px = inp.read_image(0, 0, 0, sp_.nchannels, "float").reshape(sp_.height, sp_.width, sp_.nchannels)
        inp.close()
        def ch(suffix):
            return next(i for i, n in enumerate(names) if n.endswith(suffix) and ("Combined" in n or suffix == "Depth.Z"))
        rgb = np.stack([px[..., ch("Combined.R")], px[..., ch("Combined.G")], px[..., ch("Combined.B")]], -1)
        z = px[..., ch("Depth.Z")]
        al = [next((i for i, n in enumerate(names) if n.endswith("roomia_albedo." + c)), None) for c in "RGB"]
        alb = np.stack([px[..., i] for i in al], -1) if None not in al else None
        read_layers.albedo = alb
        mi = next((i for i, n in enumerate(names) if n.endswith("roomia_mat.V") or n.endswith("roomia_mat.X") or n.endswith("roomia_mat")), None)
        read_layers.mat = np.round(px[..., mi] * 4096.0).astype(np.uint16) if mi is not None else None
        passes = {}
        for ps in ("DiffDir", "DiffInd", "DiffCol", "GlossDir", "GlossInd", "GlossCol", "TransDir", "TransInd", "TransCol", "Emit", "Env"):
            ix = [next((i for i, n in enumerate(names) if n.endswith("." + ps + "." + c)), None) for c in "RGB"]
            if None not in ix:
                passes[ps] = np.nan_to_num(np.stack([px[..., i] for i in ix], -1), nan=0.0, posinf=0.0)
        read_layers.passes = passes
        return np.nan_to_num(rgb, nan=0.0, posinf=0.0), z

    def gl(v):
        return [float(v.x), float(v.z), float(-v.y)]

    # Test views (not counted in the capture's time): real Cycles pictures from places no panorama was taken,
    # looking ahead and down at the furniture, to judge the walk by eye.
    tests, test_cams = [], []
    NT = int(SP.get("tests", 0))
    t_tests = 0.0
    if NT:
        t_t = time.time()
        # Cycles' own split of the picture, to see what the splat's light really holds (7 Nov, ChatGPT's test A)
        for attr in ("use_pass_diffuse_direct", "use_pass_diffuse_indirect", "use_pass_diffuse_color", "use_pass_glossy_direct",
                     "use_pass_glossy_indirect", "use_pass_glossy_color", "use_pass_transmission_direct", "use_pass_transmission_indirect",
                     "use_pass_transmission_color", "use_pass_emit", "use_pass_environment"):
            setattr(vl, attr, True)
        used = {(round(s.x, 3), round(s.y, 3)) for s in spots}
        cands = [s for s in walk_spots + hover_spots if (round(s.x, 3), round(s.y, 3)) not in used]
        trng = random.Random(11)
        trng.shuffle(cands)
        TS = int(SP.get("testSize", 1024))
        cam_data.type = "PERSP"
        cam_data.sensor_fit = "VERTICAL"
        cam_data.angle = math.radians(FOV)
        scene.render.resolution_x = scene.render.resolution_y = TS
        scene.cycles.samples = int(SP.get("testSamples", 64))
        for t_i, s in enumerate(cands[:0 if SP.get("mirrorOnly") else NT]):
            eye = Vector((s.x + trng.uniform(-0.2, 0.2), s.y + trng.uniform(-0.2, 0.2), s.z + trng.uniform(1.45, 1.7)))
            for v_i, pitch in enumerate((trng.uniform(-12, 0), trng.uniform(-55, -40))):
                yaw = trng.uniform(0, 2 * math.pi)
                m = c2w(eye, yaw, math.radians(pitch))
                cam.matrix_world = m
                if dome is not None:
                    dome.location.z = eye.z
                name = "t%02d-%d.npz" % (t_i, v_i)
                if SP.get("resume") and os.path.exists(os.path.join(OUT, "tests", name)):
                    tests.append({"file": "tests/" + name, "c2w": [list(r) for r in (G @ m)], "fov": FOV, "size": TS})
                    test_cams.append((m.copy(), name))
                    continue
                scene.render.filepath = os.path.join(OUT, "tests", "tmp.exr")
                bpy.ops.render.render(write_still=True)
                rgb, z = read_layers(scene.render.filepath)
                extra = {"albedo": read_layers.albedo.astype(np.float16)} if read_layers.albedo is not None else {}
                if read_layers.mat is not None:
                    extra["mat"] = read_layers.mat
                P_ = read_layers.passes
                if "DiffDir" in P_:
                    extra["diff_light"] = (P_["DiffDir"] + P_["DiffInd"]).astype(np.float16)
                    extra["diff_col"] = P_["DiffCol"].astype(np.float16)
                    extra["gloss"] = (P_["GlossCol"] * (P_["GlossDir"] + P_["GlossInd"])).astype(np.float16)
                    extra["trans"] = (P_["TransCol"] * (P_["TransDir"] + P_["TransInd"])).astype(np.float16)
                    extra["emit"] = (P_["Emit"] + P_.get("Env", 0)).astype(np.float16)
                np.savez(os.path.join(OUT, "tests", name), rgb=rgb.astype(np.float16), depth=np.minimum(z, 1000.0).astype(np.float16), **extra)
                tests.append({"file": "tests/" + name, "c2w": [list(r) for r in (G @ m)], "fov": FOV, "size": TS})
                test_cams.append((m.copy(), name))
        # Mirrors (7 Nov, investigation 3): one real Cycles view of each mirror from the room side, a little off-axis
        if SP.get("mirrorTests", True):
            groups_m = []
            for ob in scene.objects:
                if ob.type != "MESH" or ob.hide_render:
                    continue
                for poly in ob.data.polygons:
                    if poly.material_index >= len(ob.material_slots):
                        continue
                    mt = ob.material_slots[poly.material_index].material
                    if mt is None or SEE.get(mt.name) != "mirror":
                        continue
                    c_ = ob.matrix_world @ poly.center
                    n_ = (ob.matrix_world.to_3x3() @ poly.normal).normalized()
                    a_ = poly.area * abs(ob.matrix_world.to_3x3().determinant()) ** (2 / 3)
                    g_ = next((g for g in groups_m if abs(g[1].dot(n_)) > 0.99 and abs(g[1].dot(c_ - g[0])) < 0.03 and (c_ - g[0]).length < 2.5), None)
                    if g_ is None:
                        groups_m.append([c_.copy(), n_.copy(), a_])
                    else:
                        g_[0] = (g_[0] * g_[2] + c_ * a_) / (g_[2] + a_)
                        g_[2] += a_
            groups_m.sort(key=lambda g: -g[2])
            n_mt = 0
            for c_, n_, a_ in groups_m[:4]:
                if a_ < 0.1:
                    continue
                best_ = None
                for sgn in (1, -1):
                    d_ = n_ * sgn
                    h_ = ray(c_ + d_ * 0.05, d_)
                    room = (h_ - c_).length if h_ is not None else 99
                    if room > 1.0 and (best_ is None or room > best_[1]):
                        best_ = (d_, room)
                if best_ is None:
                    continue
                d_, room = best_
                side_ = d_.cross(Vector((0, 0, 1))).normalized()
                eye = c_ + d_ * min(1.4, room - 0.3) + side_ * 0.35
                f_ = (c_ - eye).normalized()
                yaw = math.atan2(f_.y, f_.x)
                pitch = math.asin(max(-1, min(1, f_.z)))
                m = c2w(eye, yaw, pitch)
                cam.matrix_world = m
                scene.render.filepath = os.path.join(OUT, "tests", "tmp.exr")
                bpy.ops.render.render(write_still=True)
                rgb, z = read_layers(scene.render.filepath)
                name = "m%02d.npz" % n_mt
                extra = {"albedo": read_layers.albedo.astype(np.float16)} if read_layers.albedo is not None else {}
                if read_layers.mat is not None:
                    extra["mat"] = read_layers.mat
                np.savez(os.path.join(OUT, "tests", name), rgb=rgb.astype(np.float16), depth=np.minimum(z, 1000.0).astype(np.float16), **extra)
                tests.append({"file": "tests/" + name, "c2w": [list(r) for r in (G @ m)], "fov": FOV, "size": TS, "kind": "mirror", "mirrorArea": a_})
                test_cams.append((m.copy(), name))
                n_mt += 1
            print("SPLAT_INFO %d mirror test views (of %d mirror planes)" % (n_mt, len(groups_m)), flush=True)
        if os.path.exists(scene.render.filepath):
            os.remove(scene.render.filepath)
        for attr in ("use_pass_diffuse_direct", "use_pass_diffuse_indirect", "use_pass_diffuse_color", "use_pass_glossy_direct",
                     "use_pass_glossy_indirect", "use_pass_glossy_color", "use_pass_transmission_direct", "use_pass_transmission_indirect",
                     "use_pass_transmission_color", "use_pass_emit", "use_pass_environment"):
            setattr(vl, attr, False)
        t_tests += time.time() - t_t
        print("SPLAT_TIME tests %.1f (%d views, not part of the capture)" % (time.time() - t_t, len(tests)), flush=True)

    if SP.get("testsOnly"):
        json.dump({"tests": tests}, open(os.path.join(OUT, "tests.json"), "w"))
        print("SPLAT_OK", flush=True)
        sys.stdout.flush()
        os._exit(0)

    # Matte capture (7 Nov, ChatGPT's investigation 1): no gloss, no metal, no coat, no sheen, so the picture is
    # colour times DIFFUSE light only and the quotient holds no reflections divided by a dark colour (F2's marble).
    # Reflections are the walk's own job (mirrors, floors).
    matte_saved = []
    if SP.get("matte"):
        n_matte = 0
        for m in bpy.data.materials:
            if not m.use_nodes or m.name in SEE:
                continue
            for b_ in [x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"]:
                for key, val in (("Specular IOR Level", 0.0), ("Metallic", 0.0), ("Coat Weight", 0.0), ("Sheen Weight", 0.0)):
                    if key in b_.inputs:
                        inp_ = b_.inputs[key]
                        matte_saved.append((m, inp_, inp_.links[0].from_socket if inp_.is_linked else None, inp_.default_value))
                        for l in list(inp_.links):
                            m.node_tree.links.remove(l)
                        inp_.default_value = val
                n_matte += 1
        print("SPLAT_INFO matte capture: %d shaders without gloss" % n_matte, flush=True)
        if test_cams:
            t_t = time.time()
            for m_, name in test_cams:
                if SP.get("resume") and "rgb_matte" in np.load(os.path.join(OUT, "tests", name)).files:
                    continue
                cam.matrix_world = m_
                scene.render.filepath = os.path.join(OUT, "tests", "tmp.exr")
                bpy.ops.render.render(write_still=True)
                rgb, _ = read_layers(scene.render.filepath)
                f_ = os.path.join(OUT, "tests", name)
                d_ = dict(np.load(f_))
                d_["rgb_matte"] = rgb.astype(np.float16)
                np.savez(f_, **d_)
            if os.path.exists(scene.render.filepath):
                os.remove(scene.render.filepath)
            t_tests += time.time() - t_t
            print("SPLAT_TIME matte tests %.1f" % (time.time() - t_t), flush=True)
    scene.cycles.samples = int(SP.get("samples", 16))
    t_cap += t_tests  # the tests are not part of the capture's time
    t_r = time.time()

    LOOK_PREFIX = None
    if LOOK:
        vl.cycles.denoising_store_passes = True
        scene.cycles.use_denoising = False
        scene.use_nodes = True
        tree_ = scene.node_tree
        tree_.nodes.clear()
        rl_ = tree_.nodes.new("CompositorNodeRLayers")
        comp_ = tree_.nodes.new("CompositorNodeComposite")
        tree_.links.new(rl_.outputs["Image"], comp_.inputs["Image"])
        fo_ = tree_.nodes.new("CompositorNodeOutputFile")
        fo_.format.file_format = "OPEN_EXR_MULTILAYER"
        fo_.format.color_depth = "32"
        LOOK_PREFIX = os.path.join(OUT, "panos", "look-")
        fo_.base_path = LOOK_PREFIX
        fo_.layer_slots.clear()
        for lname, mix_ in LOOK["looks"].items():
            acc_ = None
            for gname, w_ in mix_.items():
                sock_ = rl_.outputs.get("Combined_" + gname)
                if sock_ is None:
                    continue
                mul_ = tree_.nodes.new("CompositorNodeMixRGB")
                mul_.blend_type, mul_.use_clamp = "MULTIPLY", False
                mul_.inputs[0].default_value = 1.0
                tree_.links.new(sock_, mul_.inputs[1])
                mul_.inputs[2].default_value = (float(w_[0]), float(w_[1]), float(w_[2]), 1.0)
                if acc_ is None:
                    acc_ = mul_
                else:
                    add_ = tree_.nodes.new("CompositorNodeMixRGB")
                    add_.blend_type, add_.use_clamp = "ADD", False
                    add_.inputs[0].default_value = 1.0
                    tree_.links.new(acc_.outputs[0], add_.inputs[1])
                    tree_.links.new(mul_.outputs[0], add_.inputs[2])
                    acc_ = add_
            dn_ = tree_.nodes.new("CompositorNodeDenoise")
            dn_.prefilter = "ACCURATE"
            tree_.links.new(acc_.outputs[0], dn_.inputs["Image"])
            tree_.links.new(rl_.outputs["Denoising Normal"], dn_.inputs["Normal"])
            tree_.links.new(rl_.outputs["Denoising Albedo"], dn_.inputs["Albedo"])
            fo_.layer_slots.new(lname)
            tree_.links.new(dn_.outputs[0], fo_.inputs[lname])
            dn_.prefilter = "FAST"
        # what the panorama keeps besides the looks, in the same small file: the full render (with a pass per light
        # group, ~300 MB uncompressed) is not written at all (7 Nov: 15 s a spot, 4.3 s of it rendering)
        for slot_, sock_name in (("albedo", "roomia_albedo"), ("depth", "Depth"), ("mat", "roomia_mat")):
            if rl_.outputs.get(sock_name) is not None:
                fo_.layer_slots.new(slot_)
                tree_.links.new(rl_.outputs[sock_name], fo_.inputs[slot_])
        scene.render.compositor_device = "GPU" if scene.cycles.device == "GPU" else "CPU"

    def read_looks():
        import glob as glob_
        f_ = sorted(glob_.glob(LOOK_PREFIX + "*.exr"))[-1]
        inp = oiio.ImageInput.open(f_)
        sp_ = inp.spec()
        names = list(sp_.channelnames)
        px = inp.read_image(0, 0, 0, sp_.nchannels, "float").reshape(sp_.height, sp_.width, sp_.nchannels)
        inp.close()
        os.remove(f_)
        out_ = {}
        for lname in list(LOOK["looks"]) + ["albedo", "depth", "mat"]:
            ix = [i for i, n in enumerate(names) if len(n.split(".")) >= 2 and n.split(".")[-2] == lname]
            if not ix:
                continue
            if lname in ("depth", "mat"):
                out_[lname] = px[..., ix[0]]
            else:
                ix = [next(i for i in ix if names[i].endswith("." + c)) for c in "RGB"]
                out_[lname] = np.nan_to_num(np.stack([px[..., i] for i in ix], -1), nan=0.0, posinf=0.0)
        return out_

    groups = {}
    for n, (eye, yaw, pitch, kind) in enumerate(shots):
        groups.setdefault((round(eye.x, 4), round(eye.y, 4), round(eye.z, 4)), (eye, kind))
    cam_data.type = "PANO"
    if hasattr(cam_data, "panorama_type"):
        cam_data.panorama_type = "EQUIRECTANGULAR"
    else:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    scene.render.resolution_x, scene.render.resolution_y = PW, PW // 2
    panos, lums, pano_eyes = [], [], []
    for g, (eye, kind) in enumerate(groups.values()):
        cam.location = eye
        cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
        if dome is not None:
            dome.location.z = eye.z
        scene.render.filepath = os.path.join(OUT, "panos", "tmp.exr")
        name = "p%04d.npz" % g
        if SP.get("resume") and os.path.exists(os.path.join(OUT, "panos", name)):
            # a capture that stopped (7 Nov, F5 ran out of memory in the export): its renders are kept
            z_ = np.load(os.path.join(OUT, "panos", name))
            panos.append({"file": "panos/" + name, "eye": gl(eye), "kind": kind})
            pano_eyes.append(eye.copy())
            lums.append((z_["rgb"].astype(np.float32)[::8, ::8] @ LUM).ravel())
            continue
        if LOOK:
            bpy.ops.render.render(write_still=False)
            looks_ = read_looks()
            rgb, z = looks_[next(iter(LOOK["looks"]))], looks_["depth"]
            read_layers.albedo = looks_.get("albedo")
            read_layers.mat = np.round(looks_["mat"] * 4096.0).astype(np.uint16) if "mat" in looks_ else None
        else:
            bpy.ops.render.render(write_still=True)
            rgb, z = read_layers(scene.render.filepath)
        if g == 0:
            # what the depth pass holds for a panorama: distance along the ray (checked against ray casts)
            H_, W_ = z.shape
            errs = []
            for r_, c_ in ((H_ // 2, W_ // 8), (H_ // 2, W_ // 3), (H_ * 2 // 3, W_ // 2), (H_ // 3, W_ * 3 // 4), (H_ * 3 // 4, W_ * 7 // 8)):
                lon = (c_ + 0.5) / W_ * 2 * math.pi - math.pi
                lat = math.pi / 2 - (r_ + 0.5) / H_ * math.pi
                az = -lon
                d = Vector((math.cos(lat) * math.cos(az), math.cos(lat) * math.sin(az), math.sin(lat)))
                h = ray(eye, d)
                if h is not None:
                    errs.append("%.3f/%.3f" % (float(z[r_, c_]), (h - eye).length))
            print("SPLAT_CHECK depth pass vs ray: %s" % ", ".join(errs), flush=True)
        name = "p%04d.npz" % g
        extra = {"albedo": read_layers.albedo.astype(np.float16)} if read_layers.albedo is not None else {}
        if LOOK:
            # the first look is the one the splat's shape trains on; the others are kept beside it ("rgb_<look>")
            for k_ in list(LOOK["looks"])[1:]:
                extra["rgb_" + k_] = looks_[k_].astype(np.float16)
        if read_layers.mat is not None:
            extra["mat"] = read_layers.mat
        np.savez(os.path.join(OUT, "panos", name), rgb=rgb.astype(np.float16), depth=np.minimum(z, 1000.0).astype(np.float16), **extra)
        panos.append({"file": "panos/" + name, "eye": gl(eye), "kind": kind})
        pano_eyes.append(eye.copy())
        lums.append((rgb[::8, ::8] @ LUM).ravel())
        if g % 10 == 0:
            el = time.time() - t_r
            print("SPLAT_STEP pano %d / %d, %.1fs a spot" % (g + 1, len(groups), el / (g + 1)), flush=True)
    if os.path.exists(scene.render.filepath):
        os.remove(scene.render.filepath)
    t_render = time.time() - t_r
    # Reflection probes (7 Nov, investigation 3): the panoramas themselves, small, in true light (Radiance .hdr), for the
    # walk's own gloss (each material's roughness and Fresnel over the nearest probe)
    t_pr = time.time()
    probes = []
    if SP.get("probes", True):
        os.makedirs(os.path.join(OUT, "probes"), exist_ok=True)
        NP_ = int(SP.get("probeCount", 24))
        idx_ = [i for i, p_ in enumerate(panos) if p_["kind"] == "stop"]
        rest_ = [i for i in range(len(panos)) if i not in idx_]
        if rest_:
            pts_ = np.array([panos[i]["eye"] for i in range(len(panos))])
            dmin = np.full(len(panos), 1e9)
            for i in idx_ or [rest_[0]]:
                dmin = np.minimum(dmin, np.linalg.norm(pts_ - pts_[i], axis=1))
            while len(idx_) < NP_:
                k_ = int(np.argmax(dmin))
                if dmin[k_] < 0.5:
                    break
                idx_.append(k_)
                dmin = np.minimum(dmin, np.linalg.norm(pts_ - pts_[k_], axis=1))
        def write_hdr(path_, img):
            img = np.maximum(img.astype(np.float32), 0)
            mx = img.max(-1)
            e = np.ceil(np.log2(np.maximum(mx, 1e-32)))
            sc = np.where(mx > 1e-32, 256.0 / np.exp2(e), 0)
            rgbe = np.zeros(img.shape[:2] + (4,), np.uint8)
            rgbe[..., :3] = np.clip(img * sc[..., None], 0, 255).astype(np.uint8)
            rgbe[..., 3] = np.where(mx > 1e-32, np.clip(e + 128, 0, 255), 0).astype(np.uint8)
            with open(path_, "wb") as fh:
                fh.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (img.shape[0], img.shape[1]))
                fh.write(rgbe.tobytes())
        PRW = int(SP.get("probeWidth", 512))
        for j_, i in enumerate(idx_):
            z_ = np.load(os.path.join(OUT, panos[i]["file"]))
            im = z_["rgb"].astype(np.float32)
            f_ = im.shape[1] // PRW
            im = im[: (im.shape[0] // f_) * f_, : (im.shape[1] // f_) * f_].reshape(im.shape[0] // f_, f_, im.shape[1] // f_, f_, 3).mean((1, 3))
            write_hdr(os.path.join(OUT, "probes", "probe-%02d.hdr" % j_), im)
            for k_ in [x for x in z_.files if x.startswith("rgb_") and x != "rgb_matte"]:
                im_ = z_[k_].astype(np.float32)
                im_ = im_[: (im_.shape[0] // f_) * f_, : (im_.shape[1] // f_) * f_].reshape(im_.shape[0] // f_, f_, im_.shape[1] // f_, f_, 3).mean((1, 3))
                write_hdr(os.path.join(OUT, "probes", "probe-%02d-%s.hdr" % (j_, k_[4:])), im_)
            probes.append({"file": "probes/probe-%02d.hdr" % j_, "eye": panos[i]["eye"]})
        print("SPLAT_TIME probes %.1f (%d)" % (time.time() - t_pr, len(probes)), flush=True)
    # Samples (7 Nov, investigation 2): a few spots rendered again at other sample counts, with and without the
    # denoiser, beside the capture (not counted in its time)
    study = []
    if SP.get("sampleStudy"):
        t_s = time.time()
        os.makedirs(os.path.join(OUT, "study"), exist_ok=True)
        walk_i = [i for i, p_ in enumerate(panos) if p_["kind"] != "stop"]
        pick_ = walk_i[:: max(1, len(walk_i) // int(SP.get("sampleStudy", 4)))][: int(SP.get("sampleStudy", 4))]
        for i in pick_:
            cam.location = pano_eyes[i]
            cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
            for spp, dn in ((8, True), (16, True), (16, False), (32, True), (32, False), (64, True), (256, True)):
                scene.cycles.samples = spp
                scene.cycles.use_denoising = dn
                scene.render.filepath = os.path.join(OUT, "study", "tmp.exr")
                t0_ = time.time()
                bpy.ops.render.render(write_still=True)
                dt_ = time.time() - t0_
                rgb_, _ = read_layers(scene.render.filepath)
                name_ = "s%03d-%d%s.npz" % (i, spp, "d" if dn else "n")
                np.savez(os.path.join(OUT, "study", name_), rgb=rgb_.astype(np.float16), albedo=read_layers.albedo.astype(np.float16))
                study.append({"pano": i, "samples": spp, "denoise": dn, "seconds": round(dt_, 2), "file": "study/" + name_})
        os.remove(os.path.join(OUT, "study", "tmp.exr"))
        scene.cycles.samples = int(SP.get("samples", 16))
        scene.cycles.use_denoising = True
        t_cap += time.time() - t_s
        print("SPLAT_TIME sample study %.1f (%d renders, not part of the capture)" % (time.time() - t_s, len(study)), flush=True)
    print("SPLAT_TIME render %.1f (%d panoramas %dx%d, %d samples)" % (t_render, len(panos), PW, PW // 2, scene.cycles.samples), flush=True)
    allv = np.concatenate(lums)
    allv = allv[allv > 0]
    med = float(np.log2(np.median(allv)))
    hi = float(np.log2(np.percentile(allv, 99.9))) + 0.5
    lo = max(float(np.log2(np.percentile(allv, 0.5))) - 0.5, med - 8.0)
    print("SPLAT_INFO light range %.1f stops (log2 %.2f .. %.2f, median %.2f)" % (hi - lo, lo, hi, med), flush=True)

    # Points on the visible surfaces with their normals (the trainer lays flat splats on them, coloured from the
    # panoramas), and the mirrors and glass apart for the walk.
    t_p = time.time()
    x0, x1, y0, y1 = BOUND
    tris, special = [], {"mirror": [], "glass": []}
    for ob in scene.objects:
        if ob.type != "MESH" or ob.hide_render or ob.name.startswith("roomia_sky"):
            continue
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        if max(p.x for p in bb) < x0 or min(p.x for p in bb) > x1 or max(p.y for p in bb) < y0 or min(p.y for p in bb) > y1:
            continue
        me = ob.evaluated_get(depsgraph).to_mesh()
        me.calc_loop_triangles()
        nv, nt_ = len(me.vertices), len(me.loop_triangles)
        if nt_:
            co = np.empty(nv * 3, np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            mw = np.array(ob.matrix_world, np.float32)
            co = co @ mw[:3, :3].T + mw[:3, 3]
            idx = np.empty(nt_ * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", idx)
            mi = np.empty(nt_, np.int32)
            me.loop_triangles.foreach_get("material_index", mi)
            T_ = co[idx.reshape(-1, 3)]
            kinds = np.zeros(nt_, np.int8)
            for s_, slot in enumerate(ob.material_slots):
                k = SEE.get(slot.material.name) if slot.material else None
                if k:
                    kinds[mi == s_] = 1 if k == "mirror" else 2
            if (kinds == 1).any():
                special["mirror"].append(T_[kinds == 1])
            if (kinds == 2).any():
                special["glass"].append(T_[kinds == 2])
            tris.append(T_[kinds == 0])
        ob.evaluated_get(depsgraph).to_mesh_clear()
    T = np.concatenate(tris)
    # what is seen through the windows (the street, the building opposite) at a twentieth of the density
    inside = (T[:, :, 0].max(1) >= x0) & (T[:, :, 0].min(1) <= x1) & (T[:, :, 1].max(1) >= y0) & (T[:, :, 1].min(1) <= y1)
    cr = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    area = 0.5 * np.linalg.norm(cr, axis=1)
    ok = area > 1e-9
    T, cr, area, inside = T[ok], cr[ok], area[ok], inside[ok]
    weight = area * np.where(inside, 1.0, 0.05)
    N = int(SP.get("initPoints", 2000000))
    pick = nrng.choice(len(T), size=N, p=weight / weight.sum())
    u, w = nrng.random(N), nrng.random(N)
    flip = u + w > 1
    u[flip], w[flip] = 1 - u[flip], 1 - w[flip]
    P = T[pick, 0] + u[:, None] * (T[pick, 1] - T[pick, 0]) + w[:, None] * (T[pick, 2] - T[pick, 0])
    Nr = cr[pick] / (2 * area[pick])[:, None]
    spacing = math.sqrt(area[inside].sum() / N)
    # plus one point on every small triangle near the walk: where the model is finely shaped (slats, grooves,
    # upholstery, folds) the light changes over a centimetre, and even sampling by area left those bare (7 Nov)
    small = inside & (area < spacing * spacing * 4) & (area > 1e-6)
    NC = int(SP.get("centroidPoints", 1500000))
    ci = np.nonzero(small)[0]
    if len(ci) > NC:
        ci = nrng.choice(ci, size=NC, replace=False)
    P = np.concatenate([P, T[ci].mean(1)])
    Nr = np.concatenate([Nr, cr[ci] / (2 * area[ci])[:, None]])
    S_ = np.concatenate([np.full(N, spacing, np.float32), (np.sqrt(area[ci]) * 0.6).astype(np.float32)])
    print("SPLAT_INFO %d points by area + %d on small triangles" % (N, len(ci)), flush=True)
    def to_gl(a):
        return np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1).astype(np.float32)
    # the sky dome seen through the windows (it follows the eye's height; its centre at eye height)
    sky = np.zeros((0, 3), np.float32)
    if dome is not None:
        NS = int(SP.get("skyPoints", 40000))
        v = nrng.normal(size=(NS, 3))
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        v[:, 2] = np.abs(v[:, 2]) * 0.9 - 0.1
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        c = np.array(dome.location, np.float32)
        sky = to_gl(c + v * radius * 0.98)
    np.savez(os.path.join(OUT, "points.npz"), p=to_gl(P), n=to_gl(Nr), s=S_, spacing=np.float32(spacing), sky=sky, skyRadius=np.float32(radius))
    def tri_gl(lst):
        if not lst:
            return []
        a = np.concatenate(lst)
        return to_gl(a.reshape(-1, 3)).reshape(-1, 9).round(4).tolist()
    json.dump({"mirror": tri_gl(special["mirror"]), "materials": sorted(SEE)}, open(os.path.join(OUT, "see-through.json"), "w"))
    print("SPLAT_TIME points %.1f (%d triangles, %.0f m² of surface, %d points %.1f mm apart; %d mirror and %d glass triangles)" % (time.time() - t_p, len(T), area.sum(), N, spacing * 1000, sum(len(a) for a in special["mirror"]), sum(len(a) for a in special["glass"])), flush=True)
    # v3: the colour model, from this very scene (its geometry with SketchUp's twin sheets pushed apart, its
    # materials with the designer's edits, D5's light icons hidden): the walk draws its textures times the splat.
    if SP.get("albedo", True) and SP.get("model", True):
        t_m = time.time()
        # the materials as designed (the walk draws their gloss itself): back from the matte capture
        for m_, inp_, src_, val_ in matte_saved:
            inp_.default_value = val_
            if src_ is not None:
                m_.node_tree.links.new(src_, inp_)
        # Colours Blender computes (procedural plaster, noise) do not survive the export; baked into a texture so the
        # walk shows them (7 Nov, Suite bathroom; ChatGPT: don't let the light compensate). Big surfaces only.
        if SP.get("bakeProcedural", True):
            t_b = time.time()
            area_by = {}
            for ob in scene.objects:
                if ob.type != "MESH" or ob.hide_render or not ob.data.uv_layers:
                    continue
                det_ = abs(ob.matrix_world.to_3x3().determinant()) ** (2 / 3)
                for poly in ob.data.polygons:
                    if poly.material_index < len(ob.material_slots):
                        mt = ob.material_slots[poly.material_index].material
                        if mt is not None:
                            area_by[(ob.name, mt.name)] = area_by.get((ob.name, mt.name), 0.0) + poly.area * det_
            def procedural(mt):
                if not mt.use_nodes or mt.name in SEE:
                    return False
                b_ = next((n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if b_ is None or not b_.inputs["Base Color"].is_linked:
                    return False
                return b_.inputs["Base Color"].links[0].from_node.type != "TEX_IMAGE"
            jobs = sorted([(a_, o_, m_) for (o_, m_), a_ in area_by.items() if a_ >= float(SP.get("bakeArea", 1.5)) and procedural(bpy.data.materials[m_])], reverse=True)[: int(SP.get("bakeMax", 8))]
            baked = []
            if jobs:
                keep_bake = (scene.cycles.samples, scene.cycles.use_denoising)
                scene.cycles.samples = 4
                scene.render.bake.use_pass_direct = False
                scene.render.bake.use_pass_indirect = False
                scene.render.bake.use_pass_color = True
                scene.render.bake.margin = 4
                for a_, o_, m_ in jobs:
                    ob = scene.objects[o_]
                    mt = bpy.data.materials[m_].copy()  # this object's own copy: its UVs, its image
                    for slot in ob.material_slots:
                        if slot.material is not None and slot.material.name == m_:
                            slot.material = mt
                    px_ = int(min(2048, max(512, 2 ** round(math.log2(math.sqrt(a_) * 256)))))
                    img = bpy.data.images.new("roomia_baked_%s" % mt.name, px_, px_)
                    node = mt.node_tree.nodes.new("ShaderNodeTexImage")
                    node.image = img
                    mt.node_tree.nodes.active = node
                    # the object's other materials bake into a throwaway image (Cycles wants one in each)
                    dummy = bpy.data.images.new("roomia_bake_dummy", 8, 8)
                    temp = []
                    for slot in ob.material_slots:
                        om = slot.material
                        if om is None or om == mt or not om.use_nodes:
                            continue
                        dn_ = om.node_tree.nodes.new("ShaderNodeTexImage")
                        dn_.image = dummy
                        om.node_tree.nodes.active = dn_
                        temp.append((om, dn_))
                    bpy.ops.object.select_all(action="DESELECT")
                    ob.select_set(True)
                    bpy.context.view_layer.objects.active = ob
                    ok_ = True
                    try:
                        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_selected_to_active=False)
                    except Exception as e_:
                        print("SPLAT_INFO bake failed for %s on %s: %s" % (m_, o_, e_), flush=True)
                        ok_ = False
                    for om, dn_ in temp:
                        om.node_tree.nodes.remove(dn_)
                    if not ok_:
                        continue
                    img.pack()
                    b_ = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                    for l in list(b_.inputs["Base Color"].links):
                        mt.node_tree.links.remove(l)
                    mt.node_tree.links.new(node.outputs["Color"], b_.inputs["Base Color"])
                    baked.append("%s on %s (%.0f m², %d px)" % (m_, o_, a_, px_))
                scene.cycles.samples, scene.cycles.use_denoising = keep_bake
            print("SPLAT_TIME bake %.1f (%d procedural colours baked: %s)" % (time.time() - t_b, len(baked), "; ".join(baked)), flush=True)
        # Material manifest (7 Nov, step 2): Blender's own Principled values, for the walk's gloss (glTF and three.js
        # drop some: specular level and tint, sheen, coat)
        def val(b_, key):
            if key not in b_.inputs:
                return None
            i_ = b_.inputs[key]
            v_ = i_.default_value
            v_ = [round(float(x), 4) for x in v_][:3] if hasattr(v_, "__len__") else round(float(v_), 4)
            return {"value": v_, "linked": True} if i_.is_linked else v_
        manifest = {}
        for m in bpy.data.materials:
            if not m.use_nodes:
                continue
            b_ = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b_ is None:
                continue
            manifest[m.name] = {k_: val(b_, key) for k_, key in (
                ("roughness", "Roughness"), ("metallic", "Metallic"), ("ior", "IOR"), ("specular", "Specular IOR Level"),
                ("specularTint", "Specular Tint"), ("sheen", "Sheen Weight"), ("sheenTint", "Sheen Tint"), ("sheenRoughness", "Sheen Roughness"),
                ("coat", "Coat Weight"), ("coatRoughness", "Coat Roughness"), ("coatIor", "Coat IOR"), ("transmission", "Transmission Weight"),
                ("alpha", "Alpha"))}
            manifest[m.name]["role"] = SEE.get(m.name)
        json.dump(manifest, open(os.path.join(OUT, "materials.json"), "w"), indent=0)
        print("SPLAT_INFO material manifest: %d materials" % len(manifest), flush=True)
        bpy.ops.object.select_all(action="DESELECT")
        n_sel = 0
        # the render engine's copy of the scene first (persistent data holds it: F5, 6.7 M triangles, ran the PC out of
        # memory in this export, 7 Nov), and only what is around the apartment (seen from it), not the whole building
        scene.render.use_persistent_data = False
        import gc
        gc.collect()
        ex0, ex1, ey0, ey1 = BOUND[0] - 4.0, BOUND[1] + 4.0, BOUND[2] - 4.0, BOUND[3] + 4.0
        for ob in scene.objects:
            if ob.type == "MESH" and not ob.hide_render and not ob.name.startswith("roomia_sky") and ob.visible_camera:
                bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
                if max(p.x for p in bb) < ex0 or min(p.x for p in bb) > ex1 or max(p.y for p in bb) < ey0 or min(p.y for p in bb) > ey1:
                    continue
                ob.select_set(True)
                n_sel += 1
                # big scenes (F5: 6.7 M triangles ran out of memory exporting): the heaviest objects lighter in the export
                dec = float(SP.get("exportDecimate", 0))
                if dec > 0 and len(ob.data.polygons) > int(SP.get("exportDecimateOver", 20000)):
                    md = ob.modifiers.new("roomia_export_decimate", "DECIMATE")
                    md.ratio = dec
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "model.glb"), export_format="GLB", use_selection=True, export_yup=True,
                                  export_texcoords=True, export_normals=True, export_vertex_color="NONE", export_apply=True,
                                  export_materials="EXPORT", export_image_format="AUTO", export_lights=False, export_cameras=False)
        print("SPLAT_TIME model %.1f (%d objects)" % (time.time() - t_m, n_sel), flush=True)
    t_capture = time.time() - t_cap


    # The colours as the WALK draws them (7 Nov, Suite bathroom): the albedo pass above reads each material in Blender,
    # but a colour Blender computes (procedural plaster) does not survive the export, and the walk showed it grey. So
    # the colour pass is rendered again from the exported model itself, unlit: light = picture / the walk's own
    # colours, and wherever the model lost a material the light carries its colour instead.
    # (a matte capture divides by Cycles' own colours: this pass is then only the parity check, off unless asked)
    if SP.get("albedo", True) and SP.get("model", True) and SP.get("modelAlbedo", not SP.get("matte")) and os.path.exists(os.path.join(OUT, "model.glb")):
        t_a = time.time()
        import re as re_
        see_base = {re_.sub(r"\.\d{3}$", "", n) for n in SEE}
        objs_before = set(bpy.data.objects)
        mats_before = set(bpy.data.materials)
        for ob in scene.objects:
            if ob.type != "CAMERA":
                ob.hide_render = True
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "model.glb"))
        for ob in bpy.data.objects:
            if ob not in objs_before and ob.type == "MESH":
                ob.hide_render = False
        n_flat = n_hid = 0
        for m in [m for m in bpy.data.materials if m not in mats_before]:
            if not m.use_nodes:
                continue
            nt = m.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            out_ = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if out_ is None:
                continue
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            clear = b is None or re_.sub(r"\.\d{3}$", "", m.name) in see_base or (not b.inputs["Alpha"].is_linked and b.inputs["Alpha"].default_value < 0.6) or b.inputs["Transmission Weight"].default_value > 0.5
            if clear:
                nt.links.new(tr.outputs[0], out_.inputs["Surface"])
                n_hid += 1
                continue
            em, mx = nt.nodes.new("ShaderNodeEmission"), nt.nodes.new("ShaderNodeMixShader")
            src = b.inputs["Base Color"]
            if src.is_linked:
                nt.links.new(src.links[0].from_socket, em.inputs["Color"])
            else:
                em.inputs["Color"].default_value = src.default_value
            em.inputs["Strength"].default_value = 1.0
            a_ = b.inputs["Alpha"]
            if a_.is_linked:
                nt.links.new(a_.links[0].from_socket, mx.inputs[0])
            else:
                mx.inputs[0].default_value = a_.default_value
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(em.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out_.inputs["Surface"])
            n_flat += 1
        scene.render.film_transparent = True
        scene.cycles.samples = int(SP.get("albedoSamples", 4))
        scene.cycles.use_adaptive_sampling = False
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 0
        def albedo_render(path_):
            scene.render.filepath = path_
            bpy.ops.render.render(write_still=True)
            rgb_, _ = read_layers(path_)
            os.remove(path_)
            return rgb_.astype(np.float16)
        cam_data.type = "PANO"
        if hasattr(cam_data, "panorama_type"):
            cam_data.panorama_type = "EQUIRECTANGULAR"
        else:
            cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
        scene.render.resolution_x, scene.render.resolution_y = PW, PW // 2
        t_imp = time.time() - t_a
        for p_, eye in zip(panos, pano_eyes):
            cam.location = eye
            cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
            # beside the panorama (the trainer prefers it to the npz's own albedo)
            np.save(os.path.join(OUT, p_["file"][:-4] + "-albedo.npy"), albedo_render(os.path.join(OUT, "panos", "alb.exr")))
        t_alb = time.time() - t_a
        print("SPLAT_TIME model colours %.1f (import %.1f; %d materials drawn, %d seen through)" % (t_alb, t_imp, n_flat, n_hid), flush=True)
        # Colour parity (7 Nov, step 1): per material, the walk model's colour against the colour Cycles shaded
        t_par = time.time()
        acc = {}
        for p_ in panos[::3]:
            z_ = np.load(os.path.join(OUT, p_["file"]))
            if "mat" not in z_.files:
                continue
            mat_, aov_ = z_["mat"][::2, ::2], z_["albedo"][::2, ::2].astype(np.float32)
            mod_ = np.load(os.path.join(OUT, p_["file"][:-4] + "-albedo.npy"))[::2, ::2].astype(np.float32)
            lum_a = np.maximum(aov_ @ LUM, 1e-3)
            lum_m = np.maximum(mod_ @ LUM, 1e-3)
            d_ = np.log2(lum_m / lum_a)
            hue = np.abs(mod_ / np.maximum(mod_.sum(-1, keepdims=True), 1e-3) - aov_ / np.maximum(aov_.sum(-1, keepdims=True), 1e-3)).sum(-1)
            for k_ in np.unique(mat_):
                if k_ == 0:
                    continue
                sel = mat_ == k_
                a_ = acc.setdefault(int(k_), [0, [], []])
                a_[0] += int(sel.sum())
                a_[1].append(d_[sel][:: max(1, int(sel.sum()) // 400)])
                a_[2].append(hue[sel][:: max(1, int(sel.sum()) // 400)])
        names_ = {v: k for k, v in MAT_IDS.items()}
        parity = []
        for k_, (n_px, ds, hs) in acc.items():
            ds, hs = np.concatenate(ds), np.concatenate(hs)
            nm = names_.get(k_, "?")
            b_ = next((n for n in bpy.data.materials[nm].node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if nm in bpy.data.materials else None
            chain = []
            if b_ is not None and b_.inputs["Base Color"].is_linked:
                nd = b_.inputs["Base Color"].links[0].from_node
                for _ in range(4):
                    chain.append(nd.type + ("(%s)" % nd.image.colorspace_settings.name if nd.type == "TEX_IMAGE" and nd.image else ""))
                    nxt = next((l.from_node for inp in nd.inputs for l in inp.links), None)
                    if nxt is None:
                        break
                    nd = nxt
            parity.append({"material": nm, "pixels": n_px, "brightness_stops": round(float(np.median(ds)), 3), "abs_stops": round(float(np.median(np.abs(ds))), 3),
                           "hue_diff": round(float(np.median(hs)), 3), "baseColor": " <- ".join(chain) or "constant"})
        parity.sort(key=lambda r: -r["pixels"] * r["abs_stops"])
        json.dump(parity, open(os.path.join(OUT, "parity.json"), "w"), indent=1)
        tot = sum(r["pixels"] for r in parity) or 1
        bad = [r for r in parity if r["abs_stops"] > 0.15 or r["hue_diff"] > 0.08]
        print("SPLAT_INFO colour parity: %.1f%% of pixels in materials off by > 0.15 stop or hue; worst: %s (%.1fs)" % (
            100.0 * sum(r["pixels"] for r in bad) / tot, "; ".join("%s %+.2f st %s" % (r["material"], r["brightness_stops"], r["baseColor"]) for r in bad[:6]), time.time() - t_par), flush=True)
        t_capture += t_alb
        if test_cams:
            cam_data.type = "PERSP"
            cam_data.sensor_fit = "VERTICAL"
            cam_data.angle = math.radians(FOV)
            scene.render.resolution_x = scene.render.resolution_y = int(SP.get("testSize", 1024))
            for m, name in test_cams:
                cam.matrix_world = m
                np.save(os.path.join(OUT, "tests", name[:-4] + "-albedo.npy"), albedo_render(os.path.join(OUT, "tests", "alb.exr")))
    json.dump({"version": 2, "width": PW, "height": PW // 2, "mapping": "blender-equirect-yaw0, glTF world (x, z, -y)", "lo": lo, "hi": hi,
               "panos": panos, "tests": tests, "probes": probes, "study": study, "matte": bool(SP.get("matte")), "step": STEP, "spots": [gl(Vector((s.x, s.y, s.z + EYE))) for s in walk_spots],
               "samples": int(SP.get("samples", 16)), "renderSeconds": t_render, "seconds": t_capture},
              open(os.path.join(OUT, "panos.json"), "w"))
    json.dump({"lo": lo, "hi": hi, "curve": "log2", "note": "encoded = (log2(max(linear, 2^lo)) - lo) / (hi - lo)"}, open(os.path.join(OUT, "encoding.json"), "w"))
    print("SPLAT_TIME total %.1f" % t_capture, flush=True)
    print("SPLAT_OK", flush=True)
    sys.stdout.flush()
    os._exit(0)
elif MODE == "pano":
    # One Cycles panorama per spot, the views cut out of it: one render (and one scene sync) instead of eight.
    PW = int(SP.get("panoWidth", 3072))
    groups = {}
    for n, (eye, yaw, pitch, kind) in enumerate(shots):
        groups.setdefault((round(eye.x, 4), round(eye.y, 4), round(eye.z, 4)), []).append(n)
    def pano_mode():
        cam_data.type = "PANO"
        if hasattr(cam_data, "panorama_type"):
            cam_data.panorama_type = "EQUIRECTANGULAR"
        else:
            cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
        scene.render.resolution_x, scene.render.resolution_y = PW, PW // 2
    pano_mode()
    pending, stop_lums = [], []
    n_stops = len({(round(e.x, 4), round(e.y, 4), round(e.z, 4)) for e in seeds})
    for g, (key, members) in enumerate(groups.items()):
        eye = shots[members[0]][0]
        cam.location = eye
        cam.rotation_euler = (math.pi / 2, 0.0, -math.pi / 2)
        if dome is not None:
            dome.location.z = eye.z
        scene.render.filepath = os.path.join(OUT, "exr", "pano-%04d.exr" % g)
        bpy.ops.render.render(write_still=True)
        pano = read_exr_any(scene.render.filepath)
        for n in members:
            _, yaw, pitch, kind = shots[n]
            m = c2w(eye, yaw, pitch)
            name = "v%04d" % n
            fr = {"file_path": "images/%s.png" % name, "transform_matrix": [list(r) for r in (G @ m)], "kind": kind}
            frames.append(fr)
            px = cut(pano, m)
            if RANGE is None:
                pending.append((fr, px))
            else:
                write_png(fr, px, *RANGE)
        if RANGE is None:
            stop_lums.append((pano[::4, ::4] @ LUM).ravel())
        if RANGE is None and g + 1 >= n_stops:
            # The light range from the tour points' 360s (every room is seen from one), a stop of margin each side;
            # every view is then encoded as soon as it is cut.
            allv = np.concatenate(stop_lums)
            allv = allv[allv > 0]
            hi_ = float(np.log2(np.percentile(allv, 99.97))) + 1.0
            lo_ = max(float(np.log2(np.percentile(allv, 0.2))) - 1.0, hi_ - 19.0)
            RANGE = (lo_, hi_)
            print("SPLAT_INFO light range %.1f stops (log2 %.2f .. %.2f) from %d tour points" % (hi_ - lo_, lo_, hi_, n_stops), flush=True)
            for fr_, px_ in pending:
                write_png(fr_, px_, *RANGE)
            pending = []
        os.remove(scene.render.filepath)
        if g == 0 and SP.get("check", True):
            # the cut must match a real pinhole render from the same camera
            cam_data.type = "PERSP"
            cam_data.sensor_fit = "VERTICAL"
            cam_data.angle = math.radians(FOV)
            scene.render.resolution_x = scene.render.resolution_y = SIZE
            _, yaw, pitch, _k = shots[members[1]]
            cam.matrix_world = c2w(eye, yaw, pitch)
            scene.render.filepath = os.path.join(OUT, "check-real.exr")
            bpy.ops.render.render(write_still=True)
            real = read_exr_any(scene.render.filepath)
            mine = cut(pano, c2w(eye, yaw, pitch))
            la, lb = np.log2(np.maximum(real, 1e-4)), np.log2(np.maximum(mine, 1e-4))
            print("SPLAT_CHECK cut vs real view: mean |log2| %.3f, flipped %.3f" % (float(np.abs(la - lb).mean()), float(np.abs(la - lb[:, ::-1]).mean())), flush=True)
            pano_mode()
        if g % 10 == 0:
            el = time.time() - t_r
            print("SPLAT_STEP pano %d / %d, %.1fs a spot" % (g + 1, len(groups), el / (g + 1)), flush=True)
    frames.sort(key=lambda fr: fr["file_path"])
else:
    for n, (eye, yaw, pitch, kind) in enumerate(shots):
        m = c2w(eye, yaw, pitch)
        cam.matrix_world = m
        if dome is not None:
            dome.location.z = eye.z
        name = "v%04d" % n
        scene.render.filepath = os.path.join(OUT, "exr", name + ".exr")
        bpy.ops.render.render(write_still=True)
        frames.append({"file_path": "images/%s.png" % name, "transform_matrix": [list(r) for r in (G @ m)], "kind": kind})
        if n % 20 == 0:
            el = time.time() - t_r
            print("SPLAT_STEP %d / %d, %.1fs a view" % (n + 1, len(shots), el / (n + 1)), flush=True)
print("SPLAT_TIME render %.1f (%d views)" % (time.time() - t_r, len(shots)), flush=True)

# One log curve for every view, from the light actually in them ('views' mode; 'pano' encoded while cutting).
t_e = time.time()
if RANGE is not None:
    lo, hi = RANGE
else:
    read_exr = read_exr_any
    samples = []
    for fr in frames[:: max(1, len(frames) // 200)]:
        px = read_exr(os.path.join(OUT, "exr", os.path.basename(fr["file_path"])[:-4] + ".exr"))
        lum = px[::4, ::4] @ LUM
        samples.append(lum[lum > 0].ravel())
    allv = np.concatenate(samples)
    lo = float(np.log2(np.percentile(allv, 0.2))) - 0.5
    hi = float(np.log2(np.percentile(allv, 99.97))) + 0.5
    lo = max(lo, hi - 18.0)
    print("SPLAT_INFO light range %.1f stops (log2 %.2f .. %.2f)" % (hi - lo, lo, hi), flush=True)
    for fr in frames:
        write_png(fr, read_exr(os.path.join(OUT, "exr", os.path.basename(fr["file_path"])[:-4] + ".exr")), lo, hi)
print("SPLAT_TIME encode %.1f" % (time.time() - t_e), flush=True)

# Points on the surfaces near the walk, to start from (area-weighted).
t_p = time.time()
x0, x1, y0, y1 = BOUND
tris, cols = [], []
for ob in scene.objects:
    if ob.type != "MESH" or ob.hide_render or ob.name.startswith("roomia_sky"):
        continue
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    if max(p.x for p in bb) < x0 or min(p.x for p in bb) > x1 or max(p.y for p in bb) < y0 or min(p.y for p in bb) > y1:
        continue
    me = ob.evaluated_get(depsgraph).to_mesh()
    me.calc_loop_triangles()
    nv, nt = len(me.vertices), len(me.loop_triangles)
    if nt:
        co = np.empty(nv * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        mw = np.array(ob.matrix_world, np.float32)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        idx = np.empty(nt * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", idx)
        tris.append(co[idx.reshape(-1, 3)])
    ob.evaluated_get(depsgraph).to_mesh_clear()
T = np.concatenate(tris)
inside = (T[:, :, 0].max(1) >= x0) & (T[:, :, 0].min(1) <= x1) & (T[:, :, 1].max(1) >= y0) & (T[:, :, 1].min(1) <= y1)
T = T[inside]
area = 0.5 * np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
N = int(SP.get("initPoints", 250000))
pick = nrng.choice(len(T), size=N, p=area / area.sum())
u, w = nrng.random(N), nrng.random(N)
flip = u + w > 1
u[flip], w[flip] = 1 - u[flip], 1 - w[flip]
P = T[pick, 0] + u[:, None] * (T[pick, 1] - T[pick, 0]) + w[:, None] * (T[pick, 2] - T[pick, 0])
Pg = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1).astype(np.float32)
with open(os.path.join(OUT, "points.ply"), "wb") as fh:
    fh.write(("ply\nformat binary_little_endian 1.0\nelement vertex %d\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n" % N).encode())
    rec = np.zeros(N, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    rec["x"], rec["y"], rec["z"] = Pg[:, 0], Pg[:, 1], Pg[:, 2]
    rec["r"] = rec["g"] = rec["b"] = 128
    fh.write(rec.tobytes())
print("SPLAT_TIME points %.1f (%d triangles near the walk)" % (time.time() - t_p, len(T)), flush=True)

json.dump({"camera_model": "OPENCV", "fl_x": fl, "fl_y": fl, "cx": SIZE / 2, "cy": SIZE / 2, "w": SIZE, "h": SIZE,
           "camera_angle_x": math.radians(FOV), "ply_file_path": "points.ply", "frames": frames},
          open(os.path.join(OUT, "transforms.json"), "w"))
json.dump({"lo": lo, "hi": hi, "curve": "log2", "note": "encoded = (log2(max(linear, 2^lo)) - lo) / (hi - lo)"}, open(os.path.join(OUT, "encoding.json"), "w"))
json.dump({"step": STEP, "spots": [[s.x, s.z + EYE, -s.y] for s in walk_spots], "rendered": [[s.x, s.z + EYE, -s.y] for s in spots], "stops": [[e.x, e.z, -e.y] for e in seeds],
           "views": len(frames), "size": SIZE, "fov": FOV, "samples": scene.cycles.samples, "seconds": time.time() - t_cap},
          open(os.path.join(OUT, "capture.json"), "w"))
print("SPLAT_TIME total %.1f" % (time.time() - t_cap), flush=True)
print("SPLAT_OK", flush=True)
sys.stdout.flush()
os._exit(0)
`

/** Runs the capture for one scene (its tour must be built: the walking spots grow from its points). */
export async function captureSplat(sceneId: string, options: SplatCaptureOptions = {}, onLine: (line: string) => void = () => {}) {
  const base = splatDir(sceneId)
  const out = path.join(base, options.outName ?? 'capture')
  const work = path.join(base, 'work')
  if (!options.resume) await rm(out, { recursive: true, force: true })
  await rm(work, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await mkdir(work, { recursive: true })
  const tour = JSON.parse(await readFile(path.join(tourDir(sceneId), 'tour.json'), 'utf8')) as {
    views?: { auto?: boolean; position?: number[]; target?: number[]; panoAi?: boolean; panoAiApproved?: boolean; index: number }[]
  }
  const auto = (tour.views ?? []).filter(v => v.auto && v.position && v.target).sort((a, b) => a.index - b.index)
  const cameras = await readCameras(sceneId)
  const scriptPath = path.join(work, 'tour.py')
  const capturePath = path.join(work, 'splat_capture.py')
  const specPath = path.join(work, 'tour.json')
  await writeFile(scriptPath, TOUR_SCRIPT)
  await writeFile(capturePath, SPLAT_CAPTURE_PY)
  await writeFile(
    specPath,
    JSON.stringify({
      ...(await tourSceneSpec(sceneId)),
      outDir: work,
      views: cameras.map(c => ({ name: c.name, position: c.position, target: c.target })),
      previousAuto: auto.map(v => ({ position: v.position, target: v.target, keep: Boolean(v.panoAi), approved: Boolean(v.panoAiApproved) })),
      previousSame: true,
      faceSize: 1024,
      planSize: 1800,
      viewTransform: 'AgX',
      autoViews: true,
      autoMax: 14,
      panoEngine: 'cycles',
      cyclesSamples: 128,
      cyclesNoise: 0.02,
      splatCapture: capturePath,
      splat: { outDir: out, ...options },
    }),
  )
  const lines: string[] = []
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(BLENDER, ['--background', '--python', scriptPath, '--', specPath], { stdio: ['ignore', 'pipe', 'pipe'] })
    // if memory runs out, Blender goes first, never the desktop or the Studio (7 Nov, F5)
    if (child.pid) writeFile(`/proc/${child.pid}/oom_score_adj`, '900').catch(() => {})
    let buf = ''
    const take = (chunk: Buffer) => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (/^(SPLAT_|TOUR_TIME|TOUR_INFO)|Error|Traceback/.test(line)) {
          lines.push(line)
          onLine(line)
        }
      }
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', reject)
    child.on('close', c => resolve(c ?? 1))
  })
  await writeFile(path.join(base, 'capture-log.txt'), lines.join('\n') + '\n')
  if (!lines.includes('SPLAT_OK')) throw new Error(`splat capture failed (exit ${code}): ${lines.slice(-4).join(' | ')}`)
  const model = path.join(out, 'model.glb')
  if (await stat(model).catch(() => null)) {
    const t0 = Date.now()
    // a big model (F5: 719 MB raw, 172 MB packed at 2048 px) gets 1024 px textures
    const raw = (await stat(model)).size
    const r = await packSplatModel(model, path.join(out, 'model-packed.glb'), options.textureSize ?? (raw > 300e6 ? 1024 : 2048))
    onLine(`SPLAT_TIME pack ${((Date.now() - t0) / 1000).toFixed(1)} (${(r.inBytes / 1e6).toFixed(1)} MB -> ${(r.outBytes / 1e6).toFixed(1)} MB)`)
  }
  return out
}

/** The model for the walk: colours drawn unlit, normals and roughness for its own gloss; welded, quantized, meshopt,
 * textures to WebP at 2048 px. */
export async function packSplatModel(src: string, dst: string, textureSize = 2048) {
  const { NodeIO, Logger } = await import('@gltf-transform/core')
  const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions')
  const { dedup, flatten, join, meshopt, prune, textureCompress, weld } = await import('@gltf-transform/functions')
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer')
  const sharp = (await import('sharp')).default
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(src)
  doc.setLogger(new Logger(Logger.Verbosity.WARN))
  // D5's light icons are hidden by the walk through their names, which joining loses: they go first
  for (const node of doc.getRoot().listNodes()) if (/D5RenderLight/i.test(node.getName())) node.traverse(n => n.setMesh(null))
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    // pieces with the same material joined (7 Nov, F5: 3755 pieces drawn several times a frame, 11 fps -> 33 fps)
    flatten(),
    join({ keepNamed: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeTexcoord: 16, quantizeNormal: 10 }),
  )
  await io.write(dst, doc)
  return { inBytes: (await stat(src)).size, outBytes: (await stat(dst)).size }
}
