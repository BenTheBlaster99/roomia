"""
Sun patch transfer (7 Nov, Phase 1): where the reference image shows sunlight that the apartment's real windows cannot
let in (F5's dining-room wall sees no sky), the patch is staged like a photographer would: a hidden spot light with a
gobo, placed where a low sun would come from. The gobo is made from the reference itself: each direction from the light
hits a surface; if the reference camera sees that surface, the gobo takes the reference's patch value there.
So the patch stays on the wall from every viewpoint, and whatever stands between the light and the wall casts a real
shadow. Surfaces are found with Cycles position passes (Python ray casts in a 7 M triangle scene took minutes).

blender -b prepared.blend --python look_patch.py -- <job.json>
job: {cameras, scene, lens, mask (png, reference size), region [x0, y0, x1, y1] (fractions), wallNormal [x,y,z] (optional),
      fromAz, fromEl (direction towards the virtual light, degrees), maxDistance, size, out (png), outJson, workDir}
"""
import json, math, os, sys
import bpy
import numpy as np
from mathutils import Vector

J = json.load(open(sys.argv[sys.argv.index("--") + 1]))
import OpenImageIO as oiio  # noqa: E402

scene = bpy.context.scene
vl = scene.view_layers[0]
dg = bpy.context.evaluated_depsgraph_get()
WORK = J["workDir"]
os.makedirs(WORK, exist_ok=True)

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
scene.cycles.device = "GPU"
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.cycles.filter_width = 0.01
scene.render.use_persistent_data = True
vl.use_pass_position = True
vl.use_pass_normal = True
scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
scene.render.image_settings.color_depth = "32"
scene.use_nodes = False


def read_layers(path):
    inp = oiio.ImageInput.open(path)
    s = inp.spec()
    names = list(s.channelnames)
    px = inp.read_image(0, 0, 0, len(names), "float").reshape(s.height, s.width, len(names))
    inp.close()
    out = {}
    for i, n in enumerate(names):
        layer, ch = n.rsplit(".", 1)
        out.setdefault(layer.split(".")[-1], {})[ch] = i
    return {k: px[..., [v[c] for c in ("X", "Y", "Z") if c in v] or [v[c] for c in ("R", "G", "B") if c in v]] for k, v in out.items()}


cam_data = bpy.data.cameras.new("patch_cam")
cam = bpy.data.objects.new("patch_cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam_data.clip_start = 0.02


def render_passes(name, loc, rot_euler, angle, w, h, fit):
    cam.location = loc
    cam.rotation_euler = rot_euler
    cam_data.sensor_fit = fit
    cam_data.angle = angle
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
    scene.render.filepath = os.path.join(WORK, name + ".exr")
    bpy.ops.render.render(write_still=True)
    L = read_layers(scene.render.filepath)
    return L["Position"], L["Normal"]


cams = {c["name"]: c for c in json.load(open(J["cameras"]))}
c = cams[J["scene"]]
g = lambda p: Vector((p[0], -p[2], p[1]))
pos, tgt = g(c["position"]), g(c["target"])
hfov = 2 * math.atan(18.0 / float(J.get("lens", 24)))

inp = oiio.ImageInput.open(J["mask"])
sp = inp.spec()
mask = inp.read_image(0, 0, 0, 1, "float").reshape(sp.height, sp.width)
inp.close()
H, W = mask.shape
RW, RH = W // 2, H // 2
mask_s = mask[::2, ::2][:RH, :RW]
P1, N1 = render_passes("ref", pos, (tgt - pos).to_track_quat("-Z", "Y").to_euler(), hfov, RW, RH, "HORIZONTAL")
fwd = (tgt - pos).normalized()
right = fwd.cross(Vector((0, 0, 1))).normalized()
up = right.cross(fwd)
th = math.tan(hfov / 2)
asp = RW / RH
x0, y0, x1, y1 = J["region"]
reg = np.zeros((RH, RW), bool)
reg[int(y0 * RH):int(y1 * RH), int(x0 * RW):int(x1 * RW)] = True
wn = np.array(J.get("wallNormal") or [0, 0, 0], np.float32)
on_wall = (N1 @ wn > 0.95) if J.get("wallNormal") else np.ones((RH, RW), bool)
sel = reg & on_wall & (mask_s > 0.5)
# the wall's own plane (a radiator in front of it faces the same way): within 3 cm of the patch's median plane
if J.get("wallNormal"):
    plane = float(np.median(P1[sel] @ wn))
    on_wall &= np.abs(P1 @ wn - plane) < 0.03
    sel = reg & on_wall & (mask_s > 0.3)
pts = P1[sel]
print("PATCH points", len(pts), flush=True)
centre = Vector(pts.mean(0).tolist())
a, e = math.radians(J["fromAz"]), math.radians(J["fromEl"])
towards = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
hit, loc_, *_ = scene.ray_cast(dg, centre + towards * 0.02, towards, distance=J.get("maxDistance", 6.0))
dist = ((loc_ - centre).length - 0.25) if hit else J.get("maxDistance", 6.0)
light = centre + towards * dist
aim = (centre - light).normalized()
q = aim.to_track_quat("-Z", "Y")
R = np.array(q.to_matrix(), np.float32)
lx, ly, lz = R[:, 0], R[:, 1], R[:, 2]
d = P1[reg & on_wall] - np.array(light, np.float32)
zz = -(d @ lz)
t = float(max((np.abs(d @ lx) / zz).max(), (np.abs(d @ ly) / zz).max())) * 1.15
N = int(J.get("size", 512))
P2, N2 = render_passes("light", light, q.to_euler(), 2 * math.atan(t), N, N, "AUTO")
# each light pixel's surface, seen by the reference camera?
p = P2.reshape(-1, 3)
v = p - np.array(pos, np.float32)
z = v @ np.array(fwd, np.float32)
px = 0.5 + (v @ np.array(right, np.float32)) / np.maximum(z, 1e-6) / (2 * th)
py = 0.5 - (v @ np.array(up, np.float32)) / np.maximum(z, 1e-6) / (2 * th / asp)
ok = (z > 0) & (px >= x0) & (px <= x1) & (py >= y0) & (py <= y1)
ii = np.clip((px * RW).astype(int), 0, RW - 1)
jj = np.clip((py * RH).astype(int), 0, RH - 1)
ok &= np.linalg.norm(P1[jj, ii] - p, axis=1) < 0.03
if J.get("wallNormal"):
    ok &= ((N2.reshape(-1, 3) @ wn) > 0.95) & (np.abs(p @ wn - plane) < 0.03)
gobo = np.where(ok, mask[np.clip((py * H).astype(int), 0, H - 1), np.clip((px * W).astype(int), 0, W - 1)], 0).reshape(N, N)
print("PATCH gobo max %.3f mean %.4f, ok %d, mask at ok max %.3f" % (gobo.max(), gobo.mean(), ok.sum(), mask.max()), flush=True)
o = oiio.ImageOutput.create(J["out"])
o.open(J["out"], oiio.ImageSpec(N, N, 1, "uint8"))
o.write_image(np.ascontiguousarray((np.clip(gobo, 0, 1) * 255).astype(np.uint8)[..., None]))
o.close()
info = {"location": list(light), "aim": list(centre), "tan": t, "distance": dist, "covered": int(ok.sum())}
json.dump(info, open(J["outJson"], "w"), indent=1)
print("PATCH light", [round(x, 2) for x in light], "distance %.2f tan %.3f, %d gobo pixels on the wall" % (dist, t, int(ok.sum())), flush=True)
