#!/usr/bin/env python3
"""Splits a Blender render log (look/auto/render.log) into phases per rendered view.

usage: parse_render_log.py render.log

Each render call prints lines like
  Fra:1 Mem:... | Time:00:05.71 | Remaining:... | Scene, ViewLayer | Rendered 0/2 Tiles, Sample 0/128
and ends with "Time: 02:02.23 (Saving: 00:02.30)". Per view this prints:
  sync    = time to the first "Rendered" line (scene update, BVH, textures, kernels)
  trace   = first "Rendered" line to "Finished" (path tracing + denoise of the passes + tile copies)
  post    = "Finished" to the end of the render call (reading the buffer, compositor, saving)
  tiles   = largest N of "Rendered x/N Tiles"
and, when present, the wall-clock of "LOOK_TIME total" (one Blender process).
"""
import re, sys

TIME = re.compile(r"Time:(\d+):(\d+\.\d+)")
END = re.compile(r"^Time: (\d+):(\d+\.\d+) \(Saving: (\d+):(\d+\.\d+)\)")
TILES = re.compile(r"Rendered (\d+)/(\d+) Tiles")


def sec(m, a=1, b=2):
    return int(m.group(a)) * 60 + float(m.group(b))


def main(path):
    rows, cur = [], {"first": None, "fin": None, "tiles": 1, "last": 0.0}
    procs = []
    for line in open(path, errors="replace"):
        m = END.match(line)
        if m:
            total = sec(m)
            first = cur["first"] if cur["first"] is not None else 0.0
            fin = cur["fin"] if cur["fin"] is not None else total
            rows.append({"sync": first, "trace": fin - first, "post": total - fin, "total": total, "save": sec(m, 3, 4), "tiles": cur["tiles"]})
            cur = {"first": None, "fin": None, "tiles": 1, "last": 0.0}
            continue
        if line.startswith("LOOK_TIME total"):
            procs.append(float(line.split()[-1]))
            continue
        t = TIME.search(line)
        if not t:
            continue
        ts = int(t.group(1)) * 60 + float(t.group(2))
        if "Rendered" in line and cur["first"] is None:
            cur["first"] = ts
        tm = TILES.search(line)
        if tm:
            cur["tiles"] = max(cur["tiles"], int(tm.group(2)))
        if line.rstrip().endswith("| Finished") or " | Finished" in line:
            cur["fin"] = ts
    if not rows:
        print("no completed render calls in", path)
        return
    print("view  sync   trace    post   save  total  tiles")
    for i, r in enumerate(rows):
        print("%3d %6.1f %7.1f %7.1f %6.1f %6.1f %5d" % (i, r["sync"], r["trace"], r["post"], r["save"], r["total"], r["tiles"]))
    n = len(rows)
    avg = lambda k: sum(r[k] for r in rows) / n
    print("avg %6.1f %7.1f %7.1f %6.1f %6.1f" % (avg("sync"), avg("trace"), avg("post"), avg("save"), avg("total")))
    if procs:
        print("Blender processes (LOOK_TIME total): %s  sum %.0f s" % (", ".join("%.0f" % p for p in procs), sum(procs)))


if __name__ == "__main__":
    main(sys.argv[1])
