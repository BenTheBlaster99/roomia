"""
Splat trainer v2 (7 Nov): the walk at Cycles quality, trained on the capture of lib/splat-capture.ts (mode 'panos').

What changed from v1 (Brush on 640 px views cut once, 8-bit):
- The splats start ON the model's surfaces, flat, facing out, coloured from the panoramas (we know the apartment's
  shape exactly; v1 guessed it and drew streaks on walls and ghosts beside furniture).
- Blender's depth trains with the colours: a splat cannot drift off a wall or float in front of a bed.
- Views are cut on the graphics card from the panoramas at every step, any direction, at full resolution, in true
  light (float), not 640 px 8-bit pictures with 19 stops squeezed into 256 levels.
- A fixed budget of splats (MCMC), so time and file size are known in advance.

python scripts/splat_train.py <capture dir> <out dir> '<json options>'
Out: <out>/splat.ply (standard 3DGS, glTF world), <out>/train.json, <out>/tests/*.jpg (truth | splat).
Runs in the splat venv (Python 3.10, torch 2.4 cu124, gsplat 1.5.3).
"""
import json
import math
import os
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from gsplat import rasterization
from gsplat.strategy import MCMCStrategy

cap_dir, out_dir = sys.argv[1], sys.argv[2]
opt = json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else {}
STEPS = int(opt.get("steps", 15000))
RES = int(opt.get("res", 1024))
RES0 = int(opt.get("resStart", 512))
RES_AT = float(opt.get("resAt", 0.5))  # fraction of the steps at RES0 before RES
FOV = float(opt.get("fov", 90.0))
SH = int(opt.get("sh", 3))
CAP = int(opt.get("cap", 1500000))
INIT = int(opt.get("init", 700000))
W_DEPTH = float(opt.get("depth", 0.5))
W_SSIM = float(opt.get("ssim", 0.2))
W_FLAT = float(opt.get("flat", 0.0))
RASTER = opt.get("raster", "antialiased")
W_REG = float(opt.get("reg", 0.01))
LR_MEANS = float(opt.get("lrMeans", 6e-4))
EVAL_ONLY = bool(opt.get("evalOnly", False))
EVAL_EVERY = int(opt.get("evalEvery", 0))
# look presets (7 Nov, Phase 4): another light of the same capture (e.g. "rgb_day"), and the trained splat's shape kept
# as it is while only its colours learn that light (one shape, a colour set per time of day)
RGBK = opt.get("rgbKey", "rgb")


def rgb_of(z):
    """this look's picture of a panorama; the panoramas it was not made for (the AI refined only some) keep the plain one"""
    return z[RGBK] if RGBK in z.files else z["rgb"]

FREEZE = bool(opt.get("freeze", False))
dev = "cuda"
torch.manual_seed(0)
np.random.seed(0)
os.makedirs(out_dir, exist_ok=True)
t_start = time.time()


def log(*a):
    print("SPLAT_TRAIN", *a, flush=True)


meta = json.load(open(os.path.join(cap_dir, "panos.json")))


def albedo_of(file, z):
    """the colour pass: rendered from the walk's own model when the capture has it (<pano>-albedo.npy)"""
    side = os.path.join(cap_dir, file[:-4] + "-albedo.npy")
    # matte captures divide by Cycles' own colour (investigation 1: the clean light); others by the walk model's
    return np.load(side) if os.path.exists(side) and opt.get("albedoSource", "aov" if meta.get("matte") else "model") == "model" else z["albedo"]


