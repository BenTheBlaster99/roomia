"""
The look recipe applied to the open scene (7 Nov): exec'd with globals scene, vl, R (the recipe), kelvin_rgb, by the
recipe renderer (look_render.py) and by the walk capture (lib/splat-capture.ts, option `recipe`), so the walk is lit
exactly as the stills. Every emitter goes into a light group (GROUPS).
"""
import json, math, re
import bpy
from mathutils import Vector
GROUPS = ["SUN_GOLDEN", "PATCH", "SUN_DAY", "WORLD", "INTERIOR", "PRACTICALS", "COVES", "COVE_LINES", "PENDANTS", "PENDANT_GLOW", "SLOT", "WORLD_DAY"]
for g in GROUPS:
    if g not in [lg.name for lg in vl.lightgroups]:
        vl.lightgroups.add(name=g)
vl.use_pass_combined = True
vl.use_pass_diffuse_color = True
vl.use_pass_z = True


def by_name(rx, coll):
    r = re.compile(rx, re.I)
    return [o for o in coll if r.search(o.name)]


# --- the interior lights already in the file
lights = [o for o in scene.objects if o.type == "LIGHT" and o.name not in ("sun", "fill")]
for o in scene.objects:
    if o.type == "LIGHT" and o.name in ("sun", "fill"):
        o.data.energy = 0.0
        o.hide_render = True
INT = R.get("interior", {})
for o in lights:
    o.lightgroup = "INTERIOR"
    base = o.get("look_base_energy")
    if base is None:
        o["look_base_energy"] = o.data.energy
        base = o.data.energy
    o.data.energy = base * float(INT.get("scale", 1.0))
    if INT.get("kelvin"):
        o.data.color = tuple(kelvin_rgb(float(INT["kelvin"])))
for rule in INT.get("rules", []):
    for o in by_name(rule["match"], lights):
        o.data.energy = o["look_base_energy"] * float(rule.get("scale", 1.0))
        if rule.get("kelvin"):
            o.data.color = tuple(kelvin_rgb(float(rule["kelvin"])))
        if rule.get("off"):
            o.hide_render = True

# --- glowing materials (LED strips, lamp shades): the PRACTICALS group, their strength and colour from the recipe
PR = R.get("practicals", {})


def emissive(m):
    if not m or not m.use_nodes:
        return False
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Emission Strength"].default_value > 0:
            return True
        if n.type == "EMISSION":
            return True
    return False


glow_mats = {m.name for m in bpy.data.materials if emissive(m)}
for rule in PR.get("rules", []):
    for m in by_name(rule["match"], bpy.data.materials):
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                if rule.get("kelvin"):
                    n.inputs["Emission Color"].default_value = (*kelvin_rgb(float(rule["kelvin"])), 1)
                n.inputs["Emission Strength"].default_value = float(rule.get("strength", 1.0))
            if n.type == "EMISSION":
                if rule.get("kelvin"):
                    n.inputs["Color"].default_value = (*kelvin_rgb(float(rule["kelvin"])), 1)
                n.inputs["Strength"].default_value = float(rule.get("strength", 1.0))
        glow_mats.add(m.name)
for o in scene.objects:
    if o.type == "MESH" and any(s.material and s.material.name in glow_mats for s in o.material_slots):
        o.lightgroup = "PRACTICALS"
# added fixtures: area lights the file does not have (a cove's hidden LED strip, a pendant's downlight)
for k, fx in enumerate(PR.get("add", [])):
    name = "look_fx_%d" % k
    ob = bpy.data.objects.get(name)
    if ob is None:
        d = bpy.data.lights.new(name, fx.get("type", "AREA"))
        ob = bpy.data.objects.new(name, d)
        scene.collection.objects.link(ob)
    d = ob.data
    d.energy = float(fx["energy"])
    d.color = tuple(kelvin_rgb(float(fx.get("kelvin", 3000))))
    if d.type == "AREA":
        d.shape = "RECTANGLE"
        d.size, d.size_y = fx.get("size", [1.0, 0.05])
        if hasattr(d, "spread"):
            d.spread = math.radians(float(fx.get("spread", 180)))
    if d.type == "SPOT":
        d.spot_size = math.radians(float(fx.get("cone", 60)))
        d.spot_blend = float(fx.get("blend", 0.5))
        d.shadow_soft_size = float(fx.get("radius", 0.05))
    if d.type == "POINT":
        d.shadow_soft_size = float(fx.get("radius", 0.05))
    ob.location = Vector(fx["location"])
    ob.rotation_euler = tuple(math.radians(a) for a in fx.get("rotation", [0, 0, 0]))
    ob.lightgroup = fx.get("group", "PRACTICALS")
    ob.hide_render = False



