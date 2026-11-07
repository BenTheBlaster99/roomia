"""
Scene analysis for the automatic look (8 Nov, Pipeline v1): runs in Blender on look/prepared.blend, reads nothing from a recipe.

blender -b prepared.blend --python look_analyze.py -- <job.json>
job: {points: [{index, name, position: glTF [x, y, z]}], outDir, elevations: [5, 9, 13], azimuthStep: 15}
Writes <outDir>/analysis.json:
  sun      the azimuth (compass from +Y north, clockwise to +X, as look_apply.sun_dir) at which the low sun reaches the most
           floor samples around the points THROUGH a window (rays pass through glass, stop at anything else)
  emissive each glowing material: how many objects, their median longest side (small = downlight, long = strip)
  cameras  per point: the median and the shortest free distance in 26 directions, and a verdict (inside furniture / too tight)
"""
import json, math, os, re, sys
import bpy
from mathutils import Vector

JOB = json.load(open(sys.argv[sys.argv.index("--") + 1]))
OUT = JOB["outDir"]
scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
GLASS_RX = re.compile(r"glass|verre|vitre|window|vitrage", re.I)
SKIP_RX = re.compile(r"^(roomia_|look_)")


def gl2b(p):
    return Vector((p[0], -p[2], p[1]))


def is_glass(ob, face_index):
    try:
        slot = ob.material_slots[ob.data.polygons[face_index].material_index]
        m = slot.material
    except Exception:
        return False
    if m is None:
        return False
    if GLASS_RX.search(m.name):
        return True
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == "BSDF_GLASS":
                return True
            if n.type == "BSDF_PRINCIPLED" and n.inputs["Transmission Weight"].default_value > 0.6:
                return True
    return False


def cast(origin, direction, maxd=300.0):
    """first hit that is not the sky dome or a glass pane; also how many glass panes the ray went through"""
    glass = 0
    o = origin.copy()
    travelled = 0.0
    for _ in range(12):
        hit, loc, nrm, idx, ob, mw = scene.ray_cast(dg, o, direction, distance=maxd - travelled)
        if not hit:
            return None, glass, maxd
        travelled += (loc - o).length
        if SKIP_RX.search(ob.name):
            o = loc + direction * 0.01
            continue
        if is_glass(ob, idx):
            glass += 1
            o = loc + direction * 0.01
            continue
        return ob, glass, travelled
    return None, glass, travelled


points = JOB["points"]
elevs = [math.radians(float(e)) for e in JOB.get("elevations", [5, 9, 13])]
step = int(JOB.get("azimuthStep", 15))

# --- the sun: the direction that lights the most floor through windows
samples = []
for p in points:
    c = gl2b(p["position"])
    floor_z = c.z - float(JOB.get("eyeHeight", 1.6))
    for dx in (-2.4, -1.2, 0, 1.2, 2.4):
        for dy in (-2.4, -1.2, 0, 1.2, 2.4):
            samples.append(Vector((c.x + dx, c.y + dy, floor_z + 0.8)))
scores = {}
for az in range(0, 360, step):
    a = math.radians(az)
    n = 0
    for elev in elevs:
        d = Vector((math.sin(a) * math.cos(elev), math.cos(a) * math.cos(elev), math.sin(elev)))
        for s in samples:
            ob, glass, _ = cast(s, d)
            if ob is None and glass >= 1:
                n += 1
    scores[az] = n
azs = sorted(scores)
smooth = {az: scores[az] + 0.5 * (scores[(az - step) % 360] + scores[(az + step) % 360]) for az in azs}
best = max(azs, key=lambda a: smooth[a])
print("LOOK_SUN best %d  scores %s" % (best, {a: scores[a] for a in azs if scores[a]}), flush=True)

# --- the glowing materials
emissive, strength = {}, {}
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    glow = 0.0
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Emission Strength"].default_value > 0 and (n.inputs["Emission Color"].is_linked or max(list(n.inputs["Emission Color"].default_value)[:3]) > 0):
            glow = max(glow, n.inputs["Emission Strength"].default_value)
        if n.type == "EMISSION" and n.inputs["Strength"].default_value > 0:
            glow = max(glow, n.inputs["Strength"].default_value)
    if glow:
        emissive[m.name] = []
        strength[m.name] = round(glow, 2)
for ob in scene.objects:
    if ob.type == "MESH" and not ob.hide_render:
        for s in ob.material_slots:
            if s.material and s.material.name in emissive:
                emissive[s.material.name].append(max(ob.dimensions))
em_out = {}
for k, v in emissive.items():
    if v:
        v = sorted(v)
        em_out[k] = {"count": len(v), "medianSide": round(v[len(v) // 2], 3), "strength": strength.get(k)}

# --- the cameras: inside furniture, or a spot too tight to look at
dirs = [Vector((x, y, z)).normalized() for x in (-1, 0, 1) for y in (-1, 0, 1) for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)]
cams = []
for p in points:
    c = gl2b(p["position"])
    ds = sorted(cast(c, d, 60.0)[2] for d in dirs)
    med, mn = ds[len(ds) // 2], ds[0]
    near = sum(1 for x in ds if x < 0.45) / len(ds)
    verdict = "ok"
    if mn < 0.12 or med < 0.6:
        verdict = "inside furniture or too tight"
    cams.append({"index": p["index"], "name": p.get("name"), "median": round(med, 2), "min": round(mn, 2), "nearShare": round(near, 2), "verdict": verdict})
json.dump({"sun": {"azimuth": best, "elevation": 6, "scores": scores}, "emissive": em_out, "cameras": cams}, open(os.path.join(OUT, "analysis.json"), "w"), indent=1)
print("LOOK_ANALYSIS_OK", flush=True)
os._exit(0)
