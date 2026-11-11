"""
Step A of the walk-AI-detail plan (11 Nov 2026): every surface of one room gets a texture of its own.

blender -b <prepared.blend> --python walk_unwrap.py -- <job.json>

job: {eye: [x,y,z] glTF, radius: 6, pxPerCm: 2.5, maxSize: 4096, outDir, minAreaM2: 0.05, maxPolys: 200000, samples: 1}

For the faces within `radius` m of the eye (objects larger than the room, like a wall that spans the apartment, are split first):
  1. keep only opaque, non-emissive, non-helper surfaces (glass, mirrors, lamps, roomia_* helpers are left alone)
  2. a new UV layer `uv_unique` (smart project, islands at one texel density, packed)
  3. objects are joined in atlases (one image per ~maxSize^2 texels), each baked three times:
       col  the base colour as the walk draws it (texture x colour), PNG sRGB
       pos  the world position of every texel (float32), npz
       nrm  the world normal of every texel (float32), npz
  4. the materials of those objects point at the baked colour through uv_unique (roughness / normal image textures are dropped:
     they used the old UVs; recorded in the report)
Writes outDir/walk-unwrap.json, outDir/<atlas>-col.png, <atlas>-pos.npz, <atlas>-nrm.npz and walk-room.glb (just the room's objects).
"""
import bpy, bmesh, json, math, os, re, sys, time
import numpy as np
from mathutils import Vector

JOB = json.load(open(sys.argv[sys.argv.index("--") + 1]))
OUT = JOB["outDir"]
os.makedirs(OUT, exist_ok=True)
gl2b = lambda p: Vector((p[0], -p[2], p[1]))
EYE, R = gl2b(JOB["eye"]), float(JOB.get("radius", 6))
PPC = float(JOB.get("pxPerCm", 2.5))
MAXS = int(JOB.get("maxSize", 4096))
MIN_AREA = float(JOB.get("minAreaM2", 0.05))
MAX_POLYS = int(JOB.get("maxPolys", 200000))
SKIP_OBJ = re.compile(r"^(roomia_|look_)", re.I)
SKIP_MAT = re.compile(r"glass|vidro|cristal|mirror|espelho|miroir|water|agua|sky|roomia_|look_|enscape|led|light|lamp|lum", re.I)
t0 = time.time()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = int(JOB.get("samples", 1))
scene.cycles.use_denoising = False
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type != "CPU"
    scene.cycles.device = "GPU"
except Exception as e:
    print("WALK_INFO gpu not set:", e)


def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m and m.use_nodes else None


def opaque_plain(m):
    """a surface we may bake: a Principled that is opaque and does not glow or transmit"""
    if m is None or SKIP_MAT.search(m.name):
        return False
    b = principled(m)
    if b is None:
        return False
    if b.inputs["Alpha"].is_linked:
        # SketchUp's importer drives Alpha through Math nodes even on opaque materials ([Stone Vein Gray], the floor): only an
        # image upstream makes a real cutout
        if image_upstream(b.inputs["Alpha"]):
            return False
    elif b.inputs["Alpha"].default_value < 0.98:
        return False
    if b.inputs["Transmission Weight"].default_value > 0.05 or b.inputs["Transmission Weight"].is_linked:
        return False
    try:
        if b.inputs["Emission Strength"].default_value > 0 and (b.inputs["Emission Color"].is_linked or max(b.inputs["Emission Color"].default_value[:3]) > 0.05):
            return False
    except KeyError:
        pass
    return True


_alpha_cache = {}


def image_has_cutout(img):
    """True when the image really has transparent pixels (SketchUp exports many opaque textures with an alpha channel)"""
    if img is None:
        return False
    if img.name in _alpha_cache:
        return _alpha_cache[img.name]
    cut = False
    try:
        if img.channels == 4 and img.size[0] > 0:
            px = np.empty(img.size[0] * img.size[1] * 4, np.float32)
            img.pixels.foreach_get(px)
            cut = bool((px[3::4] < 0.9).mean() > 0.002)
    except Exception:
        cut = True
    _alpha_cache[img.name] = cut
    return cut


