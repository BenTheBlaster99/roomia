"""
Look fit (7 Nov, Phase 1): the recipe's light groups add up linearly, so how strong each group is (and a little of its
colour), and the grade, can be fitted to the reference without rendering again. Gradient descent through the walk's
own display pipeline (look_grade.py, ported to torch), on blurred images: the reference was made by an AI, its fine
details differ, its light and colour masses are what we match.

python look_fit.py <groups.npz> <reference.jpg> <out.json> [weights.png]
out: {"gains": {group: g}, "tints": {group: [r, g, b]}, "grade": {...}, "loss": ...}
"""
import json, sys
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

dev = "cuda" if torch.cuda.is_available() else "cpu"
npz, ref_p, out_p = sys.argv[1:4]
D = np.load(npz)
groups = [g for g in ("SUN_GOLDEN", "PATCH", "WORLD", "INTERIOR", "PRACTICALS", "COVES", "COVE_LINES", "PENDANTS", "PENDANT_GLOW", "SLOT") if g in D.files and float(np.abs(D[g]).mean()) > 1e-6]
H, W = D[groups[0]].shape[:2]
G = torch.stack([torch.from_numpy(D[g].astype(np.float32)) for g in groups]).to(dev)  # k x H x W x 3
ref = torch.from_numpy(np.asarray(Image.open(ref_p).convert("RGB").resize((W, H), Image.LANCZOS)).astype(np.float32) / 255).to(dev)
wmap = torch.ones(H, W, device=dev)
if len(sys.argv) > 4:
    wmap = torch.from_numpy(np.asarray(Image.open(sys.argv[4]).convert("L").resize((W, H))).astype(np.float32) / 255).to(dev)

