"""
Step B of the walk-AI-detail plan (11 Nov 2026): the AI's fine detail, from finished 360s, onto the unique textures of step A.

~/.local/bin/roomia-py scripts/walk_ai_detail.py <walk-dir> <sources.json> [--out <dir>]

walk-dir     the outDir of walk_unwrap.py (walk-unwrap.json, <atlas>-col.png / -pos.npz / -nrm.npz)
sources.json [{"name": "t6", "eye": [x,y,z] (glTF), "base": "t6-pano.png", "final": "t6-final.png", "depth": "t6-masks.npz" (key depth, metres,
              half size) , "fence": {"npz": "t6-masks.npz", keys...}}]   ("final" may be any picture with more detail than "base")

Per texel: ratio r = final / base (display sRGB), high-passed; weighted over the sources that see the texel (depth test, facing,
fence, enough pano pixels per texel); col_ai = col * r. Colour and light never change: only the multiplier's high frequencies enter.
Writes <out>/<atlas>-col-ai.png, <out>/report.json and a before/after sheet per atlas.
"""
import json, math, os, sys
import cv2
import numpy as np

wdir = sys.argv[1]
src = json.load(open(sys.argv[2]))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(wdir, "ai")
os.makedirs(out, exist_ok=True)
rep = json.load(open(os.path.join(wdir, "walk-unwrap.json")))
gl2b = lambda p: np.array([p[0], -p[2], p[1]], np.float32)
SIGMA_HP = 8.0        # px at 6144: what counts as "colour/light" (kept from the render) against "texture" (taken from the AI)
R_CLIP = (0.6, 1.6)
MIN_FACING = 0.12     # two-sided: SketchUp's reversed faces make the baked normal's sign unreliable (45% of the seen texels pointed away)
MIN_PX_PER_TEXEL = 0.5
SEAM_FRAC = 0.06