def add_light(name, kind, group):
    ob = bpy.data.objects.get(name)
    if ob is None:
        d = bpy.data.lights.new(name, kind)
        ob = bpy.data.objects.new(name, d)
        scene.collection.objects.link(ob)
    ob.lightgroup = group
    ob.hide_render = False
    return ob


def glow_material(name, strength, kelvin):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt_ = m.node_tree
    nt_.nodes.clear()
    em = nt_.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*kelvin_rgb(float(kelvin)), 1)
    em.inputs["Strength"].default_value = float(strength)
    out = nt_.nodes.new("ShaderNodeOutputMaterial")
    nt_.links.new(em.outputs[0], out.inputs["Surface"])
    # white in the walk capture's colour pass: the light it holds is the glow itself (never divided by nothing)
    aov = nt_.nodes.new("ShaderNodeOutputAOV")
    aov.aov_name = "roomia_albedo"
    aov.inputs["Color"].default_value = (1, 1, 1, 1)
    return m


# LED lines (look_coves.py): thin area lights along the fitted lines, shining down, seen as a glowing line
CV = PR.get("coves")
if CV:
    for k, cv in enumerate(json.load(open(CV["file"]))):
        if cv["name"] in CV.get("skip", []):
            continue
        ob = add_light("look_cove_%s" % cv["name"], "AREA", "COVES")
        d = ob.data
        d.shape = "RECTANGLE"
        d.size, d.size_y = cv["size"][0], float(CV.get("width", 0.03))
        d.energy = float(CV.get("energyPerMeter", 40)) * cv["size"][0]
        d.color = tuple(kelvin_rgb(float(CV.get("kelvin", 2700))))
        if hasattr(d, "spread"):
            d.spread = math.radians(float(CV.get("spread", 150)))
        ob.location = Vector(cv["location"])
        ob.rotation_euler = tuple(math.radians(a) for a in cv["rotation"])
        # the wash only; the line itself is a thin glowing strip (its own group: seen bright, lights little)
        ob.visible_camera = False
        ob.visible_glossy = True
        ln_name = "look_coveline_%s" % cv["name"]
        lo = bpy.data.objects.get(ln_name)
        if lo is None:
            L_, W_ = 0.5, float(CV.get("lineWidth", 0.02)) / 2
            me_ = bpy.data.meshes.new(ln_name)
            me_.from_pydata([(-L_, -W_, 0), (L_, -W_, 0), (L_, W_, 0), (-L_, W_, 0)], [], [(0, 1, 2, 3)])
            lo = bpy.data.objects.new(ln_name, me_)
            scene.collection.objects.link(lo)
        lo.data.materials.clear()
        lo.data.materials.append(glow_material("look_coveline_mat", CV.get("lineStrength", 20), CV.get("kelvin", 2700)))
        lo.location = ob.location + Vector((0, 0, 0.005))
        lo.rotation_euler = ob.rotation_euler
        lo.scale = (cv["size"][0], 1, 1)
        lo.lightgroup = "COVE_LINES"
        lo.visible_shadow = False

