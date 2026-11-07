"""
The apartment's exposure (8 Nov): the median of light x colour over every panorama of the capture (surfaces only), so
the walk exposes the whole apartment once instead of re-exposing every view. Writes "exposure" into the splat jsons.

python look_exposure.py <capture dir> <splat.json> [<rgb key>] ...   (pairs: json, key)
"""
import json, os, sys
import numpy as np
cap = sys.argv[1]
meta = json.load(open(os.path.join(cap, "panos.json")))
pairs = sys.argv[2:]
for jpath, key in zip(pairs[::2], pairs[1::2]):
    vals = []
    for p in meta["panos"][::2]:
        z = np.load(os.path.join(cap, p["file"]))
        rgb = z[key][::6, ::6].astype(np.float32)
        surf = (z["depth"][::6, ::6].astype(np.float32) < 40) & (z["albedo"][::6, ::6].astype(np.float32).max(-1) > 0.02)
        y = rgb[surf] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        vals.append(y[y > 0])
    med = float(np.median(np.concatenate(vals)))
    d = json.load(open(jpath))
    d["exposure"] = 0.18 / med
    json.dump(d, open(jpath, "w"), indent=1)
    print("EXPOSURE %s %s median %.4f -> %.3f" % (os.path.basename(jpath), key, med, d["exposure"]))
