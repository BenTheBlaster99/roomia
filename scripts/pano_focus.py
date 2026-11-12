"""
"Focus by place" for a 360 view (12 Nov idea of the user): each viewpoint shows ITS OWN area sharp with the AI finish (the one-pass AI
360, upscaled on the GPU = "AI + max sharpen"), and the areas that belong to another viewpoint soft (Blender + AI light, blurred more the
farther it is). The AI is good up close and invents far away, so it is only used where it is good; clicking the next point "unlocks"
the next area, sharp.

Ownership: every pixel is a 3D point (eye + direction x distance). If another viewpoint SEES that point (its own distance map agrees)
from closer than this one, the point is that viewpoint's area: soft. Within --near metres of the eye it is always sharp.

python pano_focus.py <sceneId> <view> --depth-dir <dir with depth-<k>.npy + eyes.json (depth360.py)> --out out.jpg
       [--sharp look/sunburst/pano-k-sunburst-2560-up6144.jpg] [--soft tour/pano-k-ai-light.jpg] [--width 6144]
       [--near 2.5] [--margin 0.4] [--blur-deg 0.8] [--debug dir]
Free (no AI call). AI python (cv2, numpy).
"""
import argparse, json, math, os, time
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("scene")
ap.add_argument("view", type=int)
ap.add_argument("--depth-dir", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--sharp")
ap.add_argument("--soft")
ap.add_argument("--width", type=int, default=6144)
ap.add_argument("--near", type=float, default=2.5, help="metres: always sharp this close to the eye")
ap.add_argument("--margin", type=float, default=0.4, help="metres: width of the sharp-to-soft transition in the ownership test")
ap.add_argument("--blur-deg", type=float, default=0.8, help="strongest blur (Gaussian sigma) in degrees, reached ~8 m away")
ap.add_argument("--debug")
args = ap.parse_args()
t0 = time.time()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(os.path.abspath(os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")), args.scene)
k = args.view
sharp_p = args.sharp or os.path.join(S, "look", "sunburst", "pano-%d-sunburst-2560-up6144.jpg" % k)
soft_p = args.soft or os.path.join(S, "tour", "pano-%d-ai-light.jpg" % k)
W, H = args.width, args.width // 2
SH = cv2.resize(cv2.imread(sharp_p), (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
SO = cv2.resize(cv2.imread(soft_p), (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255
LW = np.array([0.0722, 0.7152, 0.2126], np.float32)


def wrap(x, p):
    return np.concatenate([x[:, -p:], x, x[:, :p]], axis=1)


# ---- 1. bend the AI picture onto Blender's layout (the AI reframes the room by a few degrees)
def small_log(x, w2=2048):
    y = cv2.resize(np.log(x @ LW + 1e-3).astype(np.float32), (w2, w2 // 2), interpolation=cv2.INTER_AREA)
    y = (y - y.min()) / max(1e-6, y.max() - y.min())
    return cv2.equalizeHist((y * 255).astype(np.uint8))


# the sharp AI picture is NEVER bent (12 Nov: bending it melted walls and door frames); it is only turned as a whole (one yaw and
# pitch shift = the median movement). Its leftover local differences are absorbed by bending the SOFT layer onto it (step 4):
# a bend in a blur does not show.
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
fl = cv2.calcOpticalFlowFarneback(small_log(SO), small_log(SH), None, 0.5, 6, 41, 5, 7, 1.5, 0)
band2 = slice(256, 768)
gdx, gdy = (float(np.median(fl[band2, :, i])) * W / 2048 for i in (0, 1))
SH = cv2.remap(SH, (xx + gdx) % W, np.clip(yy + gdy, 0, H - 1), cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)
print("FOCUS AI turned as a whole: %.2f deg across, %.2f deg up/down" % (gdx * 360 / W, gdy * 360 / W), flush=True)

# ---- 2. ownership from the distance maps
E = json.load(open(os.path.join(args.depth_dir, "eyes.json")))
dw, dh = E["width"], E["height"]
D = {int(j): np.load(os.path.join(args.depth_dir, "depth-%s.npy" % j)).astype(np.float32) for j in E["views"]}
eye = {int(j): np.array(v["eye"], np.float32) for j, v in E["views"].items()}
yawd = {int(j): math.radians(v["yaw"]) for j, v in E["views"].items()}
lon = ((np.arange(dw) + 0.5) / dw - 0.5) * 2 * math.pi
lat = (0.5 - (np.arange(dh) + 0.5) / dh) * math.pi
LON, LAT = np.meshgrid(lon, lat)


def dirs(j):
    fwd = np.array([math.cos(yawd[j]), math.sin(yawd[j]), 0], np.float32)
    right = np.array([math.sin(yawd[j]), -math.cos(yawd[j]), 0], np.float32)
    return fwd, right


fwd, right = dirs(k)
Dk = D[k]
hit = Dk > 0
dvec = (np.cos(LAT) * np.cos(LON))[..., None] * fwd + (np.cos(LAT) * np.sin(LON))[..., None] * right
dvec[..., 2] += np.sin(LAT)
P = eye[k] + dvec * Dk[..., None]
best = np.full(Dk.shape, np.inf, np.float32)  # distance to the closest OTHER viewpoint that sees the point
for j in D:
    if j == k:
        continue
    u = P - eye[j]
    r = np.linalg.norm(u, axis=-1)
    fj, rj = dirs(j)
    lo = np.arctan2(u @ rj, u @ fj)
    la = np.arcsin(np.clip(u[..., 2] / np.maximum(r, 1e-6), -1, 1))
    px = ((lo / (2 * math.pi) + 0.5) * dw).astype(np.int32) % dw
    py = np.clip(((0.5 - la / math.pi) * dh).astype(np.int32), 0, dh - 1)
    dj = D[j][py, px]
    sees = (dj > 0) & (r <= dj * 1.03 + 0.08)
    best = np.where(sees & hit, np.minimum(best, r), best)
margin = best - Dk  # > 0: this viewpoint is the closest one that sees it
focus = np.clip(0.5 + margin / (2 * args.margin), 0, 1)
focus = np.where(Dk < args.near, 1.0, focus)
focus = np.where(~hit, 0.0, focus).astype(np.float32)  # outside (no wall hit): soft
focus = cv2.GaussianBlur(wrap(focus, 32), (0, 0), 3)[:, 32:32 + dw]
# blur strength: 0 at the near limit, full at ~8 m
far = np.where(hit, Dk, 30.0)
amount = np.clip((far - args.near) / 5.5, 0.15, 1).astype(np.float32)
focus = cv2.resize(focus, (W, H), interpolation=cv2.INTER_LINEAR)
amount = cv2.resize(amount, (W, H), interpolation=cv2.INTER_LINEAR)
# ---- the soft layer and the maps (Blender's layout) are bent onto the AI's layout, a few smooth passes
# (12 Nov, Scène 5: where the AI redrew a wall the flow goes wild and melted the soft side: very smooth, capped at 3 degrees)
for p, sig in enumerate((40,)):
    f2 = cv2.calcOpticalFlowFarneback(small_log(SH), small_log(SO), None, 0.5, 6, 41, 5, 7, 1.5, 0)
    f2 = np.stack([cv2.GaussianBlur(f2[..., i], (0, 0), sig) for i in (0, 1)], -1)
    cap = 3.0 / 360 * 2048
    mag = np.maximum(np.hypot(f2[..., 0], f2[..., 1]), 1e-6)
    f2 *= np.minimum(1, cap / mag)[..., None]
    fx = cv2.resize(f2[..., 0], (W, H)) * (W / 2048)
    fy = cv2.resize(f2[..., 1], (W, H)) * (W / 2048)
    mx, my = (xx + fx) % W, np.clip(yy + fy, 0, H - 1)
    SO = cv2.remap(SO, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    focus = cv2.remap(focus, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    amount = cv2.remap(amount, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    print("FOCUS soft layer bent onto the AI, pass %d: median %.2f deg" % (p + 1, float(np.median(np.hypot(fx, fy))) * 360 / W), flush=True)
del xx, yy, mx, my
focus = focus[..., None]
print("FOCUS view %d: sharp share %.0f %% of the picture (band 15-85 %%)" % (k, 100 * float((focus[int(H * .15):int(H * .85)] > 0.5).mean())), flush=True)

# ---- 3. the soft layer: Blender + AI light, toned like the AI (very smooth gain), blurred by distance; the sharp areas do not
# bleed into the blur (normalised by the soft-area weight)
PAD = 256
lg = np.log(cv2.GaussianBlur(wrap(SH, PAD), (0, 0), 48) + 1e-3) - np.log(cv2.GaussianBlur(wrap(SO, PAD), (0, 0), 48) + 1e-3)
SO = np.clip(SO * np.exp(np.clip(lg[:, PAD:PAD + W], -0.7, 0.7)), 0, 1)
wsoft = wrap(np.maximum(1 - focus[..., 0], 0.02), PAD)[..., None]
sig_max = args.blur_deg / 360 * W
levels = [0.0, sig_max / 3, 2 * sig_max / 3, sig_max]
stack = [SO]
for s in levels[1:]:
    num = cv2.GaussianBlur(wrap(SO, PAD) * wsoft, (0, 0), s)
    den = cv2.GaussianBlur(wsoft[..., 0], (0, 0), s)[..., None]
    stack.append((num / np.maximum(den, 1e-4))[:, PAD:PAD + W])
pos = amount * (len(levels) - 1)
i0 = np.clip(np.floor(pos).astype(np.int32), 0, len(levels) - 2)
fr = (pos - i0)[..., None]
soft = np.zeros_like(SO)
for i in range(len(levels) - 1):
    m = (i0 == i)[..., None]
    soft += m * ((1 - fr) * stack[i] + fr * stack[i + 1])

out = focus * SH + (1 - focus) * soft
cv2.imwrite(args.out, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
if args.debug:
    os.makedirs(args.debug, exist_ok=True)
    cv2.imwrite(os.path.join(args.debug, "focus-%d.png" % k), cv2.resize((focus[..., 0] * 255).astype(np.uint8), (2048, 1024)))
print("FOCUS_DONE view %d %dx%d in %.1f s" % (k, W, H, time.time() - t0), flush=True)
