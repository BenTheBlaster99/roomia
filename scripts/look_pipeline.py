"""
Roomia look pipeline v1 (8 Nov): the F5 showcase's process as one repeatable command per scene. Blender work is free; the AI
step prints what it will cost and spends nothing without --yes.

python look_pipeline.py render <sceneId> [--points 0,1,2] [--dry]   analysis -> automatic recipe -> every 360 point -> exposure,
                                                                    seam, shadows -> installed in the tour (old ones kept)
python look_pipeline.py suggest <sceneId> [--n 4]                   which points deserve the AI tiles (from the finished panoramas)
python look_pipeline.py ai <sceneId> --points 6,10 [--ring 6] [--yes]  tiles for those points (14 DA per image; ring = 4 more
                                                                    views looking higher, for the listed points)

Everything lives in .scenes/<id>/look/auto/ ; the installed pano-<index>.jpg keep the old Cycles one as pano-<index>-cycles-old.jpg.
Needs ROOMIA_BLENDER (.env.local) and the AI venv (python with cv2, torch): run it with that python.
"""
import argparse, datetime, json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
PY = sys.executable
ap = argparse.ArgumentParser()
ap.add_argument("stage", choices=["render", "suggest", "ai"])
ap.add_argument("scene")
ap.add_argument("--points")
ap.add_argument("--ring")
ap.add_argument("--n", type=int, default=4)
ap.add_argument("--yes", action="store_true")
ap.add_argument("--dry", action="store_true")
args = ap.parse_args()

S = os.path.join(ROOT, ".scenes", args.scene)
LOOK = os.path.join(S, "look")
AUTO = os.path.join(LOOK, "auto")
TOUR = os.path.join(S, "tour")
os.makedirs(AUTO, exist_ok=True)


def env(key):
    for line in open(os.path.join(ROOT, ".env.local")):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("missing %s in .env.local" % key)


BLENDER = env("ROOMIA_BLENDER")
tour = json.load(open(os.path.join(TOUR, "tour.json")))


def points():
    """every tour view that has a panorama and a known eye position: the views' own positions, else the walk capture's probes"""
    probes = None
    for f in ("splat-golden.json", "splat-v4.json", "splat-ai.json"):
        p = os.path.join(TOUR, f)
        if os.path.exists(p):
            probes = json.load(open(p)).get("probes")
            break
    out = []
    for v in tour["views"]:
        if not v.get("pano"):
            continue
        pos = v.get("position") or (probes[v["index"]]["eye"] if probes and v["index"] < len(probes) else None)
        if pos:
            out.append({"index": v["index"], "name": v["name"], "position": pos})
    return out


def blender(job_path, script, log):
    t = time.time()
    # an out-of-memory kill takes Blender, not the desktop: the Blender process is the one the kernel picks
    cmd = "echo 1000 > /proc/self/oom_score_adj; exec nice -n 10 '%s' -b '%s' --python '%s' -- '%s'" % (BLENDER, os.path.join(LOOK, "prepared.blend"), os.path.join(SCRIPTS, script), job_path)
    with open(log, "w") as f:
        subprocess.run(["bash", "-c", cmd], stdout=f, stderr=subprocess.STDOUT, check=False)
    print("  %s %.0fs" % (script, time.time() - t), flush=True)


def floor_z():
    try:
        return json.load(open(os.path.join(TOUR, "nav.json")))["levels"][0]["floor"]
    except Exception:
        return None


def ensure_prepared():
    if os.path.exists(os.path.join(LOOK, "prepared.blend")):
        return
    print("preparing the scene (once)...", flush=True)
    subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/look-prep.mts", args.scene], cwd=ROOT, check=True)