def image_upstream(sock, depth=0):
    """an image with real transparency feeds this socket (a cutout: leaves, lattices)"""
    for l in sock.links:
        n = l.from_node
        if n.type == "TEX_IMAGE":
            if image_has_cutout(n.image):
                return True
            continue
        if depth < 6 and any(image_upstream(i, depth + 1) for i in n.inputs if i.is_linked):
            return True
    return False


def world_scale(o):
    return abs(o.matrix_world.to_3x3().determinant()) ** (1 / 3)


def deselect_all():
    for o in bpy.context.view_layer.objects:
        o.select_set(False)


def activate(o):
    deselect_all()
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


# ---- 1. the room's objects, split to the room's faces
report = {"eye": JOB["eye"], "radius": R, "pxPerCm": PPC, "skipped": {"helper": 0, "material": 0, "polys": 0, "far": 0, "tiny": 0}, "dropped_textures": [], "atlases": []}
cands = []
for o in list(scene.objects):
    if o.type != "MESH" or o.hide_render or not o.data.polygons:
        continue
    if SKIP_OBJ.search(o.name):
        report["skipped"]["helper"] += 1
        continue
    if len(o.data.polygons) > MAX_POLYS:
        report["skipped"]["polys"] += 1
        continue
    if not o.material_slots or not all(opaque_plain(s.material) for s in o.material_slots if s.material) or not any(s.material for s in o.material_slots):
        report["skipped"]["material"] += 1
        continue
    me = o.data
    n = len(me.polygons)
    cen = np.empty(n * 3, np.float32)
    me.polygons.foreach_get("center", cen)
    cen = cen.reshape(n, 3)
    mw = np.array(o.matrix_world, np.float32)
    wc = cen @ mw[:3, :3].T + mw[:3, 3]
    d = np.linalg.norm(wc - np.array(EYE, np.float32), axis=1)
    inside = d <= R
    if not inside.any():
        report["skipped"]["far"] += 1
        continue
    cands.append((o, inside))

