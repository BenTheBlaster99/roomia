"""
The AI finish of the 360 views of a scene. Since 15 Nov the view's 360 IS the AI image (the user: never show Blender's work).
Before (12 Nov, still with --transfer): "Blender + AI light": per view, one AI pass over the whole panorama
(pano-sunburst.mts, 2560x1280, 16 DA) is used ONLY as the light and colour source; Blender keeps every object and texture
(pano_look_transfer.py: alignment, guided gain, colour from the room tint, dehaze).

python pano_ai_light.py <sceneId> --views 0,2,6 --refs '{"0": "photos/x.jpg", ...}' [--default-ref photos/y.jpg] [--auto auto-f] --yes
python pano_ai_light.py --scene-dir <dir> --views 0,2,6 --auto auto --finish-only   (the app: the AI images are already in
       look/sunburst/pano-k-sunburst-2560.jpg, made by lib/look-pipeline.ts; free)
Without --yes it prints the cost and spends nothing. Per view k, in tour/: pano-k-before-sunburst.jpg (the Blender 360, kept once),
pano-k-ai-orig.jpg / pano-k-ai-light.jpg (for the comparison page), pano-k.jpg replaced by the result.
Run with the AI python from the repo root.
"""
import argparse, json, os, shutil, subprocess, sys, time
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("scene", nargs="?")
ap.add_argument("--scene-dir")
ap.add_argument("--finish-only", action="store_true", help="no AI call: only the views whose AI image exists")
ap.add_argument("--views", required=True)
ap.add_argument("--refs", default="{}")
ap.add_argument("--default-ref")
ap.add_argument("--auto", default="auto-f")
ap.add_argument("--yes", action="store_true")
ap.add_argument("--transfer", action="store_true", help="the 12 Nov way: only the AI's light, put on Blender's pixels")
ap.add_argument("--stream", action="store_true", help="21 Nov: the transfer for a view still being rendered with the others: reads look/<auto>/stream/pano-k.jpg, writes look/<auto>/stream/final-k.jpg, never touches the tour")
ap.add_argument("--promote", action="store_true", help="21 Nov: puts the streamed finished pictures in the tour where the group exposure left their Blender picture unchanged (byte for byte)")
args = ap.parse_args()
S = os.path.abspath(args.scene_dir) if args.scene_dir else os.path.join(os.path.abspath(os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")), args.scene)
T, D = os.path.join(S, "tour"), os.path.join(S, "look", "sunburst")
os.makedirs(D, exist_ok=True)
views = [int(v) for v in args.views.split(",")]
refs = {int(k): v for k, v in json.loads(args.refs).items()}
STREAM = os.path.join(S, "look", args.auto, "stream")
if args.promote:
    # A streamed picture was made from the view's own exposure while the render went on. The group exposure at the end of the render
    # (look_pipeline.py finalize + install) gives most views the very same Blender picture; for those the finished picture is valid as it
    # is, and is put in the tour exactly as the normal step would leave it. Any view whose Blender picture changed is left to the normal step.
    for k in views:
        sp, fin, cur = (os.path.join(STREAM, "pano-%d.jpg" % k), os.path.join(STREAM, "final-%d.jpg" % k), os.path.join(T, "pano-%d.jpg" % k))
        if not (os.path.exists(sp) and os.path.exists(fin) and os.path.exists(cur)) or open(sp, "rb").read() != open(cur, "rb").read():
            print("PROMOTE_SKIP %d" % k, flush=True)
            continue
        before = os.path.join(T, "pano-%d-before-sunburst.jpg" % k)
        shutil.copyfile(cur, before)
        shutil.copyfile(before, os.path.join(T, "pano-%d-ai-orig.jpg" % k))
        shutil.copyfile(fin, os.path.join(T, "pano-%d-ai-light.jpg" % k))
        shutil.copyfile(fin, cur)
        print("PROMOTED %d" % k, flush=True)
    sys.exit(0)
print("AI_LIGHT %d views, %s" % (len(views), "free (AI images already made)" if args.finish_only else "x 16 DA = %d DA" % (16 * len(views))), flush=True)
if not args.yes and not args.finish_only:
    sys.exit(0)
PY = sys.executable
done = []
for k in views:
    t0 = time.time()
    if args.stream:
        blender = os.path.join(STREAM, "pano-%d.jpg" % k)
    else:
        blender = os.path.join(T, "pano-%d-before-sunburst.jpg" % k)
        cur, done_light = os.path.join(T, "pano-%d.jpg" % k), os.path.join(T, "pano-%d-ai-light.jpg" % k)
        # the Blender 360 kept once; a view rendered again since (pano-k.jpg is not our last result) is taken afresh
        same = os.path.exists(done_light) and open(cur, "rb").read() == open(done_light, "rb").read()
        if not os.path.exists(blender) or not same:
            shutil.copyfile(cur, blender)
    raw = os.path.join(D, "pano-%d-sunburst-2560.jpg" % k)
    if not os.path.exists(raw) and args.finish_only:
        print("AI_LIGHT view %d: no AI image, skipped" % k, flush=True)
        continue
    if not os.path.exists(raw):
        ref = refs.get(k) or args.default_ref
        ref = ref if os.path.isabs(ref) else os.path.join(S, ref)
        r = subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/pano-sunburst.mts", blender, ref, raw, "2560x1280", "high"], cwd=ROOT, capture_output=True, text=True)
        line = [l for l in r.stdout.splitlines() if l.startswith("SUNBURST")]
        if r.returncode or not os.path.exists(raw):
            print("AI_LIGHT view %d: the AI pass failed: %s" % (k, (r.stderr or r.stdout).strip()[-300:]), flush=True)
            continue
        print("AI_LIGHT view %d: AI pass %s" % (k, line[0][9:120] if line else "ok"), flush=True)
    # the left and right edges are one direction: blend the AI's small mismatch away
    P = np.asarray(Image.open(raw).convert("RGB"), np.float32)
    n = 48
    d = (P[:, -1] - P[:, 0])[:, None, :]
    w = (1 - np.arange(n) / n)[None, :, None] * 0.5
    P[:, :n] += d * w
    P[:, -n:] -= d * w[:, ::-1]
    seam = os.path.join(D, "pano-%d-sunburst-2560-seam.jpg" % k)
    Image.fromarray(P.clip(0, 255).astype(np.uint8)).save(seam, quality=94)
    # 15 Nov, the user: the client never sees Blender's work, the 360 IS the AI's final image (Sarah: "the AI changed nothing" —
    # the light alone on Blender's pixels still looked like Blender). The old transfer stays behind --transfer.
    out, info = seam, "AI image"
    if args.transfer:
        out = os.path.join(STREAM, "final-%d.jpg" % k) if args.stream else os.path.join(D, "pano-%d-light.jpg" % k)
        lin = os.path.join(S, "look", args.auto, "t%d-lin.npy" % k)
        # 18 Nov: 0.05..20 pasted the AI's own shadows onto Blender (dark blotches on ceilings, TVs, walls wherever the AI drew a
        # thing elsewhere). The AI now only moves an area's light between 0.75x and 1.6x, over broad zones (radius 96): its warmth and
        # brightness, never a spot; every texture stays Blender's (the user: the architect's textures exactly)
        cmd = [PY, os.path.join(ROOT, "scripts", "pano_look_transfer.py"), blender, seam, out, "--gain-min", "0.75", "--gain-max", "1.6", "--radius", "96"]
        if os.path.exists(lin):
            cmd += ["--blender-linear", lin]
        r = subprocess.run(cmd, capture_output=True, text=True)
        info = " | ".join(l for l in r.stdout.splitlines() if l.startswith(("LOOK_DEHAZE", "LOOK_TRANSFER")))
        if r.returncode or not os.path.exists(out):
            print("AI_LIGHT view %d: the transfer failed: %s" % (k, r.stderr.strip()[-300:]), flush=True)
            continue
    if args.stream:
        done.append(k)
        print("STREAM_FINAL %d done in %.0f s (%s)" % (k, time.time() - t0, info), flush=True)
        continue
    shutil.copyfile(blender, os.path.join(T, "pano-%d-ai-orig.jpg" % k))
    shutil.copyfile(out, os.path.join(T, "pano-%d-ai-light.jpg" % k))
    shutil.copyfile(out, os.path.join(T, "pano-%d.jpg" % k))
    done.append(k)
    print("AI_LIGHT view %d done in %.0f s (%s)" % (k, time.time() - t0, info), flush=True)
print("AI_LIGHT_DONE %d of %d views: %s" % (len(done), len(views), done), flush=True)