# a downlight under each small LED disc of the ceiling (the file only has the glowing disc)
DL = INT.get("downlights")
if DL:
    rx = re.compile(DL.get("material", "^LED$"), re.I)
    n_dl = 0
    for o in list(scene.objects):
        if o.type != "MESH" or not any(s.material and rx.search(s.material.name) for s in o.material_slots):
            continue
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        size = max(max(p.x for p in bb) - min(p.x for p in bb), max(p.y for p in bb) - min(p.y for p in bb))
        if size > float(DL.get("maxSize", 0.12)):
            continue
        c = sum(bb, Vector()) / 8
        ob = add_light("look_dl_%s" % o.name, "SPOT", "INTERIOR")
        d = ob.data
        d.energy = float(DL.get("energy", 12))
        d.spot_size = math.radians(float(DL.get("cone", 70)))
        d.spot_blend = float(DL.get("blend", 0.4))
        d.shadow_soft_size = float(DL.get("radius", 0.02))
        d.color = tuple(kelvin_rgb(float(DL.get("kelvin", 2700))))
        ob.location = c - Vector((0, 0, 0.015))
        ob.rotation_euler = (0, 0, 0)
        n_dl += 1
    print("LOOK_INFO %d downlights" % n_dl, flush=True)

# objects that glow as a whole (a pendant's diffuser disc)
for k, rule in enumerate(PR.get("glowObjects", [])):
    m = glow_material("look_glow_%d" % k, rule.get("strength", 5), rule.get("kelvin", 2700))
    for name in rule["objects"]:
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        for s in o.material_slots:
            s.link = "OBJECT"
            s.material = m
        o.lightgroup = rule.get("group", "PENDANTS")

# the dark cover over the ceilings (lib/scene-tour.ts) shows in LED slots as a black line: it glows like the LED instead
CG = PR.get("capGlow")
cap = bpy.data.objects.get("roomia_ceiling_cap")
if CG and cap is not None:
    m = glow_material("look_cap_glow", CG.get("strength", 3), CG.get("kelvin", 2700))
    for s in cap.material_slots:
        s.material = m
    cap.lightgroup = "SLOT"
    # seen, not lighting: through every gap over the walls it lit the whole room (7 Nov)
    lit_ = bool(CG.get("lights", False))
    cap.visible_diffuse = cap.visible_glossy = cap.visible_transmission = lit_

# --- the suns: one per preset, each in its own group
def sun_dir(az, el):
    # the direction TO the sun, Blender Z-up: azimuth from +Y (north) clockwise towards +X (east)
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))


def make_sun(name, cfg, group):
    ob = bpy.data.objects.get(name)
    if ob is None:
        d = bpy.data.lights.new(name, "SUN")
        ob = bpy.data.objects.new(name, d)
        scene.collection.objects.link(ob)
    ob.lightgroup = group
    if not cfg:
        ob.hide_render = True
        return
    ob.hide_render = False
    ob.data.energy = float(cfg.get("energy", 3.0))
    ob.data.angle = math.radians(float(cfg.get("angle", 0.6)))
    ob.data.color = tuple(kelvin_rgb(float(cfg.get("kelvin", 5500)))) if "kelvin" in cfg else tuple(cfg.get("color", [1, 1, 1]))
    to_sun = sun_dir(float(cfg["azimuth"]), float(cfg["elevation"]))
    # a sun lamp shines down its local -Z
    ob.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()


make_sun("look_sun_golden", R.get("sunGolden"), "SUN_GOLDEN")


