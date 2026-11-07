"""
Reflection probes prefiltered for roughness (7 Nov, ChatGPT step 3): for each probe (a small Cycles 360°, Radiance .hdr),
six equirectangular levels for roughness 0, 0.2 ... 1.0, each the GGX-weighted average of the light around the
reflected direction (split-sum, N = V = R), stacked top to bottom in one .hdr. three.js's PMREM gave empty textures
here; this does the same job offline, once, on the graphics card.

python splat_probes.py <out dir> <probe.hdr> ...   (writes <name>-ggx.hdr beside each output name)
"""
import math, os, sys
import numpy as np
import torch
import torch.nn.functional as F

dev = "cuda" if torch.cuda.is_available() else "cpu"
LEVELS = 6
W, H = 256, 128


def read_hdr(p):
    raw = open(p, "rb").read()
    i = raw.index(b"\n\n") + 2
    j = raw.index(b"\n", i)
    dims = raw[i:j].split()
    h, w = int(dims[1]), int(dims[3])
    d = np.frombuffer(raw[j + 1:], np.uint8)
    if len(d) == w * h * 4:  # flat
        rgbe = d.reshape(h, w, 4).astype(np.float32)
    else:  # run-length scanlines
        rgbe = np.zeros((h, w, 4), np.float32)
        k = 0
        for y in range(h):
            k += 4
            for c in range(4):
                x = 0
                while x < w:
                    n = d[k]; k += 1
                    if n > 128:
                        rgbe[y, x:x + n - 128, c] = d[k]; k += 1; x += n - 128
                    else:
                        rgbe[y, x:x + n, c] = d[k:k + n]; k += n; x += n
    e = rgbe[..., 3]
    sc = np.where(e > 0, np.exp2(e - 136.0), 0.0)
    return rgbe[..., :3] * sc[..., None]


def write_hdr(p, img):
    img = np.maximum(img.astype(np.float32), 0)
    mx = img.max(-1)
    e = np.ceil(np.log2(np.maximum(mx, 1e-32)))
    sc = np.where(mx > 1e-32, 256.0 / np.exp2(e), 0)
    rgbe = np.zeros(img.shape[:2] + (4,), np.uint8)
    rgbe[..., :3] = np.clip(img * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(mx > 1e-32, np.clip(e + 128, 0, 255), 0).astype(np.uint8)
    with open(p, "wb") as fh:
        fh.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (img.shape[0], img.shape[1]))
        fh.write(rgbe.tobytes())


def dirs(w, h):
    # three's equirect: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 (row 0 = top = up)
    u = (torch.arange(w, device=dev) + 0.5) / w
    v = 1 - (torch.arange(h, device=dev) + 0.5) / h
    phi = (u - 0.5) * 2 * math.pi
    th = (v - 0.5) * math.pi
    th, phi = torch.meshgrid(th, phi, indexing="ij")
    return torch.stack([torch.cos(th) * torch.cos(phi), torch.sin(th), torch.cos(th) * torch.sin(phi)], -1)


def sample(env, d):
    # env: 3 x h x w, d: ... x 3 -> ... x 3 (bilinear, wrapped in u)
    u = torch.atan2(d[..., 2], d[..., 0]) / (2 * math.pi) + 0.5
    v = torch.asin(d[..., 1].clamp(-1, 1)) / math.pi + 0.5
    g = torch.stack([u * 2 - 1, (1 - v) * 2 - 1], -1)
    shp = g.shape[:-1]
    out = F.grid_sample(env[None], g.reshape(1, -1, 1, 2), mode="bilinear", padding_mode="border", align_corners=False)
    return out[0, :, :, 0].T.reshape(*shp, 3)


def hammersley(n):
    i = torch.arange(n, device=dev, dtype=torch.int64)
    b = i.clone()
    b = ((b << 16) | (b >> 16)) & 0xFFFFFFFF
    b = ((b & 0x55555555) << 1) | ((b & 0xAAAAAAAA) >> 1)
    b = ((b & 0x33333333) << 2) | ((b & 0xCCCCCCCC) >> 2)
    b = ((b & 0x0F0F0F0F) << 4) | ((b & 0xF0F0F0F0) >> 4)
    b = ((b & 0x00FF00FF) << 8) | ((b & 0xFF00FF00) >> 8)
    return (i.float() + 0.5) / n, b.float() / 2 ** 32


def prefilter(img):
    env_full = torch.from_numpy(img).to(dev).permute(2, 0, 1).contiguous()
    pyr = [env_full]
    while pyr[-1].shape[2] > 32:
        pyr.append(F.avg_pool2d(pyr[-1][None], 2)[0])
    N = dirs(W, H)
    out = []
    for k in range(LEVELS):
        r = k / (LEVELS - 1)
        if k == 0:
            out.append(sample(pyr[min(1, len(pyr) - 1)], N))
            continue
        a = max(r * r, 1e-3)
        S = 384
        e1, e2 = hammersley(S)
        ph = 2 * math.pi * e1
        ct = torch.sqrt((1 - e2) / (1 + (a * a - 1) * e2))
        st = torch.sqrt(1 - ct * ct)
        Ht = torch.stack([st * torch.cos(ph), st * torch.sin(ph), ct], -1)  # tangent space
        up = torch.where(N[..., 1:2].abs() < 0.999, torch.tensor([0.0, 1.0, 0.0], device=dev), torch.tensor([1.0, 0.0, 0.0], device=dev))
        T = F.normalize(torch.linalg.cross(up.expand_as(N), N), dim=-1)
        B = torch.linalg.cross(N, T)
        # the source blurrier for rougher levels (fewer samples needed)
        src = pyr[min(len(pyr) - 1, 1 + int(round(r * 4)))]
        acc = torch.zeros(H, W, 3, device=dev)
        wsum = torch.zeros(H, W, 1, device=dev)
        for s in range(S):
            Hd = T * Ht[s, 0] + B * Ht[s, 1] + N * Ht[s, 2]
            L = 2 * (N * Hd).sum(-1, keepdim=True) * Hd - N
            nl = (N * L).sum(-1, keepdim=True).clamp(min=0)
            acc += sample(src, L) * nl
            wsum += nl
        out.append(acc / wsum.clamp(min=1e-6))
    return torch.cat(out, 0).cpu().numpy()


out_dir = sys.argv[1]
for p in sys.argv[2:]:
    atlas = prefilter(read_hdr(p))
    name = os.path.join(out_dir, os.path.basename(p)[:-4] + "-ggx.hdr")
    write_hdr(name, atlas)
print("GGX %d probes, %d levels %dx%d" % (len(sys.argv) - 2, LEVELS, W, H))
