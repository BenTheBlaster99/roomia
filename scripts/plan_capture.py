"""
The architect's plan, Blender half (11 Nov): the cut through the model at a given height as exact segments, each one flagged
wall-like (the triangle stands over a metre tall), glass (a glass/window material) and tagged with its object, plus the
list of the objects standing on the level (name, materials, footprint in plan pixels) for naming the rooms.

blender -b <scene.blend> --python plan_capture.py -- <job.json>
job: {frame: [x0, y0, x1, y1] (Blender metres), width, height (plan pixels of the tour's plan-hd.png), floor, cut, out}
Writes <out>/plan-cut.npy  (N x 9 float32: x0, y0, x1, y1 in plan-hd pixels, tall, glass, object id, triangle's lowest and highest point above the floor)
       <out>/plan-objects.json
"""
import json, os, re, sys
import bpy
import numpy as np
from mathutils import Vector

JOB = json.load(open(sys.argv[sys.argv.index("--") + 1]))
OUT = JOB["out"]
os.makedirs(OUT, exist_ok=True)
x0, y0, x1, y1 = JOB["frame"]
W, H = int(JOB["width"]), int(JOB["height"])
FLOOR, CUT = float(JOB["floor"]), float(JOB["cut"])
sx, sy = W / (x1 - x0), H / (y1 - y0)
GLASS_RX = re.compile(r"glass|verre|vitre|vitrage|window|fenetre|fenêtre|miroir|mirror", re.I)
SKIP_RX = re.compile(r"^(roomia_|look_|plan_)")
scene = bpy.context.scene


def glassy(mat):
    if mat is None:
        return False
    if GLASS_RX.search(mat.name) and not re.search(r"mirror|miroir", mat.name, re.I):
        return True
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_GLASS":
                return True
            if n.type == "BSDF_PRINCIPLED":
                tw = n.inputs.get("Transmission Weight")
                al = n.inputs.get("Alpha")
                if (tw is not None and not tw.is_linked and tw.default_value > 0.6) or (al is not None and not al.is_linked and al.default_value < 0.5):
                    return True
    return False


segs, objects = [], []
for ob in scene.objects:
    if ob.type != "MESH" or ob.hide_render or SKIP_RX.search(ob.name):
        continue
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    zs = [p.z for p in bb]
    if max(p.x for p in bb) < x0 or min(p.x for p in bb) > x1 or max(p.y for p in bb) < y0 or min(p.y for p in bb) > y1:
        continue
    if max(zs) < FLOOR - 0.3 or min(zs) > FLOOR + 2.2:
        continue  # another level, or something hanging from the ceiling
    oid = len(objects)
    mats = [s.material.name for s in ob.material_slots if s.material]
    xs_, ys_ = [p.x for p in bb], [p.y for p in bb]
    objects.append({"id": oid, "name": ob.name, "data": ob.data.name, "parent": ob.parent.name if ob.parent else "", "mats": mats[:6],
                    "cx": ((min(xs_) + max(xs_)) / 2 - x0) * sx, "cy": (y1 - (min(ys_) + max(ys_)) / 2) * sy,
                    "w": (max(xs_) - min(xs_)) * sx, "h": (max(ys_) - min(ys_)) * sy, "zmin": min(zs) - FLOOR, "zmax": max(zs) - FLOOR})
    if min(zs) > CUT or max(zs) < CUT:
        continue
    me = ob.data
    me.calc_loop_triangles()
    if not len(me.loop_triangles):
        continue
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    tri = np.empty(len(me.loop_triangles) * 3, np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    mi = np.empty(len(me.loop_triangles), np.int32)
    me.loop_triangles.foreach_get("material_index", mi)
    co, tri = co.reshape(-1, 3), tri.reshape(-1, 3)
    mw = np.array(ob.matrix_world, np.float32)
    w = co @ mw[:3, :3].T + mw[:3, 3]
    t = w[tri]
    dz = t[:, :, 2] - (CUT - 0.0007)
    cross = (dz.min(1) < 0) & (dz.max(1) > 0)
    if not cross.any():
        continue
    t, dz, mi = t[cross], dz[cross], mi[cross]
    tall = (t[:, :, 2].max(1) - t[:, :, 2].min(1) >= 1.0).astype(np.float32)
    gl_slots = np.array([glassy(s.material) for s in ob.material_slots] or [False], bool)
    glass = gl_slots[np.clip(mi, 0, len(gl_slots) - 1)].astype(np.float32)
    ends = []
    for e0, e1 in ((0, 1), (1, 2), (2, 0)):
        a0, a1 = dz[:, e0], dz[:, e1]
        hit = (a0 * a1) < 0
        f = np.where(hit, a0 / np.where(hit, a0 - a1, 1), 0)[:, None]
        ends.append((t[:, e0, :2] + f * (t[:, e1, :2] - t[:, e0, :2]), hit))
    first = np.where(ends[0][1][:, None], ends[0][0], ends[1][0])
    second = np.where(ends[2][1][:, None], ends[2][0], ends[1][0])
    zlo, zhi = t[:, :, 2].min(1) - FLOOR, t[:, :, 2].max(1) - FLOOR  # the triangle's own heights: a wall runs floor to ceiling, a wardrobe stops short
    s = np.stack([(first[:, 0] - x0) * sx, (y1 - first[:, 1]) * sy, (second[:, 0] - x0) * sx, (y1 - second[:, 1]) * sy, tall, glass, np.full(len(tall), oid, np.float32), zlo, zhi], 1)
    segs.append(s.astype(np.float32))
S = np.concatenate(segs) if segs else np.zeros((0, 9), np.float32)
np.save(os.path.join(OUT, "plan-cut.npy"), S)
json.dump({"frame": JOB["frame"], "width": W, "height": H, "floor": FLOOR, "cut": CUT, "mpp": (x1 - x0) / W, "objects": objects}, open(os.path.join(OUT, "plan-objects.json"), "w"))
print("PLAN_CAPTURE %d segments (%d wall, %d glass), %d objects" % (len(S), int(S[:, 4].sum()), int(S[:, 5].sum()), len(objects)), flush=True)
os._exit(0)