# staged sun patches (look_patch.py): a spot light whose emission is masked by a gobo picture. The light's own
# direction (Texture Coordinate > Normal, in the light's space) is projected like a camera: u = x / -z / tan.
def make_projector(k, pj):
    name = "look_patch_%d" % k
    ob = bpy.data.objects.get(name)
    if ob is None:
        d = bpy.data.lights.new(name, "SPOT")
        ob = bpy.data.objects.new(name, d)
        scene.collection.objects.link(ob)
    d = ob.data
    info = json.load(open(pj["info"]))
    t = float(info["tan"])
    ob.location = Vector(info["location"])
    ob.rotation_euler = (Vector(info["aim"]) - Vector(info["location"])).to_track_quat("-Z", "Y").to_euler()
    d.energy = float(pj.get("energy", 300))
    d.color = tuple(kelvin_rgb(float(pj.get("kelvin", 2600))))
    d.shadow_soft_size = float(pj.get("radius", 0.02))
    d.spot_size = min(math.radians(179), 2 * math.atan(t * math.sqrt(2)) + 0.02)
    d.spot_blend = 0.0
    d.use_nodes = True
    nt_ = d.node_tree
    nt_.nodes.clear()
    tc = nt_.nodes.new("ShaderNodeTexCoord")
    sep = nt_.nodes.new("ShaderNodeSeparateXYZ")
    nt_.links.new(tc.outputs["Normal"], sep.inputs[0])
    negz = nt_.nodes.new("ShaderNodeMath"); negz.operation = "MULTIPLY"; negz.inputs[1].default_value = -t
    nt_.links.new(sep.outputs["Z"], negz.inputs[0])
    def axis(out):
        dv = nt_.nodes.new("ShaderNodeMath"); dv.operation = "DIVIDE"
        nt_.links.new(sep.outputs[out], dv.inputs[0]); nt_.links.new(negz.outputs[0], dv.inputs[1])
        ma = nt_.nodes.new("ShaderNodeMath"); ma.operation = "MULTIPLY_ADD"; ma.inputs[1].default_value = 0.5; ma.inputs[2].default_value = 0.5
        nt_.links.new(dv.outputs[0], ma.inputs[0])
        return ma
    u, v = axis("X"), axis("Y")
    comb = nt_.nodes.new("ShaderNodeCombineXYZ")
    nt_.links.new(u.outputs[0], comb.inputs[0]); nt_.links.new(v.outputs[0], comb.inputs[1])
    tex = nt_.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(pj["gobo"], check_existing=True)
    tex.image.colorspace_settings.name = "Non-Color"
    tex.extension = "CLIP"
    nt_.links.new(comb.outputs[0], tex.inputs["Vector"])
    em = nt_.nodes.new("ShaderNodeEmission")
    nt_.links.new(tex.outputs["Color"], em.inputs["Strength"])
    out = nt_.nodes.new("ShaderNodeOutputLight")
    nt_.links.new(em.outputs[0], out.inputs["Surface"])
    ob.lightgroup = pj.get("group", "PATCH")
    ob.hide_render = False


for k, pj in enumerate(R.get("projectors", [])):
    make_projector(k, pj)
make_sun("look_sun_day", R.get("sunDay"), "SUN_DAY")

# --- the sky: an HDRI (its sun clipped away, the sun lamp does that job) or a plain colour; the dome seen through
# the windows shows the same picture
W = R.get("world", {})
world = scene.world
world.lightgroup = "WORLD"
nt = world.node_tree
bgn = nt.nodes["Background"]
if W.get("hdri"):
    env = nt.nodes.get("look_env") or nt.nodes.new("ShaderNodeTexEnvironment")
    env.name = "look_env"
    env.image = bpy.data.images.load(W["hdri"], check_existing=True)
    mp = nt.nodes.get("look_map") or nt.nodes.new("ShaderNodeMapping")
    mp.name = "look_map"
    tc = nt.nodes.get("look_tc") or nt.nodes.new("ShaderNodeTexCoord")
    tc.name = "look_tc"
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(float(W.get("rotation", 0))))
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bgn.inputs["Color"])
    bgn.inputs["Strength"].default_value = float(W.get("strength", 1.0))
else:
    c = W.get("color", [0.75, 0.75, 0.75])
    bgn.inputs["Color"].default_value = (c[0], c[1], c[2], 1)
    bgn.inputs["Strength"].default_value = float(W.get("strength", 1.0))
if W.get("viewScale") is not None:
    lp = nt.nodes.get("look_lp") or nt.nodes.new("ShaderNodeLightPath")
    lp.name = "look_lp"
    mul = nt.nodes.get("look_view") or nt.nodes.new("ShaderNodeMath")
    mul.name = "look_view"
    mul.operation = "MULTIPLY_ADD"
    # strength x (1 + is_diffuse x (1/viewScale - 1)) x viewScale: viewScale for what is seen, 1 for the light
    vs = float(W["viewScale"])
    mix = nt.nodes.get("look_vmix") or nt.nodes.new("ShaderNodeMix")
    mix.name = "look_vmix"
    mix.data_type = "FLOAT"
    mix.inputs["A"].default_value = float(W.get("strength", 1.0)) * vs
    mix.inputs["B"].default_value = float(W.get("strength", 1.0))
    nt.links.new(lp.outputs["Is Diffuse Ray"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], bgn.inputs["Strength"])
