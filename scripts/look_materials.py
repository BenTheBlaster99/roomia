"""
What each material of a project is in real life, and how it behaves in light (18 Nov, the owner and Sarah: "the texture of
D5 / Enscape", every texture exactly the architect's). SketchUp exports a colour or a picture per material and nothing else:
no gloss, no relief (Bloc B F5: 543 materials, 1 normal map, 2 roughness maps, every roughness 0.5). Here each material gets
a FAMILY (marble, wood, leather, velvet, chrome...) and the family its physical finish: roughness, clear coat, sheen, metal,
and a relief made from the material's OWN picture (a bump from its brightness: veins, grain, weave). Nothing is added to the
picture and no colour changes.

1. the name (French, English, Portuguese, Spanish, Italian, Indonesian, Vietnamese, Chinese: what the F5's libraries use)
2. else the picture itself: wood grain (long parallel streaks, warm), stone (light, grey, veined), fabric (fine weave, flat)
3. else nothing: the material keeps the neutral finish it had (safe: never wrong in a visible way)

Glass and mirrors are left to look_apply.py's own rules.

python look_materials.py <source.glb> <out.json>      (the look pipeline calls classify() through look_make_recipe.py)
The result is cached beside out.json for the same file (size + time).
"""
import io, json, os, re, struct, sys

# the finish of each family, in Blender's Principled BSDF terms (look_apply.py "materials" rules). selfBump: the relief taken
# from the material's own picture (0 = none); it only applies to textured materials. Not on stone, tile or plaster (18 Nov test:
# the F5's marble floor, whose faces SketchUp turned over, went black and mirror-like with a relief; polished stone has none anyway).
FAMILIES = {
    "stone":   {"roughness": 0.12, "coat": 0.3, "coatRoughness": 0.04},
    "tile":    {"roughness": 0.15, "coat": 0.25, "coatRoughness": 0.05},
    "lacquer": {"roughness": 0.12, "coat": 0.6, "coatRoughness": 0.03},
    "wood":    {"roughness": 0.42, "coat": 0.15, "coatRoughness": 0.25, "selfBump": 0.06},
    "leather": {"roughness": 0.45, "coat": 0.1, "coatRoughness": 0.3, "sheen": 0.15, "sheenRoughness": 0.4, "selfBump": 0.1},
    "velvet":  {"roughness": 0.9, "specular": 0.2, "sheen": 1.0, "sheenRoughness": 0.3, "selfBump": 0.08},
    "fabric":  {"roughness": 0.88, "specular": 0.25, "sheen": 0.6, "sheenRoughness": 0.45, "selfBump": 0.14},
    "carpet":  {"roughness": 0.95, "specular": 0.2, "sheen": 0.4, "sheenRoughness": 0.6, "selfBump": 0.25},
    "chrome":  {"metallic": 1.0, "roughness": 0.06},
    "metal":   {"metallic": 1.0, "roughness": 0.32},
    "gold":    {"metallic": 1.0, "roughness": 0.22},
    "plaster": {"roughness": 0.82, "specular": 0.4},
    # a painted cabinet or door (only from the designer's tag: nothing in a name or a picture says satin)
    "satin":   {"roughness": 0.35, "coat": 0.1, "coatRoughness": 0.2},
    # stone known only from its picture (light, grey, veined): it may be a textured wall, so a satin finish, not a polish
    "stone_soft": {"roughness": 0.28, "coat": 0.12, "coatRoughness": 0.1},
    "plastic": {"roughness": 0.35},
    "plant":   {"roughness": 0.5, "sheen": 0.15, "sheenRoughness": 0.5},
    "paper":   {"roughness": 0.75, "specular": 0.3},
}

