"""
Exposure for a set of recipe panoramas (8 Nov): every point is exposed for itself (the display median brought to the target,
as a photographer would), but never more than +-RANGE stops from the group's median exposure, so one tour stays coherent
and a dark room stays darker than a sunlit one.

python look_finalize_panos.py <dir> <recipe.json> <name1,name2,...> [targetMedian=0.45] [range=1.5]
Reads <name>-lin.npy, writes <name>-pano.png and exposure.json
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from look_grade import grade
from PIL import Image

d, recipe, names = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3].split(",")
target = float(sys.argv[4]) if len(sys.argv) > 4 else 0.45
rng = float(sys.argv[5]) if len(sys.argv) > 5 else 1.5
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
base = dict(recipe.get("grade", {}))
lin = {n: np.load(os.path.join(d, n + "-lin.npy")).astype(np.float32) for n in names}


def own_exposure(x):
    s = x[::8, ::8]
    lo, hi = -8.0, 10.0
    for _ in range(18):
        mid = (lo + hi) / 2
        if float(np.median(grade(s, dict(base, exposure=mid)) @ LUM)) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


own = {n: own_exposure(x) for n, x in lin.items()}
med = float(np.median(list(own.values())))
out = {}
for n, x in lin.items():
    e = float(np.clip(own[n], med - rng, med + rng))
    img = np.clip(grade(x, dict(base, exposure=e)), 0, 1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, n + "-pano.png"))
    out[n] = {"own": round(own[n], 2), "used": round(e, 2), "displayMedian": round(float(np.median(img @ LUM)), 3)}
    print("EXPOSURE", n, out[n], flush=True)
json.dump({"groupMedian": med, "range": rng, "target": target, "points": out}, open(os.path.join(d, "exposure.json"), "w"), indent=1)