# a second sky (another time of day) in its own light group: Cycles has one world, so this one is a see-through glowing
# sphere around the building that shows, and lights with, its own picture in the direction each ray travels
WD = R.get("worldDay")
if WD:
    dd = bpy.data.objects.get("roomia_sky_day")
    if dd is None:
        pts_ = [o.matrix_world @ Vector(c) for o in scene.objects if o.type == "MESH" and o.name != "roomia_sky" for c in o.bound_box]
        ctr = sum(pts_, Vector()) / len(pts_)
        me_ = bpy.data.meshes.new("roomia_sky_day")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=float(WD.get("radius", 150)))
        for f_ in bm.faces:
            f_.normal_flip()
        bm.to_mesh(me_)
        bm.free()
        dd = bpy.data.objects.new("roomia_sky_day", me_)
        scene.collection.objects.link(dd)
        dd.location = ctr
    m = bpy.data.materials.get("look_day_sky") or bpy.data.materials.new("look_day_sky")
    m.use_nodes = True
    t_ = m.node_tree
    t_.nodes.clear()
    geo = t_.nodes.new("ShaderNodeNewGeometry")
    neg = t_.nodes.new("ShaderNodeVectorMath"); neg.operation = "SCALE"; neg.inputs["Scale"].default_value = -1.0
    t_.links.new(geo.outputs["Incoming"], neg.inputs[0])
    rot = t_.nodes.new("ShaderNodeVectorRotate"); rot.rotation_type = "Z_AXIS"; rot.inputs["Angle"].default_value = math.radians(float(WD.get("rotation", 0)))
    t_.links.new(neg.outputs["Vector"], rot.inputs["Vector"])
    env = t_.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(WD["hdri"], check_existing=True)
    t_.links.new(rot.outputs["Vector"], env.inputs["Vector"])
    em = t_.nodes.new("ShaderNodeEmission")
    t_.links.new(env.outputs["Color"], em.inputs["Color"])
    lp = t_.nodes.new("ShaderNodeLightPath")
    mx_ = t_.nodes.new("ShaderNodeMix"); mx_.data_type = "FLOAT"
    mx_.inputs["A"].default_value = float(WD.get("strength", 1.0)) * float(WD.get("viewScale", 1.0))
    mx_.inputs["B"].default_value = float(WD.get("strength", 1.0))
    t_.links.new(lp.outputs["Is Diffuse Ray"], mx_.inputs["Factor"])
    t_.links.new(mx_.outputs["Result"], em.inputs["Strength"])
    tr_ = t_.nodes.new("ShaderNodeBsdfTransparent")
    add = t_.nodes.new("ShaderNodeAddShader")
    t_.links.new(tr_.outputs[0], add.inputs[0]); t_.links.new(em.outputs[0], add.inputs[1])
    out_ = t_.nodes.new("ShaderNodeOutputMaterial")
    t_.links.new(add.outputs[0], out_.inputs["Surface"])
    dd.data.materials.clear()
    dd.data.materials.append(m)
    dd.lightgroup = "WORLD_DAY"
    dd.visible_shadow = False
    dd.hide_render = False

dome = bpy.data.objects.get("roomia_sky")
if dome is not None:
    dome.lightgroup = "WORLD"
    if W.get("hdri") and W.get("domeFromHdri", True):
        # the dome is seen only by the camera (not lighting the room): it simply shows the world picture
        dome.hide_render = True
    elif W.get("domeStrength") is not None:
        for s in dome.material_slots:
            for n in s.material.node_tree.nodes:
                if n.type == "EMISSION":
                    n.inputs["Strength"].default_value = float(W["domeStrength"])

