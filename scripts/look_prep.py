"""
Look recipe, step 0 (7 Nov, Phase 1): runs inside TOUR_SCRIPT (exec, like the splat capture) once the scene is prepared
for Cycles exactly as the walk's capture sees it (lights, glass, mirrors, sky dome, slab). Lists the lights and the
glowing materials, and saves the prepared scene so each recipe render opens it in seconds instead of ~4 min.

Out: <outDir>/prepared.blend, <outDir>/scene-info.json
"""
import json, os, time

LK = spec["look"]
OUT = LK["outDir"]
os.makedirs(OUT, exist_ok=True)
t0 = time.time()

def emission_of(m):
    if not m or not m.use_nodes:
        return None
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            s = n.inputs["Emission Strength"].default_value
            c = n.inputs["Emission Color"]
            col = list(c.default_value)[:3]
            if s > 0 and (c.is_linked or max(col) > 0):
                return {"node": "principled", "strength": s, "color": col, "linked": c.is_linked}
        if n.type == "EMISSION":
            return {"node": "emission", "strength": n.inputs["Strength"].default_value, "color": list(n.inputs["Color"].default_value)[:3]}
    return None

info = {"gpu": GPU_KIND, "lights": [], "emissive": [], "dome": dome.name if dome is not None else None,
        "world": {"color": list(bg.inputs[0].default_value)[:3], "strength": bg.inputs[1].default_value},
        "sun": {"energy": sun_data.energy, "color": list(sun_data.color), "rot": list(sun.rotation_euler)} if energy > 0 else None}
for ob in scene.objects:
    if ob.type == "LIGHT":
        d = ob.data
        info["lights"].append({"name": ob.name, "type": d.type, "energy": d.energy, "color": list(d.color),
                               "loc": list(ob.matrix_world.translation), "size": getattr(d, "size", None),
                               "radius": getattr(d, "shadow_soft_size", None), "hidden": ob.hide_render,
                               "spot": getattr(d, "spot_size", None)})
users = {}
for ob in scene.objects:
    if ob.type == "MESH" and not ob.hide_render:
        for s in ob.material_slots:
            if s.material:
                users.setdefault(s.material.name, []).append(ob.name)
for m in bpy.data.materials:
    e = emission_of(m)
    if e and m.name in users:
        info["emissive"].append({"material": m.name, **e, "objects": users[m.name][:6], "count": len(users[m.name])})
json.dump(info, open(os.path.join(OUT, "scene-info.json"), "w"), indent=1)
print("LOOK_INFO %d lights, %d glowing materials" % (len(info["lights"]), len(info["emissive"])), flush=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "prepared.blend"), copy=True, compress=False)
print("LOOK_TIME save %.1f" % (time.time() - t0), flush=True)
print("LOOK_OK", flush=True)
os._exit(0)
