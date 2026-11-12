"""
The AI's light on Blender's pixels (12 Nov). The one-pass AI 360 (pano-sunburst.mts) has the look the user wants (bright clean walls and
ceiling, light on the island, daylight colour) but repaints far objects from its head (a TV turned into a panel, flowers changed).
Blender's 360 holds every object and texture exactly. This keeps Blender's pixels and only takes the AI's brightness and colour:

  gain   = smooth(AI) / smooth(Blender)  per channel, smoothed with an edge-aware (guided) filter that follows BLENDER's edges, so the
           gain stops at Blender's object outlines and never paints an AI shape into the picture
  trust  = where Blender and the AI disagree on structure (an invented or missing object), the gain falls back to a much smoother one:
           the room's light without the AI's invention
  result = Blender x gain   (+ optionally a little of the AI's fine detail where the two agree, --ai-detail)

python pano_look_transfer.py <blender.jpg> <ai.jpg> <out.jpg> [--blender-linear t4-lin.npy] [--radius 12] [--ai-detail 0.0] [--width 0 (= Blender's)]
Free (no AI call). Runs with the AI python (cv2, numpy).
"""
import argparse, time
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("blender")
ap.add_argument("ai")
ap.add_argument("out")
ap.add_argument("--radius", type=int, default=12, help="guided-filter radius in px at the working size (4096 wide: 12 px = ~1 degree)")
ap.add_argument("--eps", type=float, default=1e-3)
ap.add_argument("--ai-detail", type=float, default=0.0, help="0..1: how much of the AI's fine detail to add where both agree")
ap.add_argument("--gain-min", type=float, default=0.35)
ap.add_argument("--gain-max", type=float, default=4.0)
ap.add_argument("--width", type=int, default=0)
ap.add_argument("--local-colour", action="store_true", help="let the colour follow the AI locally too (can leak an AI object's colour)")
ap.add_argument("--no-align", action="store_true", help="skip bending the AI picture onto Blender's layout")
ap.add_argument("--blender-linear", help="Blender's raw linear render of the same view (look/<auto>/t<k>-lin.npy, RGB float): full detail in the darks")
args = ap.parse_args()
t0 = time.time()

