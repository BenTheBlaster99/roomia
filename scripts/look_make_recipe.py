"""
The automatic look recipe (8 Nov, Pipeline v1): "warm premium golden hour" from the F5 showcase's universal parts, with what is
specific to F5 left out (the staged sun patch, the traced coves, the pendant fixes, named materials).

python look_make_recipe.py <analysis.json> <out recipe.json> [floorZ]
  sun        the azimuth found from the windows (look_analyze.py); the world picture's warm horizon turned to match
  lights     glowing materials: small ones (<= 0.25 m, or named like a lamp) also become downlight spots; every glowing material glows
  defaults   clear glass that does not bend light, the sky never below the horizon, polished stone floors (not rugs, wood), the
             grade, the group gains and tints, the golden and day looks
"""
import json, os, re, sys

ASSETS = os.environ.get("ROOMIA_ASSETS") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

an = json.load(open(sys.argv[1]))
out = sys.argv[2]
floor_z = float(sys.argv[3]) if len(sys.argv) > 3 else None
az = float(an["sun"]["azimuth"])
LAMP = re.compile(r"led|light|lamp|lum|bulb|spot|downl|neon|glow|strip|ampoule", re.I)

small, glow = [], []
for name, e in an.get("emissive", {}).items():
    if name.startswith("roomia_sky") or e.get("count", 0) < 1:
        continue
    named = bool(LAMP.search(name))
    if not named and (e.get("strength") or 0) < 3:
        continue  # a metal with a faint emission value is not a lamp
    glow.append(name)
    if e["medianSide"] <= 0.25:
        small.append(name)
def side_rule(an, name, base):
    """the visible glow of a fixture: 12 for a 4 cm LED, less for a bigger disc (the same value over 14 cm clips to a flat white
    disc; the downlight spot placed under it does the lighting)"""
    side = an["emissive"].get(name, {}).get("medianSide", 0.04)
    if side > 0.5:  # a strip: thin, long, keeps its glow
        return {name: round(base * 0.67, 2)}
    return {name: round(base * min(1.0, max(0.06, (0.05 / max(side, 1e-3)) ** 2)), 2)}


esc = lambda names: "^(" + "|".join(re.escape(n) for n in names) + ")$"

R = {
    "sunGolden": {"azimuth": az, "elevation": 6, "kelvin": 2500, "energy": 4, "angle": 0.8},
    "world": {"hdri": os.path.join(ASSETS, "hdri", "venice_sunset_nosun.hdr"), "rotation": az - 165.6, "strength": 1.0, "viewScale": 0.018, "flattenGround": 0.25},
    "interior": {"kelvin": 3200, "scale": 1.0},
    "practicals": {"rules": [{"match": esc([n]), "kelvin": 2700, "strength": side_rule(an, n, 12)[n]} for n in glow]},
    "materials": [
        {"match": "glass", "transmission": 1.0, "roughness": 0.0, "alpha": 1.0, "ior": 1.02},
    ],
    "grade": {"exposure": -0.2, "whiteBalance": [0.88, 1.0, 1.12], "contrast": 1.35, "saturation": 0.92},
    "fit": {
        "gains": {"SUN_GOLDEN": 1.2, "PATCH": 6.5, "WORLD": 40, "INTERIOR": 2, "PRACTICALS": 0.5, "COVES": 0.15, "COVE_LINES": 1.0, "PENDANTS": 1, "PENDANT_GLOW": 3, "SLOT": 10},
        "tints": {"WORLD": [0.95, 1.0, 1.6], "INTERIOR": [0.85, 1.0, 1.4], "COVES": [0.85, 1.0, 1.4], "PENDANTS": [0.85, 1.0, 1.4], "PATCH": [1.1, 0.97, 0.75], "SUN_GOLDEN": [1.1, 0.97, 0.75]},
    },
    "sunDay": {"azimuth": az, "elevation": 35, "kelvin": 5600, "energy": 4, "angle": 0.6},
    "worldDay": {"hdri": os.path.join(ASSETS, "hdri", "rooitou_park_nosun.hdr"), "rotation": az - 166, "strength": 1.0, "viewScale": 0.3},
    "presets": {
        "golden": {g: 1 for g in ("SUN_GOLDEN", "PATCH", "WORLD", "INTERIOR", "PRACTICALS", "COVES", "COVE_LINES", "PENDANTS", "PENDANT_GLOW", "SLOT")},
        "day": {"SUN_DAY": 1, "WORLD_DAY": 1, "INTERIOR": 1},
    },
    "looks": {
        "golden": {
            "gains": {"SUN_GOLDEN": 1.2, "PATCH": 6.5, "WORLD": 40, "INTERIOR": 2, "PRACTICALS": 0.5, "COVES": 0.15, "COVE_LINES": 1.0, "PENDANTS": 1, "PENDANT_GLOW": 3, "SLOT": 10},
            "tints": {"WORLD": [0.95, 1.0, 1.6], "INTERIOR": [0.85, 1.0, 1.4], "COVES": [0.85, 1.0, 1.4], "PENDANTS": [0.85, 1.0, 1.4], "PATCH": [1.1, 0.97, 0.75], "SUN_GOLDEN": [1.1, 0.97, 0.75]},
            "grade": {"exposure": -0.2, "whiteBalance": [0.88, 1.0, 1.12], "contrast": 1.35, "saturation": 0.92},
            "walkExposure": -0.8,
        },
        "day": {
            "gains": {"SUN_DAY": 2.0, "WORLD_DAY": 110, "INTERIOR": 0.4}, "tints": {},
            "grade": {"exposure": 1.0, "whiteBalance": [0.97, 1, 1.03], "contrast": 1.2, "saturation": 1.05},
            "walkExposure": -0.3,
        },
    },
}
if small:
    R["interior"]["downlights"] = {"material": esc(small), "energy": 12, "cone": 75, "blend": 0.5, "kelvin": 3200}
if floor_z is not None:
    R["floors"] = {"z": floor_z, "roughness": 0.1, "coat": 0.3, "minM2": 2.0,
                   "exclude": "rug|carpet|tapis|moquet|fabric|wool|velvet|fur|wood|parquet|bois|oak|walnut|timber|laminate"}
json.dump(R, open(out, "w"), indent=1)
print("RECIPE sun %.0f, downlights %s, glow %s" % (az, small, glow))
