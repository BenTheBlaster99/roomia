# python3 scripts/ai-mask.py <tour dir> <depth dir>: how far each AI 360 kept the model's shapes, written into its depth panorama
# (blue's 6 low bits, 63 = kept). Near the model's edges (depth jumps: a lamp against the ceiling, a chair against the
# floor) the AI 360 and the Blender 360 must show the same pattern (local normalised correlation, so the AI's new
# light does not count); where they don't, the AI moved or invented something there and its pixels would land on the
# wrong surface. Away from edges everything is kept: a sun streak the AI laid on a wall is the AI's light, welcome.
import sys, os, json
import numpy as np
from PIL import Image

tour, dd = sys.argv[1:3]
P = json.load(open(os.path.join(dd, "projection.json")))
W, H = P["width"], P["height"]
R = 4  # 9 x 9 patches

def box(a, r):
    p = np.pad(a, r + 1, mode="edge").cumsum(0).cumsum(1)
    n = 2 * r + 1
    s = p[n:, n:] - p[:-n, n:] - p[n:, :-n] + p[:-n, :-n]
    return s[:a.shape[0], :a.shape[1]] / (n * n)

def lum(path):
    return np.asarray(Image.open(path).convert("L").resize((W, H), Image.BILINEAR), np.float64) / 255

for v in P["views"]:
    path = os.path.join(dd, v["depth"])
    d = np.asarray(Image.open(path).convert("RGB")).copy()
    mm = d[..., 0].astype(np.float64) * 256 + d[..., 1]
    ld = np.log(np.where(mm > 0, mm, 200000.0))
    gy, gx = np.gradient(ld)
    edge = np.hypot(gx, gy) > 0.08  # a jump of 8 % in distance from one pixel to the next
    zone = edge.copy()
    for _ in range(6):  # 6 px around each edge
        z = zone.copy()
        z[1:] |= zone[:-1]; z[:-1] |= zone[1:]; z[:, 1:] |= zone[:, :-1]; z[:, :-1] |= zone[:, 1:]
        zone = z
    # Behind an object, further: the AI draws a lamp a little bigger than the model's, and its rim, on the ceiling
    # behind, came back as a ghost lamp beside the real one once the visitor moved (31 Oct, new Restaurant 360s).
    # 16 px on the far side of a near object: where something within 16 px is 10 % nearer.
    near = np.where(mm > 0, mm, 1e9)
    for _ in range(16):
        n = near.copy()
        n[1:] = np.minimum(n[1:], near[:-1]); n[:-1] = np.minimum(n[:-1], near[1:])
        n[:, 1:] = np.minimum(n[:, 1:], near[:, :-1]); n[:, :-1] = np.minimum(n[:, :-1], near[:, 1:])
        near = n
    zone |= (mm > 0) & (mm > near * 1.1)
    a = lum(os.path.join(tour, v["ai"]))
    b = lum(os.path.join(tour, v["pano"]))
    ma, mb = box(a, R), box(b, R)
    va = np.maximum(box(a * a, R) - ma * ma, 0)
    vb = np.maximum(box(b * b, R) - mb * mb, 0)
    cov = box(a * b, R) - ma * mb
    ncc = cov / np.sqrt(va * vb + 1e-9)
    sa, sb = np.sqrt(va), np.sqrt(vb)
    flat = (sa < 0.02) & (sb < 0.02)
    lone = (np.maximum(sa, sb) > 0.04) & (np.minimum(sa, sb) < 0.015)  # a pattern in one picture only
    kept = np.clip((ncc - 0.25) / 0.45, 0, 1)
    kept = np.where(flat, 1.0, np.where(lone, 0.0, kept))
    kept = np.where(zone, kept, 1.0)
    kept = box(kept, 1)  # soften the mask's own edges
    k6 = np.round(kept * 63).astype(np.uint8)
    d[..., 2] = (d[..., 2] & 192) | k6
    Image.fromarray(d).save(path)
    hit = mm > 0
    print("view %d %-9s near edges %.1f%% of the picture; there %.0f%% kept, %.0f%% dropped; overall %.1f%% dropped" % (
        v["index"], v.get("name"), 100 * zone[hit].mean(), 100 * (kept[zone & hit] > 0.7).mean(), 100 * (kept[zone & hit] < 0.3).mean(),
        100 * (kept[hit] < 0.3).mean()))
