"""
Look recipe renderer (7 Nov, Phase 1): opens the prepared scene (look_prep.py), applies a recipe (sun, sky, interior
lights, practicals, materials) with every emitter in a Cycles light group, renders the asked views as linear EXR
(Combined + one pass per group + albedo) and a graded PNG through look_grade.py (the walk's own display pipeline).

blender -b <prepared.blend> --python look_render.py -- <job.json>
job: {recipe, cameras, outDir, views: [{name, scene?|position+target (glTF), lens}], width, height, samples,
      mode: 'render' | 'sunsearch', textureLimit}
"""
import json, math, os, re, sys, time
import bpy
import numpy as np
from mathutils import Vector

JOB = json.load(open(sys.argv[sys.argv.index("--") + 1]))
sys.path.insert(0, JOB["scriptsDir"])
from look_grade import grade, kelvin_rgb  # noqa: E402
import OpenImageIO as oiio  # noqa: E402

R = json.load(open(JOB["recipe"])) if JOB.get("recipe") else {}
OUT = JOB["outDir"]
os.makedirs(OUT, exist_ok=True)
scene = bpy.context.scene
vl = scene.view_layers[0]
t0 = time.time()

# --- Cycles on the graphics card (preferences are not saved in the .blend)
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for kind in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
    except Exception:
        gpus = []
    if gpus:
        for d in gpus:
            d.use = True
        scene.cycles.device = "GPU"
        break
scene.render.use_simplify = True
scene.cycles.texture_limit_render = str(JOB.get("textureLimit", "2048"))
scene.render.use_persistent_data = True
scene.cycles.use_light_tree = True
scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = 10, 4, 4
scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces = 8, 8
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0

exec(open(os.path.join(JOB["scriptsDir"], "look_apply.py")).read(), globals())
print("LOOK_TIME recipe %.1f" % (time.time() - t0), flush=True)

# --- cameras
cams = {c["name"]: c for c in json.load(open(JOB["cameras"]))}


def gl2b(p):
    return Vector((p[0], -p[2], p[1]))


cam_data = bpy.data.cameras.get("look_cam") or bpy.data.cameras.new("look_cam")
cam = bpy.data.objects.get("look_cam") or bpy.data.objects.new("look_cam", cam_data)
if cam.name not in scene.collection.objects:
    scene.collection.objects.link(cam)
scene.camera = cam
WIDTH, HEIGHT = int(JOB.get("width", 1536)), int(JOB.get("height", 1024))
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = WIDTH, HEIGHT, 100
cam_data.sensor_fit = "HORIZONTAL"
cam_data.clip_start = 0.05
cam_data.clip_end = 1000.0


def place(v):
    if v.get("scene"):
        c = cams[v["scene"]]
        pos, tgt = gl2b(c["position"]), gl2b(c["target"])
    else:
        pos, tgt = gl2b(v["position"]), gl2b(v["target"])
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat("-Z", "Y").to_euler()
    hfov = 2 * math.atan(18.0 / float(v.get("lens", 24)))
    cam_data.angle = hfov


def read_layers(path):
    inp = oiio.ImageInput.open(path)
    spec_ = inp.spec()
    names = list(spec_.channelnames)
    px = inp.read_image(0, 0, 0, len(names), "float").reshape(spec_.height, spec_.width, len(names))
    inp.close()
    out = {}
    for i, n in enumerate(names):
        layer, ch = n.rsplit(".", 1)
        out.setdefault(layer.split(".")[-1], {})[ch] = i
    return {k: px[..., [v[c] for c in ("R", "G", "B") if c in v]] if "R" in v else px[..., [v[list(v)[0]]]] for k, v in out.items()}


def write_png(path, img):
    o = oiio.ImageOutput.create(path)
    o.open(path, oiio.ImageSpec(img.shape[1], img.shape[0], 3, "uint8"))
    o.write_image((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8))
    o.close()


scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
scene.render.image_settings.color_depth = "32"
scene.render.image_settings.exr_codec = "ZIP"
scene.cycles.use_denoising = bool(JOB.get("denoise", True))
scene.cycles.denoiser = "OPTIX"
scene.cycles.denoising_input_passes = "RGB_ALBEDO_NORMAL"
scene.cycles.samples = int(JOB.get("samples", 256))
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = float(JOB.get("noise", 0.01))

PRESETS = R.get("presets", {"golden": {g: 1 for g in GROUPS if g not in ("SUN_DAY", "WORLD_DAY")}})
report = {"views": []}


def denoise_groups(prefix):
    # Cycles denoises only the Combined pass; each light group is denoised here with the same albedo and normal guides
    vl.cycles.denoising_store_passes = True
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], comp.inputs["Image"])
    fo = tree.nodes.new("CompositorNodeOutputFile")
    fo.format.file_format = "OPEN_EXR_MULTILAYER"
    fo.format.color_depth = "32"
    fo.base_path = prefix
    fo.layer_slots.clear()
    for g in GROUPS:
        sock = rl.outputs.get("Combined_" + g)
        if sock is None:
            continue
        dn = tree.nodes.new("CompositorNodeDenoise")
        dn.prefilter = "ACCURATE"
        tree.links.new(sock, dn.inputs["Image"])
        tree.links.new(rl.outputs["Denoising Normal"], dn.inputs["Normal"])
        tree.links.new(rl.outputs["Denoising Albedo"], dn.inputs["Albedo"])
        fo.layer_slots.new(g)
        tree.links.new(dn.outputs["Image"], fo.inputs[g])