# --- materials: the hero finishes (roughness, coat, sheen ...) by material name
for rule in R.get("materials", []):
    for m in by_name(rule["match"], bpy.data.materials):
        if not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type in ("BSDF_GLASS", "BSDF_REFRACTION", "BSDF_GLOSSY") and "roughness" in rule:
                n.inputs["Roughness"].default_value = float(rule["roughness"])
                continue
            if n.type != "BSDF_PRINCIPLED":
                continue
            if "transmission" in rule:
                n.inputs["Transmission Weight"].default_value = float(rule["transmission"])
            for key, sock in (("roughness", "Roughness"), ("metallic", "Metallic"), ("specular", "Specular IOR Level"),
                              ("coat", "Coat Weight"), ("coatRoughness", "Coat Roughness"), ("sheen", "Sheen Weight"),
                              ("sheenRoughness", "Sheen Roughness"), ("ior", "IOR"), ("alpha", "Alpha")):
                if key in rule:
                    inp = n.inputs[sock]
                    for l_ in list(inp.links):
                        m.node_tree.links.remove(l_)
                    inp.default_value = float(rule[key])
            if "hsv" in rule and n.inputs["Base Color"].is_linked and globals().get("LOOK_BAKE_HSV"):
                # the walk draws the exported textures: the adjustment goes into the pictures themselves
                import numpy as _np
                seen_ = set()
                stack_ = [n.inputs["Base Color"].links[0].from_node]
                while stack_:
                    x_ = stack_.pop()
                    if x_.name in seen_:
                        continue
                    seen_.add(x_.name)
                    if x_.type == "TEX_IMAGE" and x_.image is not None and not x_.image.get("look_hsv"):
                        img_ = x_.image.copy()
                        img_.name = x_.image.name + "_look"
                        w_, h_ = img_.size
                        px_ = _np.empty(w_ * h_ * 4, _np.float32)
                        img_.pixels.foreach_get(px_)
                        px_ = px_.reshape(-1, 4)
                        # the picture's values are sRGB-encoded: adjusted in linear light, like the shader node does
                        lin_ = _np.power(_np.clip(px_[:, :3], 0, 1), 2.2)
                        y_ = lin_ @ _np.array([0.2126, 0.7152, 0.0722], _np.float32)
                        lin_ = _np.clip((y_[:, None] + (lin_ - y_[:, None]) * float(rule["hsv"].get("s", 1.0))) * float(rule["hsv"].get("v", 1.0)), 0, 1)
                        px_[:, :3] = _np.power(lin_, 1 / 2.2)
                        img_.pixels.foreach_set(px_.ravel())
                        img_.pack()
                        img_["look_hsv"] = True
                        x_.image = img_
                    for inp_ in x_.inputs:
                        for l_ in inp_.links:
                            stack_.append(l_.from_node)
            elif "hsv" in rule and n.inputs["Base Color"].is_linked:
                # a colour adjustment between the texture and the shader (a lighter curtain, a richer wood)
                src = n.inputs["Base Color"].links[0].from_socket
                hs = m.node_tree.nodes.new("ShaderNodeHueSaturation")
                hs.inputs["Hue"].default_value = float(rule["hsv"].get("h", 0.5))
                hs.inputs["Saturation"].default_value = float(rule["hsv"].get("s", 1.0))
                hs.inputs["Value"].default_value = float(rule["hsv"].get("v", 1.0))
                m.node_tree.links.new(src, hs.inputs["Color"])
                m.node_tree.links.new(hs.outputs["Color"], n.inputs["Base Color"])
            if "translucent" in rule and not m.get("look_translucent"):
                outn = next(x for x in m.node_tree.nodes if x.type == "OUTPUT_MATERIAL")
                tr = m.node_tree.nodes.new("ShaderNodeBsdfTranslucent")
                if n.inputs["Base Color"].is_linked:
                    m.node_tree.links.new(n.inputs["Base Color"].links[0].from_socket, tr.inputs["Color"])
                mx = m.node_tree.nodes.new("ShaderNodeMixShader")
                mx.inputs["Fac"].default_value = float(rule["translucent"])
                surf = outn.inputs["Surface"].links[0].from_socket
                m.node_tree.links.new(surf, mx.inputs[1])
                m.node_tree.links.new(tr.outputs[0], mx.inputs[2])
                m.node_tree.links.new(mx.outputs[0], outn.inputs["Surface"])
                m["look_translucent"] = True
            if "sheenTint" in rule:
                n.inputs["Sheen Tint"].default_value = (*rule["sheenTint"], 1)
            if "tint" in rule and not n.inputs["Base Color"].is_linked:
                b = n.inputs["Base Color"].default_value
                n.inputs["Base Color"].default_value = (b[0] * rule["tint"][0], b[1] * rule["tint"][1], b[2] * rule["tint"][2], 1)