LO, HI = float(meta["lo"]), float(meta["hi"])
# 'light' (v3): the splat holds the light only, picture / surface colour; the walk multiplies by the model's textures
FLOOR = float(opt.get("albedoFloor", 0.02))
LIGHT = bool(opt.get("light", True)) and "albedo" in np.load(os.path.join(cap_dir, meta["panos"][0]["file"])).files
if LIGHT:
    samp = []
    for p in meta["panos"][:: max(1, len(meta["panos"]) // 30)]:
        z = np.load(os.path.join(cap_dir, p["file"]))
        alb = albedo_of(p["file"], z)[::8, ::8].astype(np.float32)
        lt = rgb_of(z)[::8, ::8].astype(np.float32) / np.maximum(alb, FLOOR)
        # surfaces only: the sky through the windows (no colour, far away) stretched the range and the darkest
        # room fell below it (7 Nov, Suite bathroom, flat)
        surf = (z["depth"][::8, ::8].astype(np.float32) < 40) & (alb.max(-1) > FLOOR)
        lt = lt[surf]
        samp.append(lt[lt > 0].ravel())
    samp = np.concatenate(samp)
    # the top no higher than 7 stops over the median (lamp shades and their glow clip to white, as AgX shows them):
    # with 15 stops below the brightest glow the darkest room fell off the bottom again (7 Nov, Suite bathroom)
    med_ = float(np.log2(np.median(samp)))
    HI = min(float(np.log2(np.percentile(samp, 99.5))) + 0.5, med_ + 7.0)
    LO = max(float(np.log2(np.percentile(samp, 0.1))) - 1.0, HI - 16.0)
    log("light range from surfaces: log2 %.2f .. %.2f (median %.2f)" % (LO, HI, float(np.log2(np.median(samp)))))
if opt.get("lohi"):
    LO, HI = float(opt["lohi"][0]), float(opt["lohi"][1])


def encode(lin):
    # linear light -> the walk's 0..1 log curve (app/studio/explore/[id]/splatLayer.ts decodes it)
    return ((torch.log2(torch.clamp(lin, min=2.0 ** LO)) - LO) / (HI - LO)).clamp(0, 1)


def albedo_eff(alb, depth):
    """the colour the light is divided by: the surface's own, never below FLOOR; where there is no surface at all (sky
    through a window) white, so the sky keeps its own light (7 Nov, F5: divided by the floor it clipped and the walk
    showed black glass doors)"""
    a = alb.clamp(min=FLOOR)
    sky = (alb.max(-1, keepdim=True).values < 1e-3) & (depth[..., None] > 30)
    return torch.where(sky, torch.ones_like(a), a)


def decode(e):
    return torch.exp2(e * (HI - LO) + LO)


# ---- panoramas on the graphics card, one column of wrap each side
P_E, P_D, EYES = [], [], []
for p in meta["panos"]:
    z = np.load(os.path.join(cap_dir, p["file"]))
    rgb = torch.from_numpy(rgb_of(z)).to(dev).float()
    if LIGHT:
        rgb = rgb / albedo_eff(torch.from_numpy(albedo_of(p["file"], z)).to(dev).float(), torch.from_numpy(z["depth"]).to(dev).float())
    d = torch.from_numpy(z["depth"]).to(dev).float()
    e = encode(rgb)
    e = torch.cat([e[:, -1:], e, e[:, :1]], 1).permute(2, 0, 1).contiguous().half()
    d = torch.cat([d[:, -1:], d, d[:, :1]], 1)[None].contiguous().half()
    P_E.append(e)
    P_D.append(d)
    EYES.append(p["eye"])
EYES = torch.tensor(EYES, device=dev, dtype=torch.float32)
PH, PW = P_D[0].shape[1], P_D[0].shape[2] - 2
log("panoramas %d (%dx%d), %s range %.1f stops, loaded in %.1fs" % (len(P_E), PW, PH, "light only (picture / colour)" if LIGHT else "picture", HI - LO, time.time() - t_start))


def gl_to_bl(v):
    # glTF (x, y up, z) -> Blender (x, -z, y)
    return torch.stack([v[..., 0], -v[..., 2], v[..., 1]], -1)


def pano_grid(dirs_bl):
    """Blender-frame directions -> grid_sample coordinates in a padded panorama (the capture's projection)."""
    d = dirs_bl / dirs_bl.norm(dim=-1, keepdim=True)
    az = torch.atan2(d[..., 1], d[..., 0])
    lat = torch.asin(d[..., 2].clamp(-1, 1))
    col = torch.remainder(math.pi - az, 2 * math.pi) / (2 * math.pi) * PW - 0.5
    row = (math.pi / 2 - lat) / math.pi * PH - 0.5
    gx = (col + 1 + 0.5) / (PW + 2) * 2 - 1
    gy = (row + 0.5) / PH * 2 - 1
    return torch.stack([gx, gy], -1)


def look_bl(yaw, pitch):
    """Camera-to-world rotation in Blender's frame, columns right, up, back (the capture's c2w)."""
    f = torch.tensor([math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)])
    r = torch.linalg.cross(f, torch.tensor([0.0, 0.0, 1.0]))
    r = r / r.norm()
    u = torch.linalg.cross(r, f)
    return torch.stack([r, u, -f], 1)


GM = torch.tensor([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]])  # Blender -> glTF
CV = torch.diag(torch.tensor([1.0, -1.0, -1.0]))  # OpenGL camera -> OpenCV camera