# first match wins: the more specific families come first
NAMES = [
    ("skip",    r"glass|verre|vitre|vidro|vidrio|cristal|玻璃|mirror|miroir|espelho|espejo|specchio|镜"),
    ("chrome",  r"chrom|cromo|cromad|inox|stainless|不锈钢|polished.?steel|mirror.?steel"),
    ("gold",    r"gold(?!enrod)|dor[ée]|brass|laiton|lat[aã]o|bronze|copper|cuivre|cobre|黄金|金色|铜"),
    ("metal",   r"metal|m[ée]tal|alumin|\balu\b|steel|acier|a[cç]o\b|iron|\bfer\b|ferro|nickel|zinc|anodi|brushed|bross[ée]|铁|金属"),
    ("stone",   r"marble|marbre|marmo|m[aá]rmo[rl]e?|granit|travertin|onyx|quartz|terrazzo|stone|pierre|pedra|piedra|calacatta|carrara|statuario|slate(?!.?gr[ae]y)|ardoise|大理石|石材|岩"),
    ("tile",    r"(?<![a-z])tiles?(?![a-z])|carrelage|carreau|ceramic|c[ée]ramique|ceramico|cer[aâ]mica|porcel|fa[iï]ence|zellige|mosai|azulejo|瓷|砖"),
    ("lacquer", r"laqu[ée]|lacquer|lacad|high.?gloss|brillant|\bgloss"),
    ("leather", r"leather|\bcuir|couro|cuero|pelle|皮革|真皮|\bkulit"),
    ("velvet",  r"velvet|velours|veludo|terciopelo|丝绒|天鹅绒"),
    ("carpet",  r"carpet|\brug|tapis|moquette|alfombra|tapete|地毯"),
    ("fabric",  r"fabric|tissu|tecido|\btela\b|textile|linen|\blin\b|cotton|coton|wool|laine|boucl|chenille|curtain|rideau|cortina|cushion|coussin|almofada|towel|serviette|toalha|croche|crochet|\bsofa|canap|\bkain|布|窗帘|绒"),
    ("wood",    r"wood|\bbois|oak|ch[eê]ne|walnut|noyer|teak|teck|\bash\b|fr[eê]ne|maple|[eé]rable|\bpine|pinus|\bpin\b|kayu|madeira|parquet|veneer|placage|bamboo|bambou|cherry|ceris|weng[eé]|ebony|[eé]b[eè]ne|birch|bouleau|beech|h[eê]tre|木"),
    ("plant",   r"leaf|leaves|feuille|folha|\bdaun|plant|foliage|banana|\bbana\d|pothos|fern|grass|herbe|bark|batang|flower|fleur|berry|叶|植物|花"),
    ("paper",   r"paper|papier|papel|\bpage|pagina|book|livre|\bcapa\d"),
    ("plastic", r"plastic|plastique|pl[aá]stico|\bpvc|acryli|nhua|nhựa|塑料"),
    ("plaster", r"\bral.?\d{4}\b|paint|peinture|plaster|enduit|stucco|concrete|b[ée]ton|cement|ciment|\bwall|\bmur\b|parede|墙|涂料"),
]


def by_name(name):
    for family, rx in NAMES:
        if re.search(rx, name, re.I):
            return family
    return None


def by_picture(img):
    """wood, stone or fabric from the picture alone, or None (a print, a logo, a photo: left alone)"""
    import numpy as np
    from PIL import Image, ImageFilter
    im = img.convert("RGB")
    im.thumbnail((256, 256))
    if min(im.size) < 32:
        return None
    a = np.asarray(im, np.float32) / 255
    hsv = np.asarray(im.convert("HSV"), np.float32) / 255
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    sat, val, hue = float(hsv[..., 1].mean()), float(lum.mean()), hsv[..., 0] * 360
    # structure: how much the edges run one way (wood grain)
    gy, gx = np.gradient(lum)
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    coherence = float(np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / (jxx + jyy + 1e-9))
    blur = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
    fine = float(np.abs(lum - blur).mean())
    broad = float(np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(8)), np.float32).std() / 255)
    warm = float(((hue > 10) & (hue < 50)).mean())
    if coherence > 0.45 and warm > 0.5 and sat > 0.15:
        return "wood"
    if val > 0.5 and sat < 0.12 and float(lum.std()) > 0.06 and coherence < 0.35:
        return "stone_soft"
    if fine > 0.025 and broad < 0.05 and coherence < 0.4:
        return "fabric"
    return None


def read_glb(path):
    f = open(path, "rb")
    f.read(12)
    jl, _ = struct.unpack("<II", f.read(8))
    j = json.loads(f.read(jl))
    bl, _ = struct.unpack("<II", f.read(8))
    return j, f, 12 + 8 + jl + 8