# --- real texture detail (8 Nov, step 3): what the SketchUp files lack is micro-structure (plaster grain, fabric weave,
# wood grain, marble veins). Each rule keeps the material's own colour and design and adds a free CC0 texture's detail on
# top: its brightness as an OVERLAY on the base colour (neutral grey = no change) and its height as a bump. World-space
# box mapping at a real-world tile size, so no UVs are needed and nothing stretches.
#   {"match": regex, "dir": folder, "set": "velour_velvet", "scaleM": 0.12, "albedo": 0.35, "bump": 0.5}
_detail_cache = {}


def _detail_images(folder, name):
    if name in _detail_cache:
        return _detail_cache[name]
    import numpy as _np
    import os as _os
    def load(suffix):
        for ext in ("jpg", "png"):
            pth = _os.path.join(folder, "%s_%s.%s" % (name, suffix, ext))
            if _os.path.exists(pth):
                return bpy.data.images.load(pth, check_existing=True)
        return None
    diff, disp = load("diff"), load("disp")
    ov = None
    if diff is not None:
        w_, h_ = diff.size
        px_ = _np.empty(w_ * h_ * 4, _np.float32)
        diff.pixels.foreach_get(px_)
        px_ = px_.reshape(-1, 4)
        lum_ = _np.power(_np.clip(px_[:, :3], 0, 1), 2.2) @ _np.array([0.2126, 0.7152, 0.0722], _np.float32)
        rel_ = lum_ / max(float(lum_.mean()), 1e-4)
        v_ = _np.clip(0.5 * rel_, 0.0, 1.0)  # 0.5 = the texture's own average = no change under OVERLAY
        out_ = _np.stack([v_, v_, v_, _np.ones_like(v_)], -1).astype(_np.float32)
        ov = bpy.data.images.new("look_detail_%s" % name, w_, h_, float_buffer=False)
        ov.pixels.foreach_set(out_.ravel())
        ov.colorspace_settings.name = "Non-Color"
        ov.pack()
    if disp is not None:
        disp.colorspace_settings.name = "Non-Color"
    _detail_cache[name] = (ov, disp)
    return ov, disp


def _box_tex(nt_, image, geo_pos, scale):
    mp = nt_.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0 / scale, 1.0 / scale, 1.0 / scale)
    nt_.links.new(geo_pos, mp.inputs["Vector"])
    tx = nt_.nodes.new("ShaderNodeTexImage")
    tx.image = image
    tx.projection = "BOX"
    tx.projection_blend = 0.2
    tx.interpolation = "Cubic"
    nt_.links.new(mp.outputs["Vector"], tx.inputs["Vector"])
    return tx


_detailed = []
for rule_ in R.get("details", []):
    rx_ = re.compile(rule_["match"], re.I)
    ov_img, disp_img = _detail_images(rule_["dir"], rule_["set"])
    for m in bpy.data.materials:
        if not m.use_nodes or not rx_.search(m.name) or m.get("look_detail"):
            continue
        bsdf_ = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf_ is None:
            continue
        nt_ = m.node_tree
        geo_ = nt_.nodes.new("ShaderNodeNewGeometry")
        scale_ = float(rule_.get("scaleM", 0.5))
        if ov_img is not None and float(rule_.get("albedo", 0)) > 0:
            tex_ = _box_tex(nt_, ov_img, geo_.outputs["Position"], scale_)
            mix_ = nt_.nodes.new("ShaderNodeMix")
            mix_.data_type = "RGBA"
            mix_.blend_type = "OVERLAY"
            mix_.inputs["Factor"].default_value = float(rule_["albedo"])
            base_in = bsdf_.inputs["Base Color"]
            if base_in.is_linked:
                nt_.links.new(base_in.links[0].from_socket, mix_.inputs["A"])
            else:
                mix_.inputs["A"].default_value = base_in.default_value
            nt_.links.new(tex_.outputs["Color"], mix_.inputs["B"])
            nt_.links.new(mix_.outputs["Result"], base_in)
        if disp_img is not None and float(rule_.get("bump", 0)) > 0:
            tex_ = _box_tex(nt_, disp_img, geo_.outputs["Position"], scale_)
            bump_ = nt_.nodes.new("ShaderNodeBump")
            bump_.inputs["Strength"].default_value = float(rule_["bump"])
            bump_.inputs["Distance"].default_value = float(rule_.get("distance", 0.003))
            nt_.links.new(tex_.outputs["Color"], bump_.inputs["Height"])
            nrm_in = bsdf_.inputs["Normal"]
            if nrm_in.is_linked:
                nt_.links.new(nrm_in.links[0].from_socket, bump_.inputs["Normal"])
            nt_.links.new(bump_.outputs["Normal"], nrm_in)
        m["look_detail"] = rule_["set"]
        _detailed.append(m.name)
