"""
Checks the equirect convention of walk_ai_detail.py against ground truth: the render's own albedo pass (masks.npz 'albedo') must equal
the baked colour of the same surface. Tries the four orientations; the right one has a small median colour error and the others don't.

~/.local/bin/roomia-py scripts/walk_check_projection.py <walk-dir> <eye x,y,z glTF> <masks.npz>
"""
import json, math, os, sys
import cv2
import numpy as np


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

wdir, eye_s, masks = sys.argv[1], sys.argv[2], sys.argv[3]
eye = np.array([float(a) for a in eye_s.split(",")], np.float32)
eye = np.array([eye[0], -eye[2], eye[1]], np.float32)
z = np.load(masks)
alb = z["albedo"].astype(np.float32)[..., :3]
dep = z["depth"].astype(np.float32)
H, W = dep.shape
rep = json.load(open(os.path.join(wdir, "walk-unwrap.json")))
variants = {"u=+lon": lambda lon, lat: (0.5 + lon / (2 * np.pi), 0.5 - lat / np.pi), "u=-lon": lambda lon, lat: (0.5 - lon / (2 * np.pi), 0.5 - lat / np.pi),
            "u=+lon,v flipped": lambda lon, lat: (0.5 + lon / (2 * np.pi), 0.5 + lat / np.pi), "u=lon/2pi (no half turn)": lambda lon, lat: (lon / (2 * np.pi) % 1, 0.5 - lat / np.pi)}
best = {}
for a in rep["atlases"]:
    col = cv2.cvtColor(cv2.imread(os.path.join(wdir, a["col"])), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    pos = np.load(os.path.join(wdir, a["pos"]))["v"]
    nrm = np.load(os.path.join(wdir, a["nrm"]))["v"] * 2 - 1
    ys, xs = np.nonzero(np.abs(pos).sum(-1) > 1e-6)
    rng = np.random.default_rng(1)
    pick = rng.choice(len(ys), min(len(ys), 200000), replace=False)
    ys, xs = ys[pick], xs[pick]
    P, N, C = pos[ys, xs], nrm[ys, xs], col[ys, xs]
    C = np.where(C <= 0.04045, C / 12.92, ((C + 0.055) / 1.055) ** 2.4)  # the baked PNG is sRGB, the render's albedo pass is linear
    d = P - eye
    dist = np.linalg.norm(d, axis=1)
    dn = d / np.maximum(dist[:, None], 1e-6)
    N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-6)
    facing = -(N * dn).sum(1)
    lon = np.arctan2(dn[:, 1], dn[:, 0])
    lat = np.arcsin(np.clip(dn[:, 2], -1, 1))
    for name, f in variants.items():
        u, v = f(lon, lat)
        dm = remap_pts(dep, u, v, nearest=True)
        A = remap_pts(alb, u, v)
        ok = (dist < 6) & (facing > 0.5) & (dist <= dm * 1.03 + 0.05)
        err = np.abs(A[ok] - C[ok]).mean(1) if ok.any() else np.array([9])
        best.setdefault(name, []).append((int(ok.sum()), float(np.median(err))))
        print("CHECK", a["name"], name, "visible texels", int(ok.sum()), "median |albedo - baked colour| = %.3f" % np.median(err), flush=True)