def camera(R_bl, eye_gl, size, fov):
    fl = size / 2 / math.tan(math.radians(fov) / 2)
    R_gl = GM @ R_bl
    c2w = torch.eye(4)
    c2w[:3, :3] = R_gl @ CV
    c2w[:3, 3] = torch.as_tensor(eye_gl).cpu()
    K = torch.tensor([[fl, 0, size / 2], [0, fl, size / 2], [0, 0, 1.0]])
    return torch.linalg.inv(c2w).to(dev), K.to(dev), fl


LOCAL_CACHE = {}


def local_rays(size, fl):
    key = (size, round(fl, 4))
    if key not in LOCAL_CACHE:
        a = (torch.arange(size, device=dev, dtype=torch.float32) + 0.5 - size / 2) / fl
        gy, gx = torch.meshgrid(-a, a, indexing="ij")
        LOCAL_CACHE[key] = torch.stack([gx, gy, -torch.ones_like(gx)], -1)
    return LOCAL_CACHE[key]


def cut(i, R_bl, size, fl):
    """A pinhole view (encoded colour, planar depth) out of panorama i."""
    loc = local_rays(size, fl)
    dirs = loc @ R_bl.to(dev).T
    grid = pano_grid(dirs)[None]
    col = F.grid_sample(P_E[i][None].float(), grid, mode="bilinear", align_corners=False)[0].permute(1, 2, 0)
    ray = F.grid_sample(P_D[i][None].float(), grid, mode="nearest", align_corners=False)[0, 0]
    return col, ray / loc.norm(dim=-1)


# ---- splats on the surfaces
t_i = time.time()
pts = np.load(os.path.join(cap_dir, "points.npz"))
P = torch.from_numpy(pts["p"]).to(dev)
NRM = torch.from_numpy(pts["n"]).to(dev)
spacing0 = float(pts["spacing"])
SKY = torch.from_numpy(pts["sky"]).to(dev) if "sky" in pts.files else torch.zeros((0, 3), device=dev)
sky_r = float(pts["skyRadius"]) if "skyRadius" in pts.files else 80.0

best_d = torch.full((len(P),), 1e9, device=dev)
best_c = torch.zeros((len(P), 3), device=dev)
agree = []
for j in range(len(P_E)):
    for s in range(0, len(P), 1 << 20):
        q = P[s:s + (1 << 20)]
        v = q - EYES[j]
        dist = v.norm(dim=-1)
        grid = pano_grid(gl_to_bl(v))[None, None]
        r = F.grid_sample(P_D[j][None].float(), grid, mode="nearest", align_corners=False)[0, 0, 0]
        c = F.grid_sample(P_E[j][None].float(), grid, mode="bilinear", align_corners=False)[0, :, 0].T
        facing = (-(v / dist[:, None]) * NRM[s:s + (1 << 20)]).sum(-1).abs()
        vis = ((r - dist).abs() < 0.015 + 0.01 * dist) & (facing > 0.15)
        if s == 0 and j % 15 == 0:
            near = (r - dist).abs() < 0.5
            agree.append(float(((r - dist).abs() < 0.02)[near].float().mean()))
        better = vis & (dist < best_d[s:s + (1 << 20)])
        best_d[s:s + (1 << 20)] = torch.where(better, dist, best_d[s:s + (1 << 20)])
        best_c[s:s + (1 << 20)] = torch.where(better[:, None], c, best_c[s:s + (1 << 20)])
