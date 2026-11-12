"""
python plan_fill_finish.py <sceneId> [--views f0,f2]   (12 Nov) lays the AI's fill back into the top view.
Only the masked pixels (the missing floor) take the AI's colours, feathered over a few pixels; every other pixel of the plan stays what
Blender drew, so walls, furniture and measures cannot move. The result is written as tour/plan-src/plan-hd-filled.png and
plan-archi/fill/preview-after.jpg; plan_fill_apply.py (later) swaps it in. Needs cv2 (the AI python).
"""
import argparse, json, os
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("scene")
ap.add_argument("--views")
args = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(os.path.abspath(os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")), args.scene)
OUT = os.path.join(S, "plan-archi", "fill")
meta = json.load(open(os.path.join(OUT, "views.json")))
top = cv2.imread(meta["top"], cv2.IMREAD_COLOR).astype(np.float32)
want = set(args.views.split(",")) if args.views else None
done = 0
for v in meta["views"]:
    if want and v["name"] not in want:
        continue
    ai_path = os.path.join(OUT, v["name"] + "-ai.jpg")
    if not os.path.exists(ai_path):
        continue
    ai = cv2.imread(ai_path, cv2.IMREAD_COLOR)
    x, y, w, h = v["x"], v["y"], v["w"], v["h"]
    ai = cv2.resize(ai, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    mask = cv2.imread(os.path.join(OUT, v["name"] + "-mask.png"), cv2.IMREAD_GRAYSCALE) > 0
    # the AI repaints at 1536 px and a little differently: match its brightness and colour to the real floor around the spot (a ring of 25 px)
    ring = cv2.dilate(mask.astype(np.uint8), np.ones((51, 51), np.uint8)).astype(bool) & ~cv2.dilate(mask.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    orig = top[y:y + h, x:x + w]
    ring &= orig.min(axis=2) < 240
    if ring.sum() > 500:
        for c in range(3):
            a, b = ai[..., c][ring], orig[..., c][ring]
            gain = (b.std() + 1e-3) / (a.std() + 1e-3)
            ai[..., c] = np.clip((ai[..., c] - a.mean()) * min(1.5, max(0.67, gain)) + b.mean(), 0, 255)
    alpha = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 3.0)
    alpha = np.where(mask, 1.0, alpha)[..., None]  # fully the AI inside the spot, a 3 px feather just outside it
    top[y:y + h, x:x + w] = orig * (1 - alpha) + ai * alpha
    done += 1
    print("FILL_LAID", v["name"], "hole px", v["holePx"])
out = os.path.join(S, "tour", "plan-src", "plan-hd-filled.png")
cv2.imwrite(out, np.clip(top, 0, 255).astype(np.uint8))
H, W = top.shape[:2]
cv2.imwrite(os.path.join(OUT, "preview-after.jpg"), cv2.resize(np.clip(top, 0, 255).astype(np.uint8), (W // 3, H // 3), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 88])
print("FILL_DONE", done, "crops laid ->", out)
