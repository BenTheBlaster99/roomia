"""
Between two points the render scripts wait while the server asks for a rest (9 Nov 2026).

lib/blender-guard.ts writes two flag files in ROOMIA_FLAG_DIR while a job runs:
  cool.flag   the graphics card is hot: let it cool before the next point
  pause.flag  the person pressed "Pause after this point"
A flag counts only while its modification time is recent (the server touches it every 5 s): a server that died cannot leave a
render waiting for ever. Without ROOMIA_FLAG_DIR (a run by hand) nothing waits.
"""
import os, sys, time

FRESH_S = 25


def _live(path):
    try:
        return time.time() - os.path.getmtime(path) < FRESH_S
    except OSError:
        return False


def wait_between_points(label=""):
    d = os.environ.get("ROOMIA_FLAG_DIR")
    if not d:
        return 0.0
    cool, pause = os.path.join(d, "cool.flag"), os.path.join(d, "pause.flag")
    t0 = time.time()
    announced = False
    while _live(cool) or _live(pause):
        if not announced:
            print("ROOMIA_WAIT %s %s" % ("pause" if _live(pause) else "cool", label), flush=True)
            announced = True
        time.sleep(2)
    waited = time.time() - t0
    if announced:
        print("ROOMIA_WAIT_END %.0fs" % waited, flush=True)
    return waited
