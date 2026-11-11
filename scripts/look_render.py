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
from roomia_flags import wait_between_points  # noqa: E402
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
if JOB.get("bounces"):  # [total, diffuse, glossy, transmission, transparent]: the speed benchmark (8 Nov)
    b_ = JOB["bounces"]
    scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = b_[0], b_[1], b_[2]
    scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces = b_[3], b_[4]
if JOB.get("noCaustics"):
    scene.cycles.caustics_reflective = scene.cycles.caustics_refractive = False
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
    if v.get("pano"):
        # a 360 from an eye position (glTF), the capture's convention: the middle of the picture looks along +yaw
        cam_data.type = "PANO"
        cam_data.panorama_type = "EQUIRECTANGULAR"
        cam.location = gl2b(v["position"])
        cam.rotation_euler = (math.pi / 2, 0.0, math.radians(float(v.get("yaw", 0))) - math.pi / 2)
        scene.render.resolution_x, scene.render.resolution_y = int(v.get("width", 3072)), int(v.get("height", 1536))
        return
    cam_data.type = "PERSP"
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
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
elif JOB["mode"] == "pano":
    # 360s with the recipe: the light groups summed at the fitted weights inside the compositor (one denoise, one small
    # file), plus the passes the finishing step's masks come from (ceiling, mirrors and glass, fixtures, sky, materials)
    import glob, re as _re
    for attr in ("use_pass_normal", "use_pass_position", "use_pass_emit", "use_pass_diffuse_color", "use_pass_z", "use_pass_material_index"):
        setattr(vl, attr, not JOB.get("noMasks"))  # noMasks: only the picture (no AI finish planned), 1.5 GB less
    vl.use_pass_diffuse_color = True  # always: the finishing step finds the neutral materials in it (white balance)
    mats = list(bpy.data.materials)
    for i_, m_ in enumerate(mats):
        m_.pass_index = i_ + 1
    json.dump({str(i_ + 1): m_.name for i_, m_ in enumerate(mats)}, open(os.path.join(OUT, "material-ids.json"), "w"))
    vl.cycles.denoising_store_passes = True
    scene.cycles.use_denoising = False  # the compositor's denoise on the summed light, with the albedo and normal guides
    FG = R.get("fit", {})
    wts = PRESETS.get(JOB.get("preset", "golden"), {})
    LOOK = R.get("looks", {}).get(JOB.get("preset", "golden"))
    if LOOK:  # the walk's looks (own gains and tints per group), the same recipe the splat walk is built from
        FG, wts = LOOK, {g: 1.0 for g in LOOK.get("gains", {})}
    # a look uses a few of the 12 light groups: the others stay in Combined only (no pass of their own), which is what keeps the
    # panorama inside memory (the 3072 px render with all 12 passes peaked at 10.8 GB and took Cursor down with it, 8 Nov)
    for lg_ in [g_ for g_ in vl.lightgroups if wts.get(g_.name, 0) == 0 or float(FG.get("gains", {}).get(g_.name, 1.0)) == 0]:
        vl.lightgroups.remove(lg_)
    for i_, f_ in enumerate(JOB.get("fills", [])):  # a soft fill for a room with no fixtures of its own (a closet renders black)
        ld_ = bpy.data.lights.new("look_fill%d" % i_, "POINT")
        # the fixtures are the light of a room (10 Nov): the fill shrinks with the number of ceiling spots within 4 m, so only a room
        # with no fixtures of its own (closet, corridor) gets the full fill
        px_, py_ = gl2b(f_["position"])[0], gl2b(f_["position"])[1]
        n_dl_ = sum(1 for o_ in scene.objects if o_.name.startswith("look_dl_") and (o_.location.x - px_) ** 2 + (o_.location.y - py_) ** 2 < 16)
        ld_.energy, ld_.shadow_soft_size = float(f_.get("power", 300)) * max(0.12, 1.0 - n_dl_ / 3.0), float(f_.get("radius", 0.6))
        print("LOOK_INFO fill %d: %d spots near, %.1f W" % (i_, n_dl_, ld_.energy), flush=True)
        ld_.color = tuple(f_.get("color", [1.0, 0.85, 0.65]))
        ob_ = bpy.data.objects.new("look_fill%d" % i_, ld_)
        ob_.location = gl2b(f_["position"])
        ob_.lightgroup = "INTERIOR"
        ob_.visible_glossy = ob_.visible_camera = False  # lights the room, never shows in a polished floor (10 Nov)
        scene.collection.objects.link(ob_)
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl.outputs["Image"], comp.inputs["Image"])
    print("LOOK_INFO pass sockets:", ",".join(o.name for o in rl.outputs if o.enabled), flush=True)
    acc = None
    for g, w in wts.items():
        sock = rl.outputs.get("Combined_" + g)
        gain = float(w) * float(FG.get("gains", {}).get(g, 1.0))
        if sock is None or gain == 0:
            continue
        tint = FG.get("tints", {}).get(g, [1, 1, 1])
        mul = tree.nodes.new("CompositorNodeMixRGB")
        mul.blend_type, mul.use_clamp = "MULTIPLY", False
        mul.inputs[0].default_value = 1.0
        tree.links.new(sock, mul.inputs[1])
        mul.inputs[2].default_value = (gain * tint[0], gain * tint[1], gain * tint[2], 1.0)
        if acc is None:
            acc = mul
        else:
            add = tree.nodes.new("CompositorNodeMixRGB")
            add.blend_type, add.use_clamp = "ADD", False
            add.inputs[0].default_value = 1.0
            tree.links.new(acc.outputs[0], add.inputs[1])
            tree.links.new(mul.outputs[0], add.inputs[2])
            acc = add
    dn = tree.nodes.new("CompositorNodeDenoise")
    dn.prefilter = "ACCURATE"
    tree.links.new(acc.outputs[0], dn.inputs["Image"])
    tree.links.new(rl.outputs["Denoising Normal"], dn.inputs["Normal"])
    tree.links.new(rl.outputs["Denoising Albedo"], dn.inputs["Albedo"])
    fo = tree.nodes.new("CompositorNodeOutputFile")
    fo.format.file_format = "OPEN_EXR_MULTILAYER"
    fo.format.color_depth = "32"
    fo.layer_slots.clear()
    fo.layer_slots.new("img")
    tree.links.new(dn.outputs[0], fo.inputs["img"])
    for slot_, sock_ in (("normal", "Normal"), ("pos", "Position"), ("emit", "Emit"), ("albedo", "DiffCol"), ("depth", "Depth"), ("mat", "IndexMA")):
        if rl.outputs.get(sock_) is not None:
            fo.layer_slots.new(slot_)
            tree.links.new(rl.outputs[sock_], fo.inputs[slot_])
    scene.cycles.samples = int(JOB.get("samples", 128))
    GLASS_RX = _re.compile(r"glass|verre|vitre|window", _re.I)
    MIRROR_RX = _re.compile(r"mirror|miroir", _re.I)
    mirror_ids = [i_ + 1 for i_, m_ in enumerate(mats) if MIRROR_RX.search(m_.name)]
    glass_ids = [i_ + 1 for i_, m_ in enumerate(mats) if GLASS_RX.search(m_.name) and not MIRROR_RX.search(m_.name)]

    def read_multi(path_):
        inp_ = oiio.ImageInput.open(path_)
        sp_ = inp_.spec()
        names_ = list(sp_.channelnames)
        px_ = inp_.read_image(0, 0, 0, len(names_), "float").reshape(sp_.height, sp_.width, len(names_))
        inp_.close()
        out_ = {}
        for i_, n_ in enumerate(names_):
            parts_ = n_.split(".")
            out_.setdefault(parts_[-2] if len(parts_) >= 2 else n_, {})[parts_[-1]] = i_
        res_ = {}
        for k_, v_ in out_.items():
            ch_ = [v_[c] for c in ("R", "G", "B") if c in v_] or [v_[c] for c in ("X", "Y", "Z") if c in v_] or [v_[c] for c in v_]
            res_[k_] = px_[..., ch_]
        return res_

    for v in JOB["views"]:
        v = dict(v, pano=True)
        wait_between_points(v["name"])  # the card cools, or the person paused, between two points (never in the middle of one)
        place(v)
        name = v["name"]
        scene.render.filepath = os.path.join(OUT, name + "-tmp.exr")
        pref = os.path.join(OUT, name + "-pano-")
        for old_ in glob.glob(pref + "*.exr"):
            os.remove(old_)
        fo.base_path = pref
        t_r = time.time()
        bpy.ops.render.render(write_still=True)
        files = sorted(glob.glob(pref + "*.exr"))
        L = read_multi(files[-1])
        lin = L["img"][..., :3]
        np.save(os.path.join(OUT, name + "-lin.npy"), lin.astype(np.float16))
        if "albedo" in L:
            np.save(os.path.join(OUT, name + "-albedo.npy"), L["albedo"][::4, ::4, :3].astype(np.float16))
        write_png(os.path.join(OUT, name + "-pano.png"), grade(lin, (LOOK or {}).get("grade") or R.get("grade", {})))
        # masks, at half size
        eye_z = float(gl2b(v["position"]).z)
        nz = L["normal"][..., 2] if "normal" in L else np.zeros(lin.shape[:2], np.float32)
        pz = L["pos"][..., 2] if "pos" in L else np.zeros(lin.shape[:2], np.float32)
        px_, py_ = (L["pos"][..., 0], L["pos"][..., 1]) if "pos" in L else (np.zeros(lin.shape[:2]), np.zeros(lin.shape[:2]))
        dist = np.sqrt((px_ - cam.location.x) ** 2 + (py_ - cam.location.y) ** 2 + (pz - cam.location.z) ** 2)
        mid = np.round(L["mat"][..., 0]).astype(np.int32) if "mat" in L else np.zeros(lin.shape[:2], np.int32)
        emit = L["emit"][..., :3].max(-1) if "emit" in L else np.zeros(lin.shape[:2], np.float32)
        masks = {
            "ceiling": (nz < -0.55) & (pz > eye_z + 0.3),
            "mirror": np.isin(mid, mirror_ids),
            "glass": np.isin(mid, glass_ids),
            "sky": dist > 40.0,
            "emit": emit > 0.02,
        }
        half = lambda a: a[::2, ::2]
        np.savez_compressed(os.path.join(OUT, name + "-masks.npz"), mat=half(mid).astype(np.uint16), albedo=half(L["albedo"][..., :3]).astype(np.float16) if "albedo" in L else np.zeros(1),
                            depth=half(np.minimum(dist, 100)).astype(np.float16), **{k_: half(m_) for k_, m_ in masks.items()})
        os.remove(files[-1])
        if os.path.exists(scene.render.filepath):
            os.remove(scene.render.filepath)
        entry = {"name": name, "seconds": round(time.time() - t_r, 1), "size": [int(lin.shape[1]), int(lin.shape[0])],
                 "share": {k_: round(float(m_.mean()), 3) for k_, m_ in masks.items()}}
        report["views"].append(entry)
        print("LOOK_PANO", json.dumps(entry), flush=True)
    # one exposure for the whole set (a tour is one apartment: no point should be brighter than its neighbour just
    # because it faces a dark door): the median of the points' medians brought to the hero photo's median
    LUMW = np.array([0.2126, 0.7152, 0.0722], np.float32)
    meds = []
    for v in JOB["views"]:
        lin_ = np.load(os.path.join(OUT, v["name"] + "-lin.npy")).astype(np.float32)[::4, ::4]
        meds.append(lin_ @ LUMW)
    allv = np.concatenate([m_.ravel() for m_ in meds])
    target = float(JOB.get("targetMedian", 0.40))
    gr = dict(R.get("grade", {}))
    lo_, hi_ = -6.0, 6.0
    for _ in range(14):
        mid_ = (lo_ + hi_) / 2
        g_ = dict(gr, exposure=mid_)
        sample = np.stack([np.full_like(allv, float(np.median(allv)))] * 3, -1)[:1000].reshape(1, -1, 3)
        disp = float(np.median(grade(sample, g_) @ LUMW))
        if disp < target:
            lo_ = mid_
        else:
            hi_ = mid_
    gr["exposure"] = (lo_ + hi_) / 2
    report["commonGrade"] = gr
    for v in JOB["views"]:
        lin_ = np.load(os.path.join(OUT, v["name"] + "-lin.npy")).astype(np.float32)
        write_png(os.path.join(OUT, v["name"] + "-pano.png"), grade(lin_, gr))
    print("LOOK_INFO common exposure %.2f EV (grade exposure %.2f)" % (gr["exposure"] - R.get("grade", {}).get("exposure", 0), gr["exposure"]), flush=True)
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