def geometry(j, f, base):
    """
    Where each material's surfaces stand in the apartment (19 Nov): its area, how much of it faces up, down or sideways, its
    height span, how flat and square its faces are (a cabinet) or how curved and dense (a sofa). glTF is y-up, metres.
    Read straight from the file with numpy (no Blender, no graphics card).
    """
    import numpy as np
    acc, views = j.get("accessors", []), j.get("bufferViews", [])
    COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NUM = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def read(i):
        a = acc[i]
        bv = views[a["bufferView"]]
        dt = np.dtype(COMP[a["componentType"]])
        n, k = a["count"], NUM[a["type"]]
        stride = bv.get("byteStride") or dt.itemsize * k
        f.seek(base + bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        raw = np.frombuffer(f.read(stride * (n - 1) + dt.itemsize * k), np.uint8)
        if stride == dt.itemsize * k:
            return raw.view(dt).reshape(n, k)
        return np.lib.stride_tricks.as_strided(raw.view(dt), (n, k), (stride, dt.itemsize)).copy()

    def local(node):
        if "matrix" in node:
            return np.array(node["matrix"], np.float64).reshape(4, 4).T
        t = np.array(node.get("translation", [0, 0, 0]), np.float64)
        x, y, z, w = node.get("rotation", [0, 0, 0, 1])
        r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        m = np.eye(4)
        m[:3, :3] = r * np.array(node.get("scale", [1, 1, 1]), np.float64)[None, :]
        m[:3, 3] = t
        return m

    stats, mats = {}, j.get("materials", [])
    nodes = j.get("nodes", [])
    scene = j.get("scenes", [{}])[j.get("scene", 0)] if j.get("scenes") else {"nodes": list(range(len(nodes)))}
    stack = [(i, np.eye(4)) for i in scene.get("nodes", [])]
    ups = []  # (height, area) of up-facing triangles, for the floor; down-facing for the ceiling
    downs = []
    while stack:
        ni, parent = stack.pop()
        node = nodes[ni]
        m = parent @ local(node)
        for c in node.get("children", []):
            stack.append((c, m))
        if "mesh" not in node:
            continue
        for prim in j["meshes"][node["mesh"]].get("primitives", []):
            if prim.get("mode", 4) != 4 or "material" not in prim:
                continue
            name = mats[prim["material"]].get("name", "")
            try:
                pos = read(prim["attributes"]["POSITION"]).astype(np.float64)
                idx = read(prim["indices"]).reshape(-1).astype(np.int64) if "indices" in prim else np.arange(len(pos))
            except Exception:
                continue
            pw = pos @ m[:3, :3].T + m[:3, 3]
            t = pw[idx[: len(idx) // 3 * 3]].reshape(-1, 3, 3)
            if not len(t):
                continue
            cr = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
            ar = np.linalg.norm(cr, axis=1) / 2
            ok = ar > 1e-9
            if not ok.any():
                continue
            t, cr, ar = t[ok], cr[ok], ar[ok]
            n = cr / (2 * ar[:, None])
            ny = n[:, 1]
            cy = t[:, :, 1].mean(1)
            axis = (np.abs(n).max(1) > 0.97)
            s = stats.setdefault(name, {"area": 0.0, "up": 0.0, "down": 0.0, "side": 0.0, "axis": 0.0, "tris": 0, "ymin": 1e9, "ymax": -1e9, "ysum": 0.0, "objects": []})
            label = node.get("name") or j["meshes"][node["mesh"]].get("name") or ""
            if label and label not in s["objects"] and len(s["objects"]) < 6:
                s["objects"].append(label[:40])
            s["area"] += float(ar.sum())
            s["up"] += float(ar[ny > 0.8].sum())
            s["down"] += float(ar[ny < -0.8].sum())
            s["side"] += float(ar[np.abs(ny) < 0.3].sum())
            s["axis"] += float(ar[axis].sum())
            s["tris"] += int(len(ar))
            s["ymin"] = min(s["ymin"], float(t[:, :, 1].min()))
            s["ymax"] = max(s["ymax"], float(t[:, :, 1].max()))
            s["ysum"] += float((cy * ar).sum())
            big_up = (ny > 0.95)
            if big_up.any():
                ups.append(np.stack([cy[big_up], ar[big_up]], 1))
            big_down = (ny < -0.95)
            if big_down.any():
                downs.append(np.stack([cy[big_down], ar[big_down]], 1))

    def mode_height(parts):
        if not parts:
            return None
        a = np.concatenate(parts)
        h = np.round(a[:, 0] / 0.05).astype(np.int64)
        u, inv = np.unique(h, return_inverse=True)
        w = np.bincount(inv, weights=a[:, 1])
        return float(u[w.argmax()] * 0.05)

    floor = mode_height(ups)
    # the ceiling: the most down-facing surface at least 1.8 m above the floor (slab undersides face down at floor level)
    if floor is not None and downs:
        a_ = np.concatenate(downs)
        downs = [a_[a_[:, 0] > floor + 1.8]] if (a_[:, 0] > floor + 1.8).any() else []
    return stats, floor, mode_height(downs)


def by_place(s, floor, ceil):
    """a plain material from where it stands: a wall or a ceiling is matte paint, a flat square-cut front is a painted cabinet"""
    a = s["area"]
    if a < 0.5:
        return None
    side, up, down, axis = s["side"] / a, s["up"] / a, s["down"] / a, s["axis"] / a
    span = s["ymax"] - s["ymin"]
    density = s["tris"] / a
    if side > 0.7 and a >= 8 and span >= 1.8:
        return "plaster"  # walls
    if ceil is not None and down > 0.7 and a >= 3 and abs(s["ysum"] / a - ceil) < 0.6:
        return "plaster"  # ceilings
    if floor is not None and up > 0.7 and abs(s["ysum"] / a - floor) < 0.15:
        return None  # floors: the polish of look_apply.py decides
    if axis > 0.85 and density < 400 and a < 40 and (floor is None or s["ymin"] > floor - 0.1) and span < 2.8:
        return "satin"  # flat, square-cut fronts: cabinets, doors, shelves
    return None


FAMILY_WORDS = ", ".join(k for k in FAMILIES if k != "stone_soft")


MATERIALS_MODEL = os.environ.get("ROOMIA_MATERIALS_MODEL", "anthropic/claude-haiku-5.5")


def _ask(prompt, image_b64=None):
    """
    One JSON answer from Coconut's AI gateway (OPENAI_API_KEY + OPENAI_BASE_URL, an OpenAI-style chat with a picture; 19 Nov, the
    owner: Coconut's key, not a Gemini key). A desktop PC holds no key: it asks Roomia's server (ROOMIA_CLOUD_URL + its account
    token), which asks the gateway. None when neither is there.
    """
    import ssl, time, urllib.request
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    base = os.environ.get("OPENAI_BASE_URL", "").strip().rstrip("/")
    cloud = os.environ.get("ROOMIA_CLOUD_URL", "").strip()
    token = ""
    tf = os.environ.get("ROOMIA_CLOUD_TOKEN_FILE", "")
    if tf and os.path.exists(tf):
        try:
            token = json.load(open(tf)).get("token", "")
        except Exception:
            token = ""
    if not (key and base) and not (cloud and token):
        return None
    # Blender's own Python knows no certificates on Linux: the system's bundle (Windows' Python reads the Windows store itself)
    ctx = ssl.create_default_context()
    for ca in ("/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"):
        if os.path.exists(ca):
            ctx.load_verify_locations(ca)
            break

    def parse(text):
        # the JSON object in the answer (a model may wrap it in a code fence or a sentence)
        return json.loads(text[text.index("{"): text.rindex("}") + 1])

    # the gateway is behind Cloudflare, which refuses Python's own User-Agent (403)
    ua = {"User-Agent": "RoomiaDesktop/1.0"}

    for attempt in range(3):
        try:
            if key and base:
                content = [{"type": "text", "text": prompt}]
                if image_b64:
                    content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + image_b64}})
                body = {"model": MATERIALS_MODEL, "messages": [{"role": "user", "content": content}], "temperature": 0, "max_tokens": 4000}
                req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(),
                                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + key, **ua})
                r = json.load(urllib.request.urlopen(req, timeout=150, context=ctx))
                return parse(r["choices"][0]["message"]["content"])
            req = urllib.request.Request(cloud.rstrip("/") + "/api/desktop/materials", data=json.dumps({"image": image_b64 or "", "prompt": prompt}).encode(),
                                         headers={"Content-Type": "application/json", "Authorization": "Bearer " + token, **ua})
            return json.load(urllib.request.urlopen(req, timeout=180, context=ctx)).get("families")
        except Exception as e:
            print("MATERIALS ai try %d: %s" % (attempt + 1, str(e)[:160]), flush=True)
            time.sleep(4)
    return None


