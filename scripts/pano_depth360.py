# blender -b --python scripts/pano_depth360.py -- <scene dir> <look auto dir> <out dir> [width]   (12 Nov, for pano_focus.py)
# Distance per pixel for each Cycles 360 of a look render (job-render.json: the exact eyes, yaw 0 = middle of the picture along +X).
# Same ray layout as scripts/ai-depth.py. Glass is looked through. Writes depth-<k>.npy (float16 metres, 0 = nothing hit) and eyes.json.
import bpy, sys, os, re, json, math, time, glob
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

a = sys.argv[sys.argv.index("--") + 1:]
scene_dir, auto_dir, out_dir = a[:3]
W = int(a[3]) if len(a) > 3 else 2048
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
GLASS = re.compile(r"glass|verre|vitre|window", re.I)
FABRIC = re.compile(r"curtain|rideau|voilage|tulle|sheer|drape|cortina", re.I)


def is_glass(mat):
    if mat is None:
        return False
    base = re.sub(r"\.\d{3}$", "", mat.name)
    if GLASS.search(base):
        return True
    b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat.use_nodes else None
    if b is not None and not FABRIC.search(base):
        al = b.inputs["Alpha"]
        if (not al.is_linked and al.default_value < 0.9) or b.inputs["Transmission Weight"].default_value > 0.5:
            return True
    return False


V, T, G, off = [], [], [], 0
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
    g = np.array([is_glass(s.material) for s in ob.material_slots] or [False])
    mw = np.array(ob.matrix_world, np.float32)
    V.append(co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3])
    T.append(tri.reshape(-1, 3) + off)
    G.append(g[np.minimum(mi, len(g) - 1)])
    off += len(co) // 3
V = np.concatenate(V); T = np.concatenate(T); G = np.concatenate(G)
bvh = BVHTree.FromPolygons(V, T[~G], all_triangles=True)
print("DEPTH360 %d triangles (%d glass skipped), %.1fs" % (len(T), int(G.sum()), time.time() - t0), flush=True)

job = json.load(open(os.path.join(auto_dir, "job-render.json")))
lon = ((np.arange(W) + 0.5) / W - 0.5) * 2 * math.pi
lat = (0.5 - (np.arange(H) + 0.5) / H) * math.pi
LON, LAT = np.meshgrid(lon, lat)
eyes = {}
for v in job["views"]:
    t1 = time.time()
    k = int(v["name"][1:])
    p = v["position"]
    eye = Vector((p[0], -p[2], p[1]))
    yaw = math.radians(float(v.get("yaw", 0)))
    fwd = np.array([math.cos(yaw), math.sin(yaw), 0.0])
    right = np.array([math.sin(yaw), -math.cos(yaw), 0.0])
    D = (np.cos(LAT) * np.cos(LON))[..., None] * fwd + (np.cos(LAT) * np.sin(LON))[..., None] * right
    D[..., 2] += np.sin(LAT)
    D = D.reshape(-1, 3)
    dist = np.zeros(len(D), np.float32)
    rc = bvh.ray_cast
    for i in range(len(D)):
        h = rc(eye, Vector(D[i]), 200.0)
        if h[0] is not None:
            dist[i] = h[3]
    np.save(os.path.join(out_dir, "depth-%d.npy" % k), dist.reshape(H, W).astype(np.float16))
    eyes[k] = {"eye": [eye.x, eye.y, eye.z], "yaw": float(v.get("yaw", 0))}
    hit = dist > 0
    print("DEPTH360 view %d: %.1f%% hit, median %.2f m, %.1fs" % (k, 100 * hit.mean(), float(np.median(dist[hit])), time.time() - t1), flush=True)
json.dump({"width": W, "height": H, "views": eyes}, open(os.path.join(out_dir, "eyes.json"), "w"), indent=1)
print("DEPTH360 done %.1fs" % (time.time() - t0), flush=True)
