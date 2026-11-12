"""
Roomia look pipeline v1 (8 Nov): the F5 showcase's process as one repeatable command per scene. Blender work is free; the AI
step prints what it will cost and spends nothing without --yes.

python look_pipeline.py render <sceneId> [--points 0,1,2] [--dry]   analysis -> automatic recipe -> every 360 point -> exposure,
                                                                    seam, shadows -> installed in the tour (old ones kept)
python look_pipeline.py suggest <sceneId> [--n 4]                   which points deserve the AI tiles (from the finished panoramas)
python look_pipeline.py ai <sceneId> --points 6,10 [--ring 6] [--yes]  tiles for those points (14 DA per image; ring = 4 more
                                                                    views looking higher, for the listed points)

python look_pipeline.py ai-prepare <sceneId> --points 6,10 [--ring 6]    the first half of "ai" (what the desktop app drives): re-render those
                                                                    points with masks, cut the tiles, write auto/ai-manifest.json (the list
                                                                    of images to send and their cost); nothing is sent
python look_pipeline.py ai-finish <sceneId> --points 6,10 [--ring 6]     the second half: lay the returned tiles (<view>-ai.jpg beside each
                                                                    <view>-in.png), fence, validate, install at 6144 px

Everything lives in .scenes/<id>/look/auto/ ; the installed pano-<index>.jpg keep the old Cycles one as pano-<index>-cycles-old.jpg.
Needs ROOMIA_BLENDER (.env.local) and the AI venv (python with cv2, torch): run it with that python.
"""
import argparse, datetime, hashlib, json, os, shutil, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
PY = sys.executable
ap = argparse.ArgumentParser()
ap.add_argument("stage", choices=["render", "suggest", "ai", "ai-prepare", "ai-finish"])
ap.add_argument("scene")
ap.add_argument("--points")
ap.add_argument("--ring")
ap.add_argument("--n", type=int, default=4)
ap.add_argument("--yes", action="store_true")
ap.add_argument("--dry", action="store_true")
ap.add_argument("--look", default=os.environ.get("ROOMIA_LOOK_PRESET", "daylight"), choices=["daylight", "golden"])
ap.add_argument("--auto-dir", default="auto")
args = ap.parse_args()

# where the app keeps its projects: SCENES_DIR (Roomia Desktop: %LOCALAPPDATA%\\Roomia\\projects), else .scenes beside the code
SCENES = os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")
S = os.path.join(os.path.abspath(SCENES), args.scene)
LOOK = os.path.join(S, "look")
AUTO = os.path.join(LOOK, args.auto_dir)
TOUR = os.path.join(S, "tour")
os.makedirs(AUTO, exist_ok=True)


def env(key):
    if os.environ.get(key):
        return os.environ[key]
    for line in open(os.path.join(ROOT, ".env.local")):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("missing %s in .env.local" % key)


BLENDER = env("ROOMIA_BLENDER")
tour = json.load(open(os.path.join(TOUR, "tour.json")))


def points(raw=False):
    """every tour view that has a panorama and a known eye position: the views' own positions, else the walk capture's probes"""
    probes = None
    for f in ("splat-golden.json", "splat-v4.json", "splat-ai.json"):
        p = os.path.join(TOUR, f)
        if os.path.exists(p):
            probes = json.load(open(p)).get("probes")
            break
    out = []
    cams = {}
    cp = os.path.join(S, "cameras.json")
    if os.path.exists(cp):
        cams = {c["name"]: c["position"] for c in json.load(open(cp))}
    for v in tour["views"]:
        if v.get("hidden") or v.get("outside"):
            continue
        # a view whose 360 failed to build (no pano yet) gets one too: its eye is the view's own, else the saved camera's, else the walk probe's
        pos = v.get("position") or cams.get(v["name"]) or (probes[v["index"]]["eye"] if probes and v["index"] < len(probes) else None)
        if pos:
            out.append({"index": v["index"], "name": v["name"], "position": pos})
    # a camera against a wall or inside a cupboard takes its 360 from the better spot the analysis found nearby (11 Nov)
    an_p = os.path.join(AUTO, "analysis.json")
    if raw:
        return out
    moved = {c["index"]: c["moved"] for c in json.load(open(an_p)).get("cameras", []) if c.get("moved")} if os.path.exists(an_p) else {}
    for p in out:
        if p["index"] in moved:
            p["position"], p["moved"] = moved[p["index"]], True
    return out


