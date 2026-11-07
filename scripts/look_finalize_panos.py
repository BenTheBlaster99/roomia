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


def seam_heal(x, frac=0.06, probe=3):
    """Cycles' denoiser is not wrap-aware: the two edge columns of an equirect differ by 1-6 % (a visible vertical step on smooth
    ceilings and floors). Gains per row (smoothed vertically, clamped) bring both edges to their geometric mean and fade out
    over frac*width columns. Multiplicative, so texture and light direction stay untouched."""
    h, w, _ = x.shape
    L, R = x[:, :probe].mean(1) + 1e-4, x[:, -probe:].mean(1) + 1e-4
    T = np.sqrt(L * R)
    gl, gr = T / L, T / R
    k = np.exp(-0.5 * (np.arange(-40, 41) / 14.0) ** 2); k /= k.sum()
    sm = lambda g: np.stack([np.convolve(np.pad(g[:, c], 40, mode="edge"), k, mode="valid") for c in range(3)], 1)
    gl, gr = np.clip(sm(gl), 0.8, 1.25), np.clip(sm(gr), 0.8, 1.25)
    W = int(w * frac)
    f = (0.5 + 0.5 * np.cos(np.pi * np.arange(W) / W)).astype(np.float32)  # 1 at the seam -> 0 away from it
    y = x.copy()
    y[:, :W] *= (1 + (gl[:, None, :] - 1) * f[None, :, None])
    y[:, -W:] *= (1 + (gr[:, None, :] - 1) * f[::-1][None, :, None])
    return y


if os.environ.get("SEAM_HEAL", "1") == "1":
    lin = {n: seam_heal(x) for n, x in lin.items()}


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