print("LOOK_INFO details on %d materials: %s" % (len(_detailed), ", ".join(_detailed[:10])), flush=True)


# --- polished floors (8 Nov): what the AI edit added to every floor was gloss, a physical property. Any material that is
# the up-facing surface at floor height (>= minM2 square metres, found from the geometry, not from names) gets a polished
# finish, so every point shows the same floor reflections without paying for an edit.
#   "floors": {"z": 26.53, "roughness": 0.08, "coat": 0.4, "minM2": 2.0}
FL_ = R.get("floors")
if FL_:
    import numpy as _np
    _fz = float(FL_["z"])
    _area = {}
    for _ob in scene.objects:
        if _ob.type != "MESH" or _ob.hide_render or not len(_ob.data.polygons) or not _ob.material_slots:
            continue
        _me = _ob.data
        _n = len(_me.polygons)
        _c = _np.empty(_n * 3, _np.float32); _me.polygons.foreach_get("center", _c); _c = _c.reshape(-1, 3)
        _nr = _np.empty(_n * 3, _np.float32); _me.polygons.foreach_get("normal", _nr); _nr = _nr.reshape(-1, 3)
        _a = _np.empty(_n, _np.float32); _me.polygons.foreach_get("area", _a)
        _mi = _np.empty(_n, _np.int32); _me.polygons.foreach_get("material_index", _mi)
        _mw = _np.array(_ob.matrix_world, _np.float32)
        _cw = _c @ _mw[:3, :3].T + _mw[:3, 3]
        _nw = _nr @ _mw[:3, :3].T
        _nw /= _np.maximum(_np.linalg.norm(_nw, axis=1, keepdims=True), 1e-9)
        _sc = float(abs(_np.linalg.det(_mw[:3, :3]))) ** (2 / 3)
        _sel = (_np.abs(_cw[:, 2] - _fz) < 0.12) & (_nw[:, 2] > 0.95)
        if not _sel.any():
            continue
        for _k in _np.unique(_mi[_sel]):
            if _k < len(_ob.material_slots) and _ob.material_slots[_k].material:
                _nm = _ob.material_slots[_k].material.name
                _area[_nm] = _area.get(_nm, 0.0) + float(_a[_sel & (_mi == _k)].sum()) * _sc
    _floors = [n_ for n_, a_ in _area.items() if a_ >= float(FL_.get("minM2", 2.0))]
    for _nm in _floors:
        _m = bpy.data.materials[_nm]
        for _n in _m.node_tree.nodes if _m.use_nodes else []:
            if _n.type != "BSDF_PRINCIPLED":
                continue
            for _s, _v in (("Roughness", float(FL_.get("roughness", 0.08))), ("Coat Weight", float(FL_.get("coat", 0.4))), ("Coat Roughness", 0.03)):
                for _l in list(_n.inputs[_s].links):
                    _m.node_tree.links.remove(_l)
                _n.inputs[_s].default_value = _v
    print("LOOK_INFO polished floors: %s" % ", ".join("%s (%.0f m2)" % (n_, _area[n_]) for n_ in _floors), flush=True)
