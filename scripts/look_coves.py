"""
LED lines from the reference (7 Nov, Phase 1): a line drawn on the reference image (pixels) becomes a 3D strip light. The
reference camera's position and normal passes (look_patch.py's ref.exr) give the surface under the line; a straight line
is fitted through those points and the strip sits along it, a few centimetres off the surface and under the ceiling,
shining down (a cove washing the wall).

blender -b --python look_coves.py -- <job.json>
job: {exr, refWidth, refHeight, lines: [{name, from: [x, y], to: [x, y], below: px, off: m, down: m}], out}
"""
import json, math, sys
import numpy as np
from mathutils import Matrix, Vector

J = json.load(open(sys.argv[sys.argv.index("--") + 1]))
import OpenImageIO as oiio  # noqa: E402

inp = oiio.ImageInput.open(J["exr"])
s = inp.spec()
names = list(s.channelnames)
px = inp.read_image(0, 0, 0, len(names), "float").reshape(s.height, s.width, len(names))
inp.close()
P = px[..., [names.index("ViewLayer.Position." + c) for c in "XYZ"]]
N = px[..., [names.index("ViewLayer.Normal." + c) for c in "XYZ"]]
sx, sy = s.width / J["refWidth"], s.height / J["refHeight"]
out = []
for ln in J["lines"]:
    a, b = np.array(ln["from"], float), np.array(ln["to"], float)
    k = max(8, int(np.linalg.norm(b - a) / 6))
    pts, nrm = [], []
    for t in np.linspace(0.02, 0.98, k):
        x, y = a + (b - a) * t
        y += ln.get("below", 4)
        i, j = int(x * sx), int(y * sy)
        if 0 <= i < s.width and 0 <= j < s.height:
            pts.append(P[j, i])
            nrm.append(N[j, i])
    pts, nrm = np.array(pts), np.array(nrm)
    # robust straight line: drop the points far from the median plane height and the first fit
    c = np.median(pts, 0)
    u, sv, vt = np.linalg.svd(pts - c)
    d = vt[0]
    res = np.linalg.norm((pts - c) - np.outer((pts - c) @ d, d), axis=1)
    keep = res < max(0.05, np.percentile(res, 70) * 2)
    pts, nrm = pts[keep], nrm[keep]
    c = pts.mean(0)
    d = np.linalg.svd(pts - c)[2][0]
    tt = (pts - c) @ d
    p0, p1 = c + d * tt.min(), c + d * tt.max()
    n = np.median(nrm, 0)
    n[2] = 0
    n = n / max(1e-6, np.linalg.norm(n)) if np.linalg.norm(n) > 0.3 else np.zeros(3)
    mid = (p0 + p1) / 2 + n * ln.get("off", 0.05) - np.array([0, 0, ln.get("down", 0.03)])
    X = Vector((p1 - p0).tolist()).normalized()
    Z = Vector((0, 0, 1))
    if abs(X.dot(Z)) > 0.9:
        Z = Vector(n.tolist())
    X = (X - Z * X.dot(Z)).normalized()
    Y = Z.cross(X)
    R = Matrix((X, Y, Z)).transposed()
    length = float(np.linalg.norm(p1 - p0))
    e = R.to_euler()
    out.append({"name": ln["name"], "location": [float(v) for v in mid], "rotation": [math.degrees(v) for v in e],
                "size": [length, float(ln.get("width", 0.03))], "normal": [float(v) for v in n], "points": int(len(pts))})
    print("COVE %s %.2f m at %s from %d points" % (ln["name"], length, [round(float(v), 2) for v in mid], len(pts)), flush=True)
json.dump(out, open(J["out"], "w"), indent=1)
