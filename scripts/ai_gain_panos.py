"""
AI corrections for the walk (8 Nov): for some panoramas of a capture, the walk's own frames are refined by the local
model (ai_refiner.py) and what the AI changed becomes a gain map on the panorama, saved as "rgb_<key>" beside "rgb":

  frames: 8 yaws (45 deg apart) x 3 pitches (-40, -5, +30), 75 deg, 768 px, shown as the walk shows them (exposure,
          AgX, grade), refined, then ratio = sRGB-decoded AI / sRGB-decoded walk frame (what it made lighter, darker,
          another tone), clipped to [0.5, 2], softened
  gain:   the ratios laid back on the equirect, feathered where frames overlap, 1 where no frame looked
  rgb_<key> = rgb x gain

The trainer then refits the splat's colours to rgb_<key> (splat_train.py: rgbKey + freeze), so the walk's model
textures stay sharp and the AI's corrections arrive as light. Same seed, same reference photo, tight depth lock: the
same floor seen from two spots gets the same correction.

python ai_gain_panos.py <capture dir> '<json {panos: [...], key, ref, grade, exposure, ...}>'
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from ai_refiner import Refiner, cut, depth_image, equirect_dirs, look_bl
from look_grade import grade

cap = sys.argv[1]
opt = json.loads(sys.argv[2])
KEY = opt.get("key", "ai")
SIZE = int(opt.get("size", 768))
FOV = float(opt.get("fov", 75))
YAWS = [i * 45 for i in range(8)]
PITCHES = opt.get("pitches", [-40, -5, 30])
meta = json.load(open(os.path.join(cap, "panos.json")))
os.makedirs(os.path.join(cap, "ai-frames"), exist_ok=True)

t0 = time.time()
R = Refiner(opt.get("ref"), ip_scale=float(opt.get("ipScale", 0.4)))
print("AIGAIN model ready %.0fs" % (time.time() - t0), flush=True)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def soften(x, s=2.0):
    k = int(s * 3) * 2 + 1
    ax = torch.arange(k, dtype=torch.float32) - k // 2
    g = torch.exp(-ax ** 2 / (2 * s * s)); g = g / g.sum()
    t = torch.from_numpy(x).permute(2, 0, 1)[None].float()
    t = F.conv2d(F.pad(t, (k // 2, k // 2, 0, 0), mode="replicate"), g.view(1, 1, 1, k).repeat(3, 1, 1, 1), groups=3)
    t = F.conv2d(F.pad(t, (0, 0, k // 2, k // 2), mode="replicate"), g.view(1, 1, k, 1).repeat(3, 1, 1, 1), groups=3)
    return t[0].permute(1, 2, 0).numpy()


for n, pi_ in enumerate(opt["panos"]):
    t1 = time.time()
    p = meta["panos"][int(pi_)]
    f = os.path.join(cap, p["file"])
    z = np.load(f)
    data = {k: z[k] for k in z.files}
    pano = data["rgb"].astype(np.float32)
    dep = np.minimum(data["depth"].astype(np.float32), 100.0)
    H, W = pano.shape[:2]
    dirs = equirect_dirs(W, H).reshape(-1, 3)
    acc = np.zeros((H * W, 3), np.float32)
    wsum = np.zeros(H * W, np.float32)
    fl = SIZE / 2 / math.tan(math.radians(FOV) / 2)
    for pitch in PITCHES:
        for yaw in YAWS:
            Rm = look_bl(math.radians(yaw), math.radians(pitch))
            lin, zz = cut(pano, dep, Rm, SIZE, FOV)
            shown = np.clip(grade(lin * float(opt["exposure"]), opt["grade"]), 0, 1)
            img_in = Image.fromarray((shown * 255 + 0.5).astype(np.uint8))
            out = R(img_in, depth_image(zz), strength=float(opt.get("strength", 0.3)), control=float(opt.get("controlScale", 0.9)),
                    steps=int(opt.get("steps", 26)), seed=int(opt.get("seed", 7)))
            ai = np.asarray(out).astype(np.float32) / 255
            if n == 0 and yaw in (0, 180) and pitch == -5:
                img_in.save(os.path.join(cap, "ai-frames", "p%d-y%d-in.jpg" % (pi_, yaw)))
                out.save(os.path.join(cap, "ai-frames", "p%d-y%d-ai.jpg" % (pi_, yaw)))
            ratio = srgb_to_lin(ai) / np.maximum(srgb_to_lin(shown), 0.02)
            lr = np.log(np.clip(soften(ratio), 0.5, 2.0)).astype(np.float32)
            # back on the equirect: each pixel's place in this frame, feathered towards the frame's edges
            loc = dirs @ Rm
            zc = -loc[:, 2]
            ok = zc > 1e-4
            x = np.where(ok, loc[:, 0] / np.where(ok, zc, 1) * fl + SIZE / 2 - 0.5, -1)
            y = np.where(ok, -loc[:, 1] / np.where(ok, zc, 1) * fl + SIZE / 2 - 0.5, -1)
            inside = ok & (x >= 0) & (x <= SIZE - 1) & (y >= 0) & (y <= SIZE - 1)
            if not inside.any():
                continue
            idx = np.nonzero(inside)[0]
            gx = torch.from_numpy(x[idx] / (SIZE - 1) * 2 - 1).float()
            gy = torch.from_numpy(y[idx] / (SIZE - 1) * 2 - 1).float()
            s = F.grid_sample(torch.from_numpy(lr).permute(2, 0, 1)[None], torch.stack([gx, gy], -1)[None, None], mode="bilinear", align_corners=True)[0, :, 0].T.numpy()
            ex = np.minimum(np.minimum(x[idx], SIZE - 1 - x[idx]), np.minimum(y[idx], SIZE - 1 - y[idx])) / (SIZE * 0.2)
            w = np.clip(ex, 0, 1) ** 2 * np.clip(zc[idx] / 1.0, 0.2, 1.0)  # feather, and a little less at the far edge
            acc[idx] += s * w[:, None]
            wsum[idx] += w
    gain = np.exp(acc / np.maximum(wsum, 1e-6)[:, None] * np.minimum(wsum, 1.0)[:, None]).reshape(H, W, 3)
    data["rgb_" + KEY] = (pano * gain).astype(np.float16)
    data["gain_" + KEY] = gain.astype(np.float16)
    tmp = f + ".tmp.npz"
    np.savez(tmp, **data)
    os.replace(tmp, f)
    print("AIGAIN pano %d done %.0fs  (%d / %d)  gain median %.3f, 5-95%% %.2f..%.2f" % (
        pi_, time.time() - t1, n + 1, len(opt["panos"]), float(np.median(gain)), float(np.percentile(gain, 5)), float(np.percentile(gain, 95))), flush=True)
print("AIGAIN_OK", flush=True)