seen = best_d < 1e8
log("depth = distance along the ray: %s of nearby points agree within 2 cm" % ", ".join("%.2f" % a for a in agree))
idx = torch.nonzero(seen)[:, 0]
log("surface points seen from a panorama: %d of %d" % (len(idx), len(P)))
n_surf = min(INIT, len(idx))
idx = idx[torch.randperm(len(idx), device=dev)[:n_surf]]
means = P[idx]
nrm = NRM[idx]
col = best_c[idx]
spacing = spacing0 * math.sqrt(len(P) / max(n_surf, 1))
# the sky: big soft splats, coloured from the panoramas too
if len(SKY):
    sc = torch.zeros((len(SKY), 3), device=dev)
    sd = torch.full((len(SKY),), 1e9, device=dev)
    for j in range(len(P_E)):
        v = SKY - EYES[j]
        grid = pano_grid(gl_to_bl(v))[None, None]
        r = F.grid_sample(P_D[j][None].float(), grid, mode="nearest", align_corners=False)[0, 0, 0]
        c = F.grid_sample(P_E[j][None].float(), grid, mode="bilinear", align_corners=False)[0, :, 0].T
        vis = r > sky_r * 0.5
        better = vis & (v.norm(dim=-1) < sd)
        sd = torch.where(better, v.norm(dim=-1), sd)
        sc = torch.where(better[:, None], c, sc)
    keep = sd < 1e8
    log("sky points seen through windows: %d of %d" % (int(keep.sum()), len(SKY)))
    sky_p = SKY[keep]
    sky_c = sc[keep]
    sky_n = -(sky_p - sky_p.mean(0)) / (sky_p - sky_p.mean(0)).norm(dim=-1, keepdim=True)
else:
    sky_p = sky_c = sky_n = torch.zeros((0, 3), device=dev)
