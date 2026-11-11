"""
Before / after of the walk-AI-detail step as the walk would show it, rendered by Cycles with the look (11 Nov 2026).

~/.local/bin/roomia-py scripts/walk_compare.py <walk-dir> <ai-dir> <recipe.json> <poses.json> <out-dir>

walk-dir  walk_unwrap.py's outDir with room-scene.blend (the scene whose room surfaces read <atlas>-col.png through uv_unique)
ai-dir    walk_ai_detail.py's out with <atlas>-col-ai.png
poses     [{"name", "position": [x,y,z] glTF, "target": [x,y,z] glTF, "lens": 24}]
Renders every pose twice with look_render.py (pano mode, persp views, the recipe's daylight look): once with the baked colour, once
with the AI-detail colour swapped in on disk; both graded with the SAME exposure; writes <name>-before.png, -after.png, -diff.png
(difference x8 around grey) and a sheet.
"""
import json, os, shutil, subprocess, sys
import numpy as np
import cv2

wdir, aidir, recipe, poses_p, out = sys.argv[1:6]
os.makedirs(out, exist_ok=True)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from look_grade import grade  # noqa: E402

BLENDER = next(l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env.local")) if l.startswith("ROOMIA_BLENDER="))
rep = json.load(open(os.path.join(wdir, "walk-unwrap.json")))
poses = json.load(open(poses_p))
R = json.load(open(recipe))
look = (R.get("looks") or {}).get("daylight") or {}


def render(tag):
    d = os.path.join(out, tag)
    os.makedirs(d, exist_ok=True)
    job = {"recipe": recipe, "cameras": os.path.join(d, "no-cameras.json"), "outDir": d, "scriptsDir": os.path.join(ROOT, "scripts"), "mode": "pano",
           "preset": "daylight", "samples": 64, "noise": 0.02, "noMasks": True, "width": 1600, "height": 900,
           "views": [dict(p, persp=True) for p in poses]}
    json.dump([], open(job["cameras"], "w"))
    json.dump(job, open(os.path.join(d, "job.json"), "w"))
    with open(os.path.join(d, "render.log"), "w") as f:
        subprocess.run(["bash", "-c", 'echo 1000 > /proc/self/oom_score_adj; exec nice -n 10 "$@"', "blender", BLENDER, "-b", os.path.join(wdir, "room-scene.blend"),
                        "--python", os.path.join(ROOT, "scripts", "look_render.py"), "--", os.path.join(d, "job.json")], stdout=f, stderr=subprocess.STDOUT, check=False)
    return {p["name"]: np.load(os.path.join(d, p["name"] + "-lin.npy")).astype(np.float32) for p in poses}


# the textures the saved scene reads, by path; the AI ones go in their place for the second render, the originals come back after
cols = [os.path.join(wdir, a["col"]) for a in rep["atlases"]]
for c in cols:
    shutil.copy(c, c + ".base-backup.png")
before = render("before")
try:
    for a in rep["atlases"]:
        shutil.copy(os.path.join(aidir, a["name"] + "-col-ai.png"), os.path.join(wdir, a["col"]))
    after = render("after")
finally:
    for c in cols:
        shutil.copy(c + ".base-backup.png", c)
rows = []
for p in poses:
    n = p["name"]
    b, a = before[n], after[n]
    # one exposure for both: the median of the before picture brought to 0.5 on the display
    g = dict(look.get("grade") or R.get("grade", {}))
    lo, hi = -8.0, 8.0
    LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)
    for _ in range(16):
        mid = (lo + hi) / 2
        if float(np.median(grade(b[::4, ::4], dict(g, exposure=mid)) @ LUM)) < 0.5:
            lo = mid
        else:
            hi = mid
    g["exposure"] = (lo + hi) / 2
    B = (np.clip(grade(b, g), 0, 1) * 255 + 0.5).astype(np.uint8)
    A = (np.clip(grade(a, g), 0, 1) * 255 + 0.5).astype(np.uint8)
    D = np.clip(128 + (A.astype(np.float32) - B.astype(np.float32)) * 8, 0, 255).astype(np.uint8)
    for tag, img in (("before", B), ("after", A), ("diff", D)):
        cv2.imwrite(os.path.join(out, "%s-%s.png" % (n, tag)), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    print("COMPARE", n, "mean |after-before| %.2f/255, 99th pct %.1f/255" % (np.abs(A.astype(np.float32) - B).mean(), np.percentile(np.abs(A.astype(np.float32) - B), 99)), flush=True)
    rows.append(np.hstack([cv2.resize(B, (800, 450)), cv2.resize(A, (800, 450))]))
cv2.imwrite(os.path.join(out, "sheet.jpg"), cv2.cvtColor(np.vstack(rows), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
print("COMPARE_OK", flush=True)