if JOB.get("mode", "render") == "render":
    import glob
    for v in JOB["views"]:
        place(v)
        name = v["name"]
        scene.render.filepath = os.path.join(OUT, name + ".exr")
        dn_prefix = os.path.join(OUT, name + "-groups-")
        for old in glob.glob(dn_prefix + "*.exr"):
            os.remove(old)
        denoise_groups(dn_prefix)
        t_r = time.time()
        bpy.ops.render.render(write_still=True)
        L = read_layers(scene.render.filepath)
        comb = L["Combined"][..., :3]
        D = read_layers(sorted(glob.glob(dn_prefix + "*.exr"))[-1])
        groups = {g: D[g][..., :3] for g in GROUPS if g in D}
        raw = {g: L["Combined_" + g][..., :3] for g in GROUPS if "Combined_" + g in L}
        # the groups must add back up to the full render (otherwise an emitter was left outside every group): compared
        # on the noisy passes, 16 px blocks, so noise does not count
        def blocks(x):
            h, w = x.shape[0] // 16 * 16, x.shape[1] // 16 * 16
            return x[:h, :w].reshape(h // 16, 16, w // 16, 16, 3).mean((1, 3))
        cb, tb = blocks(comb), blocks(sum(raw.values()))
        err = float(np.abs(tb - cb).mean() / max(1e-6, float(cb.mean())))
        entry = {"name": name, "seconds": round(time.time() - t_r, 1), "groupSumError": round(err, 4),
                 "groupShare": {g: round(float(x.mean() / max(1e-9, comb.mean())), 4) for g, x in raw.items()}}
        # the denoised groups for the fit (look_fit.py) and the albedo
        np.savez_compressed(os.path.join(OUT, name + "-groups.npz"), albedo=L["DiffCol"][..., :3].astype(np.float16), depth=L["Depth"][..., 0].astype(np.float32),
                            **{g: x.astype(np.float16) for g, x in groups.items()})
        for pname, wts in PRESETS.items():
            # the fitted strength and colour of each group (look_fit.py), applied where the groups are added up
            FG = R.get("fit", {})
            lin = sum(groups[g] * float(w) * float(FG.get("gains", {}).get(g, 1.0)) * np.array(FG.get("tints", {}).get(g, [1, 1, 1]), np.float32)
                      for g, w in wts.items() if g in groups)
            write_png(os.path.join(OUT, "%s-%s.png" % (name, pname)), grade(lin, R.get("grade", {})))
        write_png(os.path.join(OUT, "%s-combined.png" % name), grade(comb, R.get("grade", {})))
        report["views"].append(entry)
        print("LOOK_VIEW", json.dumps(entry), flush=True)
elif JOB["mode"] == "sunsearch":
    # sun only, low resolution: where its light lands for each candidate direction (the patch fit)
    for o in scene.objects:
        if o.type == "LIGHT" and o.name != "look_sun_golden":
            o.hide_render = True
    bgn.inputs["Strength"].default_value = 0.0
    if dome is not None:
        dome.hide_render = True
    for mn in glow_mats:
        m = bpy.data.materials.get(mn)
        for n in m.node_tree.nodes if m and m.use_nodes else []:
            if n.type == "BSDF_PRINCIPLED":
                n.inputs["Emission Strength"].default_value = 0.0
            if n.type == "EMISSION":
                n.inputs["Strength"].default_value = 0.0
    scene.cycles.samples = int(JOB.get("samples", 16))
    scene.cycles.use_denoising = False
    vl.use_pass_diffuse_direct = True
    place(JOB["views"][0])
    sun = bpy.data.objects["look_sun_golden"]
    sun.hide_render = False
    sun.data.energy = 5.0
    sun.data.angle = math.radians(0.6)
    masks = []
    for az in JOB["azimuths"]:
        for el in JOB["elevations"]:
            sun.rotation_euler = (-sun_dir(az, el)).to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = os.path.join(OUT, "sun.exr")
            bpy.ops.render.render(write_still=True)
            L = read_layers(scene.render.filepath)
            dd = L["DiffDir"][..., :3].mean(-1)
            masks.append(((az, el), dd.astype(np.float16)))
            print("LOOK_SUN %g %g lit %.3f" % (az, el, float((dd > 0.05).mean())), flush=True)
    np.savez_compressed(os.path.join(OUT, "sunsearch.npz"), dirs=np.array([m[0] for m in masks], np.float32), lit=np.stack([m[1] for m in masks]))
json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
print("LOOK_TIME total %.1f" % (time.time() - t0), flush=True)
print("LOOK_OK", flush=True)