n_sky = len(sky_p)
means = torch.cat([means, sky_p])
nrm = torch.cat([nrm, sky_n])
col = torch.cat([col, sky_c])
# flat splats facing out: the rotation taking +z to the normal
nz = nrm[:, 2]
quats = torch.stack([1 + nz, -nrm[:, 1], nrm[:, 0], torch.zeros_like(nz)], -1)
flip = nz < -0.999
quats[flip] = torch.tensor([0.0, 1.0, 0.0, 0.0], device=dev)
quats = quats / quats.norm(dim=-1, keepdim=True)
# each point's own size (by area: the spacing; on a small triangle: its size), larger when only some are kept
own = torch.from_numpy(pts["s"]).to(dev)[idx] if "s" in pts.files else torch.full((n_surf,), spacing0, device=dev)
own = own * math.sqrt(max(int(seen.sum()) / max(n_surf, 1), 1.0))
tang = torch.cat([own, torch.full((n_sky,), sky_r * 0.02, device=dev)])
scales = torch.log(torch.stack([tang, tang, tang * 0.1], -1))
C0 = 0.28209479177387814
K = (SH + 1) ** 2
params = torch.nn.ParameterDict({
    "means": torch.nn.Parameter(means.contiguous()),
    "scales": torch.nn.Parameter(scales.contiguous()),
    "quats": torch.nn.Parameter(quats.contiguous()),
    "opacities": torch.nn.Parameter(torch.logit(torch.full((len(means),), 0.7, device=dev))),
    "sh0": torch.nn.Parameter(((col - 0.5) / C0)[:, None, :].contiguous()),
    "shN": torch.nn.Parameter(torch.zeros((len(means), K - 1, 3), device=dev)),
})
if opt.get("fromPly"):
    # diagnostics: a trained splat back in, no training
    with open(opt["fromPly"], "rb") as fh:
        head = b""
        while not head.endswith(b"end_header\n"):
            head += fh.readline()
        props = [l.split()[-1].decode() for l in head.split(b"\n") if l.startswith(b"property")]
        nv = int([l for l in head.split(b"\n") if l.startswith(b"element vertex")][0].split()[-1])
        arr = torch.from_numpy(np.frombuffer(fh.read(), dtype="<f4").reshape(nv, len(props)).copy()).to(dev)
    col_ = {nm: i for i, nm in enumerate(props)}
    g = lambda names: arr[:, [col_[x] for x in names]]
    nrest = len([x for x in props if x.startswith("f_rest_")]) // 3
    params = torch.nn.ParameterDict({
        "means": torch.nn.Parameter(g(["x", "y", "z"]).contiguous()),
        "scales": torch.nn.Parameter(g(["scale_0", "scale_1", "scale_2"]).contiguous()),
        "quats": torch.nn.Parameter(g(["rot_0", "rot_1", "rot_2", "rot_3"]).contiguous()),
        "opacities": torch.nn.Parameter(arr[:, col_["opacity"]].contiguous()),
        "sh0": torch.nn.Parameter(g(["f_dc_0", "f_dc_1", "f_dc_2"])[:, None, :].contiguous()),
        "shN": torch.nn.Parameter(g(["f_rest_%d" % k for k in range(nrest * 3)]).reshape(nv, 3, nrest).transpose(1, 2).contiguous()),
    })
    if not FREEZE:
        STEPS = 0
log("start: %d splats on surfaces (%.1f mm apart) + %d sky, in %.1fs" % (n_surf, spacing * 1000, n_sky, time.time() - t_i))

lrs = {"means": LR_MEANS, "scales": 5e-3, "quats": 1e-3, "opacities": 5e-2, "sh0": 2.5e-3, "shN": 2.5e-3 / 20}
if FREEZE:
    for k_ in ("means", "scales", "quats", "opacities"):
        params[k_].requires_grad_(False)
        lrs[k_] = 0.0
    lrs["sh0"] = float(opt.get("lrColour", 5e-3))
    lrs["shN"] = lrs["sh0"] / 20
optimizers = {k: torch.optim.Adam([{"params": params[k], "lr": lrs[k], "name": k}], eps=1e-15) for k in params}
# MCMC's position noise is made for scenes scaled to about one unit; ours is in metres (an apartment ~5 m across): at
# the default it threw splats ~0.5 m a step and the training blew up (7 Nov, first run).
NOISE_LR = float(opt.get("noiseLr", 3e4))
strategy = MCMCStrategy(cap_max=CAP, noise_lr=NOISE_LR, refine_start_iter=500, refine_stop_iter=int(STEPS * 0.8), refine_every=100, min_opacity=0.005)
if not FREEZE:
    strategy.check_sanity(params, optimizers)
state = strategy.initialize_state()


def gauss_win(size=11, sigma=1.5):
    x = torch.arange(size, device=dev, dtype=torch.float32) - size // 2
    g = torch.exp(-x ** 2 / (2 * sigma ** 2))
    return g / g.sum()


GW = gauss_win()


def blur(x):
    c = x.shape[1]
    x = F.conv2d(x, GW.view(1, 1, 1, -1).expand(c, 1, 1, -1), padding=(0, 5), groups=c)
    return F.conv2d(x, GW.view(1, 1, -1, 1).expand(c, 1, -1, 1), padding=(5, 0), groups=c)


