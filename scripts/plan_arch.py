"""
The architect's plan, drawing half (11 Nov): from plan_capture.py's cut (plan-cut.npy, plan-objects.json) and the tour's top
view (plan-hd.png, same pixels), a finished 2D plan: wall poché, windows, door swings, rooms with their names and areas
(m²), each room's inner size, the overall dimensions, a scale bar, a north arrow and a title block. Two styles:
"rendu" (the furnished top view under the drawing) and "technique" (white floors, furniture as thin cut lines).

python plan_arch.py <capture dir> <top view png> <out prefix> '<json options>'
options: {title, subtitle, apt (mask png, optional), names: {roomIndex: name} (overrides), style: rendu|technique|both}
Writes <out>-rendu.png, <out>-technique.png, <out>.pdf (A3, both pages), <out>-rooms.json
"""
import json, math, os, re, sys
import numpy as np
from scipy import ndimage as ndi
from PIL import Image, ImageDraw, ImageFont

CAP, TOP, OUTP = sys.argv[1], sys.argv[2], sys.argv[3]
OPT = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
S = np.load(os.path.join(CAP, "plan-cut.npy"))
META = json.load(open(os.path.join(CAP, "plan-objects.json")))
MPP = float(META["mpp"])
PXM = 1.0 / MPP  # pixels per metre
W, H = int(META["width"]), int(META["height"])
OBJ = {o["id"]: o for o in META["objects"]}


def dil(mask, r):
    return ndi.distance_transform_edt(~mask) <= r


def ero(mask, r):
    return ndi.distance_transform_edt(mask) > r


def m(px):
    return int(round(px * PXM))


FONT_DIR = "/usr/share/fonts/truetype/dejavu"


