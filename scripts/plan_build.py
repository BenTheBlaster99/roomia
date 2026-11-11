"""
The architect's plan for a scene, end to end (11 Nov): the cut in Blender (plan_capture.py), a first drawing that numbers the
rooms (plan_arch.py), the AI names them (plan-ai-names.mts, Gemini; skipped without a key), the final drawing, installed
in the tour folder next to the photographic plan:
  tour/plan-archi-rendu.png   furnished top view under the drawing
  tour/plan-archi-technique.png  white floors, cut lines
  tour/plan-archi.pdf         A3, both pages
  tour/plan-archi.json        rooms (name, m², size), total, doors
and tour.json's plan.archi = {rendu, technique, pdf, total, rooms}.

python plan_build.py <sceneId> [--title "Appartement F5"] [--no-ai]
Needs ROOMIA_BLENDER (.env.local); runs with the tour's python (numpy, scipy, PIL).
"""
import argparse, datetime, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
ap = argparse.ArgumentParser()
ap.add_argument("scene")
ap.add_argument("--title")
ap.add_argument("--no-ai", action="store_true")
ap.add_argument("--cut", type=float, default=1.2)
args = ap.parse_args()
SCENES = os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")
S = os.path.join(os.path.abspath(SCENES), args.scene)
TOUR = os.path.join(S, "tour")
WORK = os.path.join(S, "plan-archi")
os.makedirs(WORK, exist_ok=True)
PY = os.environ.get("ROOMIA_PYTHON") or "python3"


def env(key):
    if os.environ.get(key):
        return os.environ[key]
    p = os.path.join(ROOT, ".env.local")
    if os.path.exists(p):
        for line in open(p):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    return None


BLENDER = env("ROOMIA_BLENDER")
tour = json.load(open(os.path.join(TOUR, "tour.json")))
hd = os.path.join(TOUR, (tour.get("plan") or {}).get("hd") or "plan-hd.png")

# the plan's frame: the tour build's own record, else fitted from the views (their plan dot and their eye)
src = os.path.join(TOUR, "plan-src", "tour-blender.json")
top, apt = hd, None
if os.path.exists(src):
    m = json.load(open(src))["plan"]
    frame, width, height, floor = m["frame"], 2 * m["width"], 2 * m["height"], m["floor"]
    if os.path.exists(os.path.join(TOUR, "plan-src", "plan-hd.png")):
        top = os.path.join(TOUR, "plan-src", "plan-hd.png")
    if os.path.exists(os.path.join(TOUR, "plan-src", "plan-apt.png")):
        apt = os.path.join(TOUR, "plan-src", "plan-apt.png")
else:
    import numpy as np
    vs = [v for v in tour["views"] if v.get("position") and v.get("plan")]
    gx, gz = np.array([v["position"][0] for v in vs]), np.array([v["position"][2] for v in vs])
    px, py = np.array([v["plan"]["x"] for v in vs]), np.array([v["plan"]["y"] for v in vs])
    A = np.stack([np.r_[gx, gz], np.r_[np.ones_like(gx), np.zeros_like(gz)], np.r_[np.zeros_like(gx), np.ones_like(gz)]], 1)
    (s, bx, by), *_ = np.linalg.lstsq(A, np.r_[px, py], rcond=None)
    W_, H_ = tour["plan"]["width"], tour["plan"]["height"]
    lox, hiy = -bx / s, by / s
    frame, width, height = [lox, hiy - H_ / s, lox + W_ / s, hiy], 2 * W_, 2 * H_
    try:
        floor = json.load(open(os.path.join(TOUR, "nav.json")))["levels"][0]["floor"]
    except Exception:
        floor = float(min(v["position"][1] for v in vs)) - 1.6
blend = os.path.join(S, "look", "prepared.blend")
if not os.path.exists(blend):
    caches = sorted(f for f in os.listdir(S) if f.startswith("scene-cache-") and f.endswith(".blend"))
    blend = os.path.join(S, caches[-1]) if caches else None
if not blend or not BLENDER:
    raise SystemExit("plan_build: no Blender or no scene .blend")

