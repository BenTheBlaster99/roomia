"""
Fenced AI finishing of a Blender 360 (8 Nov, step 4): the AI edit may add micro-detail, never change the design.

  base   the recipe panorama (graded, display sRGB), the source of truth
  ai     the gateway's edit of it
  masks  from Blender: ceiling, mirror, glass, sky, emit (fixtures), material ids, albedo

  1. fit      the edit is moved onto the render (dense flow on 1/4 size, smoothed, capped), the model moves things a few px
  2. fence    alpha = how much of the AI's fine detail may enter: 0 on ceiling, mirrors, fixtures, sky and a margin around
              them; a little on glass and walls; more on floor, fabric, wood; fading to 0 at the left/right seam
  3. blend    final = base_low + (1 - alpha) base_high + alpha ai_high  (colour and light always from Blender; the AI's
              low frequencies are discarded, which is also what stops it inventing glow, sun patches or a new tint)
  4. passport each material's median colour (Lab) in the result is pulled back to the render's, per material
  5. check    structure (low-pass similarity), new bright blobs, seam, protected regions, detail gained; any failure
              returns the render itself

python pano_finish.py <base.png> <ai image> <masks.npz> <material-ids.json> <out.png> [json options]
"""
import json, os, re, sys
import cv2
import numpy as np

base_p, ai_p, masks_p, ids_p, out_p = sys.argv[1:6]
opt = json.loads(sys.argv[6]) if len(sys.argv) > 6 else {}
W = int(opt.get("width", 3840))
H = W // 2
S = W / 3840.0                                  # every pixel size below is given at 3840 and scales with the width
SIGMA = S * float(opt.get("sigma", 5.0))          # px at W: the split between colour/light and texture
A_DEFAULT, A_FLOOR, A_SOFT, A_GLASS = float(opt.get("walls", 0.35)), float(opt.get("floor", 0.60)), float(opt.get("fabric", 0.60)), 0.15
# 12 Nov (tuning toward the single AI photos): the ceiling may take the AI too, and walls may take more than the fine texture
A_CEIL = float(opt.get("ceiling", 0.0))
SIGMA_W = S * float(opt.get("sigmaWalls", opt.get("sigma", 5.0)))