def font(size, bold=False):
    return ImageFont.truetype(os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"), int(size))


# ---------------------------------------------------------------- doors: thin, tall, door-wide objects (closed leaves)
DOOR_RX = re.compile(r"door|porte|puerta|tür|leaf|battant|vantail", re.I)
NOT_DOOR_RX = re.compile(r"cabinet|placard|armoire|wardrobe|dressing|kitchen|cuisine|drawer|tiroir|shower|douche|glass|verre|vitre|window|fen", re.I)
door_ids = set()
for o in META["objects"]:
    thin, long_ = min(o["w"], o["h"]) * MPP, max(o["w"], o["h"]) * MPP
    txt = " ".join([o["name"], o["data"], o["parent"]] + o["mats"])
    tall = 1.85 <= o["zmax"] - o["zmin"] <= 2.6 and o["zmin"] < 0.15
    if tall and thin <= 0.09 and 0.55 <= long_ <= 1.3 and (DOOR_RX.search(txt) or not NOT_DOOR_RX.search(txt)):
        door_ids.add(o["id"])
is_door = np.isin(S[:, 6].astype(int), list(door_ids)) if door_ids else np.zeros(len(S), bool)

# ---------------------------------------------------------------- rasters
tall, glass = S[:, 4] > 0.5, S[:, 5] > 0.5


def raster(sel, thick=1):
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    for x0, y0, x1, y1 in S[sel][:, :4]:
        dr.line([(float(x0), float(y0)), (float(x1), float(y1))], fill=255, width=thick)
    return np.asarray(img) > 0


# a wall runs from the floor to the ceiling; a wardrobe or a tall cabinet stops short: drawn as an outline, never as poché
full = tall.copy()
CEIL = None
if S.shape[1] >= 9 and tall.any():
    seglen = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
    hist, edges = np.histogram(S[tall, 8], bins=np.arange(1.8, 4.5, 0.05), weights=seglen[tall])
    CEIL = float(edges[int(hist.argmax())] + 0.025)
    # (the ceiling estimate is kept in the report; splitting walls by it failed on F5: wall faces are cut into triangles at door
    # and window heights, so many real wall triangles stop short too. Shape decides instead, below.)
cab_lines = raster(tall & ~full & ~glass & ~is_door, 2)
wall_lines = raster(full & ~glass & ~is_door)
glass_lines = raster(glass, 2)
furn_lines = raster(~tall & ~glass)
door_lines = raster(is_door)

# the top view (the drawing's background; its alpha can give the apartment's outline)
top = Image.open(TOP)
if top.size != (W, H):
    top = top.resize((W, H), Image.LANCZOS)
# The geometry (wall poché, rooms, enclosed pockets) is the slow part of a pass (about 20 of 32 s) and does not depend on the room names: plan_build.py
# draws twice (numbers, then the AI's names), so the first pass saves it and the second one reads it back (12 Nov, docs/PLAN-performance.md).
import hashlib
_h = hashlib.sha1(b'plan-geometry-v1|%d' % int(os.environ.get('ROOMIA_PLAN_GROW_DS', '2')))
for _f in (os.path.join(CAP, 'plan-cut.npy'), os.path.join(CAP, 'plan-objects.json'), TOP, OPT.get('apt') or ''):
    if _f and os.path.exists(_f):
        with open(_f, 'rb') as _fh:
            for _blk in iter(lambda: _fh.read(1 << 22), b''):
                _h.update(_blk)
GEOM_CACHE = os.path.join(CAP, 'plan-geometry-cache.npz')
_hit = False
if os.path.exists(GEOM_CACHE):
    try:
        with np.load(GEOM_CACHE) as _z:
            if str(_z['key']) == _h.hexdigest():
                wall, rooms, holes = _z['wall'], _z['rooms'], _z['holes']
                inside = rooms > 0
                labels = [i for i in np.unique(rooms) if i > 0]
                _hit = True
                print('PLAN_INFO geometry read from the first pass', flush=True)
    except Exception:
        _hit = False
if not _hit:
    # wall poché: the faces of a wall closed into a solid; any thin pocket (no point more than 25 cm from its edge) is wall
    closed = ero(dil(wall_lines, m(0.13)), m(0.13)) | wall_lines  # the two faces of a wall up to 26 cm thick join into one solid
    lab, n = ndi.label(~closed)
    dt = ndi.distance_transform_edt(~closed)
    mx = ndi.maximum(dt, lab, index=np.arange(1, n + 1))
    area = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    thin_pocket = np.zeros(n + 1, bool)
    # a wall's cavity is long and thin; a wardrobe's compartment is short and boxy (F5 bedrooms, 11 Nov): only the long ones are poché
    thin_pocket[1:] = (mx <= m(0.22)) & (area * MPP * MPP < 6.0) & (area / np.maximum(2 * mx, 1) ** 2 >= 3.0)
    for b in border:
        thin_pocket[b] = False
    wall = closed | thin_pocket[lab]
    wall = ndi.binary_opening(wall, np.ones((3, 3), bool))

    # the apartment: the given mask, else the top view's alpha, else everything enclosed by walls
    apt = None
    if OPT.get("apt") and os.path.exists(OPT["apt"]):
        a = np.asarray(Image.open(OPT["apt"]).convert("L").resize((W, H), Image.NEAREST)) > 127
        apt = a
    if apt is None and top.mode == "RGBA":
        apt = np.asarray(top)[..., 3] > 10
    if apt is None:
        tg = np.asarray(top.convert("L"))
        apt = tg < 250
    # the inside: the apartment's walkable outline (the tour's survey), a little grown so it meets the walls' faces
    barrier = wall | door_lines | ndi.binary_dilation(glass_lines, iterations=2)
    inside = dil(apt, m(0.15)) & ~wall

    # keep only wall that borders the inside (no fences, terraces or neighbours' walls far away)
    near_in = dil(inside, m(0.3))
    wall &= near_in

    # ---------------------------------------------------------------- rooms
    free = inside & ~barrier
    seeds = free & ~dil(barrier, m(0.55))  # closes any opening up to 1.1 m: doors split rooms
    slab, ns = ndi.label(seeds)
    sareas = ndi.sum(np.ones_like(slab), slab, index=np.arange(1, ns + 1)) * MPP * MPP
    keep = np.zeros(ns + 1, np.int32)
    k = 0
    for i, a in enumerate(sareas, 1):
        if a >= 0.25:
            k += 1
            keep[i] = k
    slab = keep[slab]
    # grow the seeds over the free floor without crossing walls (geodesic: repeated small dilations, at half size)
    DS = int(os.environ.get("ROOMIA_PLAN_GROW_DS", "2"))  # 4: quarter size (about 4x less work), to be compared mask against mask before it becomes the default
    rs, fs = slab[::DS, ::DS].copy(), free[::DS, ::DS]
    for _ in range(m(0.75) // DS + 2):  # from the seeds to the wall faces, not through a window's gap to the outside
        grown = ndi.grey_dilation(rs, size=(3, 3))
        fill = (rs == 0) & fs & (grown > 0)
        if not fill.any():
            break
        rs[fill] = grown[fill]
    rooms = np.repeat(np.repeat(rs, DS, 0), DS, 1)[:H, :W]
    rooms[~free] = 0
    # what the half-size pass left out (wall faces, a pixel here and there): the nearest room
    _, (iy, ix) = ndi.distance_transform_edt(rooms == 0, return_indices=True)
    near = rooms[iy, ix]
    rooms = np.where(inside & (rooms == 0) & dil(rooms > 0, m(0.12)), near, rooms)
    rooms[~inside] = 0
    # a room too narrow for a seed (a WC 1.1 m wide, a shower room behind the kitchen): its own enclosed floor, if it is one
    rest, nr = ndi.label(free & (rooms == 0) & ~dil(barrier, m(0.2)))
    if nr:
        rareas = ndi.sum(np.ones_like(rest), rest, index=np.arange(1, nr + 1)) * MPP * MPP
        for j, a in enumerate(rareas, 1):
            if a >= 1.0:
                k += 1
                comp = dil(rest == j, m(0.2)) & free & (rooms == 0)
                rooms[comp] = k
    ids = [i for i in range(1, k + 1)]
    # a room is never smaller than 1 m²: merged into the neighbour it touches most
    for i in ids:
        mask = rooms == i
        if mask.sum() * MPP * MPP >= 1.0:
            continue
        ring = ndi.binary_dilation(mask, iterations=2)
        nb = rooms[ring & ~mask]
        nb = nb[nb > 0]
        if len(nb):
            rooms[mask] = np.bincount(nb).argmax()
        else:
            rooms[mask] = 0
    labels = [i for i in np.unique(rooms) if i > 0]
    # what is drawn as the apartment: the rooms, and the walls that bound them
    inside = rooms > 0
    wall &= dil(inside, m(0.45))
    # the small enclosed spaces no room took (a cupboard, a duct, a strip behind a wardrobe): drawn, never left white (11 Nov)
    holes = ndi.binary_fill_holes(inside | wall) & ~inside & ~wall
    np.savez(GEOM_CACHE, key=np.array(_h.hexdigest()), wall=wall, rooms=rooms, holes=holes)

# ---------------------------------------------------------------- room names from what stands in them
VOTES = [
    ("Salle de bain", r"bath|baignoire|tub|shower|douche|vasque|basin|lavabo|sink.*bath|towel|serviette|toilet|wc|bidet|mirror|miroir"),
    ("Cuisine", r"kitchen|cuisine|oven|four|fridge|frigo|refrig|hob|cooktop|plaque|hotte|hood|dishwasher|lave.?vaisselle|evier|microwave"),
    ("Chambre", r"\bbed\b|bed[ _-]|lit\b|matelas|mattress|nightstand|chevet|headboard|t[eê]te de lit|duvet|pillow|oreiller"),
    ("Séjour", r"sofa|canap|couch|tv|t[eé]l[eé]|television|armchair|fauteuil|coffee.?table|table.?basse|meuble.?tv"),
    ("Salle à manger", r"dining|salle.?a.?manger|chair|chaise"),
    ("Dressing", r"dressing|wardrobe|armoire|closet|penderie|hanger|cintre"),
    ("Bureau", r"desk|bureau|office"),
]
WC_RX = re.compile(r"toilet|wc|bidet|cuvette", re.I)
votes = {i: {} for i in labels}
for o in META["objects"]:
    cx, cy = int(o["cx"]), int(o["cy"])
    if not (0 <= cx < W and 0 <= cy < H):
        continue
    r = rooms[cy, cx]
    if r == 0:
        continue
    txt = " ".join([o["name"], o["data"], o["parent"]] + o["mats"]).lower()
    for name, rx in VOTES:
        if re.search(rx, txt):
            votes[r][name] = votes[r].get(name, 0) + 1
    if WC_RX.search(txt):
        votes[r]["_wc"] = votes[r].get("_wc", 0) + 1

info = []
for i in labels:
    mask = rooms == i
    a = float(mask.sum() * MPP * MPP)
    dtm = ndi.distance_transform_edt(mask)
    y, x = np.unravel_index(int(dtm.argmax()), dtm.shape)
    ys_r, xs_r = np.nonzero(mask)
    pts_r = np.stack([xs_r, ys_r], 1).astype(np.float32)[:: max(1, len(xs_r) // 20000)]
    pts_r -= pts_r.mean(0)
    _, _, vt_r = np.linalg.svd(pts_r, full_matrices=False)
    pr = pts_r @ vt_r.T
    dims = sorted([float(np.percentile(pr[:, 0], 99.5) - np.percentile(pr[:, 0], 0.5)) * MPP, float(np.percentile(pr[:, 1], 99.5) - np.percentile(pr[:, 1], 0.5)) * MPP])
    v = {k_: c for k_, c in votes[i].items() if not k_.startswith("_")}
    order = {"Salle de bain": 6, "Cuisine": 5, "Chambre": 4, "Séjour": 3, "Salle à manger": 2, "Dressing": 1, "Bureau": 1}
    name = max(v, key=lambda k_: (v[k_], order.get(k_, 0))) if v else None
    if name == "Salle de bain" and a < 3.0 and votes[i].get("_wc") and not re.search("", ""):
        name = "WC"
    if name is None:
        elong = dims[1] / max(dims[0], 0.1)
        name = "Dégagement" if (a < 8 and elong > 2.2) or dims[0] < 1.3 else ("Rangement" if a < 3 else "Pièce")
    info.append({"id": int(i), "name": name, "area": round(a, 1), "label": [int(x), int(y)], "dims": [round(dims[1], 2), round(dims[0], 2)], "clear": float(dtm.max() * MPP)})
NAMES = dict(OPT.get("names", {}))
if OPT.get("namesFile") and os.path.exists(OPT["namesFile"]):
    NAMES.update(json.load(open(OPT["namesFile"])))
for r in info:
    if str(r["id"]) in NAMES:
        r["name"] = NAMES[str(r["id"])]
# size rules the AI does not always keep (11 Nov, F5): a room under 5 m² is never the kitchen or the living room; the largest
# room is the Séjour (with the kitchen when kitchen units stand in it, or the AI saw the kitchen in a nook that cannot be one)
LIVING = ("Cuisine", "Séjour", "Salle à manger", "Séjour / Cuisine")
kitchen_seen = False
for r in info:
    if r["area"] < 5 and r["name"] in LIVING:
        kitchen_seen |= r["name"] == "Cuisine"
        r["name"] = "Rangement"
if info:
    big = max(info, key=lambda r: r["area"])
    if big["area"] >= 25 and not big["name"].startswith("Séjour"):
        has_kitchen = kitchen_seen or big["name"] == "Cuisine" or votes.get(big["id"], {}).get("Cuisine", 0) > 0
        big["name"] = "Séjour / Cuisine" if has_kitchen or big["name"] == "Salle à manger" else "Séjour"
# numbered when a name repeats (Chambre 1, Chambre 2), the largest first
for nm in set(r["name"] for r in info):
    same = sorted([r for r in info if r["name"] == nm], key=lambda r: -r["area"])
    if len(same) > 1 and nm not in ("Dégagement", "Rangement"):
        for k_, r in enumerate(same, 1):
            r["name"] = "%s %d" % (nm, k_)
info.sort(key=lambda r: (r["label"][1], r["label"][0]))

# ---------------------------------------------------------------- doors: leaves found above, and gaps between two rooms
doors = []
for did in door_ids:
    seg = S[(S[:, 6] == did)][:, :4]
    if not len(seg):
        continue
    pts = seg.reshape(-1, 2)
    c = pts.mean(0)
    u, s_, vt = np.linalg.svd(pts - c)
    ax = vt[0]
    proj = (pts - c) @ ax
    a_, b_ = c + ax * proj.min(), c + ax * proj.max()
    doors.append((a_, b_))
# gaps: where two rooms meet across no wall, 0.6 to 1.4 m wide
# each room dilated once, not once per pair (12 Nov profile: 55 full-image dilations were 8 s of 32)
_grown = {i: ndi.binary_dilation(rooms == i) for i in labels}
for i in labels:
    for j in labels:
        if j <= i:
            continue
        touch = _grown[i] & (rooms == j)
        if touch.sum() < 3:
            continue
        ys, xs = np.nonzero(touch)
        pts = np.stack([xs, ys], 1).astype(np.float32)
        c = pts.mean(0)
        _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
        proj = (pts - c) @ vt[0]
        width = (proj.max() - proj.min()) * MPP
        if 0.6 <= width <= 1.4 and not any(np.linalg.norm((a_ + b_) / 2 - c) < m(0.6) for a_, b_ in doors):
            doors.append((c + vt[0] * proj.min(), c + vt[0] * proj.max()))

# ---------------------------------------------------------------- drawing
MARGIN = m(2.4)
SIDE = m(6.5)  # the room table and title block on the right
ys_, xs_ = np.nonzero(wall | inside)
bx0, by0, bx1, by1 = xs_.min(), ys_.min(), xs_.max(), ys_.max()
CW, CH = (bx1 - bx0) + 2 * MARGIN + SIDE, (by1 - by0) + 2 * MARGIN
ox, oy = MARGIN - bx0, MARGIN - by0
FS = max(12, m(0.24))  # label size: 24 cm on the ground


def draw_plan(style):
    canvas = Image.new("RGB", (CW, CH), (255, 255, 255))
    inner = inside | wall
    if style == "rendu":
        t = top.convert("RGBA")
        arr = np.asarray(t).astype(np.float32)
        rgb = arr[..., :3]
        g = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        rgb = rgb * 0.82 + g[..., None] * 0.18  # a little less saturated, a little lighter: the drawing reads on top
        rgb = 255 - (255 - rgb) * 0.85
        a = ((inside | holes)[..., None]).astype(np.float32)
        img = (rgb * a + 255 * (1 - a)).clip(0, 255).astype(np.uint8)
        canvas.paste(Image.fromarray(img[by0:by1 + 1, bx0:bx1 + 1]), (MARGIN, MARGIN))
    else:
        fl = np.full((H, W, 3), 255, np.uint8)
        fl[inside] = (250, 249, 246)
        fl[holes] = (232, 230, 225)
        fl[ndi.binary_dilation(furn_lines) & inside] = (150, 150, 150)
        canvas.paste(Image.fromarray(fl[by0:by1 + 1, bx0:bx1 + 1]), (MARGIN, MARGIN))
    arr = np.asarray(canvas).copy()
    sub = (slice(MARGIN, MARGIN + by1 - by0 + 1), slice(MARGIN, MARGIN + bx1 - bx0 + 1))
    # walls: poché with a crisp outline
    wcrop = wall[by0:by1 + 1, bx0:bx1 + 1]
    arr[sub][wcrop] = (38, 38, 38)
    arr[sub][cab_lines[by0:by1 + 1, bx0:bx1 + 1] & ~wcrop & inside[by0:by1 + 1, bx0:bx1 + 1]] = (70, 70, 70)
    # windows: the wall opened, glazing as two thin lines in it
    gl = glass_lines[by0:by1 + 1, bx0:bx1 + 1]
    gzone = dil(gl, m(0.06))
    gwall = gzone & dil(wcrop, m(0.15))
    arr[sub][gwall] = (255, 255, 255)
    edge = gwall & ~ndi.binary_erosion(gwall)
    arr[sub][edge] = (60, 60, 60)
    arr[sub][gl] = (70, 130, 170)
    canvas = Image.fromarray(arr)
    d = ImageDraw.Draw(canvas)
    # doors: the leaf open at 90° and its swing
    lw = max(2, m(0.02))
    for a_, b_ in doors:
        a_, b_ = a_ + (ox, oy), b_ + (ox, oy)
        L = float(np.linalg.norm(b_ - a_))
        u = (b_ - a_) / max(L, 1e-3)
        nrm = np.array([-u[1], u[0]])
        # swing toward the side with more free floor
        mid = ((a_ + b_) / 2 - (ox, oy)).astype(int)
        probe = lambda s_: inside[np.clip(int(mid[1] + s_ * nrm[1] * m(0.5)), 0, H - 1), np.clip(int(mid[0] + s_ * nrm[0] * m(0.5)), 0, W - 1)]
        side = 1 if probe(1) else -1
        tip = a_ + nrm * side * L
        d.rectangle([min(a_[0], b_[0]) - 1, min(a_[1], b_[1]) - 1, max(a_[0], b_[0]) + 1, max(a_[1], b_[1]) + 1], fill=None)
        d.line([tuple(a_), tuple(tip)], fill=(40, 40, 40), width=lw)
        ang0 = math.degrees(math.atan2(u[1], u[0]))
        ang1 = math.degrees(math.atan2(nrm[1] * side, nrm[0] * side))
        lo, hi = sorted([ang0, ang1])
        if hi - lo > 180:
            lo, hi = hi, lo + 360
        d.arc([a_[0] - L, a_[1] - L, a_[0] + L, a_[1] + L], lo, hi, fill=(90, 90, 90), width=max(1, lw // 2))
    # room labels: name, area, inner size, with a white halo
    for r in info:
        x, y = r["label"][0] + ox, r["label"][1] + oy
        big = r["clear"] > 0.9
        f1, f2 = font(FS if big else FS * 0.8, True), font(FS * 0.8 if big else FS * 0.68)
        lines = [(r["name"], f1), ("%s m²" % ("%.1f" % r["area"]).replace(".", ","), f2)]
        if big:
            lines.append(("%s × %s" % (("%.2f" % r["dims"][0]).replace(".", ","), ("%.2f" % r["dims"][1]).replace(".", ",")), font(FS * 0.6)))
        hs = [d.textbbox((0, 0), t_, font=f_) for t_, f_ in lines]
        tot = sum(b[3] - b[1] for b in hs) + 6 * (len(lines) - 1)
        cy = y - tot / 2
        for (t_, f_), b in zip(lines, hs):
            wdt = b[2] - b[0]
            d.text((x - wdt / 2, cy - b[1]), t_, font=f_, fill=(25, 25, 25), stroke_width=max(2, FS // 7), stroke_fill=(255, 255, 255))
            cy += (b[3] - b[1]) + 6
    # overall dimensions, outside the walls
    def dim_h(x0_, x1_, y_, text):
        d.line([(x0_, y_), (x1_, y_)], fill=(30, 30, 30), width=2)
        for xx in (x0_, x1_):
            d.line([(xx, y_ - m(0.15)), (xx, y_ + m(0.15))], fill=(30, 30, 30), width=2)
            d.line([(xx - m(0.08), y_ + m(0.08)), (xx + m(0.08), y_ - m(0.08))], fill=(30, 30, 30), width=3)
        f = font(FS * 0.85)
        b = d.textbbox((0, 0), text, font=f)
        d.text(((x0_ + x1_) / 2 - (b[2] - b[0]) / 2, y_ - m(0.12) - (b[3] - b[1]) - b[1]), text, font=f, fill=(30, 30, 30))

    def dim_v(y0_, y1_, x_, text):
        d.line([(x_, y0_), (x_, y1_)], fill=(30, 30, 30), width=2)
        for yy in (y0_, y1_):
            d.line([(x_ - m(0.15), yy), (x_ + m(0.15), yy)], fill=(30, 30, 30), width=2)
            d.line([(x_ - m(0.08), yy + m(0.08)), (x_ + m(0.08), yy - m(0.08))], fill=(30, 30, 30), width=3)
        f = font(FS * 0.85)
        b = d.textbbox((0, 0), text, font=f)
        tw, th = b[2] - b[0], b[3] - b[1]
        lbl = Image.new("RGBA", (tw + 8, th + 8), (255, 255, 255, 0))
        ImageDraw.Draw(lbl).text((4, 4 - b[1]), text, font=f, fill=(30, 30, 30))
        lbl = lbl.rotate(90, expand=True)
        canvas.paste(lbl, (int(x_ - m(0.12) - lbl.size[0]), int((y0_ + y1_) / 2 - lbl.size[1] / 2)), lbl)

    fmt = lambda v: ("%.2f m" % v).replace(".", ",")
    wy, wx = np.nonzero(wall)
    gx0, gx1, gy0, gy1 = wx.min() + ox, wx.max() + ox, wy.min() + oy, wy.max() + oy
    dim_h(gx0, gx1, gy0 - m(1.0), fmt((gx1 - gx0) * MPP))
    dim_v(gy0, gy1, gx0 - m(1.0), fmt((gy1 - gy0) * MPP))
    # chain of the facade: wall extremities seen from the top edge (every jump in the outline over 40 cm)
    # scale bar and north arrow, bottom left
    sbx, sby = MARGIN, CH - m(0.9)
    for k_ in range(5):
        d.rectangle([sbx + k_ * m(1), sby, sbx + (k_ + 1) * m(1), sby + m(0.12)], fill=(30, 30, 30) if k_ % 2 == 0 else (255, 255, 255), outline=(30, 30, 30), width=2)
    for k_ in (0, 1, 2, 5):
        t_ = "%d m" % k_ if k_ == 5 else str(k_)
        b = d.textbbox((0, 0), t_, font=font(FS * 0.6))
        d.text((sbx + k_ * m(1) - (b[2] - b[0]) / 2, sby + m(0.18)), t_, font=font(FS * 0.6), fill=(30, 30, 30))
    nx, ny = MARGIN + m(6.2), CH - m(0.55)
    d.polygon([(nx, ny - m(0.7)), (nx - m(0.22), ny), (nx, ny - m(0.18)), (nx + m(0.22), ny)], fill=(30, 30, 30))
    b = d.textbbox((0, 0), "N", font=font(FS * 0.75, True))
    d.text((nx - (b[2] - b[0]) / 2, ny - m(0.7) - (b[3] - b[1]) - m(0.12) - b[1]), "N", font=font(FS * 0.75, True), fill=(30, 30, 30))
    # the side panel: title, room table, total, title block
    px0 = CW - SIDE + m(0.4)
    d.line([(CW - SIDE, MARGIN), (CW - SIDE, CH - MARGIN // 2)], fill=(210, 210, 210), width=2)
    yy = MARGIN
    d.text((px0, yy), OPT.get("title", "Plan d'aménagement"), font=font(FS * 1.25, True), fill=(20, 20, 20))
    yy += int(FS * 1.9)
    d.text((px0, yy), OPT.get("subtitle", "Niveau principal"), font=font(FS * 0.8), fill=(90, 90, 90))
    yy += int(FS * 2.0)
    total = 0.0
    for r in sorted(info, key=lambda r: -r["area"]):
        if r["area"] < 0.8:
            continue
        total += r["area"]
        a_txt = ("%.1f m²" % r["area"]).replace(".", ",")
        d.text((px0, yy), r["name"], font=font(FS * 0.72), fill=(30, 30, 30))
        b = d.textbbox((0, 0), a_txt, font=font(FS * 0.72))
        d.text((CW - m(0.4) - (b[2] - b[0]), yy), a_txt, font=font(FS * 0.72), fill=(30, 30, 30))
        yy += int(FS * 1.15)
    yy += int(FS * 0.3)
    d.line([(px0, yy), (CW - m(0.4), yy)], fill=(30, 30, 30), width=2)
    yy += int(FS * 0.4)
    t_tot = ("%.1f m²" % total).replace(".", ",")
    d.text((px0, yy), "Surface totale", font=font(FS * 0.8, True), fill=(20, 20, 20))
    b = d.textbbox((0, 0), t_tot, font=font(FS * 0.8, True))
    d.text((CW - m(0.4) - (b[2] - b[0]), yy), t_tot, font=font(FS * 0.8, True), fill=(20, 20, 20))
    by_ = CH - MARGIN // 2 - int(FS * 4.2)
    d.rectangle([px0 - m(0.1), by_, CW - m(0.3), CH - MARGIN // 2], outline=(30, 30, 30), width=2)
    d.text((px0 + m(0.1), by_ + int(FS * 0.4)), "roomia", font=font(FS * 1.1, True), fill=(20, 20, 20))
    d.text((px0 + m(0.1), by_ + int(FS * 1.8)), OPT.get("date", ""), font=font(FS * 0.62), fill=(70, 70, 70))
    d.text((px0 + m(0.1), by_ + int(FS * 2.7)), "Surfaces mesurées au nu des murs, à titre indicatif.", font=font(FS * 0.52), fill=(70, 70, 70))
    return canvas


outs = []
for style in (["rendu", "technique"] if OPT.get("style", "both") == "both" else [OPT["style"]]):
    im = draw_plan(style)
    im.save("%s-%s.png" % (OUTP, style), optimize=True)
    outs.append(im)
# the apartment as drawn (rooms, walls, enclosed pockets): the 3D plan is cut to it (plan_build.py writes plan-src/plan-apt.png)
Image.fromarray(((inside | wall | holes) * 255).astype(np.uint8)).save(OUTP + "-apt.png", optimize=True)
# the floor as drawn (rooms and enclosed pockets, no wall): where the top view shows through, so where a white spot is a missing floor (plan_fill_prepare.py)
Image.fromarray(((inside | holes) * 255).astype(np.uint8)).save(OUTP + "-floor.png", optimize=True)
# the furnished top view with a number on each room: what the AI is shown to name the rooms (plan-ai-names.mts)
ids_img = top.convert("RGB").copy()
dd = ImageDraw.Draw(ids_img)
for r in info:
    x, y = r["label"]
    rr = int(FS * 1.1)
    dd.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(200, 30, 30), outline=(255, 255, 255), width=4)
    b = dd.textbbox((0, 0), str(r["id"]), font=font(FS * 1.2, True))
    dd.text((x - (b[2] - b[0]) / 2, y - (b[3] - b[1]) / 2 - b[1]), str(r["id"]), font=font(FS * 1.2, True), fill=(255, 255, 255))
ids_img.crop((max(0, bx0 - 20), max(0, by0 - 20), min(W, bx1 + 20), min(H, by1 + 20))).save(OUTP + "-ids.jpg", quality=88)
# A3 landscape PDF at 150 dpi (one page per style)
A3 = (int(420 / 25.4 * 150), int(297 / 25.4 * 150))
pages = []
for im in outs:
    s_ = min(A3[0] / im.size[0], A3[1] / im.size[1]) * 0.96
    pg = Image.new("RGB", A3, (255, 255, 255))
    sm = im.resize((int(im.size[0] * s_), int(im.size[1] * s_)), Image.LANCZOS)
    pg.paste(sm, ((A3[0] - sm.size[0]) // 2, (A3[1] - sm.size[1]) // 2))
    pages.append(pg)
pages[0].save(OUTP + ".pdf", save_all=True, append_images=pages[1:], resolution=150)
json.dump({"ceiling": CEIL, "rooms": info, "doors": len(doors), "doorObjects": len(door_ids), "mpp": MPP, "total": round(sum(r["area"] for r in info if r["area"] >= 0.8), 1)},
          open(OUTP + "-rooms.json", "w"), ensure_ascii=False, indent=1)
print("PLAN_ARCH %d rooms, %d doors (%d leaves), total %.1f m2" % (len(info), len(doors), len(door_ids), sum(r["area"] for r in info if r["area"] >= 0.8)), flush=True)
for r in info:
    print("  ", r["id"], r["name"], r["area"], r["dims"])