def job(extra, views, out_dir, masks):
    j = {"recipe": os.path.join(AUTO, "recipe-auto.json"), "cameras": os.path.join(S, "cameras.json") if os.path.exists(os.path.join(S, "cameras.json")) else os.path.join(AUTO, "no-cameras.json"),
         "outDir": out_dir, "scriptsDir": SCRIPTS, "mode": "pano", "preset": "golden", "samples": 128, "targetMedian": 0.45}
    if not os.path.exists(j["cameras"]):
        json.dump([], open(j["cameras"], "w"))
    if not masks:
        j["noMasks"] = True
    j["views"] = [{"name": "t%d" % p["index"], "position": p["position"], "yaw": 0, "width": 3072, "height": 1536} for p in views]
    # an invisible, very soft fill above each point: a room with no fixtures of its own stays readable (5 W is nothing next to real lights)
    j["fills"] = [{"position": [p["position"][0], p["position"][1] + 0.9, p["position"][2]], "power": 5, "color": [1.0, 0.85, 0.65]} for p in views]
    j.update(extra)
    return j


def finalize(names):
    e = dict(os.environ, LIFT="0.08")
    subprocess.run([PY, os.path.join(SCRIPTS, "look_finalize_panos.py"), AUTO, os.path.join(AUTO, "recipe-auto.json"), ",".join(names), "0.45", "2.5"], env=e, check=True)