def by_ai_text(entries):
    """
    The plain materials nothing placed yet (19 Nov, "all 543"): their name, colour, size, the way they face, their height in the
    room and the names of the objects they are on ("Sofa", "Handle", "Lamp") go to the AI as text; it names each one's family.
    """
    out = {}
    for start in range(0, len(entries), 70):
        chunk = entries[start:start + 70]
        prompt = ("Materials of an architect's 3D model of an apartment interior (SketchUp). For each, say what it is in real life, one word from: "
                  + FAMILY_WORDS + ". Always pick the most likely one. Clues: the objects it is on, its colour, its total area, which way its "
                  "faces point, its height above the floor. Matte wall/ceiling paint = plaster; painted cabinet fronts, doors, shelves = satin; "
                  "high-gloss = lacquer; sofas, cushions, curtains, bedding = fabric; rugs = carpet; handles, taps, frames in grey = metal; "
                  "shiny chrome = chrome; brass/gold = gold; screens, appliances, small plastic parts = plastic; books, prints, posters = paper; "
                  "ceramic sinks, toilets, vases = tile.\n"
                  + "\n".join("%d: %s" % (i, e) for i, (_, e) in enumerate(chunk))
                  + '\nAnswer with JSON only: {"<number>": "<family>", ...} for every number.')
        answer = _ask(prompt) or {}
        for k_, fam in answer.items():
            try:
                i = int(k_)
            except Exception:
                continue
            if 0 <= i < len(chunk) and fam in FAMILIES:
                out[chunk[i][0]] = fam
    return out