base = cv2.cvtColor(cv2.imread(base_p), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
ai = cv2.cvtColor(cv2.imread(ai_p), cv2.COLOR_BGR2RGB).astype(np.float32) / 255
# enlarging overshoots the 0..1 range (ringing): clipped, or a plain cast to bytes wraps around into coloured fringes
base = np.clip(cv2.resize(base, (W, H), interpolation=cv2.INTER_LANCZOS4 if base.shape[1] < W else cv2.INTER_AREA), 0, 1)
ai = np.clip(cv2.resize(ai, (W, H), interpolation=cv2.INTER_LANCZOS4 if ai.shape[1] < W else cv2.INTER_AREA), 0, 1)
M = np.load(masks_p)
ids = json.load(open(ids_p))


def up(a, interp=cv2.INTER_NEAREST):
    return cv2.resize(a.astype(np.float32), (W, H), interpolation=interp)


def blur(x, s):
    return cv2.GaussianBlur(x, (0, 0), s)


gray = lambda x: cv2.cvtColor(x, cv2.COLOR_RGB2GRAY)

# ---- 1. fit: dense flow from the render to the edit at 1/4 size, capped, smoothed, applied to the edit
q = max(2, round(4 * S))
gb = cv2.resize(gray(base), (W // q, H // q), interpolation=cv2.INTER_AREA)
ga = cv2.resize(gray(ai), (W // q, H // q), interpolation=cv2.INTER_AREA)
# match the edit's brightness to the render's for the flow only
ga = np.clip((ga - ga.mean()) / (ga.std() + 1e-6) * gb.std() + gb.mean(), 0, 1)
flow = cv2.calcOpticalFlowFarneback((gb * 255).astype(np.uint8), (ga * 255).astype(np.uint8), None, 0.5, 4, 25, 4, 7, 1.5, 0)
flow = np.clip(flow, -6, 6)  # 6 px at 1/4 size = 24 px at full size
flow = cv2.GaussianBlur(flow, (0, 0), 6)
flow_full = cv2.resize(flow, (W, H), interpolation=cv2.INTER_CUBIC) * q
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
ai_fit = cv2.remap(ai, gx + flow_full[..., 0], gy + flow_full[..., 1], cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
drift = float(np.abs(flow_full).mean())

# ---- 2. fence: how much of the AI's fine detail may enter, by region
ceiling, mirror, glass, sky, emit = (M[k] for k in ("ceiling", "mirror", "glass", "sky", "emit"))
mat = M["mat"].astype(np.int32)
FLOORRX = re.compile(r"patina|stone|marble|tile|parquet|floor|carrel|vein|granit", re.I)
SOFTRX = re.compile(r"sketchuv|fabric|velvet|velour|chair|sofa|cushion|carpet|rug|boucle|linen|leather|bed", re.I)
alpha_small = np.full(mat.shape, A_DEFAULT, np.float32)
floor_ids = [int(k) for k, v in ids.items() if FLOORRX.search(v)]
soft_ids = [int(k) for k, v in ids.items() if SOFTRX.search(v) and not FLOORRX.search(v)]
alpha_small[np.isin(mat, floor_ids)] = A_FLOOR
alpha_small[np.isin(mat, soft_ids)] = A_SOFT
alpha_small[glass] = A_GLASS
if A_CEIL > 0:
    alpha_small[ceiling & ~emit] = A_CEIL
alpha = up(alpha_small, cv2.INTER_NEAREST)
protect = ((mirror | sky | emit | (ceiling if A_CEIL <= 0 else np.zeros_like(ceiling)))).astype(np.uint8)
protect = cv2.dilate(up(protect), np.ones((2 * int(opt.get("margin", 6) * S) + 1,) * 2, np.uint8))
alpha = alpha * (1 - np.clip(blur(protect, 3 * S), 0, 1))
# the AI never edits where the edit has moved the structure more than the fit explains: later check; the seam fades out
seam = np.ones(W, np.float32)
n = int(W * 0.03)
seam[:n] = np.linspace(0, 1, n) ** 2
seam[-n:] = np.linspace(1, 0, n) ** 2
alpha = alpha * seam[None, :]
# the AI's detail is only trusted where it lines up with the render: its local pattern must match the render's (normalised
# cross-correlation of the band 2..12 px over a 31 px window). Where the edit moved something, the two disagree, and
# blending them draws a ghost copy (8 Nov: the bed and nightstand doubled), so the AI is switched off there.
def band(x):
    g = gray(x)
    return blur(g, 2 * S) - blur(g, 12 * S)


bb, ba = band(base), band(ai_fit)
BOXN = int(31 * S) | 1
box = lambda x: cv2.blur(x, (BOXN, BOXN))
cov = box(bb * ba) - box(bb) * box(ba)
ncc = cov / np.sqrt(np.maximum((box(bb * bb) - box(bb) ** 2) * (box(ba * ba) - box(ba) ** 2), 1e-12))
trust = np.clip((ncc - float(opt.get("nccLow", 0.55))) / (float(opt.get("nccHigh", 0.85)) - float(opt.get("nccLow", 0.55))), 0, 1)
flat_area = (box(bb * bb) - box(bb) ** 2) < 1e-6   # nothing to compare (a blank wall): trust the usual alpha
trust = np.where(flat_area, 1.0, trust)
trust = blur(trust.astype(np.float32), 4 * S)
alpha = alpha * trust
alpha = blur(alpha, 2 * S)

# ---- 3. blend
# Two splits: at SIGMA (a few px) only the AI's texture enters (walls, default); on floors and fabrics the split is at
# SIGMA_BIG (tens of px), so the AI's material response also enters (polished-stone reflections, fabric sheen, soft shading),
# which is what the edit really adds (8 Nov test: no sharper detail, but the floor gets its gloss). Colour and light are
# always Blender's: everything below the split is the render's.
def blend(sigma):
    bl, al = blur(base, sigma), blur(ai_fit, sigma)
    return bl + (1 - alpha[..., None]) * (base - bl) + alpha[..., None] * (ai_fit - al)


SIGMA_BIG = S * float(opt.get("sigmaBig", 40.0))
big_small = np.isin(mat, floor_ids + soft_ids).astype(np.float32)
big = np.clip(blur(up(big_small, cv2.INTER_NEAREST), 6 * S), 0, 1)[..., None]
final = np.clip(big * blend(SIGMA_BIG) + (1 - big) * blend(SIGMA_W), 0, 1)
b_low = blur(base, SIGMA)

# ---- 4. passport: per material, pull the result's median colour back to the render's (Lab), smooth masks
lab_b = cv2.cvtColor(base, cv2.COLOR_RGB2LAB)
lab_f = cv2.cvtColor(final.astype(np.float32), cv2.COLOR_RGB2LAB)
PHOTO_LOOK = bool(opt.get("photoLook", False))
PASS_CLIP = float(opt.get("passportClip", 12))
lab_a = cv2.cvtColor(ai_fit.astype(np.float32), cv2.COLOR_RGB2LAB) if PHOTO_LOOK else lab_b
mat_full = cv2.resize(mat.astype(np.uint16), (W, H), interpolation=cv2.INTER_NEAREST)
shift = np.zeros_like(lab_f)
wsum = np.zeros((H, W), np.float32)
corrections = []
lum = gray(base)
valid = (lum > 0.04) & (lum < 0.92) & (protect == 0)
for mid in np.unique(mat_full):
    mk = (mat_full == mid) & valid
    if mk.sum() < 0.01 * W * H:
        continue
    # photoLook (12 Nov): the result's colour per material follows the AI's (a global, smooth shift: the photographer's
    # white point and brightness), instead of being pulled back to the render's. Light direction and detail stay as before.
    target = np.median(lab_a[mk], 0) if PHOTO_LOOK else np.median(lab_b[mk], 0)
    d = target - np.median(lab_f[mk], 0)
    d = np.clip(d, -PASS_CLIP, PASS_CLIP)
    w = blur(mk.astype(np.float32), 8 * S)
    shift += d[None, None, :] * w[..., None]
    wsum += w
    corrections.append({"material": ids.get(str(int(mid)), str(mid)), "dLab": [round(float(x), 2) for x in d], "share": round(float(mk.mean()), 3)})
shift /= np.maximum(wsum, 1e-3)[..., None]
lab_f = lab_f + shift * np.clip(wsum, 0, 1)[..., None]
final = np.clip(cv2.cvtColor(lab_f, cv2.COLOR_LAB2RGB), 0, 1)

# ---- 5. checks
def ssim_like(a, b):
    a, b = blur(gray(a), 10 * S), blur(gray(b), 10 * S)
    c = np.corrcoef(a.ravel(), b.ravel())[0, 1]
    return float(c)


def blobs(x):
    m = (gray(x) > 0.93).astype(np.uint8)
    n_, _, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(m, np.ones((5, 5), np.uint8)))
    return int(sum(1 for i in range(1, n_) if st[i, 4] > 60 * S * S))


def seam_err(x):
    return float(np.abs(x[:, 0] - x[:, -1]).mean())


edges_b = cv2.Canny((gray(base) * 255).astype(np.uint8), 60, 140) > 0
edges_f = cv2.Canny((gray(final) * 255).astype(np.uint8), 60, 140) > 0
prot_bool = protect > 0
protected_change = float(np.abs(final - base)[prot_bool].mean()) if prot_bool.any() else 0.0
detail_base = float(np.abs(base - b_low).mean())
detail_final = float(np.abs(final - blur(final, SIGMA)).mean())
checks = {
    "driftPx": round(drift, 2),
    "structure": round(ssim_like(final, base), 4),
    "blobsBase": blobs(base), "blobsFinal": blobs(final),
    "seamBase": round(seam_err(base), 4), "seamFinal": round(seam_err(final), 4),
    "protectedChange": round(protected_change, 4),
    "detailGain": round(detail_final / max(detail_base, 1e-6), 3),
    "meanChange": round(float(np.abs(final - base).mean()), 4),
    "ghostRisk": round(float(((1 - trust) * (alpha > 0.02)).sum() / max(float((alpha > 0.02).sum()), 1.0)), 3),
    "aiShare": round(float((alpha > 0.05).mean()), 3),
}
fails = []
if checks["structure"] < float(opt.get("minStructure", 0.985)): fails.append("structure moved")
if checks["blobsFinal"] > checks["blobsBase"] + max(2, 0.3 * checks["blobsBase"]): fails.append("new bright blobs (invented lights?)")
if checks["seamFinal"] > checks["seamBase"] * 1.5 + 0.01: fails.append("seam")
if checks["protectedChange"] > 0.01: fails.append("protected regions changed")
if drift > 14: fails.append("edit drifted from the render")
verdict = "accepted" if not fails else "fallback to render"
result = final if not fails else base
cv2.imwrite(out_p, cv2.cvtColor((result * 255 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 94] if out_p.lower().endswith(".jpg") else [])
# what the AI changed, exaggerated, and the fence
np.save(out_p.rsplit(".", 1)[0] + "-alpha.npy", alpha.astype(np.float16))
cv2.imwrite(out_p.rsplit(".", 1)[0] + "-diff.jpg", cv2.cvtColor(np.clip(0.5 + (final - base) * 6, 0, 1).__mul__(255).astype(np.uint8), cv2.COLOR_RGB2BGR))
cv2.imwrite(out_p.rsplit(".", 1)[0] + "-fence.jpg", (np.clip(alpha / max(A_FLOOR, 1e-6), 0, 1) * 255).astype(np.uint8))
json.dump({"verdict": verdict, "fails": fails, "checks": checks, "passport": corrections, "options": opt}, open(out_p.rsplit(".", 1)[0] + "-report.json", "w"), indent=1)
print("FINISH", verdict, json.dumps(checks), fails, flush=True)
