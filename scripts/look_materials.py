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


def classify(source, out):
    st = os.stat(source)
    key = {"size": st.st_size, "mtime": int(st.st_mtime), "v": 5}
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

    for m in j.get("materials", []):
        name = m.get("name", "")
        if not name or name in found:
            continue
        family, why = by_name(name), "name"
        tex = (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture")
        textured_all[name] = tex is not None
        if family is None and tex is not None:
            im = picture(tex.get("index"))
            family, why = (by_picture(im) if im is not None else None), "picture"
        if family and family != "skip":
            found[name] = {"family": family, "why": why, "textured": tex is not None}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    json.dump({"key": key, "materials": found, "textured": textured_all}, open(out, "w"), indent=1, ensure_ascii=False)
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