def by_ai(items, pictures):
    """
    The pictures Roomia could not place, shown to an AI that names their family (19 Nov): contact sheets of 48 numbered samples
    with their names, one call each (Coconut's gateway, a text model that reads pictures; cheap, not the image model). On a desktop PC without the key, through Roomia's
    server (ROOMIA_CLOUD_URL + the account token). Returns {name: family}; nothing when neither is there.
    """
    import base64
    from PIL import Image, ImageDraw
    out = {}
    T = 160
    for start in range(0, len(items), 48):
        chunk = items[start:start + 48]
        sheet = Image.new("RGB", (8 * T, ((len(chunk) + 7) // 8) * T), "white")
        d = ImageDraw.Draw(sheet)
        lines = []
        for i, (name, tex) in enumerate(chunk):
            im = pictures.get(tex)
            if im is None:
                continue
            tile = im.convert("RGB")
            w, h = tile.size
            c = min(w, h)
            tile = tile.crop(((w - c) // 2, (h - c) // 2, (w - c) // 2 + c, (h - c) // 2 + c)).resize((T - 4, T - 4))
            x, y = (i % 8) * T, (i // 8) * T
            sheet.paste(tile, (x + 2, y + 2))
            d.rectangle((x + 2, y + 2, x + 30, y + 20), fill="white")
            d.text((x + 5, y + 5), str(i), fill="black")
            lines.append("%d: %s" % (i, name[:60]))
        buf = io.BytesIO()
        sheet.save(buf, "JPEG", quality=88)
        prompt = ("These are material textures from an architect's 3D model of an apartment interior. Each square has a number; "
                  "the material names are listed below. For each number, say what the material is in real life, one word from: "
                  + FAMILY_WORDS + ", or unknown (a photo, a picture, a logo, a screen, food, or you are not sure). "
                  "marble/granite/terrazzo/travertine = stone; ceramic and tiles = tile; high-gloss = lacquer; painted wood or MDF fronts = satin; "
                  "matte wall paint, plaster, concrete = plaster; rugs = carpet; brushed or dark metal = metal; polished chrome or steel = chrome; brass/gold/copper = gold.\n"
                  + "\n".join(lines) + '\nAnswer with JSON only: {"<number>": "<family>", ...}')
        answer = _ask(prompt, base64.b64encode(buf.getvalue()).decode())
        for k_, fam in (answer or {}).items():
            try:
                i = int(k_)
            except Exception:
                continue
            if 0 <= i < len(chunk) and fam in FAMILIES:
                out[chunk[i][0]] = fam
    return out


def classify(source, out):
    st = os.stat(source)
    key = {"size": st.st_size, "mtime": int(st.st_mtime), "v": 10}
    if os.path.exists(out):
        try:
            d = json.load(open(out))
            if d.get("key") == key:
                return d["materials"], d.get("textured", {})
        except Exception:
            pass
    from PIL import Image
    j, f, base = read_glb(source)
    views, images, textures = j.get("bufferViews", []), j.get("images", []), j.get("textures", [])
    found, pictures, textured_all = {}, {}, {}

    def picture(tex_index):
        if tex_index in pictures:
            return pictures[tex_index]
        im = None
        try:
            src = textures[tex_index].get("source")
            bv = views[images[src]["bufferView"]]
            f.seek(base + bv.get("byteOffset", 0))
            im = Image.open(io.BytesIO(f.read(bv["byteLength"])))
            im.load()
        except Exception:
            im = None
        pictures[tex_index] = im
        return im

    # 1. the name; see-through materials (glass) and glass/mirror names are left to look_apply.py
    unknown_tex, unknown_plain, skipped = [], [], set()
    for m in j.get("materials", []):
        name = m.get("name", "")
        if not name or name in textured_all:
            continue
        pbr = m.get("pbrMetallicRoughness") or {}
        tex = pbr.get("baseColorTexture")
        textured_all[name] = tex is not None
        alpha = (pbr.get("baseColorFactor") or [1, 1, 1, 1])[3]
        family = by_name(name)
        if family == "skip" or (m.get("alphaMode") == "BLEND" and alpha < 0.9):
            skipped.add(name)
            continue
        if family:
            found[name] = {"family": family, "why": "name", "textured": tex is not None}
        elif tex is not None:
            unknown_tex.append((name, tex.get("index")))
        else:
            unknown_plain.append(name)
    # 2. the AI on the textures the name did not tell (one call per 48), cached with the rest
    for _, t in unknown_tex:
        picture(t)
    ai = by_ai(unknown_tex, pictures) if os.environ.get("ROOMIA_LOOK_MATERIALS_AI", "1") != "0" else {}
    for name, t in unknown_tex:
        fam, why = ai.get(name), "ai"
        if not fam:
            im = pictures.get(t)
            fam, why = (by_picture(im) if im is not None else None), "picture"
        if fam:
            found[name] = {"family": fam, "why": why, "textured": True}
    # 3. where the plain ones stand: walls, ceilings, cabinet fronts
    try:
        stats, floor, ceil = geometry(j, f, base)
    except Exception as e:
        print("MATERIALS geometry skipped: %s" % e, flush=True)
        stats, floor, ceil = {}, None, None
    for name in unknown_plain:
        s = stats.get(name)
        fam = by_place(s, floor, ceil) if s else None
        if fam:
            found[name] = {"family": fam, "why": "place", "textured": False}
    # 4. every other one (19 Nov, "all 543"): the AI with its context, as text
    def hexcol(name):
        m = next((x for x in j.get("materials", []) if x.get("name") == name), {})
        c = (m.get("pbrMetallicRoughness") or {}).get("baseColorFactor") or [1, 1, 1, 1]
        return "#%02x%02x%02x" % tuple(int(max(0, min(1, v)) ** (1 / 2.2) * 255) for v in c[:3])

    def describe(name):
        s = stats.get(name)
        parts = ['"%s"' % name[:50], "picture" if textured_all.get(name) else "plain " + hexcol(name)]
        if s and s["area"] > 0:
            a = s["area"]
            face = "up" if s["up"] / a > 0.6 else "down" if s["down"] / a > 0.6 else "vertical" if s["side"] / a > 0.6 else "mixed"
            h = (s["ysum"] / a - floor) if floor is not None else None
            parts.append("%.1f m2, faces %s%s, %s" % (a, face, ", %.1f m above floor" % h if h is not None else "",
                                                      "flat boxy" if s["axis"] / a > 0.85 else "curved/detailed"))
            if s.get("objects"):
                parts.append("on: " + ", ".join(s["objects"]))
        return " | ".join(parts)

    rest = [n for n in textured_all if n not in found and n not in skipped]
    if rest and os.environ.get("ROOMIA_LOOK_MATERIALS_AI", "1") != "0":
        for name, fam in by_ai_text([(n, describe(n)) for n in rest]).items():
            # a metal guessed from words alone stays on small things: a big metal surface wrongly so is a dark mirror (the F5's
            # "Patina" floor, 18 Nov); one of 1 m2 or more is a painted surface instead
            if fam in ("metal", "chrome", "gold") and stats.get(name, {}).get("area", 0) >= 1.0:
                fam = "satin"
            found[name] = {"family": fam, "why": "ai-text", "textured": bool(textured_all.get(name))}
    # 5. a safe finish for anything still unsure: nothing stays without one
    for name in textured_all:
        if name in found or name in skipped:
            continue
        a = stats.get(name, {}).get("area", 0)
        found[name] = {"family": "satin" if a >= 1 else "plastic", "why": "default", "textured": bool(textured_all.get(name))}
    # glass and mirrors: their own rules in look_apply.py (counted, never given a family finish)
    for name in skipped:
        found[name] = {"family": "mirror" if re.search(r"mirror|miroir|espelho|espejo|specchio|镜", name, re.I) else "glass", "why": "name", "textured": bool(textured_all.get(name))}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump({"key": key, "materials": found, "textured": textured_all, "floor": floor, "ceiling": ceil,
               "areas": {n: round(v["area"], 2) for n, v in stats.items()}}, open(out, "w"), indent=1, ensure_ascii=False)
    return found, textured_all


def overlay(found, textured, scene_dir):
    """What the designer said wins (18 Nov): this project's tags (material-roles.json "family"), then the PC's library (the
    tags of earlier projects, by material name, beside the projects folder), then Roomia's own guess."""
    out = dict(found)
    lib = {}
    try:
        lib = json.load(open(os.path.join(os.path.dirname(os.path.abspath(scene_dir)), "..", "material-library.json"))).get("families", {})
    except Exception:
        pass
    tags = {}
    try:
        tags = {n: e["family"] for n, e in json.load(open(os.path.join(scene_dir, "material-roles.json"))).items() if isinstance(e, dict) and e.get("family")}
    except Exception:
        pass
    for why, src in (("library", lib), ("tag", tags)):
        for name, family in src.items():
            if name in textured and family in FAMILIES:
                out[name] = {"family": family, "why": why, "textured": bool(textured[name])}
    return out


def rules(found):
    """look_apply.py material rules: one per family, the exact names of its materials; the relief only on textured ones"""
    out = []
    for family, params in FAMILIES.items():
        names = [n for n, d in found.items() if d["family"] == family]
        if not names:
            continue
        plain = {k: v for k, v in params.items() if k != "selfBump"}
        textured = [n for n in names if found[n]["textured"]]
        flat = [n for n in names if not found[n]["textured"]]
        esc = lambda ns: "^(" + "|".join(re.escape(n) for n in ns) + ")$"
        if textured:
            out.append(dict(plain, match=esc(textured), family=family, **({"selfBump": params["selfBump"]} if params.get("selfBump") else {})))
        if flat:
            out.append(dict(plain, match=esc(flat), family=family))
    return out


if __name__ == "__main__":
    found, textured = classify(sys.argv[1], sys.argv[2])
    if len(sys.argv) > 3 and not sys.argv[3].startswith("--"):
        found = overlay(found, textured, sys.argv[3])
    if "--json" in sys.argv:
        # for the app's Matières panel (lib/material-library.ts)
        print("MATERIALS_JSON " + json.dumps({"guesses": found, "total": len(textured)}, ensure_ascii=False))
        sys.exit(0)
    from collections import Counter
    print("MATERIALS %d of their family: %s" % (len(found), dict(Counter(d["family"] for d in found.values()))))
    print("MATERIALS by picture: %d" % sum(1 for d in found.values() if d["why"] == "picture"))