print("WALK_INFO %d candidate objects (%.0f s)" % (len(cands), time.time() - t0), flush=True)
def bisect_to_box(o):
    """cut every face of o at the four vertical planes eye +-R (x and y): a floor slab or wall that spans the apartment keeps only
    the room's part, so its texels go to the room (11 Nov: the F5 floor gave a 1260 m2 atlas at 0.79 px/cm)"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    mwi = o.matrix_world.inverted()
    m3t = o.matrix_world.to_3x3().transposed()
    for axis in (0, 1):
        for sgn in (-1, 1):
            co_w = EYE.copy()
            co_w[axis] += sgn * R
            n_w = Vector((0, 0, 0))
            n_w[axis] = 1.0
            n_l = (m3t @ n_w).normalized()
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=mwi @ co_w, plane_no=n_l, dist=1e-6, clear_inner=False, clear_outer=False)
    bm.to_mesh(me)
    bm.free()
    me.update()
    n = len(me.polygons)
    cen = np.empty(n * 3, np.float32)
    me.polygons.foreach_get("center", cen)
    mw = np.array(o.matrix_world, np.float32)
    wc = cen.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
    return np.linalg.norm(wc - np.array(EYE, np.float32), axis=1) <= R


room = []
for o, inside in cands:
    me = o.data
    if not inside.all():
        inside = bisect_to_box(o)
        if inside.all():
            room.append(o)
            continue
        if not inside.any():
            report["skipped"]["far"] += 1
            continue
        activate(o)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_mode(type="FACE")
        bpy.ops.mesh.select_all(action="DESELECT")
        bm = bmesh.from_edit_mesh(me)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:
            if inside[f.index]:
                f.select_set(True)  # select_set flushes to the edges and vertices (a bare f.select = True does not)
        bmesh.update_edit_mesh(me)
        before = set(scene.objects)
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        new = [x for x in scene.objects if x not in before]
        if not new:
            report["skipped"]["splitFailed"] = report["skipped"].get("splitFailed", 0) + 1
            print("WALK_WARN split produced nothing for", o.name, int(inside.sum()), "of", len(inside), flush=True)
            continue
        room.extend(new)
    else:
        room.append(o)
print("WALK_INFO %d room objects after splitting (%.0f s)" % (len(room), time.time() - t0), flush=True)


def farthest(o):
    me = o.data
    n = len(me.polygons)
    cen = np.empty(n * 3, np.float32)
    me.polygons.foreach_get("center", cen)
    mw = np.array(o.matrix_world, np.float32)
    wc = cen.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
    return float(np.linalg.norm(wc - np.array(EYE, np.float32), axis=1).max())


far_bad = [(o.name, round(farthest(o), 1)) for o in room if farthest(o) > R + 0.01]
print("WALK_INFO room objects beyond the radius after splitting:", len(far_bad), far_bad[:5], flush=True)
report["beyondRadius"] = len(far_bad)


def area_m2(o):
    s = world_scale(o)
    return sum(p.area for p in o.data.polygons) * s * s


room = [(area_m2(o), o) for o in room]
tiny = [o for a, o in room if a < MIN_AREA]
report["skipped"]["tiny"] = len(tiny)
room = [(a, o) for a, o in room if a >= MIN_AREA]
# dense, curved meshes (fabrics, chairs, plants: a tiny island per triangle with smart project) keep the textures they have
DENSE_FACE_M2 = float(JOB.get("denseFaceM2", 0.004))  # 6 x 6 cm per face on average: fabrics and chairs, not tiled floors
dense = [o for a, o in room if a / max(len(o.data.polygons), 1) < DENSE_FACE_M2 or len(o.data.polygons) > int(JOB.get("maxUnwrapPolys", 20000))]
report["skipped"]["dense"] = len(dense)
report["denseKeptArea"] = round(sum(a for a, o in room if o in dense), 1)
report["denseBiggest"] = [(o.name, round(a, 2), len(o.data.polygons), [s.material.name for s in o.material_slots if s.material][:2]) for a, o in sorted(room, key=lambda r: -r[0]) if o in dense][:12]
print("WALK_INFO dense kept (biggest):", report["denseBiggest"][:6], flush=True)
room = sorted([(a, o) for a, o in room if o not in dense], key=lambda r: -r[0])
total_area = sum(a for a, _ in room)
print("WALK_INFO room surfaces: %d objects, %.1f m2" % (len(room), total_area), flush=True)

# ---- 2. atlases: greedy groups whose area fits one image at the wanted density
cap_m2 = (MAXS * MAXS * 0.6) / (PPC * PPC * 1e4)
groups = []
for a, o in room:
    for g in groups:
        if g["area"] + a <= cap_m2:
            g["objs"].append(o)
            g["area"] += a
            break
    else:
        groups.append({"area": a, "objs": [o]})
print("WALK_INFO %d atlases (capacity %.0f m2 each at %.1f px/cm)" % (len(groups), cap_m2, PPC), flush=True)


def new_image(name, size, data=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=data)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return img


def bake_into(obj, img, bake_type, pass_filter=None, margin=6):
    """bake `bake_type` of every material of obj into img (an Image Texture node made active in each material)"""
    nodes = []
    for s in obj.material_slots:
        nt = s.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.select = True
        nt.nodes.active = n
        nodes.append((nt, n))
    activate(obj)
    kw = dict(type=bake_type, margin=margin, use_clear=True)
    if pass_filter:
        kw["pass_filter"] = pass_filter
    bpy.ops.object.bake(**kw)
    for nt, n in nodes:
        nt.nodes.remove(n)


def attr_material(kind):
    m = bpy.data.materials.new("rm_tmp_" + kind)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    em = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if kind == "nrm":
        mul = nt.nodes.new("ShaderNodeVectorMath")
        mul.operation = "MULTIPLY_ADD"
        mul.inputs[1].default_value = (0.5, 0.5, 0.5)
        mul.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], mul.inputs[0])
        nt.links.new(mul.outputs[0], em.inputs["Color"])
    else:
        nt.links.new(geo.outputs["Position"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


tmp = {"pos": attr_material("pos"), "nrm": attr_material("nrm")}
room_objs = []
for gi, g in enumerate(groups):
    name = "rm_atlas%02d" % gi
    objs = g["objs"]
    for o in objs:
        for l in list(o.data.uv_layers):
            o.data.uv_layers.remove(l)
    activate(objs[0])
    for o in objs:
        o.select_set(True)
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    _vs = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", _vs)
    _mw = np.array(ob.matrix_world, np.float32)
    _w = _vs.reshape(-1, 3) @ _mw[:3, :3].T + _mw[:3, 3]
    _d = np.linalg.norm(_w - np.array(EYE, np.float32), axis=1)
    print("WALK_DBG %s verts %d, dist to eye max %.1f, 99%% %.1f, scale %.4f, loc %s, parent %s, users in group %d" % (name, len(_d), _d.max(), np.percentile(_d, 99), world_scale(ob), tuple(round(x, 1) for x in ob.location), ob.parent.name if ob.parent else None, len(objs)), flush=True)
    # unique UVs at one texel density
    uv = ob.data.uv_layers.new(name="uv_unique")
    ob.data.uv_layers.active = uv
    ob.data.uv_layers["uv_unique"].active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    # texel density achieved: texels per cm from the UV area against the world area
    me = ob.data
    s = world_scale(ob)
    uva = 0.0
    for p in me.polygons:
        pts = [me.uv_layers["uv_unique"].data[li].uv for li in p.loop_indices]
        uva += abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
    wa = sum(p.area for p in me.polygons) * s * s
    # size so the density is PPC (never above MAXS)
    need = math.sqrt(wa * 1e4 * PPC * PPC / max(uva, 1e-6))
    size = int(min(MAXS, max(256, 2 ** math.ceil(math.log2(max(need, 1))))))
    dens = size * math.sqrt(uva / max(wa * 1e4, 1e-6))
    # 1. colour
    col = new_image(name + "_col", size)
    t = time.time()
    bake_into(ob, col, "DIFFUSE", {"COLOR"})
    col.filepath_raw = os.path.join(OUT, name + "-col.png")
    col.file_format = "PNG"
    col.save()
    # 2. position, 3. normal: the surfaces drawn with an emission of the attribute, then the originals put back
    originals = [s_.material for s_ in ob.material_slots]
    for kind in ("pos", "nrm"):
        img = new_image(name + "_" + kind, size, data=True)
        for s_ in ob.material_slots:
            s_.material = tmp[kind]
        bake_into(ob, img, "EMIT", None, margin=4)
        arr = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(arr)
        arr = arr.reshape(size, size, 4)[::-1]  # Blender stores the bottom row first: flipped so that row 0 is the top, like the PNG
        # texels the bake did not reach stay at 0 alpha? (alpha is 1 on baked texels): use a mask from the UV coverage instead
        np.savez_compressed(os.path.join(OUT, "%s-%s.npz" % (name, kind)), v=arr[..., :3].astype(np.float32))
        bpy.data.images.remove(img)
    for s_, m in zip(ob.material_slots, originals):
        s_.material = m
    # 4. the materials now read the baked colour through uv_unique (copies: the same material elsewhere in the scene keeps its own)
    for s_ in ob.material_slots:
        m = s_.material.copy()
        s_.material = m
        nt = m.node_tree
        b = principled(m)
        for inp in ("Base Color", "Roughness", "Normal", "Metallic", "Specular IOR Level"):
            if b.inputs[inp].is_linked:
                if inp != "Base Color":
                    report["dropped_textures"].append("%s.%s" % (m.name, inp))
                for l in list(b.inputs[inp].links):
                    nt.links.remove(l)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = col
        tex.interpolation = "Linear"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "uv_unique"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    room_objs.append(ob)
    report["atlases"].append({"name": name, "objects": len(objs), "worldArea": round(wa, 2), "size": size, "texelsPerCm": round(dens, 2), "col": name + "-col.png", "pos": name + "-pos.npz", "nrm": name + "-nrm.npz", "seconds": round(time.time() - t, 1)})
    print("WALK_ATLAS", json.dumps(report["atlases"][-1]), flush=True)

# ---- the room's objects as a glTF (just them), colour textures embedded
deselect_all()
for ob in room_objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = room_objs[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "walk-room.glb"), export_format="GLB", use_selection=True, export_yup=True,
                          export_image_format="AUTO", export_materials="EXPORT", export_apply=False)
if JOB.get("saveBlend"):
    bpy.ops.wm.save_as_mainfile(filepath=JOB["saveBlend"], compress=False)
    print("WALK_INFO scene saved", JOB["saveBlend"], flush=True)
report["roomArea"] = round(total_area, 1)
report["seconds"] = round(time.time() - t0, 1)
json.dump(report, open(os.path.join(OUT, "walk-unwrap.json"), "w"), indent=1)
print("WALK_OK", json.dumps({k: report[k] for k in ("roomArea", "seconds", "skipped")}), flush=True)