def ssim(x, y):
    C1, C2 = 0.01 ** 2, 0.03 ** 2
    mx, my = blur(x), blur(y)
    sxx, syy, sxy = blur(x * x) - mx * mx, blur(y * y) - my * my, blur(x * y) - mx * my
    return (((2 * mx * my + C1) * (2 * sxy + C2)) / ((mx * mx + my * my + C1) * (sxx + syy + C2))).mean()


def render(viewmat, K_, size, sh_deg):
    colors = torch.cat([params["sh0"], params["shN"]], 1)
    out, alpha, info = rasterization(
        params["means"], params["quats"], torch.exp(params["scales"]), torch.sigmoid(params["opacities"]), colors,
        viewmat[None], K_[None], size, size, sh_degree=sh_deg, render_mode="RGB+ED", near_plane=0.05, packed=False, rasterize_mode=RASTER,
    )
    return out[0, ..., :3], out[0, ..., 3], alpha[0, ..., 0], info


def random_view():
    i = int(torch.randint(len(P_E), (1,)))
    u = float(torch.rand(1))
    if u < 0.62:
        pitch = float(torch.empty(1).uniform_(-25, 12))
    elif u < 0.85:
        pitch = float(torch.empty(1).uniform_(-80, -30))
    else:
        pitch = float(torch.empty(1).uniform_(25, 75))
    yaw = float(torch.rand(1)) * 2 * math.pi
    return i, look_bl(yaw, math.radians(pitch))


# ---- test views: truth | splat, as the walk shows them (eye exposure, AgX)
S2020 = torch.tensor([[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0113], [0.0164, 0.0880, 0.8956]], device=dev)
R2020 = torch.tensor([[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]], device=dev)
INSET = torch.tensor([[0.856627153315983, 0.0951212405381588, 0.0482516061458583],
                      [0.137318972929847, 0.761241990602591, 0.101439036467562],
                      [0.11189821299995, 0.0767994186031903, 0.811302368396859]], device=dev)
OUTSET = torch.tensor([[1.1271005818144368, -0.11060664309660323, -0.016493938717834573],
                       [-0.1413297634984383, 1.157823702216272, -0.016493938717834257],
                       [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405]], device=dev)


def agx(c):
    c = c @ S2020.T @ INSET.T
    c = ((torch.log2(c.clamp(min=1e-10)) + 12.47393) / (4.026069 + 12.47393)).clamp(0, 1)
    x2 = c * c
    x4 = x2 * x2
    c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232
    c = c @ OUTSET.T
    c = c.clamp(min=0) ** 2.2 @ R2020.T
    c = c.clamp(0, 1)
    return torch.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, c * 12.92)


TEST_DATA = []
LUMW = torch.tensor([0.2126, 0.7152, 0.0722], device=dev)
for t in [t for t in meta.get("tests", []) if t.get("kind") != "mirror"]:
    z = np.load(os.path.join(cap_dir, t["file"]))
    size = int(t["size"])
    c2w = torch.tensor(t["c2w"], dtype=torch.float32)
    c2w[:3, :3] = c2w[:3, :3] @ CV
    fl = size / 2 / math.tan(math.radians(float(t["fov"])) / 2)
    K_ = torch.tensor([[fl, 0, size / 2], [0, fl, size / 2], [0, 0, 1.0]], device=dev)
    truth = torch.from_numpy(z["rgb"]).to(dev).float()
    alb = albedo_eff(torch.from_numpy(albedo_of(t["file"], z)).to(dev).float(), torch.from_numpy(z["depth"]).to(dev).float()) if LIGHT else None
    lum = (truth @ LUMW).flatten()
    expo = 0.18 * 2 ** 0.3 / float(lum[lum > 0].median())
    matte = agx(torch.from_numpy(z["rgb_matte"]).to(dev).float() * expo) if "rgb_matte" in z.files else None
    TEST_DATA.append((t, torch.linalg.inv(c2w).to(dev), K_, size, agx(truth * expo), expo, alb, matte))


