"""
Gateway tiles for a 360 (8 Nov, step "AI inside the 360"): the render is enlarged, cut into perspective views (one ring, ~19 px/deg),
each view goes to the image gateway as an ordinary photo (scripts/pano-tiles-gateway.mts), and the edited views are laid back on a
6144 px equirect with feathered weights (the same laying as ai_pano_tiles.py). pano_finish.py then fences that AI panorama
exactly as it fences any other (colour and light from Blender, detail only where it lines up).

python pano_tiles.py cut  <base.png> <masks.npz> <outdir> [json {width,size,fov,pitch,yawStep}]
python pano_tiles.py lay  <outdir> <name>                  # reads <outdir>/views.json and <outdir>/<view>-ai.jpg
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import cv2


def look_bl(yaw, pitch):
    """camera-to-world rotation in Blender's frame, columns right, up, back (the capture's c2w)"""
    f = np.array([math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)])
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.stack([r, u, -f], 1)


def cut(pano, depth, R, size, fov):
    """a pinhole view (colour, planar depth) of an equirect, in the capture's projection (no torch: cv2.remap)"""
    H, W = pano.shape[:2]
    fl = size / 2 / math.tan(math.radians(fov) / 2)
    a = (np.arange(size) + 0.5 - size / 2) / fl
    gy, gx = np.meshgrid(-a, a, indexing="ij")
    loc = np.stack([gx, gy, -np.ones_like(gx)], -1)
    d = loc @ R.T
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    az = np.arctan2(d[..., 1], d[..., 0])
    lat = np.arcsin(np.clip(d[..., 2], -1, 1))
    col = (np.mod(math.pi - az, 2 * math.pi) / (2 * math.pi) * W - 0.5).astype(np.float32)
    row = ((math.pi / 2 - lat) / math.pi * H - 0.5).astype(np.float32)
    img = cv2.remap(pano.astype(np.float32), col, row, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    z = cv2.remap(depth.astype(np.float32), col, row, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    return img, z / np.linalg.norm(loc, axis=-1)


mode = sys.argv[1]
if mode == "cut":
    base_p, masks_p, outdir = sys.argv[2:5]
    opt = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
    W = int(opt.get("width", 6144)); H = W // 2
    size, fov, pitch, step = int(opt.get("size", 1536)), float(opt.get("fov", 80)), float(opt.get("pitch", -12)), float(opt.get("yawStep", 60))
    os.makedirs(outdir, exist_ok=True)
    base = cv2.cvtColor(cv2.imread(base_p), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    up = np.clip(cv2.resize(base, (W, H), interpolation=cv2.INTER_LANCZOS4), 0, 1)
    cv2.imwrite(os.path.join(outdir, "up.png"), cv2.cvtColor((up * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
    z = np.load(masks_p)["depth"].astype(np.float32)
    depth = cv2.resize(z, (W, H), interpolation=cv2.INTER_LINEAR)
    views = []
    for i in range(int(round(360 / step))):
        yaw = i * step
        R = look_bl(math.radians(yaw), math.radians(pitch))
        img, _ = cut(up, depth, R, size, fov)
        name = "v%d" % i
        cv2.imwrite(os.path.join(outdir, name + "-in.png"), cv2.cvtColor((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
        views.append({"name": name, "yaw": yaw, "pitch": pitch})
    json.dump({"width": W, "size": size, "fov": fov, "views": views}, open(os.path.join(outdir, "views.json"), "w"))
    print("CUT", len(views), "views", size, "px, fov", fov)
else:
    outdir, name = sys.argv[2:4]
    meta = json.load(open(os.path.join(outdir, "views.json")))
    W = meta["width"]; H = W // 2; SIZE = meta["size"]; FOV = meta["fov"]
    up = cv2.cvtColor(cv2.imread(os.path.join(outdir, "up.png")), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    T = math.tan(math.radians(FOV) / 2); fl = SIZE / 2 / T
    acc = np.zeros((H, W, 3), np.float32); wsum = np.zeros((H, W), np.float32)
    row = (np.arange(H) + 0.5) / H; AZ = math.pi - ((np.arange(W) + 0.5) / W) * 2 * math.pi
    used = 0
    for v in meta["views"]:
        p = os.path.join(outdir, v["name"] + "-ai.jpg")
        if not os.path.exists(p):
            continue
        tile = cv2.cvtColor(cv2.imread(p), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        tile = cv2.resize(tile, (SIZE, SIZE), interpolation=cv2.INTER_AREA if tile.shape[0] > SIZE else cv2.INTER_CUBIC)
        R = look_bl(math.radians(v["yaw"]), math.radians(v["pitch"]))
        used += 1
        for r0 in range(0, H, 256):
            r1 = min(H, r0 + 256)
            a, l = np.meshgrid(AZ, math.pi / 2 - row[r0:r1] * math.pi)
            d = np.stack([np.cos(l) * np.cos(a), np.cos(l) * np.sin(a), np.sin(l)], -1)
            loc = d @ R
            fwd = -loc[..., 2]; ok = fwd > 1e-3
            u = np.where(ok, loc[..., 0] / np.maximum(fwd, 1e-3), 9); w_ = np.where(ok, loc[..., 1] / np.maximum(fwd, 1e-3), 9)
            inside = (np.abs(u) < T * 0.999) & (np.abs(w_) < T * 0.999)
            if not inside.any():
                continue
            e = np.minimum(1 - np.abs(u) / T, 1 - np.abs(w_) / T)
            wt = np.clip(e / 0.4, 0, 1); wt = wt * wt * (3 - 2 * wt) * inside
            samp = cv2.remap(tile, (u * fl + SIZE / 2 - 0.5).astype(np.float32), (-w_ * fl + SIZE / 2 - 0.5).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            acc[r0:r1] += samp * wt[..., None]; wsum[r0:r1] += wt
    ai = np.where(wsum[..., None] > 1e-4, acc / np.maximum(wsum, 1e-4)[..., None], up)
    mix = np.clip(wsum / 0.15, 0, 1)[..., None]
    ai = ai * mix + up * (1 - mix)
    cv2.imwrite(os.path.join(outdir, name + "-ai.png"), cv2.cvtColor((np.clip(ai, 0, 1) * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
    print("LAY", used, "views, coverage %.3f" % float((wsum > 1e-4).mean()))