t = lambda a: torch.tensor(a, dtype=torch.float32, device=dev)
SRGB_TO_2020 = t([[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]]).T
R2020_TO_SRGB = t([[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]]).T
INSET = t([[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
           [0.0482516061458583, 0.101439036467562, 0.811302368396859]]).T
OUTSET = t([[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
            [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]]).T
LUMA = t([0.2126, 0.7152, 0.0722])


def agx(c):
    c = c @ SRGB_TO_2020.T @ INSET.T
    c = torch.clamp((torch.log2(torch.clamp(c, min=1e-10)) + 12.47393) / (4.026069 + 12.47393), 0, 1)
    x2 = c * c
    x4 = x2 * x2
    c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232
    c = c @ OUTSET.T
    c = torch.clamp(c, min=0) ** 2.2 @ R2020_TO_SRGB.T
    return torch.clamp(c, 0, 1)


def srgb(c):
    return torch.where(c <= 0.0031308, c * 12.92, 1.055 * torch.clamp(c, min=1e-8) ** (1 / 2.4) - 0.055)


def blur(x, s):
    k = int(s * 3) * 2 + 1
    ax = torch.arange(k, device=dev, dtype=torch.float32) - k // 2
    g = torch.exp(-ax ** 2 / (2 * s * s))
    g = g / g.sum()
    x = x.permute(2, 0, 1)[None]
    x = F.conv2d(F.pad(x, (k // 2, k // 2, 0, 0), mode="replicate"), g.view(1, 1, 1, k).repeat(3, 1, 1, 1), groups=3)
    x = F.conv2d(F.pad(x, (0, 0, k // 2, k // 2), mode="replicate"), g.view(1, 1, k, 1).repeat(3, 1, 1, 1), groups=3)
    return x[0].permute(1, 2, 0)


k = len(groups)
logg = torch.zeros(k, device=dev, requires_grad=True)
tint = torch.zeros(k, 3, device=dev, requires_grad=True)
wb = torch.zeros(3, device=dev, requires_grad=True)
con = torch.zeros(1, device=dev, requires_grad=True)
sat = torch.zeros(1, device=dev, requires_grad=True)
sh = torch.zeros(3, device=dev, requires_grad=True)
hi = torch.zeros(3, device=dev, requires_grad=True)
# start: the exposure that brings the sum's median to the reference's
with torch.no_grad():
    tot = G.sum(0)
    for e in np.linspace(-6, 10, 161):
        y = srgb(agx(tot * 2 ** e)) @ LUMA
        if float(y.median()) >= float((ref @ LUMA).median()):
            logg += float(e) * np.log(2)
            break
GLOW = [i for i, g in enumerate(groups) if g in ("COVE_LINES", "PENDANT_GLOW", "SLOT")]
ROOM = [i for i in range(k) if i not in GLOW]
lv = torch.zeros(1, device=dev, requires_grad=True)  # the sky as seen, against the sky that lights (log)
alb = torch.from_numpy(D["albedo"].astype(np.float32)).to(dev)
wi = groups.index("WORLD") if "WORLD" in groups else None
with torch.no_grad():
    tot = G.sum(0).sum(-1) + 1e-9
    # what is seen through the windows: no surface colour, the light is the sky's
    view = (alb.sum(-1) < 0.03) & ((G[wi].sum(-1) / tot) > 0.5) if wi is not None else torch.zeros(H, W, dtype=torch.bool, device=dev)
    glow_share = G[GLOW].sum(0).sum(-1) / tot if GLOW else torch.zeros(H, W, device=dev)
print("FIT view %.1f%% of the frame, glow-dominated %.1f%%" % (100 * float(view.float().mean()), 100 * float((glow_share > 0.3).float().mean())), flush=True)
refb1, refb2 = blur(ref, 1.5), blur(ref, 8)


def image():
    gain = torch.exp(logg)[:, None, None, None] * torch.exp(tint - tint.mean(1, keepdim=True))[:, None, None, :]
    Gs = G * gain
    if wi is not None:
        Gs = torch.cat([Gs[:wi], (Gs[wi] * torch.where(view[..., None], torch.exp(lv), torch.ones_like(lv)))[None], Gs[wi + 1:]])
    lin = Gs.sum(0)
    w = torch.exp(wb)
    w = w / (w * LUMA).sum()
    c = srgb(agx(lin * w))
    c = 0.45 + (c - 0.45) * torch.exp(con)
    y = (c @ LUMA)[..., None]
    c = y + (c - y) * torch.exp(sat)
    yy = torch.clamp(y, 0, 1)
    c = c + sh * (1 - yy) ** 2 + hi * yy ** 2
    return torch.clamp(c, 0, 1)


def run(params, weights, steps, label, room=True):
    opt = torch.optim.Adam(params, lr=0.03)
    for it in range(steps):
        opt.zero_grad()
        c = image()
        l1 = ((blur(c, 1.0 if not room else 1.5) - (blur(ref, 1.0) if not room else refb1)).abs().sum(-1) * weights).sum() / weights.sum()
        l2 = ((blur(c, 8) - refb2).abs().sum(-1) * weights).sum() / weights.sum() if room else torch.zeros((), device=dev)
        reg = 0.02 * (tint ** 2).sum() + 0.05 * (sh ** 2 + hi ** 2).sum() + 0.01 * (con ** 2 + sat ** 2).sum()
        loss = l1 + 2 * l2 + reg
        loss.backward()
        # only the asked groups move
        if logg.grad is not None and not room:
            mask_ = torch.zeros(k, device=dev)
            mask_[GLOW] = 1
            logg.grad *= mask_
        elif logg.grad is not None and room:
            mask_ = torch.ones(k, device=dev)
            mask_[GLOW] = 0
            logg.grad *= mask_
        opt.step()
        if it % 200 == 0 or it == steps - 1:
            print("FIT %s %d loss %.4f gains %s view %.2f" % (label, it, float(loss), {g: round(float(v), 3) for g, v in zip(groups, torch.exp(logg))}, float(torch.exp(lv))), flush=True)
    return float(loss)


# 1: the room's light and the grade, on the room (not the windows' view, not the glowing lines themselves)
room_w = wmap * (~view).float() * (glow_share < 0.3).float()
loss = run([logg, tint, wb, con, sat, sh, hi], room_w, 600, "room")
# 2: each glowing line or disc, and the view out, on their own pixels
if GLOW:
    glow_w = wmap * (glow_share > 0.3).float() * 3 + wmap * view.float()
    run([logg, lv], glow_w, 400, "glow", room=False)
with torch.no_grad():
    c = image().cpu().numpy()
Image.fromarray((c * 255 + 0.5).astype(np.uint8)).save(out_p.replace(".json", ".png"))
res = {"groups": groups,
       "gains": {g: float(v) for g, v in zip(groups, torch.exp(logg))},
       "tints": {g: [float(x) for x in torch.exp(tint[i] - tint[i].mean())] for i, g in enumerate(groups)},
       "viewScale": float(torch.exp(lv)),
       "grade": {"exposure": 0.0, "whiteBalance": [float(x) for x in torch.exp(wb) / (torch.exp(wb) * LUMA).sum()], "contrast": float(torch.exp(con)),
                 "pivot": 0.45, "saturation": float(torch.exp(sat)), "shadows": [float(x) for x in sh], "highlights": [float(x) for x in hi]},
       "loss": loss}
json.dump(res, open(out_p, "w"), indent=1)
print(json.dumps({k_: v for k_, v in res.items() if k_ != "tints"}, indent=1))
