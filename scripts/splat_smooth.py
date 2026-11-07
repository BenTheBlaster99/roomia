"""
Wall smoothing (7 Nov, Phase 7): the light-only splat's blotches on flat walls, removed after training without blurring
real light edges (a sun patch, a shadow line).

- The capture is matte (diffuse light only), so the light does not change with the viewing angle: the splat's
  view-dependent colour (SH degree 1) holds only noise (it showed as pink and green mottling): set to zero.
- Edge-aware smoothing in 3D: splats are binned in a small grid by position and facing (the axis of their thinnest
  scale); each splat moves towards its cell's mean colour, weighted by how close it already is (a fraction of a stop
  blends, a light edge of a stop or more does not). Done on three shifted grids, a few rounds.

python splat_smooth.py <in.ply> <out.ply> '<json: {cell, sigma, rounds, strength, keepSH}>'
"""
import json, math, sys
import numpy as np
import torch

src, dst = sys.argv[1], sys.argv[2]
opt = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
CELL = float(opt.get("cell", 0.07))  # metres
SIGMA = float(opt.get("sigma", 0.35))  # stops: colour differences below this blend, above it stay
ROUNDS = int(opt.get("rounds", 3))
STRENGTH = float(opt.get("strength", 0.8))
RANGE = float(opt.get("range", 16.0))  # the trainer's light range in stops (encoded 0..1 spans it)
dev = "cuda"

with open(src, "rb") as fh:
    head = b""
    while not head.endswith(b"end_header\n"):
        head += fh.readline()
    props = [l.split()[-1].decode() for l in head.split(b"\n") if l.startswith(b"property")]
    nv = int([l for l in head.split(b"\n") if l.startswith(b"element vertex")][0].split()[-1])
    arr = np.frombuffer(fh.read(), dtype="<f4").reshape(nv, len(props)).copy()
col = {n: i for i, n in enumerate(props)}
P = torch.from_numpy(arr).to(dev)
xyz = P[:, [col["x"], col["y"], col["z"]]]
C0 = 0.28209479177387814
dc = P[:, [col["f_dc_0"], col["f_dc_1"], col["f_dc_2"]]]
enc = dc * C0 + 0.5  # the trainer's log-encoded light, 0..1 over RANGE stops
sc = P[:, [col["scale_0"], col["scale_1"], col["scale_2"]]]
q = P[:, [col["rot_0"], col["rot_1"], col["rot_2"], col["rot_3"]]]
q = q / q.norm(dim=-1, keepdim=True)
w_, x_, y_, z_ = q.unbind(-1)
# rotation matrix columns; the thinnest axis is the splat's facing
R = torch.stack([
    torch.stack([1 - 2 * (y_ * y_ + z_ * z_), 2 * (x_ * y_ + w_ * z_), 2 * (x_ * z_ - w_ * y_)], -1),
    torch.stack([2 * (x_ * y_ - w_ * z_), 1 - 2 * (x_ * x_ + z_ * z_), 2 * (y_ * z_ + w_ * x_)], -1),
    torch.stack([2 * (x_ * z_ + w_ * y_), 2 * (y_ * z_ - w_ * x_), 1 - 2 * (x_ * x_ + y_ * y_)], -1),
], 1)  # n x 3 axes x 3 comps
thin = sc.argmin(-1)
nrm = R[torch.arange(nv, device=dev), thin]
flat = (sc.max(-1).values - sc.min(-1).values) > math.log(4.0)  # clearly flat splats only
# facing bin: dominant axis and its sign (walls, floors and ceilings are mostly axis-aligned); others get no smoothing
ax = nrm.abs().argmax(-1)
sign = (nrm[torch.arange(nv, device=dev), ax] > 0).long()
aligned = nrm.abs().max(-1).values > 0.92
ok = flat & aligned
fbin = ax * 2 + sign
sig = SIGMA / RANGE
print("SMOOTH %d splats, %d flat and facing an axis (%.0f%%)" % (nv, int(ok.sum()), 100 * float(ok.float().mean())), flush=True)
before = enc.clone()
for r in range(ROUNDS):
    acc = torch.zeros_like(enc)
    for k, off in enumerate((0.0, 1 / 3, 2 / 3)):
        g = torch.floor(xyz / CELL + off).long()
        g = g - g.min(0).values
        key = ((g[:, 0] * 4096 + g[:, 1]) * 4096 + g[:, 2]) * 8 + fbin
        key = torch.where(ok, key, torch.full_like(key, -1))
        uk, inv = torch.unique(key, return_inverse=True)
        # robust cell mean: the plain mean, then the mean of those within 2 sigma of it
        cnt = torch.zeros(len(uk), device=dev).index_add_(0, inv, torch.ones(nv, device=dev))
        mean = torch.zeros(len(uk), 3, device=dev).index_add_(0, inv, enc) / cnt[:, None]
        close = ((enc - mean[inv]).abs().max(-1).values < 2 * sig).float()
        cnt2 = torch.zeros(len(uk), device=dev).index_add_(0, inv, close)
        mean2 = torch.zeros(len(uk), 3, device=dev).index_add_(0, inv, enc * close[:, None]) / cnt2.clamp(min=1)[:, None]
        mean2 = torch.where(cnt2[:, None] > 0, mean2, mean)
        m = mean2[inv]
        d = (enc - m).abs().max(-1).values
        w = STRENGTH * torch.exp(-(d / sig) ** 2) * ok.float() * (cnt[inv] > 2).float()
        acc += enc + w[:, None] * (m - enc)
    enc = acc / 3
moved = (enc - before).abs().max(-1).values * RANGE
print("SMOOTH moved: median %.3f stops, 99th %.3f stops" % (float(moved[ok].median()), float(torch.quantile(moved[ok][:1000000], 0.99))), flush=True)
P[:, [col["f_dc_0"], col["f_dc_1"], col["f_dc_2"]]] = (enc - 0.5) / C0
if not opt.get("keepSH"):
    rest = [i for n, i in col.items() if n.startswith("f_rest_")]
    P[:, rest] = 0
with open(dst, "wb") as fh:
    fh.write(head)
    fh.write(P.cpu().numpy().astype("<f4").tobytes())
print("SMOOTH written %s" % dst, flush=True)
