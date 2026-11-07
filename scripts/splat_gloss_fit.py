"""
Gloss strength per material (7 Nov, ChatGPT step 4): the walk's own reflections (read back from the real walk at the
capture's test views) fitted to Cycles' glossy pass, per material (the test views carry material ids), shrunk toward
the global factor for materials seen little; half the views fit, the other half check. Writes glossScale into the
walk's materials.json.

python splat_gloss_fit.py <capture dir> <spec dir (spec-<t>.f32)> <materials.json to update> <t,t,t fit> <t,t,t check>
"""
import json, os, sys
import numpy as np

cap, specdir, mats_path, fit_s, val_s = sys.argv[1:6]
fit, val = [int(x) for x in fit_s.split(",")], [int(x) for x in val_s.split(",")]
meta = json.load(open(os.path.join(cap, "panos.json")))
ids = {int(k): v for k, v in json.load(open(os.path.join(cap, "material-ids.json"))).items()}
LUM = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(t):
    z = np.load(os.path.join(cap, meta["tests"][t]["file"]))
    g = z["gloss"].astype(np.float32) @ LUM
    surf = z["depth"].astype(np.float32) < 40
    n = int(np.sqrt(os.path.getsize(os.path.join(specdir, "spec-%d.f32" % t)) // 12))
    w = np.fromfile(os.path.join(specdir, "spec-%d.f32" % t), np.float32).reshape(n, n, 3)[::-1] @ LUM
    return g, w, z["mat"], surf


num, den, cnt = {}, {}, {}
for t in fit:
    g, w, mat, surf = load(t)
    for k in np.unique(mat[surf]):
        s = (mat == k) & surf
        num[k] = num.get(k, 0) + float((w[s] * g[s]).sum())
        den[k] = den.get(k, 0) + float((w[s] ** 2).sum())
        cnt[k] = cnt.get(k, 0) + int(s.sum())
glob = sum(num.values()) / max(sum(den.values()), 1e-12)
scale = {}
for k in num:
    a = cnt[k] / (cnt[k] + 20000.0)
    local = num[k] / den[k] if den[k] > 0 else glob
    scale[int(k)] = float(np.clip(a * local + (1 - a) * glob, 0, 2))


def err(ts, sc):
    e0 = e1 = e2 = tot = 0.0
    for t in ts:
        g, w, mat, surf = load(t)
        f = np.vectorize(lambda k: sc.get(int(k), glob))(mat)
        e0 += np.abs(w - g)[surf].sum()
        e1 += np.abs(w * f - g)[surf].sum()
        e2 += np.abs(g)[surf].sum()  # no gloss at all
        tot += g[surf].sum()
    return round(e0 / tot, 3), round(e1 / tot, 3), round(e2 / tot, 3)


mats = json.load(open(mats_path))
for k, v in scale.items():
    if ids.get(k) in mats:
        mats[ids[k]]["glossScale"] = round(v, 4)
json.dump(mats, open(mats_path, "w"))
r = {"global": round(glob, 4), "materials": len(scale), "fit_err_raw_fitted_none": err(fit, scale), "check_err_raw_fitted_none": err(val, scale)}
print("GLOSSFIT", json.dumps(r))