psnr_m = []


def evaluate(save_dir=None, sh_deg=SH):
    from PIL import Image
    psnrs, out = [], []
    psnr_m.clear()
    with torch.no_grad():
        for t, vm, K_, size, a, expo, alb, matte in TEST_DATA:
            img, _, _, _ = render(vm, K_, size, sh_deg)
            lin = decode(img.clamp(0, 1))
            b = agx((lin * alb if alb is not None else lin) * expo)
            psnrs.append(10 * math.log10(1 / max(float(((a - b) ** 2).mean()), 1e-10)))
            if matte is not None:
                psnr_m.append(10 * math.log10(1 / max(float(((matte - b) ** 2).mean()), 1e-10)))
            if save_dir:
                os.makedirs(save_dir, exist_ok=True)
                gap = torch.ones((size, 8, 3), device=dev)
                pair = torch.cat([a, gap, matte, gap, b] if matte is not None else [a, gap, b], 1)
                name = os.path.basename(t["file"]).replace(".npz", ".jpg")
                Image.fromarray((pair * 255).round().byte().cpu().numpy()).save(os.path.join(save_dir, name), quality=92)
                out.append({"file": "tests/" + name, "psnr": round(psnrs[-1], 2)})
    return (float(np.mean(psnrs)) if psnrs else 0.0), psnrs, out


# ---- training
t_tr = time.time()
if TEST_DATA and EVAL_EVERY:
    m_, ps_, _ = evaluate(os.path.join(out_dir, "tests-start"), sh_deg=0)
    log("eval at the start: test PSNR %.2f dB" % m_)
