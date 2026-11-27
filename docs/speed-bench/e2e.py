#!/usr/bin/env python3
"""
End-to-end run through the app's own server (the one-launch path) on the speed-test copy of the F5.

python e2e.py propose                    # "Placer les points de vue": prints the points the placement proposes
python e2e.py confirm [--scenes N] [--auto M]   # "Lancer": confirms the proposal (all points, or the first N scenes and M automatic points) and follows the whole chain
Needs the server on 127.0.0.1:3011 (docs/speed-bench/start_server.sh). Prints a timeline of every change of the build and render state.
"""
import json, sys, time, urllib.request

BASE, ID = "http://127.0.0.1:3011", "BlocBF5Speed000000001"
T0 = time.time()


def log(msg):
    print("%6.0fs  %s" % (time.time() - T0, msg), flush=True)


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")


def tour():
    return api("GET", "/api/scenes/%s/tour" % ID)


def look():
    return api("GET", "/api/scenes/%s/look" % ID)


def propose():
    api("POST", "/api/scenes/%s/tour" % ID, {"propose": True, "fresh": True})
    log("placement started")
    last = None
    while True:
        p = (tour().get("proposal") or {})
        if p.get("step") != last:
            last = p.get("step")
            log("placement: %s %s" % (p.get("state"), last or ""))
        if p.get("state") in ("ready", "failed"):
            return p
        time.sleep(3)


def show(p):
    pts = p.get("points") or []
    log("proposal %s: %d points (%d scenes, %d automatic)" % (p.get("state"), len(pts), sum(1 for x in pts if x["kind"] == "view"), sum(1 for x in pts if x["kind"] == "auto")))
    for x in pts:
        log("   %-22s %-6s level %s plan (%4.0f,%4.0f) sees %s" % (x["key"], x["kind"], x["level"], x["plan"]["x"], x["plan"]["y"], x.get("sees")))


def confirm(p, scenes=None, auto=None):
    pts = p["points"]
    views = [x["view"] for x in pts if x["kind"] == "view" and not x.get("off")][:scenes]
    autos = [{"id": x["id"], "name": x["name"], "position": x["position"], "target": x["target"]} for x in pts if x["kind"] == "auto"][:auto]
    n = len(views) + len(autos)
    log("confirming %d points (%d scenes, %d automatic)" % (n, len(views), len(autos)))
    api("POST", "/api/scenes/%s/tour" % ID, {"confirmPoints": {"views": views, "auto": autos}, "autoAi": {"max": 200}})
    seen = {}
    while True:
        t, l = tour(), look()
        state = (t.get("status") or {}).get("state")
        key = ("build", state, (t.get("status") or {}).get("step"))
        lk = ("look", l.get("stage"), l.get("job"), l.get("step"))
        for k in (key, lk):
            if seen.get(k[0]) != k:
                seen[k[0]] = k
                log(" ".join(str(v) for v in k))
        if l.get("stage") in ("done", "error", "interrupted") or state == "failed":
            log("END " + json.dumps({"look": l.get("stage"), "error": l.get("error"), "ai": l.get("ai")}))
            return
        time.sleep(4)


if __name__ == "__main__":
    mode = sys.argv[1]
    arg = lambda name: int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else None
    p = propose()
    show(p)
    if mode == "confirm" and p.get("state") == "ready":
        confirm(p, arg("--scenes"), arg("--auto"))