print("PLAN_STEP coupe", flush=True)
job = {"frame": frame, "width": width, "height": height, "floor": floor, "cut": floor + args.cut, "out": WORK}
json.dump(job, open(os.path.join(WORK, "job.json"), "w"))
with open(os.path.join(WORK, "capture.log"), "w") as f:
    subprocess.run([BLENDER, "-b", blend, "--python", os.path.join(SCRIPTS, "plan_capture.py"), "--", os.path.join(WORK, "job.json")], stdout=f, stderr=subprocess.STDOUT, check=False)
if not os.path.exists(os.path.join(WORK, "plan-cut.npy")):
    raise SystemExit("plan_build: the cut failed (see %s)" % os.path.join(WORK, "capture.log"))

meta = {}
for f in ("meta.json",):
    p = os.path.join(S, f)
    if os.path.exists(p):
        meta = json.load(open(p))
title = args.title or meta.get("name") or meta.get("title") or "Plan d'aménagement"
title = os.path.splitext(title)[0]
months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
today = datetime.date.today()
opt = {"title": title, "subtitle": "Plan d'aménagement · niveau principal", "date": "%d %s %d" % (today.day, months[today.month - 1], today.year)}
if apt:
    opt["apt"] = apt
out = os.path.join(WORK, "plan")
names = out + "-names.json"
if os.path.exists(names):
    os.remove(names)
print("PLAN_STEP dessin", flush=True)
subprocess.run([PY, os.path.join(SCRIPTS, "plan_arch.py"), WORK, top, out, json.dumps(opt)], check=True)
if not args.no_ai and env("GEMINI_API_KEY"):
    print("PLAN_STEP noms", flush=True)
    r = subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/plan-ai-names.mts", out], cwd=ROOT, check=False)
    if r.returncode == 0 and os.path.exists(names):
        subprocess.run([PY, os.path.join(SCRIPTS, "plan_arch.py"), WORK, top, out, json.dumps(dict(opt, namesFile=names))], check=True)
for a, b in (("-rendu.png", "plan-archi-rendu.png"), ("-technique.png", "plan-archi-technique.png"), (".pdf", "plan-archi.pdf"), ("-rooms.json", "plan-archi.json")):
    shutil.copyfile(out + a, os.path.join(TOUR, b))
rep = json.load(open(out + "-rooms.json"))
# a tour built before 2 Nov kept no plan sources: the 3D plan needs the frame and the apartment's outline, which this run has
src_dir = os.path.join(TOUR, "plan-src")
if not os.path.exists(os.path.join(src_dir, "tour-blender.json")):
    os.makedirs(src_dir, exist_ok=True)
    lvl = {"index": 0, "suffix": "", "main": True, "floor": floor, "ceil": floor + 2.7, "cut": floor + 1.6, "width": width // 2, "height": height // 2,
           "mpp": (frame[2] - frame[0]) / (width // 2), "frame": frame, "outdoor": False}
    json.dump({"plan": lvl, "levels": [lvl]}, open(os.path.join(src_dir, "tour-blender.json"), "w"))
    shutil.copyfile(out + "-apt.png", os.path.join(src_dir, "plan-apt.png"))
    print("PLAN_STEP sources du plan 3D écrites", flush=True)
if not os.path.exists(os.path.join(TOUR, "plan-3d.jpg")) and os.environ.get("ROOMIA_PLAN3D", "1") == "1":
    print("PLAN_STEP plan 3D", flush=True)
    subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/plan3d-run.mts", args.scene], cwd=ROOT, check=False)
t = json.load(open(os.path.join(TOUR, "tour.json")))
t.setdefault("plan", {})["archi"] = {"rendu": "plan-archi-rendu.png", "technique": "plan-archi-technique.png", "pdf": "plan-archi.pdf",
                                     "total": rep.get("total"), "rooms": [{"name": r["name"], "area": r["area"]} for r in rep["rooms"] if r["area"] >= 0.8]}
json.dump(t, open(os.path.join(TOUR, "tour.json"), "w"), ensure_ascii=False)
print("PLAN_DONE", rep.get("total"), "m2,", len(rep["rooms"]), "rooms", flush=True)
