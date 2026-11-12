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
LOOKNAME = os.environ.get("LOOK", "")
base = dict((recipe.get("looks", {}).get(LOOKNAME) or {}).get("grade") or recipe.get("grade", {}))
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


def neutral_gains(n, x, e):
    """White balance from the scene's own neutral materials (8 Nov, Pipeline v1): the pixels whose albedo is nearly colourless
    (plaster, white paint, grey concrete) must stay near-neutral in the picture, with only a little warmth; the grade's cool tint
    plus warm lights had pushed them toward magenta. Gains per channel, clamped, applied to the linear picture before the grade."""
    p = os.path.join(d, n + "-albedo.npy")
    if os.environ.get("NEUTRAL", "1") != "1" or not os.path.exists(p):
        return np.ones(3, np.float32)
    al = np.load(p).astype(np.float32)
    h, w = al.shape[:2]
    xs = x[::4, ::4][:h, :w]
    mx, mn = al.max(-1), al.min(-1)
    lum = al @ LUM
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    neutral = (sat < 0.12) & (lum > 0.25) & (lum < 0.85)
    shown = np.clip(grade(xs, dict(base, exposure=e)), 0, 1)
    sl = shown @ LUM
    ok = neutral & (sl > 0.12) & (sl < 0.9)
    if ok.sum() < 0.01 * ok.size:
        return np.ones(3, np.float32)
    m = np.median(shown[ok], axis=0)
    cur = np.array([m[0] / m[1], 1.0, m[2] / m[1]], np.float32)
    tgt = np.array([1.03, 1.0, 0.95] if LOOKNAME != "daylight" else [1.01, 1.0, 0.98], np.float32)  # golden: a touch of warmth; daylight: nearly neutral
    return np.clip(tgt / cur, 0.85, 1.15).astype(np.float32)


own = {n: own_exposure(x) for n, x in lin.items()}
med = float(np.median(list(own.values())))
out = {}
for n, x in lin.items():
    e = float(np.clip(own[n], med - rng, med + rng))
    gains = neutral_gains(n, x, e)
    x = x * gains[None, None, :]
    img = np.clip(grade(x, dict(base, exposure=e)), 0, 1)
    LIFT = float(os.environ.get("LIFT", "0"))  # shadows lifted a little: black cabinets keep their texture (the grade's contrast crushes them)
    if LIFT:
        img = np.clip(img + LIFT * (1 - img) ** 3, 0, 1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(os.path.join(d, n + "-pano.png"))
    out[n] = {"wb": [round(float(v), 3) for v in gains], "own": round(own[n], 2), "used": round(e, 2), "displayMedian": round(float(np.median(img @ LUM)), 3)}
    print("EXPOSURE", n, out[n], flush=True)
# merge, never replace (12 Nov): a run on a few points (the AI step re-finalizes two of fourteen) used to overwrite the whole
# file, and the video then exposed every shot from two points. The group median of the fullest run is kept.
ep = os.path.join(d, "exposure.json")
prev = {}
try:
    prev = json.load(open(ep))
except Exception:
    pass
points_all = dict(prev.get("points", {}))
points_all.update(out)
group = med if len(out) >= len(prev.get("points", {})) else prev.get("groupMedian", med)
json.dump({"groupMedian": group, "range": rng, "target": target, "points": points_all}, open(ep, "w"), indent=1)
