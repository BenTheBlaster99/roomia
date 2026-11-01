# blender -b --python scripts/ai-depth.py -- .scenes/<id> <out dir> [width]   (then: python3 scripts/ai-mask.py .scenes/<id>/tour <out dir>, copy the out dir into the tour folder)
# Depth panoramas for the AI 360 points (31 Oct, AI layer of the free walk): from each point's eye, one ray per pixel
# through the FULL model (the walk's model is a simplified copy), the same equirectangular layout as the 360°
# (middle = the point's direction, right in the image = right of it, top = up). Glass is looked through (the AI 360
# shows what is behind it); mirrors are marked. depth-<view>.png: R,G = distance in mm (16 bits, 0 = nothing hit),
# B = 128 mirror, 64 seen through glass. projection.json: the points, their eyes and directions in glTF coordinates.
import bpy, sys, os, re, json, math, time, glob
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import OpenImageIO as oiio

scene_dir, out_dir = sys.argv[sys.argv.index("--") + 1:][:2]
rest = sys.argv[sys.argv.index("--") + 3:]
W = int(rest[0]) if rest else 2048
H = W // 2
t0 = time.time()
os.makedirs(out_dir, exist_ok=True)
src = os.path.join(scene_dir, "source.glb")
st = os.stat(src)
cache = glob.glob(os.path.join(scene_dir, "scene-cache-%d-%d-*.blend" % (st.st_size, int(st.st_mtime))))
if cache:
    bpy.ops.wm.open_mainfile(filepath=cache[0], load_ui=False)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
print("DEPTH scene open %.1fs (%s)" % (time.time() - t0, "cache" if cache else "import"), flush=True)

# the tour's own rules for mirrors and glass (lib/scene-tour.ts)
MIRROR = re.compile(r"mirror|miroir", re.I)
GLASS = re.compile(r"glass|verre|vitre|window", re.I)
FABRIC = re.compile(r"curtain|rideau|voilage|tulle|sheer|drape|cortina", re.I)
def kind(mat):
    if mat is None:
        return 0
    base = re.sub(r"\.\d{3}$", "", mat.name)
    if MIRROR.search(base):
        return 1
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat.use_nodes else None
    if GLASS.search(base):
        return 2
    if b is not None and not FABRIC.search(base):
        a = b.inputs["Alpha"]
        if (not a.is_linked and a.default_value < 0.9) or b.inputs["Transmission Weight"].default_value > 0.5:
            return 2
    return 0

V, T, K, off = [], [], [], 0
dg = bpy.context.evaluated_depsgraph_get()
for ob in bpy.context.scene.objects:
    if ob.type != "MESH" or ob.hide_render or not ob.data.polygons:
        continue
    me = ob.data
    me.calc_loop_triangles()
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    tri = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    mi = np.empty(len(me.loop_triangles), np.int32)
    me.loop_triangles.foreach_get("material_index", mi)
    kinds = np.array([kind(s.material) for s in ob.material_slots] or [0], np.int8)
    mw = np.array(ob.matrix_world, np.float32)
    V.append(co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3])
    T.append(tri.reshape(-1, 3) + off)
    K.append(kinds[np.minimum(mi, len(kinds) - 1)])
    off += len(co) // 3
V = np.concatenate(V); T = np.concatenate(T); K = np.concatenate(K)
solid = np.flatnonzero(K != 2)
glass = np.flatnonzero(K == 2)
bvh = BVHTree.FromPolygons(V, T[solid], all_triangles=True)
gbvh = BVHTree.FromPolygons(V, T[glass], all_triangles=True) if len(glass) else None
mirror_of = (K[solid] == 1)
print("DEPTH %d triangles: %d solid (%d mirror), %d glass, %.1fs" % (len(T), len(solid), int(mirror_of.sum()), len(glass), time.time() - t0), flush=True)

tour = json.load(open(os.path.join(scene_dir, "tour", "tour.json")))
views = [v for v in tour["views"] if v.get("pano") and v.get("panoAi") and not v.get("hidden")]
lon = ((np.arange(W) + 0.5) / W - 0.5) * 2 * math.pi
lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
LON, LAT = np.meshgrid(lon, lat)
out = {"width": W, "height": H, "encoding": "R,G = mm (16 bits, 0 none); B = 128 mirror, 64 through glass", "views": []}
for v in views:
    t1 = time.time()
    p, q = v["position"], v["target"]
    eye = Vector((p[0], -p[2], p[1]))
    fx, fy = q[0] - p[0], -(q[2] - p[2])
    yaw = math.atan2(fy, fx)
    fwd = np.array([math.cos(yaw), math.sin(yaw), 0.0])
    right = np.array([math.sin(yaw), -math.cos(yaw), 0.0])
    D = (np.cos(LAT) * np.cos(LON))[..., None] * fwd + (np.cos(LAT) * np.sin(LON))[..., None] * right
    D[..., 2] += np.sin(LAT)
    D = D.reshape(-1, 3)
    mm = np.zeros(len(D), np.uint32)
    flag = np.zeros(len(D), np.uint8)
    rc = bvh.ray_cast
    grc = gbvh.ray_cast if gbvh is not None else None
    for k in range(len(D)):
        d = Vector(D[k])
        h = rc(eye, d, 200.0)
        if h[0] is None:
            continue
        mm[k] = min(65535, int(h[3] * 1000 + 0.5))
        if mirror_of[h[2]]:
            flag[k] = 128
        elif grc is not None:
            g = grc(eye, d, h[3])
            if g[0] is not None:
                flag[k] = 64
    img = np.stack([(mm >> 8).astype(np.uint8), (mm & 255).astype(np.uint8), flag], 1).reshape(H, W, 3)
    path = os.path.join(out_dir, "depth-%d.png" % v["index"])
    o = oiio.ImageOutput.create(path)
    o.open(path, oiio.ImageSpec(W, H, 3, "uint8"))
    o.write_image(img)
    o.close()
    hit = mm > 0
    out["views"].append({"index": v["index"], "name": v.get("name"), "pano": v["pano"], "ai": v["panoAi"], "eye": p, "target": q,
                         "depth": os.path.basename(path), "hitShare": round(float(hit.mean()), 4), "mirrorShare": round(float((flag == 128).mean()), 4),
                         "glassShare": round(float((flag == 64).mean()), 4), "medianM": round(float(np.median(mm[hit])) / 1000, 2) if hit.any() else None})
    print("DEPTH view %d (%s): %.1f%% hit, median %.2f m, mirror %.1f%%, through glass %.1f%%, %.1fs" % (
        v["index"], v.get("name"), 100 * hit.mean(), out["views"][-1]["medianM"] or 0, 100 * (flag == 128).mean(), 100 * (flag == 64).mean(), time.time() - t1), flush=True)
json.dump(out, open(os.path.join(out_dir, "projection.json"), "w"), indent=1)
print("DEPTH done %.1fs" % (time.time() - t0), flush=True)