def install(width, pairs):
    subprocess.run([PY, os.path.join(SCRIPTS, "look_install_tour.py"), TOUR, str(width)] + ["%d=%s" % (i, f) for i, f in pairs], check=True)
    tour_p = os.path.join(TOUR, "tour.json")
    t = json.load(open(tour_p))
    t["builtAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    json.dump(t, open(tour_p, "w"), ensure_ascii=False)


def analysis():
    ap_ = os.path.join(AUTO, "analysis.json")
    if not os.path.exists(ap_):
        print("analysis (sun from the windows, lights, cameras)...", flush=True)
        json.dump({"points": points(), "outDir": AUTO, "elevations": [5, 9, 13], "azimuthStep": 15, "eyeHeight": 1.6}, open(os.path.join(AUTO, "analyze-job.json"), "w"))
        blender(os.path.join(AUTO, "analyze-job.json"), "look_analyze.py", os.path.join(AUTO, "analyze.log"))
    return json.load(open(ap_))


if args.stage == "render":
    ensure_prepared()
    an = analysis()
    fz = floor_z()
    subprocess.run([PY, os.path.join(SCRIPTS, "look_make_recipe.py"), os.path.join(AUTO, "analysis.json"), os.path.join(AUTO, "recipe-auto.json")] + ([str(fz)] if fz is not None else []), check=True)
    bad = {c["index"]: c["verdict"] for c in an["cameras"] if c["verdict"] != "ok"}
    pts = [p for p in points() if p["index"] not in bad]
    if args.points:
        want = {int(x) for x in args.points.split(",")}
        pts = [p for p in pts if p["index"] in want]
    print("points: %d to render, %d skipped (camera): %s" % (len(pts), len(bad), bad), flush=True)
    if args.dry:
        raise SystemExit(0)
    json.dump(job({}, pts, AUTO, False), open(os.path.join(AUTO, "job-render.json"), "w"))
    print("rendering %d panoramas (about 3 minutes each)..." % len(pts), flush=True)
    blender(os.path.join(AUTO, "job-render.json"), "look_render.py", os.path.join(AUTO, "render.log"))
    names = ["t%d" % p["index"] for p in pts if os.path.exists(os.path.join(AUTO, "t%d-lin.npy" % p["index"]))]
    finalize(names)
    install(4096, [(int(n[1:]), os.path.join(AUTO, n + "-pano.png")) for n in names])
    json.dump({"rendered": names, "skipped": bad}, open(os.path.join(AUTO, "render-report.json"), "w"), indent=1)
    print("RENDER_DONE", len(names), "installed; skipped", bad)

elif args.stage == "suggest":
    import cv2
    import numpy as np
    an = json.load(open(os.path.join(AUTO, "analysis.json")))
    bad = {c["index"] for c in an["cameras"] if c["verdict"] != "ok"}
    pts = {p["index"]: p for p in points()}
    scored = []
    for i, p in pts.items():
        f = os.path.join(AUTO, "t%d-pano.png" % i)
        if i in bad or not os.path.exists(f):
            continue
        im = cv2.imread(f, cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
        mid = im[int(im.shape[0] * 0.25):int(im.shape[0] * 0.85)]
        # texture and structure in the part of the sphere the AI tiles cover: plain walls have none
        edges = float((cv2.Canny((mid * 255).astype(np.uint8), 40, 120) > 0).mean())
        detail = float(np.abs(mid - cv2.GaussianBlur(mid, (0, 0), 4)).mean())
        scored.append((edges * 3 + detail * 6, i))
    scored.sort(reverse=True)
    chosen = []
    for s, i in scored:
        pos = np.array(pts[i]["position"])
        if all(np.linalg.norm(pos - np.array(pts[j]["position"])) > 3.0 for j in chosen):
            chosen.append(i)
        if len(chosen) == args.n:
            break
    print("SUGGEST", json.dumps([{"index": i, "name": pts[i]["name"], "score": round(dict((b, a) for a, b in scored)[i], 3)} for i in chosen]))
    print("all ranked:", [(i, round(s, 3)) for s, i in scored])

else:  # ai
    want = [int(x) for x in args.points.split(",")]
    ring = {int(x) for x in args.ring.split(",")} if args.ring else set()
    pts = [p for p in points() if p["index"] in want]
    images = sum(6 + (4 if p["index"] in ring else 0) for p in pts)
    print("AI tiles: %d points, %d images x 14 DA = %d DA" % (len(pts), images, images * 14))
    if not args.yes:
        raise SystemExit("not spending: run again with --yes")
    # these points again with the masks the fence needs (same recipe, same light)
    json.dump(job({}, pts, AUTO, True), open(os.path.join(AUTO, "job-ai.json"), "w"))
    blender(os.path.join(AUTO, "job-ai.json"), "look_render.py", os.path.join(AUTO, "render-ai.log"))
    finalize(["t%d" % p["index"] for p in pts])
    done = []
    for p in pts:
        n = "t%d" % p["index"]
        d = os.path.join(AUTO, "tiles-" + n)
        os.makedirs(d, exist_ok=True)
        subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "cut", os.path.join(AUTO, n + "-pano.png"), os.path.join(AUTO, n + "-masks.npz"), d], check=True)
        sel = ",".join("v%d" % i for i in range(6))
        subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/pano-tiles-gateway.mts", d, "1536x1536", sel], cwd=ROOT, check=True)
        if p["index"] in ring:
            d2 = d + "-r2"
            os.makedirs(d2, exist_ok=True)
            subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "cut", os.path.join(AUTO, n + "-pano.png"), os.path.join(AUTO, n + "-masks.npz"), d2, json.dumps({"pitch": 42, "yawStep": 90})], check=True)
            subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/pano-tiles-gateway.mts", d2, "1536x1536"], cwd=ROOT, check=True)
            m1, m2 = json.load(open(os.path.join(d, "views.json"))), json.load(open(os.path.join(d2, "views.json")))
            import shutil
            for k, v in enumerate(m2["views"]):
                if os.path.exists(os.path.join(d2, v["name"] + "-ai.jpg")):
                    shutil.copy(os.path.join(d2, v["name"] + "-ai.jpg"), os.path.join(d, "r%d-ai.jpg" % k))
                    m1["views"].append({"name": "r%d" % k, "yaw": v["yaw"], "pitch": v["pitch"]})
            json.dump(m1, open(os.path.join(d, "views.json"), "w"))
        subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "lay", d, n], check=True)
        final = os.path.join(AUTO, n + "-final.png")
        subprocess.run([PY, os.path.join(SCRIPTS, "pano_finish.py"), os.path.join(d, "up.png"), os.path.join(d, n + "-ai.png"), os.path.join(AUTO, n + "-masks.npz"), os.path.join(AUTO, "material-ids.json"), final,
                        json.dumps({"width": 6144, "floor": 0.95, "walls": 0.7, "fabric": 0.9, "sigmaBig": 22, "nccLow": 0.35, "nccHigh": 0.7})], check=True)
        done.append((p["index"], final))
    install(6144, done)
    print("AI_DONE", [i for i, _ in done])
