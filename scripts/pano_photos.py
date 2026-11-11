"""
AI photos framed in the 360 (11 Nov, the F5 hero photos): a frame of a finished panorama (a point, a direction, a field of view)
becomes a photoreal 1536x1024 photo through the image gateway, and lands in the project's photos (the Studio's Galerie).

python pano_photos.py <sceneId> '<frames json>' [--yes]
frames: [{"name": "Cuisine", "point": 4, "yaw": 358, "pitch": 1, "vfov": 85}, ...]
  point = the tour view index (its tour/pano-<point>.jpg), yaw/pitch in degrees as the 360 viewer turns (0 = the panorama's
  middle, right is +), vfov = vertical field of view (80-95 frames a room like a photographer's 16-20 mm).
Without --yes it prints the cost (14 DA per image) and spends nothing.
A dark frame (a black kitchen, a room with no window) is exposed brighter before the AI, as a photographer would: the AI keeps
the light it is given.
"""
import datetime, json, os, re, shutil, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DA_PER_IMAGE = 14
scene, frames = sys.argv[1], json.loads(sys.argv[2])
yes = "--yes" in sys.argv
SCENES = os.environ.get("SCENES_DIR") or os.path.join(ROOT, ".scenes")
S = os.path.join(os.path.abspath(SCENES), scene)
WORK = os.path.join(S, "look", "photos-360")
os.makedirs(WORK, exist_ok=True)


def view(pano, yaw, pitch, vfov, w=1536, h=1024):
    P = np.asarray(Image.open(pano).convert("RGB"), np.float32)
    t = np.tan(np.radians(vfov) / 2)
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    X, Y = np.meshgrid(xs * t * w / h, ys * t)
    d = np.stack([X, Y, np.ones_like(X)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p = np.radians(pitch)
    y2 = d[..., 1] * np.cos(p) + d[..., 2] * np.sin(p)
    z2 = -d[..., 1] * np.sin(p) + d[..., 2] * np.cos(p)
    lon = np.arctan2(d[..., 0], z2) + np.radians(yaw)
    lat = np.arcsin(np.clip(y2, -1, 1))
    col = ((lon / (2 * np.pi) + 0.5) % 1) * (P.shape[1] - 1)
    row = (0.5 - lat / np.pi) * (P.shape[0] - 1)
    c0, r0 = np.floor(col).astype(int), np.floor(row).astype(int)
    fc, fr = (col - c0)[..., None], (row - r0)[..., None]
    c1, r1 = (c0 + 1) % P.shape[1], np.minimum(r0 + 1, P.shape[0] - 1)
    out = P[r0, c0] * (1 - fc) * (1 - fr) + P[r0, c1] * fc * (1 - fr) + P[r1, c0] * (1 - fc) * fr + P[r1, c1] * fc * fr
    return out.clip(0, 255) / 255.0


def slug(s):
    s = re.sub(r"[^A-Za-z0-9]+", "_", s.encode("ascii", "ignore").decode() or "photo").strip("_")
    return s or "photo"


print("PHOTOS_360 %d frames x %d DA = %d DA" % (len(frames), DA_PER_IMAGE, len(frames) * DA_PER_IMAGE), flush=True)
views = []
for f in frames:
    pano = os.path.join(S, "tour", "pano-%d.jpg" % int(f["point"]))
    img = view(pano, float(f.get("yaw", 0)), float(f.get("pitch", 0)), float(f.get("vfov", 88)))
    med = float(np.median(img @ np.array([0.2126, 0.7152, 0.0722])))
    if med < 0.36:  # a dark room: brought toward a photographer's exposure (F5 kitchen: median 0.25 -> gamma 0.72)
        g = float(np.clip(np.log(0.42) / np.log(max(med, 1e-3)), 0.6, 1.0))
        img = img ** g
        print("PHOTOS_360 %s exposed brighter (median %.2f, gamma %.2f)" % (f["name"], med, g), flush=True)
    key = slug(f["name"]).lower()
    Image.fromarray((img * 255 + 0.5).astype(np.uint8)).save(os.path.join(WORK, key + "-in.png"))
    views.append({"name": key, "label": f["name"], "frame": f})
json.dump({"views": [{"name": v["name"]} for v in views]}, open(os.path.join(WORK, "views.json"), "w"))
if not yes:
    raise SystemExit("not spending: the frames are in %s; run again with --yes" % WORK)
subprocess.run(["npx", "tsx", "--env-file=.env.local", "scripts/pano-tiles-gateway.mts", WORK, "1536x1024"], cwd=ROOT, check=True)
# into the project's photos: the Galerie lists them, runs.jsonl keeps how each was made (feedback later)
photos = os.path.join(S, "photos")
os.makedirs(photos, exist_ok=True)
now = datetime.datetime.now(datetime.timezone.utc)
with open(os.path.join(S, "runs.jsonl"), "a") as log:
    for k, v in enumerate(views):
        src = os.path.join(WORK, v["name"] + "-ai.jpg")
        if not os.path.exists(src):
            print("PHOTOS_360 %s: no image (gateway failed), nothing charged for it" % v["label"], flush=True)
            continue
        at = now + datetime.timedelta(seconds=k)
        name = "%s-%s.jpg" % (at.strftime("%Y-%m-%dT%H-%M-%S-") + "%03dZ" % (at.microsecond // 1000), slug(v["label"]))
        shutil.copyfile(src, os.path.join(photos, name))
        log.write(json.dumps({"at": at.strftime("%Y-%m-%dT%H:%M:%S.000Z"), "ok": True, "photoFile": "photos/" + name, "view": v["label"], "time": "apres-midi",
                              "lens": "360", "quality": "high", "source": "360", "frame": v["frame"], "fellBack": False}, ensure_ascii=False) + "\n")
        print("PHOTOS_360 installed", name, flush=True)
print("PHOTOS_360_DONE", flush=True)
