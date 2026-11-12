"""
Missing floor in the furnished top view (12 Nov): the capture sees nothing where the model has no floor face (a niche behind a curtain, a
balcony strip), and those spots print white inside the apartment. This finds them (white pixels inside the drawn apartment), groups them
into crops of at most 1536x1024 px, and writes what the AI fill needs. Free: nothing is sent.

python plan_fill_prepare.py <sceneId> [--min-px 400]
Writes <scene>/plan-archi/fill/: views.json, f<k>-in.png (crop, the spots painted magenta), f<k>-orig.png (crop as it is), f<k>-mask.png (the pixels the AI may change), preview.jpg.
The AI (plan-fill-gateway.mts) gets each crop as a photo; plan_fill_finish.py then copies ONLY the masked pixels back (feathered), so
walls, furniture and measures stay exactly as drawn.
"""
import argparse, json, os, sys
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("scene")
ap.add_argument("--min-px", type=int, default=400)
args = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(os.path.abspath(os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")), args.scene)
TOUR, WORK = os.path.join(S, "tour"), os.path.join(S, "plan-archi")
OUT = os.path.join(WORK, "fill")
os.makedirs(OUT, exist_ok=True)
tour = json.load(open(os.path.join(TOUR, "tour.json")))
top_path = os.path.join(TOUR, "plan-src", "plan-hd.png")
if not os.path.exists(top_path):
    top_path = os.path.join(TOUR, (tour.get("plan") or {}).get("hd") or "plan-hd.png")
top = cv2.imread(top_path, cv2.IMREAD_COLOR)
drawn = cv2.imread(os.path.join(WORK, "plan-floor.png"), cv2.IMREAD_GRAYSCALE)  # the floor as drawn (plan_arch.py), not the walls
if drawn.shape != top.shape[:2]:
    drawn = cv2.resize(drawn, (top.shape[1], top.shape[0]), interpolation=cv2.INTER_NEAREST)
inside = drawn > 127
white = top.min(axis=2) >= 245
holes = (white & inside).astype(np.uint8)
holes = cv2.morphologyEx(holes, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# a thin white line along a wall face is the drawing's own gap, not missing floor: keep only spots that are not thin
dist = cv2.distanceTransform(holes, cv2.DIST_L2, 3)
solid = (dist >= 4).astype(np.uint8)
solid = cv2.dilate(solid, np.ones((11, 11), np.uint8))  # back to the spot's full shape, thin white lines gone
holes = holes & solid
holes = cv2.dilate(holes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))  # a little past the edge: anti-aliased rim
holes = (holes > 0) & inside
n, lab, stats, cent = cv2.connectedComponentsWithStats(holes.astype(np.uint8), connectivity=8)
comps = [(int(stats[i, cv2.CC_STAT_AREA]), i) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= args.min_px]
comps.sort(reverse=True)
H, W = holes.shape
CW, CH = 1536, 1024
covered, views = set(), []
for area, i in comps:
    if i in covered:
        continue
    x, y, w, h = (int(stats[i, k]) for k in (cv2.CC_STAT_LEFT, cv2.CC_STAT_TOP, cv2.CC_STAT_WIDTH, cv2.CC_STAT_HEIGHT))
    # a spot larger than a crop is handled in tiles of its own: its first CWxCH window, the rest on a later run
    cx, cy = x + w // 2, y + h // 2
    x0 = int(np.clip(cx - CW // 2, 0, max(0, W - CW)))
    y0 = int(np.clip(cy - CH // 2, 0, max(0, H - CH)))
    win = (x0, y0, min(CW, W), min(CH, H))
    inwin = [j for _, j in comps if stats[j, cv2.CC_STAT_LEFT] >= x0 and stats[j, cv2.CC_STAT_TOP] >= y0
             and stats[j, cv2.CC_STAT_LEFT] + stats[j, cv2.CC_STAT_WIDTH] <= x0 + win[2] and stats[j, cv2.CC_STAT_TOP] + stats[j, cv2.CC_STAT_HEIGHT] <= y0 + win[3]]
    covered.update(inwin)
    covered.add(i)
    k = len(views)
    crop = top[y0:y0 + win[3], x0:x0 + win[2]].copy()
    m = (np.isin(lab[y0:y0 + win[3], x0:x0 + win[2]], inwin + [i])).astype(np.uint8) * 255
    cv2.imwrite(os.path.join(OUT, "f%d-orig.png" % k), crop)
    marked = crop.copy()
    marked[m > 0] = (255, 0, 255)  # BGR magenta: what the AI is asked to fill; the white outside the walls is left alone
    cv2.imwrite(os.path.join(OUT, "f%d-in.png" % k), marked)
    cv2.imwrite(os.path.join(OUT, "f%d-mask.png" % k), m)
    views.append({"name": "f%d" % k, "x": x0, "y": y0, "w": win[2], "h": win[3], "holePx": int((m > 0).sum()), "spots": len(inwin) + 1})
json.dump({"views": views, "top": top_path, "size": [W, H]}, open(os.path.join(OUT, "views.json"), "w"), indent=1)
tot = int(holes.sum())
print("PLAN_FILL holes %d px (%.2f %% of the drawn apartment), %d spots >= %d px, %d crops" % (tot, 100.0 * tot / max(1, inside.sum()), len(comps), args.min_px, len(views)))
for v in views:
    print("  %s at %d,%d  %dx%d  %d hole px in %d spots" % (v["name"], v["x"], v["y"], v["w"], v["h"], v["holePx"], v["spots"]))
ov = top.copy()
ov[holes] = (0, 0, 255)
for v in views:
    cv2.rectangle(ov, (v["x"], v["y"]), (v["x"] + v["w"], v["y"] + v["h"]), (0, 160, 0), 6)
cv2.imwrite(os.path.join(OUT, "preview.jpg"), cv2.resize(ov, (W // 3, H // 3), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
print("PLAN_FILL cost if all crops are sent: %d DA (14 DA per image)" % (14 * len(views)))