def blender(job_path, script, log):
    t = time.time()
    # an out-of-memory kill takes Blender, not the desktop: the Blender process is the one the kernel picks
    argv = [BLENDER, "-b", os.path.join(LOOK, "prepared.blend"), "--python", os.path.join(SCRIPTS, script), "--", job_path]
    if sys.platform.startswith("linux"):
        argv = ["bash", "-c", "echo 1000 > /proc/self/oom_score_adj; exec nice -n 10 \"$@\"", "blender"] + argv
    with open(log, "w") as f:
        subprocess.run(argv, stdout=f, stderr=subprocess.STDOUT, check=False)
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
         "outDir": out_dir, "scriptsDir": SCRIPTS, "mode": "pano", "preset": args.look,
         # 48 samples at noise 0.03 (9 Nov benchmark, Suite): half the time of 128 / 0.01, the same image to the eye (floor, wall, fabric crops)
         "samples": int(os.environ.get("ROOMIA_LOOK_SAMPLES", 48)), "noise": float(os.environ.get("ROOMIA_LOOK_NOISE", 0.03)), "targetMedian": 0.45}
    if not os.path.exists(j["cameras"]):
        json.dump([], open(j["cameras"], "w"))
    if not masks:
        j["noMasks"] = True
    j["views"] = [{"name": "t%d" % p["index"], "position": p["position"], "yaw": 0, "width": 3072, "height": 1536} for p in views]
    # an invisible, very soft fill above each point: a room with no fixtures of its own stays readable (5 W is nothing next to real lights)
    j["fills"] = [{"position": [p["position"][0], p["position"][1] + 0.9, p["position"][2]], "power": float(os.environ.get("ROOMIA_LOOK_FILL", 25)), "color": [1.0, 0.9, 0.78]} for p in views]
    j.update(extra)
    return j


def finalize(names):
    lk = (json.load(open(os.path.join(AUTO, "recipe-auto.json"))).get("looks") or {}).get(args.look, {})
    e = dict(os.environ, LIFT=os.environ.get("LIFT", str(lk.get("lift", 0.1))), LOOK=args.look)
    subprocess.run([PY, os.path.join(SCRIPTS, "look_finalize_panos.py"), AUTO, os.path.join(AUTO, "recipe-auto.json"), ",".join(names), "0.5" if args.look == "daylight" else "0.45", "3.0"], env=e, check=True)


