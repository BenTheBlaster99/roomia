"""
Reflection zones (7 Nov, ChatGPT step 5): the apartment's rooms from the walk's own map (tour/nav.json), and which
reflection probes belong to each, so a surface reflects the room it is in, not the room the visitor stands in.

Rooms: the walkable floor shrunk until doorways close (cells with at least CORE cm of clearance), the pieces that
remain are the rooms; they grow back over the whole floor through walkable cells, then over the rest of the grid
(walls, furniture) to the nearest room. Each room gets a box (its cells, floor to ceiling) for parallax correction.

python splat_rooms.py <nav.json> <splat.json> <out rooms.json>
"""
import base64, json, sys
from collections import deque

import numpy as np

nav_p, splat_p, out_p = sys.argv[1:4]
CORE = int(sys.argv[4]) if len(sys.argv) > 4 else 48
nav = json.load(open(nav_p))
info = json.load(open(splat_p))
lv = nav["levels"][0]
nx, ny, step, x0, y0 = nav["nx"], nav["ny"], nav["step"], nav["x0"], nav["y0"]
dz = np.frombuffer(base64.b64decode(lv["dz"]), dtype=np.int16).reshape(ny, nx)
cl = np.frombuffer(base64.b64decode(lv["cl"]), dtype=np.uint8).reshape(ny, nx).astype(np.int32)
walk = (dz != -32768) & (cl >= 24)
core = walk & (cl >= CORE)

lab = np.zeros((ny, nx), np.int32)
n = 0
for j in range(ny):
    for i in range(nx):
        if core[j, i] and lab[j, i] == 0:
            n += 1
            q = deque([(j, i)])
            lab[j, i] = n
            cells = [(j, i)]
            while q:
                a, b = q.popleft()
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c, d = a + da, b + db
                    if 0 <= c < ny and 0 <= d < nx and core[c, d] and lab[c, d] == 0:
                        lab[c, d] = n
                        q.append((c, d))
                        cells.append((c, d))
            if len(cells) < 12:  # a gap behind furniture, not a room
                for c, d in cells:
                    lab[c, d] = -1
lab[lab < 0] = 0
ids = sorted(set(lab[lab > 0].tolist()))
remap = {k: v + 1 for v, k in enumerate(ids)}
lab = np.vectorize(lambda v: remap.get(v, 0))(lab) if ids else lab


def grow(mask):
    q = deque([(j, i) for j in range(ny) for i in range(nx) if lab[j, i] > 0])
    while q:
        a, b = q.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c, d = a + da, b + db
            if 0 <= c < ny and 0 <= d < nx and mask[c, d] and lab[c, d] == 0:
                lab[c, d] = lab[a, b]
                q.append((c, d))


grow(walk)                              # through doors, over the walkable floor
grow(np.ones_like(walk, dtype=bool))    # then walls and furniture, to the nearest room

floor = lv["floor"]
ceil = floor + 3.0
rooms = []
probes = info.get("probes", [])
for r in range(1, len(ids) + 1):
    js, is_ = np.nonzero((lab == r) & walk)
    if not len(js):
        js, is_ = np.nonzero(lab == r)
    xs = x0 + (is_ + 0.5) * step
    ys = y0 - (js + 0.5) * step
    box = [float(xs.min() - step), floor, float(-(ys.max() + step)), float(xs.max() + step), ceil, float(-(ys.min() - step))]
    rooms.append({"id": r, "cells": int(((lab == r) & walk).sum()), "area": round(float(((lab == r) & walk).sum()) * step * step, 1), "box": box, "probes": []})
for k, p in enumerate(probes):
    x, y = p["eye"][0], -p["eye"][2]
    i, j = int((x - x0) / step), int((y0 - y) / step)
    if 0 <= i < nx and 0 <= j < ny and lab[j, i] > 0:
        rooms[lab[j, i] - 1]["probes"].append(k)
for rm in rooms:  # a room no probe was taken in borrows the nearest one
    if not rm["probes"] and probes:
        c = np.array([(rm["box"][0] + rm["box"][3]) / 2, floor + 1.6, (rm["box"][2] + rm["box"][5]) / 2])
        rm["probes"] = [int(np.argmin([np.linalg.norm(np.array(p["eye"]) - c) for p in probes]))]
        rm["borrowed"] = True
json.dump({"x0": x0, "y0": y0, "step": step, "nx": nx, "ny": ny, "labels": base64.b64encode(lab.astype(np.uint8).tobytes()).decode(),
           "rooms": rooms, "core": CORE}, open(out_p, "w"))
print("ROOMS %d: %s" % (len(rooms), ", ".join("#%d %.1f m² %d probes%s" % (r["id"], r["area"], len(r["probes"]), " (borrowed)" if r.get("borrowed") else "") for r in rooms)))
