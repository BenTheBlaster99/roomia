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
HDIRS = [Vector((math.cos(a), math.sin(a), 0.0)) for a in (k * math.pi / 8 for k in range(16))]


def clearance(c):
    """the shortest free distance around a spot, at eye height and at furniture height (90 cm lower), capped at 3 m"""
    return min(cast(c + Vector((0, 0, dz)), d, 3.0)[2] for d in HDIRS for dz in (0.0, -0.9))


def better_spot(c):
    """A camera pressed against a wall or inside a cupboard (a 360 that is half a white wall): the spot within 1.6 m, on the same
    floor, under a ceiling and seen from the original eye, that has the most room around it (nearer spots preferred).
    Returns (spot, distance, old clearance, new clearance) or None when the camera is fine or nothing better is near."""
    old = clearance(c)
    if old >= float(JOB.get("minClearance", 0.75)):
        return None
    down = cast(c, Vector((0, 0, -1)), 3.0)
    floor0 = c.z - down[2] if down[0] is not None else None
    best = None
    # first the spots the original eye sees; a camera shut inside a cupboard sees none, so then any spot within 2 m (11 Nov, Scene 2)
    tries = [(r, True) for r in (0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6)] + [(r, False) for r in (0.4, 0.8, 1.2, 1.6, 2.0)]
    for r, must_see in tries:
        if not must_see and best is not None:
            break
        for d in HDIRS:
            q = c + d * r
            ob, glass, dist = cast(c, d, r)
            if must_see and (glass or (ob is not None and dist < r)):
                continue  # not seen from the original eye (a wall or the cupboard's door between them)
            dn = cast(q, Vector((0, 0, -1)), 3.0)
            if dn[0] is None or (floor0 is not None and abs((q.z - dn[2]) - floor0) > 0.15):
                continue  # no floor under it, or another level (a step, the bed's top)
            if cast(q, Vector((0, 0, 1)), 6.0)[0] is None:
                continue  # no ceiling: outside
            cl = clearance(q)
            score = min(cl, 1.2) - 0.15 * r
            if cl >= max(old + 0.2, 0.6) and (best is None or score > best[0]):
                best = (score, q, r, cl)
    return None if best is None else (best[1], best[2], old, best[3])


for p in points:
    c = gl2b(p["position"])
    ds = sorted(cast(c, d, 60.0)[2] for d in dirs)
    med, mn = ds[len(ds) // 2], ds[0]
    open_share = sum(1 for x in ds if x >= 59.0) / len(ds)  # rays that leave without touching anything: a camera outside the building
    near = sum(1 for x in ds if x < 0.45) / len(ds)
    verdict = "ok"
    if mn < 0.12 or med < 0.6:
        verdict = "inside furniture or too tight"
    if open_share > 0.5:
        verdict = "outside the building"
    entry = {"index": p["index"], "name": p.get("name"), "median": round(med, 2), "min": round(mn, 2), "nearShare": round(near, 2), "openShare": round(open_share, 2), "verdict": verdict}
    if verdict != "outside the building":
        mv = better_spot(c)
        if mv is not None:
            entry["moved"], entry["movedBy"], entry["clearance"] = [mv[0].x, mv[0].z, -mv[0].y], round(mv[1], 2), [round(mv[2], 2), round(mv[3], 2)]
            entry["verdict"] = "ok"  # a 360 from the better spot nearby instead of none (11 Nov: Scene 2 stood inside a wardrobe)
            print("LOOK_CAMERA %s moved %.2f m: clearance %.2f -> %.2f" % (p.get("name"), mv[1], mv[2], mv[3]), flush=True)
    cams.append(entry)
json.dump({"sun": {"azimuth": best, "elevation": 6, "scores": scores}, "emissive": em_out, "cameras": cams}, open(os.path.join(OUT, "analysis.json"), "w"), indent=1)
print("LOOK_ANALYSIS_OK", flush=True)
os._exit(0)
