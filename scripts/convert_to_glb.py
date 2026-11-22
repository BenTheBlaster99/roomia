"""
22 Nov: one converter for every 3D format Blender can read, so Roomia is not limited to SketchUp's .dae / .glb.

blender -b --python scripts/convert_to_glb.py -- <input> <output.glb> <meta.json> [unit]

input   .fbx .obj .stl .ply .usd .usda .usdc .usdz .abc .blend (.dae and .gltf/.glb have their own readers in lib/scene-prep)
unit    auto (default), m, cm, mm, in, ft: the file's length unit when it does not say (OBJ, STL, PLY carry none)

Writes a GLB (metres, Y-up, materials and textures as Blender reads them) and a JSON next to it:
  { cameras: [{name, position, target, hfov}], unit, scale, upAxis, objects, triangles, missingTextures, warnings }
The cameras are the file's own saved views (the same role as SketchUp's scenes): glTF frame, metres.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT, META = argv[0], argv[1], argv[2]
UNIT = argv[3] if len(argv) > 3 else "auto"
ext = os.path.splitext(SRC)[1].lower()
warnings = []

UNIT_M = {"m": 1.0, "cm": 0.01, "mm": 0.001, "in": 0.0254, "ft": 0.3048}

bpy.ops.wm.read_factory_settings(use_empty=True)


def run(op, **kw):
    r = op(**kw)
    if "FINISHED" not in r:
        raise SystemExit("import failed: %s" % op)


if ext == ".fbx":
    run(bpy.ops.import_scene.fbx, filepath=SRC)
elif ext == ".obj":
    run(bpy.ops.wm.obj_import, filepath=SRC)
elif ext == ".stl":
    run(bpy.ops.wm.stl_import, filepath=SRC)
elif ext == ".ply":
    run(bpy.ops.wm.ply_import, filepath=SRC)
elif ext in (".usd", ".usda", ".usdc", ".usdz"):
    run(bpy.ops.wm.usd_import, filepath=SRC)
elif ext == ".abc":
    run(bpy.ops.wm.alembic_import, filepath=SRC)
elif ext == ".blend":
    run(bpy.ops.wm.open_mainfile, filepath=SRC)
    # a .blend states its own unit
    k = bpy.context.scene.unit_settings.scale_length
    if abs(k - 1.0) > 1e-9:
        for o in bpy.data.objects:
            if o.parent is None:
                o.scale *= k
                o.location *= k
else:
    raise SystemExit("unsupported format %s" % ext)

# --- what came in
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
if not meshes:
    raise SystemExit("the file holds no mesh")
bpy.context.view_layer.update()


def world_bbox():
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for o in meshes:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def roots():
    return [o for o in bpy.data.objects if o.parent is None]


def transform_all(scale=1.0, rot_x_deg=0.0):
    """scale and/or turn every top-level object around the world origin"""
    from mathutils import Matrix

    m = Matrix.Rotation(math.radians(rot_x_deg), 4, "X") @ Matrix.Scale(scale, 4)
    for o in roots():
        o.matrix_world = m @ o.matrix_world
    bpy.context.view_layer.update()


# --- units: only for formats that do not carry one
scale = 1.0
unit = "file"
lo, hi = world_bbox()
ext_xyz = hi - lo
if ext in (".obj", ".stl", ".ply", ".abc"):
    if UNIT != "auto" and UNIT in UNIT_M:
        scale, unit = UNIT_M[UNIT], UNIT
    else:
        # an apartment or a house is 3 to 150 m across: pick the unit that lands there (metres first, then cm, then mm)
        longest = max(ext_xyz.x, ext_xyz.y, ext_xyz.z)
        for name in ("m", "cm", "mm"):
            if 3.0 <= longest * UNIT_M[name] <= 150.0:
                scale, unit = UNIT_M[name], name
                break
        else:
            unit = "m"
            warnings.append("unit unclear (longest side %.1f): kept as metres" % longest)
    if scale != 1.0:
        transform_all(scale=scale)
        warnings.append("unit %s: scaled by %g" % (unit, scale))

# --- orientation: OBJ/STL/PLY do not say which axis is up. A flat apartment is far lower than wide: when Z is not the smallest side
# and another axis is clearly smaller, that axis is up.
up = "Z"
lo, hi = world_bbox()
e = hi - lo
if ext in (".obj", ".stl", ".ply", ".abc"):
    smallest = min(range(3), key=lambda i: e[i])
    if smallest == 1 and e[1] < 0.6 * e[2]:
        transform_all(rot_x_deg=90.0)  # Y was up (most exporters): turn it to Z
        up = "Y"
        warnings.append("up axis guessed: Y (turned to Z)")
    elif smallest == 0 and e[0] < 0.6 * e[2]:
        warnings.append("X looks like the up axis: left as it is, check the orientation")

# --- the file's saved views
out_cams = []
for o in cams:
    loc = o.matrix_world.translation
    fwd = o.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    tgt = loc + fwd.normalized() * 3.0
    cd = o.data
    hfov = math.degrees(cd.angle_x) if cd.type == "PERSP" else 60.0
    g = lambda v: [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]  # Blender Z-up -> glTF Y-up
    if (loc - tgt).length < 1e-6:
        continue
    out_cams.append({"name": o.name[:80], "position": g(loc), "target": g(tgt), "hfov": round(max(5.0, min(150.0, hfov)), 2)})
for o in cams:
    bpy.data.objects.remove(o, do_unlink=True)

# --- missing textures: reported, the surface keeps its colour
missing = sorted({os.path.basename(i.filepath) for i in bpy.data.images if i.source == "FILE" and i.filepath and not i.has_data and not os.path.exists(bpy.path.abspath(i.filepath))})

tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)

# --- GLB
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_cameras=False,
    export_lights=False,
    export_apply=True,
    export_yup=True,
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_texcoords=True,
    export_normals=True,
    use_selection=False,
)
json.dump(
    {"cameras": out_cams, "unit": unit, "scale": scale, "upAxis": up, "objects": len(meshes), "triangles": tris, "missingTextures": missing, "warnings": warnings},
    open(META, "w"),
)
print("CONVERT_OK objects=%d triangles=%d cameras=%d unit=%s scale=%g up=%s missing=%d" % (len(meshes), tris, len(out_cams), unit, scale, up, len(missing)), flush=True)