B8 = cv2.imread(args.blender, cv2.IMREAD_COLOR)
if args.width:
    B8 = cv2.resize(B8, (args.width, args.width // 2), interpolation=cv2.INTER_AREA)
H, W = B8.shape[:2]
A8 = cv2.resize(cv2.imread(args.ai, cv2.IMREAD_COLOR), (W, H), interpolation=cv2.INTER_CUBIC)


def to_lin(x8):
    x = x8.astype(np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


B, A = to_lin(B8), to_lin(A8)
if args.blender_linear:
    # the raw render keeps the texture of near-black surfaces (a black stone island) that the 8-bit 360 has crushed to 0; its overall
    # exposure is matched to the AI's (one number), the gain does the rest
    L = np.load(args.blender_linear).astype(np.float32)[..., :3][..., ::-1]
    L = cv2.resize(np.ascontiguousarray(L), (W, H), interpolation=cv2.INTER_AREA)
    L = np.maximum(L, 0)
    k = float(np.median(A) / max(1e-6, np.median(L)))
    B = L * k
PADX = 4 * args.radius + 64


def wrap(x):
    """the panorama's left and right edges are one direction: pad each with the other before any filter"""
    return np.concatenate([x[:, -PADX:], x, x[:, :PADX]], axis=1)


def unwrap(x):
    return x[:, PADX:PADX + W]


def box(x, r):
    return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    """He et al. guided filter, grey guide I, input p (both wrapped)"""
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p, r) - mI * mp
    var = box(I * I, r) - mI * mI
    a = cov / (var + eps)
    b = mp - a * mI
    return box(a, r) * I + box(b, r)


lumB = B @ np.array([0.0722, 0.7152, 0.2126], np.float32)  # BGR


def align_ai(A, lumB, passes=3):
    """The AI sometimes reframes the room (12 Nov, F5 living room: 6 degrees, the plant moved). Its light must be read at the right place,
    so the AI picture is bent back onto Blender's layout first (smooth optical flow, a few passes). Only the light is taken from it,
    never its pixels, so a bend in the AI picture never shows."""
    w2, h2 = 2048, 1024
    s = W / w2

    def small_log(x):
        y = cv2.resize(np.log(x + 1e-3).astype(np.float32), (w2, h2), interpolation=cv2.INTER_AREA)
        y = (y - y.min()) / max(1e-6, y.max() - y.min())
        return cv2.equalizeHist((y * 255).astype(np.uint8))

    gb = small_log(lumB)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    out = A
    for k in range(passes):
        ga = small_log(out @ np.array([0.0722, 0.7152, 0.2126], np.float32))
        fl = cv2.calcOpticalFlowFarneback(gb, ga, None, 0.5, 6, 41, 5, 7, 1.5, 0)
        sig = [24, 12, 6][min(k, 2)]
        fx = cv2.GaussianBlur(fl[..., 0], (0, 0), sig)
        fy = cv2.GaussianBlur(fl[..., 1], (0, 0), sig)
        fxu = cv2.resize(fx, (W, H), interpolation=cv2.INTER_LINEAR) * s
        fyu = cv2.resize(fy, (W, H), interpolation=cv2.INTER_LINEAR) * s
        out = cv2.remap(out, (xx + fxu) % W, np.clip(yy + fyu, 0, H - 1), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
        mag = np.hypot(fx, fy)[int(h2 * .2):int(h2 * .8)] * 360.0 / w2
        print("LOOK_ALIGN pass %d: moved median %.2f deg, 90th %.2f deg" % (k + 1, float(np.median(mag)), float(np.percentile(mag, 90))))
    return out


if not args.no_align:
    A = align_ai(A, lumB)
guide = wrap(np.log(lumB + 1e-3)).astype(np.float32)
guide = (guide - guide.min()) / max(1e-6, guide.max() - guide.min())
r = args.radius
gain = np.empty_like(B)
gain_far = np.empty_like(B)
for c in range(3):
    lb, la = wrap(np.log(B[..., c] + 1e-3)), wrap(np.log(A[..., c] + 1e-3))
    sb, sa = guided(guide, lb, r, args.eps), guided(guide, la, r, args.eps)
    gain[..., c] = unwrap(sa - sb)
    # the room's light without any object's detail: very smooth, plain blur on the wrapped picture
    k = 8 * r + 1
    gain_far[..., c] = unwrap(cv2.GaussianBlur(la, (k, k), 0) - cv2.GaussianBlur(lb, (k, k), 0))

# colour only from the room-wide tint (12 Nov, living room: the AI's leaf leaked a green halo onto Blender's wall): locally the
# brightness follows the AI, the colour balance comes from the smooth gain only
if not args.local_colour:
    LW = np.array([0.0722, 0.7152, 0.2126], np.float32)
    gl, gfl = gain @ LW, gain_far @ LW
    gain = gl[..., None] + (gain_far - gfl[..., None])

# trust: do Blender and the AI show the same structure here? (local correlation of their luminance gradients)
def grad(x):
    gx = cv2.Sobel(x, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(x, cv2.CV_32F, 0, 1, ksize=3)
    return np.sqrt(gx * gx + gy * gy)


gB = wrap(grad(np.log(lumB + 1e-3).astype(np.float32)))
gA = wrap(grad(np.log(A @ np.array([0.0722, 0.7152, 0.2126], np.float32) + 1e-3).astype(np.float32)))
R2 = 3 * r
mB, mA = box(gB, R2), box(gA, R2)
cov = box(gB * gA, R2) - mB * mA
vB, vA = box(gB * gB, R2) - mB * mB, box(gA * gA, R2) - mA * mA
corr = unwrap(cov / np.sqrt(np.maximum(vB * vA, 1e-8)))
flat = unwrap((mB < 0.04) & (mA < 0.04))  # a plain wall in both: nothing to disagree about
trust = np.clip((corr - 0.15) / 0.45, 0, 1)
trust = np.where(flat, 1.0, trust).astype(np.float32)
trust = cv2.GaussianBlur(trust, (0, 0), r / 2)[..., None]

g = trust * gain + (1 - trust) * gain_far
g = np.clip(np.exp(g), args.gain_min, args.gain_max)
out = B * g
if args.ai_detail > 0:
    # the AI's own fine texture (its high frequencies), only where both pictures agree
    hf = np.empty_like(A)
    for c in range(3):
        la = wrap(np.log(A[..., c] + 1e-3))
        hf[..., c] = unwrap(la - guided(guide, la, 2, args.eps))
    out = out * np.exp(np.clip(hf, -0.5, 0.5) * args.ai_detail * trust)
if args.blender_linear:
    # very bright spots (the window, a lamp) can exceed 1 after the gain: soft roll-off instead of a hard clip
    out = np.where(out > 0.8, 0.8 + 0.2 * np.tanh((out - 0.8) / 0.2), out)
res = (to_srgb(out) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(args.out, res, [cv2.IMWRITE_JPEG_QUALITY, 93])
print("LOOK_TRANSFER %dx%d in %.1f s, trusted share %.0f %%, gain median %.2f" % (W, H, time.time() - t0, 100 * float((trust > 0.5).mean()), float(np.median(g))))