def install(width, pairs):
    subprocess.run([PY, os.path.join(SCRIPTS, "look_install_tour.py"), TOUR, str(width)] + ["%d=%s" % (i, f) for i, f in pairs], check=True)
    tour_p = os.path.join(TOUR, "tour.json")
    t = json.load(open(tour_p))
    for i, _ in pairs:
        for v in t["views"]:
            if v["index"] == i and not v.get("pano"):
                v["pano"] = "pano-%d.jpg" % i
    # moved cameras: the tour's arrows and the plan's dot follow the 360 to its new spot (plan pixels from the views that have both)
    mv = {p["index"]: p["position"] for p in points() if p.get("moved")}
    known = [v for v in t["views"] if v.get("position") and v.get("plan") and v["index"] not in mv]
    fit = None
    if len(known) >= 2:
        a, b = known[0], max(known[1:], key=lambda v: abs(v["position"][0] - known[0]["position"][0]))
        dx = b["position"][0] - a["position"][0]
        if abs(dx) > 1e-3:
            s = (b["plan"]["x"] - a["plan"]["x"]) / dx
            fit = (s, a["plan"]["x"] - s * a["position"][0], a["plan"]["y"] - s * a["position"][2])
    for v in t["views"]:
        if v["index"] in mv and v["index"] in {i for i, _ in pairs}:
            v["position"] = mv[v["index"]]
            v.pop("facesWall", None)
            if fit and v.get("plan"):
                v["plan"] = dict(v["plan"], x=fit[0] * mv[v["index"]][0] + fit[1], y=fit[0] * mv[v["index"]][2] + fit[2])
    if all(v.get("pano") or v.get("hidden") for v in t["views"]):
        # a build that failed long ago (out of memory, 30 Oct) no longer shows its red notice on a tour that is complete
        st = os.path.join(TOUR, "status.json")
        if os.path.exists(st) and json.load(open(st)).get("state") == "failed":
            json.dump({"state": "done"}, open(st, "w"))
    t["builtAt"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    json.dump(t, open(tour_p, "w"), ensure_ascii=False)


ANALYSIS_VERSION = 2  # bump when look_analyze.py's method changes


def source_hash():
    """sha256 of the project's source.glb (about 2 s for 512 MB), remembered beside the file as long as its size and time are the same."""
    for name in ("source.glb", os.path.join("look", "prepared.blend")):
        f = os.path.join(S, name)
        if not os.path.exists(f):
            continue
        st = os.stat(f)
        memo = f + ".sha256"
        try:
            m = json.load(open(memo))
            if m.get("size") == st.st_size and m.get("mtime") == int(st.st_mtime):
                return m["sha256"]
        except Exception:
            pass
        h = hashlib.sha256()
        with open(f, "rb") as fh:
            for chunk in iter(lambda: fh.read(8 << 20), b""):
                h.update(chunk)
        try:
            json.dump({"size": st.st_size, "mtime": int(st.st_mtime), "sha256": h.hexdigest()}, open(memo, "w"))
        except OSError:
            pass
        return h.hexdigest()
    return "no-source"


def analysis_key(job):
    """What the analysis depends on: the scene's content, the camera positions it was given, the method and its parameters, Blender."""
    pts = sorted((p["index"], [round(x, 3) for x in p["position"]]) for p in points(raw=True))
    params = {k: job[k] for k in ("elevations", "azimuthStep", "eyeHeight")}
    params["sunFast"] = bool(job.get("sunFast"))
    blob = json.dumps({"src": source_hash(), "pts": pts, "v": ANALYSIS_VERSION, "params": params, "blender": os.path.basename(os.path.dirname(BLENDER))}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def analysis():
    ap_ = os.path.join(AUTO, "analysis.json")
    cache_ = os.path.join(LOOK, "analysis-cache.json")
    job_ = {"points": points(raw=True), "outDir": AUTO, "elevations": [5, 9, 13], "azimuthStep": 15, "eyeHeight": 1.6}
    if os.environ.get("ROOMIA_SUN_FAST") == "1":  # coarse-to-fine sun search (tested on F5, Suite, F2 before it becomes the default)
        job_["sunFast"] = True
    key = analysis_key(job_)

    def keyed(path):
        try:
            return json.load(open(path)).get("cacheKey")
        except Exception:
            return None

    if os.path.exists(ap_) and keyed(ap_) in (key, None):  # no key: made before 12 Nov, kept
        if keyed(ap_) is None:
            d = json.load(open(ap_))
            d["cacheKey"] = key
            json.dump(d, open(ap_, "w"), indent=1)
            if not os.path.exists(cache_):
                shutil.copyfile(ap_, cache_)
        return json.load(open(ap_))
    if keyed(cache_) == key:
        shutil.copyfile(cache_, ap_)
        print("analysis: same scene, same cameras, reused (cache)", flush=True)
        return json.load(open(ap_))
    print("analysis (sun from the windows, lights, cameras)...", flush=True)
    json.dump(job_, open(os.path.join(AUTO, "analyze-job.json"), "w"))
    blender(os.path.join(AUTO, "analyze-job.json"), "look_analyze.py", os.path.join(AUTO, "analyze.log"))
    d = json.load(open(ap_))
    d["cacheKey"] = key
    json.dump(d, open(ap_, "w"), indent=1)
    shutil.copyfile(ap_, cache_)
    return d


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
    # a project prepared before the architect's plan existed gets it now (11 Nov): short Blender run, then drawing + AI names
    if not os.path.exists(os.path.join(TOUR, "plan-archi.json")) and os.environ.get("ROOMIA_PLAN_ARCHI", "1") == "1":
        subprocess.run([os.environ.get("ROOMIA_PYTHON") or "python3", os.path.join(SCRIPTS, "plan_build.py"), args.scene], check=False)
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

else:  # ai, ai-prepare, ai-finish
    import shutil
    want = [int(x) for x in args.points.split(",")]
    ring = {int(x) for x in args.ring.split(",")} if args.ring else set()
    pts = [p for p in points() if p["index"] in want]

    def tiles_dir(n):
        return os.path.join(AUTO, "tiles-" + n)

    def prepare():
        images = sum(6 + (4 if p["index"] in ring else 0) for p in pts)
        print("AI tiles: %d points, %d images x 14 DA = %d DA" % (len(pts), images, images * 14), flush=True)
        # these points again with the masks the fence needs (same recipe, same light)
        json.dump(job({}, pts, AUTO, True), open(os.path.join(AUTO, "job-ai.json"), "w"))
        blender(os.path.join(AUTO, "job-ai.json"), "look_render.py", os.path.join(AUTO, "render-ai.log"))
        finalize(["t%d" % p["index"] for p in pts])
        manifest = {"points": [], "images": images, "cost": images * 14, "size": "1536x1536"}
        for p in pts:
            n = "t%d" % p["index"]
            d = tiles_dir(n)
            os.makedirs(d, exist_ok=True)
            subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "cut", os.path.join(AUTO, n + "-pano.png"), os.path.join(AUTO, n + "-masks.npz"), d], check=True)
            entry = {"index": p["index"], "name": n, "dir": d, "views": ["v%d" % i for i in range(6)]}
            if p["index"] in ring:
                d2 = d + "-r2"
                os.makedirs(d2, exist_ok=True)
                subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "cut", os.path.join(AUTO, n + "-pano.png"), os.path.join(AUTO, n + "-masks.npz"), d2, json.dumps({"pitch": 42, "yawStep": 90})], check=True)
                m1, m2 = json.load(open(os.path.join(d, "views.json"))), json.load(open(os.path.join(d2, "views.json")))
                for k, v in enumerate(m2["views"]):  # the higher row joins the same folder as r0..r3
                    shutil.copy(os.path.join(d2, v["name"] + "-in.png"), os.path.join(d, "r%d-in.png" % k))
                    m1["views"].append({"name": "r%d" % k, "yaw": v["yaw"], "pitch": v["pitch"]})
                    entry["views"].append("r%d" % k)
                json.dump(m1, open(os.path.join(d, "views.json"), "w"))
            manifest["points"].append(entry)
        json.dump(manifest, open(os.path.join(AUTO, "ai-manifest.json"), "w"), indent=1)
        print("AI_PREPARED", manifest["images"], "images", manifest["cost"], "DA", flush=True)
        return manifest

    def finish():
        done = []
        for p in pts:
            n = "t%d" % p["index"]
            d = tiles_dir(n)
            subprocess.run([PY, os.path.join(SCRIPTS, "pano_tiles.py"), "lay", d, n], check=True)
            final = os.path.join(AUTO, n + "-final.png")
            subprocess.run([PY, os.path.join(SCRIPTS, "pano_finish.py"), os.path.join(d, "up.png"), os.path.join(d, n + "-ai.png"), os.path.join(AUTO, n + "-masks.npz"), os.path.join(AUTO, "material-ids.json"), final,
                            json.dumps({"width": 6144, "floor": 0.95, "walls": 0.7, "fabric": 0.9, "sigmaBig": 22, "nccLow": 0.35, "nccHigh": 0.7})], check=True)
            rep = json.load(open(os.path.join(AUTO, n + "-final-report.json")))
            print("AI_POINT", n, rep["verdict"], flush=True)
            done.append((p["index"], final))
        install(6144, done)
        print("AI_DONE", [i for i, _ in done], flush=True)

    if args.stage == "ai-prepare":
        prepare()
    elif args.stage == "ai-finish":
        finish()
    else:  # ai: both halves with the command-line gateway (me, by hand)
        images = sum(6 + (4 if p["index"] in ring else 0) for p in pts)
        print("AI tiles: %d points, %d images x 14 DA = %d DA" % (len(pts), images, images * 14))
        if not args.yes:
            raise SystemExit("not spending: run again with --yes")
        man = prepare()
        for e in man["points"]:
            sel = ",".join(e["views"])
            subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/pano-tiles-gateway.mts", e["dir"], "1536x1536", sel], cwd=ROOT, check=True)
        finish()
