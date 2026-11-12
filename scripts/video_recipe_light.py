# 4. (recipe mode, 12 Nov) The light of the 360 tour: the prepared scene gets the same daylight recipe (look_apply.py) and
# Cycles, with the light groups summed and denoised in the compositor exactly as look_render.py does for the panoramas.
# The grade (exposure, white balance, AgX, contrast, lift) is applied per frame afterwards, with the 360's own function.
sys.path.insert(0, spec["scriptsDir"])
from look_grade import grade, kelvin_rgb
import OpenImageIO as oiio
R = json.load(open(spec["recipe"]))
vl = scene.view_layers[0]
PRESET = spec.get("preset", "daylight")
scene.render.engine = "CYCLES"
_prefs = bpy.context.preferences.addons["cycles"].preferences
for _kind in ("OPTIX", "CUDA"):
    try:
        _prefs.compute_device_type = _kind
        _prefs.get_devices()
        _gpus = [d for d in _prefs.devices if d.type == _kind]
    except Exception:
        _gpus = []
    if _gpus:
        for d in _gpus:
            d.use = True
        scene.cycles.device = "GPU"
        break
scene.render.use_simplify = True
scene.cycles.texture_limit_render = str(spec.get("textureLimit", "2048"))
scene.render.use_persistent_data = True
scene.cycles.use_light_tree = True
scene.cycles.max_bounces, scene.cycles.diffuse_bounces, scene.cycles.glossy_bounces = 12, 8, 6
scene.cycles.transmission_bounces, scene.cycles.transparent_max_bounces = 8, 8
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0
scene.render.use_motion_blur = False
_lk = (R.get("looks") or {}).get(PRESET, {}).get("interior")
if _lk:
    R.setdefault("interior", {})
    for _k, _v in _lk.items():
        if _k == "downlights" and isinstance(R["interior"].get("downlights"), dict):
            R["interior"]["downlights"] = dict(R["interior"]["downlights"], **_v)
        else:
            R["interior"][_k] = _v
# look_apply in its own namespace: its many short names (n, c, d, o...) must not overwrite this script's
_ns = dict(globals())
exec(open(os.path.join(spec["scriptsDir"], "look_apply.py")).read(), _ns)
LOOK = (R.get("looks") or {}).get(PRESET) or {}
_gains = LOOK.get("gains", {})
for _lg in [g_ for g_ in vl.lightgroups if float(_gains.get(g_.name, 0.0)) == 0.0]:
    vl.lightgroups.remove(_lg)
vl.cycles.denoising_store_passes = True
scene.cycles.use_denoising = False  # the compositor denoises the sum, with the albedo and normal guides
scene.cycles.samples = int(spec.get("samples", 24))
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = float(spec.get("noise", 0.05))
scene.use_nodes = True
_tree = scene.node_tree
_tree.nodes.clear()
_rl = _tree.nodes.new("CompositorNodeRLayers")
_comp = _tree.nodes.new("CompositorNodeComposite")
_acc = None
for _g, _gain in _gains.items():
    _sock = _rl.outputs.get("Combined_" + _g)
    if _sock is None or float(_gain) == 0:
        continue
    _tint = LOOK.get("tints", {}).get(_g, [1, 1, 1])
    _mul = _tree.nodes.new("CompositorNodeMixRGB")
    _mul.blend_type, _mul.use_clamp = "MULTIPLY", False
    _mul.inputs[0].default_value = 1.0
    _tree.links.new(_sock, _mul.inputs[1])
    _mul.inputs[2].default_value = (float(_gain) * _tint[0], float(_gain) * _tint[1], float(_gain) * _tint[2], 1.0)
    if _acc is None:
        _acc = _mul
    else:
        _add = _tree.nodes.new("CompositorNodeMixRGB")
        _add.blend_type, _add.use_clamp = "ADD", False
        _add.inputs[0].default_value = 1.0
        _tree.links.new(_acc.outputs[0], _add.inputs[1])
        _tree.links.new(_mul.outputs[0], _add.inputs[2])
        _acc = _add
_dn = _tree.nodes.new("CompositorNodeDenoise")
_dn.prefilter = "ACCURATE"
_tree.links.new(_acc.outputs[0], _dn.inputs["Image"])
_tree.links.new(_rl.outputs["Denoising Normal"], _dn.inputs["Normal"])
_tree.links.new(_rl.outputs["Denoising Albedo"], _dn.inputs["Albedo"])
_tree.links.new(_dn.outputs[0], _comp.inputs["Image"])
print("VIDEO_INFO recipe %s: %d light groups, %d spp" % (PRESET, len([1 for g_ in _gains.values() if float(g_) != 0]), scene.cycles.samples), flush=True)