def load_src(s):
    b = cv2.cvtColor(cv2.imread(s["base"]), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    f = cv2.cvtColor(cv2.imread(s["final"]), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    H, W = f.shape[:2]
    b = cv2.resize(b, (W, H), interpolation=cv2.INTER_CUBIC)
    r = f / np.maximum(b, 0.02)
    r = r / np.maximum(cv2.GaussianBlur(r, (0, 0), SIGMA_HP * W / 6144), 1e-3)  # keep the high frequencies of the ratio only
    r = np.clip(r, *R_CLIP)
    z = np.load(s["depth"])
    depth = z["depth"].astype(np.float32)                     # metres, half size (H/4 x W/4 of a 6144 pano is not assumed: any size)
    fence = np.ones((H, W), np.float32)
    for k, w in (s.get("fenceKeys") or {"ceiling": 0.0, "mirror": 0.0, "emit": 0.0, "sky": 0.0, "glass": 0.15}).items():
        if k in z.files:
            m = cv2.resize(z[k].astype(np.float32), (W, H), interpolation=cv2.INTER_NEAREST) > 0.5
            m = cv2.dilate(m.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0   # a margin around the fenced areas
            fence[m] = np.minimum(fence[m], w)
    return {"eye": gl2b(s["eye"]), "r": r, "depth": depth, "fence": fence, "W": W, "H": H, "name": s["name"]}


def dir_to_uv(d):
    """world (blender) direction -> equirect pixel fractions, pano_tiles.cut's convention: col = (pi - az) / 2pi, row = (pi/2 - lat) / pi"""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    lon = np.arctan2(y, x)                 # 0 = +x
    lat = np.arcsin(np.clip(z / np.maximum(np.linalg.norm(d, axis=-1), 1e-9), -1, 1))
    u = np.mod(np.pi - lon, 2 * np.pi) / (2 * np.pi)   # pano_tiles.cut: col = (pi - az) / 2pi
    v = 0.5 - lat / np.pi
    return u, v


def remap_pts(img, u, v, nearest=False):
    """sample img (H,W[,C]) at fractional equirect positions u (wraps) and v (clamped), for a flat list of points
    (cv2.remap cannot take a map wider than 32767 px)"""
    H, W = img.shape[:2]
    x = u * W - 0.5
    y = np.clip(v * H - 0.5, 0, H - 1)
    if nearest:
        return img[np.rint(y).astype(np.int64) % H, np.rint(x).astype(np.int64) % W]
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    x1, y1 = (x0 + 1) % W, np.minimum(y0 + 1, H - 1)
    x0 %= W
    if img.ndim == 3:
        fx, fy = fx[:, None], fy[:, None]
    return (img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy


S = [load_src(s) for s in src]
report = {"atlases": []}
for a in rep["atlases"]:
    n = a["name"]
    col = cv2.cvtColor(cv2.imread(os.path.join(wdir, a["col"])), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    pos = np.load(os.path.join(wdir, a["pos"]))["v"]
    nrm = np.load(os.path.join(wdir, a["nrm"]))["v"] * 2 - 1
    valid = np.abs(pos).sum(-1) > 1e-6
    H, W = valid.shape
    acc = np.zeros((H, W, 3), np.float32)
    wsum = np.zeros((H, W), np.float32)
    ys, xs = np.nonzero(valid)
    P, N = pos[ys, xs], nrm[ys, xs]
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-6)
    texel_cm = 100.0 / max(a["texelsPerCm"], 1e-3)  # one texel is 1/(px per cm) cm: texel size in cm = 1 / texelsPerCm... (cm per texel)
    texel_cm = 1.0 / max(a["texelsPerCm"], 1e-3)
    cov = {}
    for s in S:
        d = P - s["eye"]
        dist = np.linalg.norm(d, axis=1)
        dn = d / np.maximum(dist[:, None], 1e-6)
        facing = np.abs((N * dn).sum(1))
        u, v = dir_to_uv(dn)
        # depth test against the pano's own depth (half size map)
        dm = remap_pts(s["depth"], u, v, nearest=True)
        ok = (np.abs(dist - dm) <= np.maximum(0.04, 0.02 * dist)) & (facing >= MIN_FACING)   # the texel IS the surface the pano saw
        # pano pixels per texel: the pano has W/360 px per degree; a texel of texel_cm at distance dist spans (texel_cm/100/dist) rad
        px_per_texel = (s["W"] / (2 * math.pi)) * (texel_cm / 100.0) / np.maximum(dist, 0.05)
        ok &= px_per_texel >= MIN_PX_PER_TEXEL
        fe = remap_pts(s["fence"], u, v)
        seam = np.clip(np.minimum(u, 1 - u) / SEAM_FRAC, 0, 1)
        w = facing ** 2 * np.minimum(1.0, px_per_texel / 2.0) * fe * seam * ok
        r = remap_pts(s["r"], u, v)
        acc[ys, xs] += r * w[:, None]
        wsum[ys, xs] += w
        cov[s["name"]] = round(float((w > 0.004).mean()), 3)
    R = np.ones((H, W, 3), np.float32)
    seen = wsum > 0.004
    R[seen] = acc[seen] / wsum[seen][:, None]
    # feathered back to 1 where the evidence is thin (a texel seen weakly moves a little, one seen well moves fully)
    conf = np.clip(wsum / 0.08, 0, 1)[..., None]   # one decent view is enough to move a texel; grazing or distant ones move it less
    R = 1 + (R - 1) * conf
    # no hard seams at the island borders: blur the multiplier's departure from 1 slightly inside valid texels
    dev = cv2.GaussianBlur((R - 1) * valid[..., None], (0, 0), 1.2)
    R = 1 + dev
    new = np.clip(col * R, 0, 1)
    cv2.imwrite(os.path.join(out, n + "-col-ai.png"), cv2.cvtColor((new * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
    stat = {"atlas": n, "validTexels": int(valid.sum()), "seenFraction": round(float(seen[valid].mean()), 3), "meanAbsDeviation": round(float(np.abs(R - 1)[valid].mean()), 4),
            "maxDeviation": round(float(np.abs(R - 1)[valid].max()), 3), "perSourceCoverage": cov}
    report["atlases"].append(stat)
    print("WALK_B", json.dumps(stat), flush=True)
    # a before / after crop around the best-covered 512 px area
    sc = cv2.boxFilter((wsum * valid).astype(np.float32), -1, (512, 512))
    cy, cx = np.unravel_index(np.argmax(sc), sc.shape)
    y0, x0 = int(np.clip(cy - 256, 0, H - 512)), int(np.clip(cx - 256, 0, W - 512))
    crop = np.hstack([col[y0:y0 + 512, x0:x0 + 512], new[y0:y0 + 512, x0:x0 + 512]])
    cv2.imwrite(os.path.join(out, "sheet-" + n + ".jpg"), cv2.cvtColor((crop * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
print("WALK_B_OK", flush=True)
