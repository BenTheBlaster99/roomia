"""
Local AI finish for a Blender 360, tile by tile (8 Nov, step 6 bake-off): the free alternative to the gateway's whole-panorama edit.

The panorama is enlarged to <width> (default 6144, ~17 px/deg), cut into perspective tiles (fov 60, 1024 px = the same ~17 px/deg),
each tile is refined by SDXL img2img held to the real geometry by a depth ControlNet (the render's own depth) and to the approved
look by an IP-Adapter (ai_refiner.py), and the tiles are laid back on the equirect with feathered weights. The result is an
"AI panorama" that pano_finish.py then fences exactly like the gateway's (colour and light from Blender, detail only on materials
where it lines up).

python ai_pano_tiles.py <base.png> <masks.npz> <outdir> <name> [json {width, size, fov, strength, control, ipScale, ref, pitches, yawStep, steps}]
Writes <outdir>/<name>-up.png (enlarged render), <name>-ai.png (the tile panorama), tiles/ (resumable).
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import cv2
from PIL import Image
from ai_refiner import Refiner, cut, depth_image, look_bl

base_p, masks_p, outdir, name = sys.argv[1:5]
opt = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
W = int(opt.get("width", 6144)); H = W // 2
SIZE = int(opt.get("size", 1024)); FOV = float(opt.get("fov", 60))
PITCHES = opt.get("pitches", [-55, -20, 15, 50])
YAWSTEP = float(opt.get("yawStep", 40))
REF = opt.get("ref")
os.makedirs(os.path.join(outdir, "tiles"), exist_ok=True)

base = cv2.cvtColor(cv2.imread(base_p), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
up = np.clip(cv2.resize(base, (W, H), interpolation=cv2.INTER_LANCZOS4), 0, 1)
cv2.imwrite(os.path.join(outdir, name + "-up.png"), cv2.cvtColor((up * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
z = np.load(masks_p)["depth"].astype(np.float32)
depth = cv2.resize(z, (W, H), interpolation=cv2.INTER_LINEAR)
depth = np.where(np.isfinite(depth), depth, 60.0)

t0 = time.time()
ref = Refiner(REF, ip_scale=float(opt.get("ipScale", 0.3)))
print("TILES model ready %.0fs" % (time.time() - t0), flush=True)

yaws = [i * YAWSTEP for i in range(int(round(360 / YAWSTEP)))]
views = [(y, p) for p in PITCHES for y in yaws]
T = math.tan(math.radians(FOV) / 2)
fl = SIZE / 2 / T

acc = np.zeros((H, W, 3), np.float32)
wsum = np.zeros((H, W), np.float32)
col = (np.arange(W) + 0.5) / W
row = (np.arange(H) + 0.5) / H
AZ = math.pi - col * 2 * math.pi


def lay(tile, R):
    """add one refined tile to the accumulators (inverse mapping, strips of rows)"""
    for r0 in range(0, H, 256):
        r1 = min(H, r0 + 256)
        lat = math.pi / 2 - row[r0:r1] * math.pi
        a, l = np.meshgrid(AZ, lat)
        d = np.stack([np.cos(l) * np.cos(a), np.cos(l) * np.sin(a), np.sin(l)], -1)
        loc = d @ R                                   # (rows, W, 3): the tile camera's frame, forward = -z
        fwd = -loc[..., 2]
        ok = fwd > 1e-3
        u = np.where(ok, loc[..., 0] / np.maximum(fwd, 1e-3), 9)
        v = np.where(ok, loc[..., 1] / np.maximum(fwd, 1e-3), 9)
        inside = (np.abs(u) < T * 0.999) & (np.abs(v) < T * 0.999)
        if not inside.any():
            continue
        e = np.minimum(1 - np.abs(u) / T, 1 - np.abs(v) / T)          # 0 at the tile edge, 1 at the centre
        w = np.clip(e / 0.4, 0, 1); w = w * w * (3 - 2 * w) * inside   # feather over the outer 40 %
        px = (u * fl + SIZE / 2 - 0.5).astype(np.float32)
        py = (-v * fl + SIZE / 2 - 0.5).astype(np.float32)
        samp = cv2.remap(tile, px, py, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        acc[r0:r1] += samp * w[..., None]
        wsum[r0:r1] += w


for i, (yaw, pitch) in enumerate(views):
    t1 = time.time()
    R = look_bl(math.radians(yaw), math.radians(pitch))
    tp = os.path.join(outdir, "tiles", "%s-%02d-y%d-p%d.png" % (name, i, yaw, pitch))
    if os.path.exists(tp):
        tile = np.asarray(Image.open(tp).convert("RGB")).astype(np.float32) / 255
    else:
        img, zz = cut(up, depth, R, SIZE, FOV)
        out = ref(Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)), depth_image(zz),
                  strength=float(opt.get("strength", 0.3)), control=float(opt.get("control", 0.9)), steps=int(opt.get("steps", 26)))
        out.save(tp)
        tile = np.asarray(out).astype(np.float32) / 255
    lay(tile, R)
    print("TILES %d/%d yaw %d pitch %d  %.0fs" % (i + 1, len(views), yaw, pitch, time.time() - t1), flush=True)

ai = np.where(wsum[..., None] > 1e-4, acc / np.maximum(wsum, 1e-4)[..., None], up)
cover = float((wsum > 1e-4).mean())
# where the tiles do not reach (poles) or barely do, fall back to the enlarged render
mix = np.clip(wsum / 0.15, 0, 1)[..., None]
ai = ai * mix + up * (1 - mix)
cv2.imwrite(os.path.join(outdir, name + "-ai.png"), cv2.cvtColor((np.clip(ai, 0, 1) * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR))
print("TILES_DONE coverage %.3f total %.0fs" % (cover, time.time() - t0), flush=True)