if not EVAL_ONLY:
    means_lr_end = LR_MEANS * 0.01
    l1_sum, l1_n = 0.0, 0
    for step in range(STEPS):
        size = RES0 if step < STEPS * RES_AT else RES
        i, R_bl = random_view()
        viewmat, K_, fl = camera(R_bl, EYES[i].cpu(), size, FOV)
        gt, gz = cut(i, R_bl, size, fl)
        sh_deg = SH if FREEZE else min(step // 1000, SH)
        img, ed, alpha, info = render(viewmat, K_, size, sh_deg)
        l1 = (img - gt).abs().mean()
        loss = (1 - W_SSIM) * l1
        if W_SSIM > 0:
            loss = loss + W_SSIM * (1 - ssim(img.permute(2, 0, 1)[None], gt.permute(2, 0, 1)[None]))
        if W_DEPTH > 0 and not FREEZE:
            valid = ((gz > 0.05) & (gz < 40) & (alpha > 0.3)).float()
            loss = loss + W_DEPTH * (((ed - gz).abs() / gz.clamp(min=0.05)) * valid).sum() / valid.sum().clamp(min=1)
        sc = torch.exp(params["scales"])
        loss = loss + (0 if FREEZE else 1) * W_REG * torch.sigmoid(params["opacities"]).mean() + W_REG * sc.mean()
        if W_FLAT > 0:
            loss = loss + W_FLAT * sc.min(-1).values.mean()
        loss.backward()
        l1_sum = l1_sum + l1.detach()
        l1_n += 1
        t = step / max(STEPS - 1, 1)
        lr_now = LR_MEANS * (means_lr_end / LR_MEANS) ** t
        if not FREEZE:
            for g in optimizers["means"].param_groups:
                g["lr"] = lr_now
        for k_, o in optimizers.items():
            if FREEZE and k_ not in ("sh0", "shN"):
                continue
            o.step()
            o.zero_grad(set_to_none=True)
        if not FREEZE:
            strategy.step_post_backward(params=params, optimizers=optimizers, state=state, step=step, info=info, lr=lr_now)
        if step % 500 == 0 or step == STEPS - 1:
            el = time.time() - t_tr
            log("step %d / %d  %d splats  res %d  l1 %.4f (mean of %d)  %.1f steps/s  %.0fs" % (step, STEPS, len(params["means"]), size, float(l1_sum) / max(l1_n, 1), l1_n, (step + 1) / max(el, 1e-6), el))
            l1_sum, l1_n = 0.0, 0
        if TEST_DATA and EVAL_EVERY and step and step % EVAL_EVERY == 0:
            m_, ps_, _ = evaluate(sh_deg=sh_deg)
            log("eval at step %d: test PSNR %.2f dB (%s)" % (step, m_, " ".join("%.1f" % p for p in ps_)))
train_seconds = time.time() - t_tr
log("trained in %.1fs" % train_seconds)

# ---- export (standard 3DGS PLY, glTF world)
with torch.no_grad():
    n = len(params["means"])
    f_rest = params["shN"].transpose(1, 2).reshape(n, -1)
    cols = [params["means"], torch.zeros((n, 3), device=dev), params["sh0"][:, 0, :], f_rest,
            params["opacities"][:, None], params["scales"], params["quats"] / params["quats"].norm(dim=-1, keepdim=True)]
    data = torch.cat(cols, 1).float().cpu().numpy()
names = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"] + ["f_rest_%d" % k for k in range(f_rest.shape[1])] + \
        ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
with open(os.path.join(out_dir, "splat.ply"), "wb") as fh:
    fh.write(("ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % n).encode())
    for nm in names:
        fh.write(("property float %s\n" % nm).encode())
    fh.write(b"end_header\n")
    fh.write(data.astype("<f4").tobytes())
op_ = torch.sigmoid(params["opacities"]).detach()
log("exported %d splats; opacity p10/p50/p90 %.3f %.3f %.3f" % (n, float(op_.quantile(0.1)), float(op_.quantile(0.5)), float(op_.quantile(0.9))))

if opt.get("diag") and TEST_DATA:
    # how well the splat fits its own pictures: views cut from the panorama nearest each test spot, same direction
    from PIL import Image
    os.makedirs(os.path.join(out_dir, "fit"), exist_ok=True)
    with torch.no_grad():
        for t, vm, K_, size, a, expo, alb, _m in TEST_DATA:
            c2w = torch.linalg.inv(vm).cpu()
            eye = c2w[:3, 3]
            i = int(((EYES.cpu() - eye) ** 2).sum(-1).argmin())
            R_gl = c2w[:3, :3] @ CV
            R_bl = GM.T @ R_gl
            vm2, K2, fl2 = camera(R_bl, EYES[i].cpu(), 768, FOV)
            gt, _ = cut(i, R_bl, 768, fl2)
            img, _, _, _ = render(vm2, K2, 768, SH)
            pair = torch.cat([gt, torch.ones((768, 8, 3), device=dev), img.clamp(0, 1)], 1)
            Image.fromarray((pair * 255).round().byte().cpu().numpy()).save(os.path.join(out_dir, "fit", os.path.basename(t["file"]).replace(".npz", ".jpg")), quality=90)
    log("fit views written")
if TEST_DATA:
    m_, ps_, tests = evaluate(os.path.join(out_dir, "tests"))
    log("test views (truth | splat) PSNR mean %.2f dB: %s" % (m_, " ".join("%.1f" % p for p in ps_)))
    if psnr_m:
        log("against the MATTE truth (no gloss): PSNR mean %.2f dB: %s" % (float(np.mean(psnr_m)), " ".join("%.1f" % p for p in psnr_m)))
else:
    tests = []
json.dump({"splats": int(n), "steps": STEPS, "res": RES, "trainSeconds": round(train_seconds, 1), "totalSeconds": round(time.time() - t_start, 1),
           "lo": LO, "hi": HI, "light": LIGHT, "albedoFloor": FLOOR, "tests": tests, "options": opt}, open(os.path.join(out_dir, "train.json"), "w"), indent=1)
log("done in %.1fs" % (time.time() - t_start))
