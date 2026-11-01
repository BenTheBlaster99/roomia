"""
Compacts a GLB whose JSON is too big to read in Node (V8 strings stop at 512 MB).

SketchUp's glTF exporter can write one material and one primitive per painted face: 622,465 materials
for 239 different ones and 625,655 primitives in a pool model (27 Oct), a 634 MB JSON for 126 MB of
geometry. Here identical materials (same name, same values) become one, and in each mesh the primitives
that share a material are merged into one. Nodes, meshes, images and textures keep their indices.

    python3 compact-glb.py <in.glb> <out.glb>

Prints "COMPACT_SKIP <reason>" and writes nothing when the file uses something this does not handle
(external buffers, sparse accessors, morph targets, skins, animations): the import then reads it as it is.
"""
import json
import struct
import sys

import numpy as np

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def skip(reason):
    print(f"COMPACT_SKIP {reason}")
    sys.exit(0)


def main(src, dst):
    with open(src, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        skip("not a GLB")
    jlen, jtype = struct.unpack_from("<I4s", data, 12)
    if jtype != b"JSON":
        skip("no JSON chunk")
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    binary = b""
    if off + 8 <= len(data):
        blen, btype = struct.unpack_from("<I4s", data, off)
        if btype == b"BIN\x00":
            binary = memoryview(data)[off + 8:off + 8 + blen]
    del data  # the BIN view keeps its bytes alive

    if len(gltf.get("buffers", [])) > 1 or any("uri" in b for b in gltf.get("buffers", [])):
        skip("external buffers")
    if gltf.get("animations") or gltf.get("skins"):
        skip("animations or skins")
    accessors, views = gltf.get("accessors", []), gltf.get("bufferViews", [])
    if any("sparse" in a for a in accessors):
        skip("sparse accessors")

    def read(index):
        a = accessors[index]
        n, dtype = COMPONENTS[a["type"]], np.dtype(DTYPES[a["componentType"]])
        if "bufferView" not in a:
            return np.zeros((a["count"], n), dtype)
        v = views[a["bufferView"]]
        start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride") or n * dtype.itemsize
        arr = np.ndarray((a["count"], n), dtype, buffer=binary, offset=start, strides=(stride, dtype.itemsize))
        return arr.copy()

    # 1. Identical materials (name included: roles such as mirror or glass are read from names).
    materials, kept, material_map = gltf.get("materials", []), {}, {}
    for i, m in enumerate(materials):
        material_map[i] = kept.setdefault(json.dumps(m, sort_keys=True), len(kept))
    new_materials = [None] * len(kept)
    for key, index in kept.items():
        new_materials[index] = json.loads(key)

    # 2. A new BIN: the merged geometry, then the images, each in its own buffer view.
    out = bytearray()
    new_views, new_accessors = [], []

    def add_view(raw, target=None):
        while len(out) % 4:
            out.append(0)
        view = {"buffer": 0, "byteOffset": len(out), "byteLength": len(raw)}
        if target:
            view["target"] = target
        out.extend(raw)
        new_views.append(view)
        return len(new_views) - 1

    def add_accessor(arr, like, target):
        arr = np.ascontiguousarray(arr)
        acc = {"bufferView": add_view(arr.tobytes(), target), "componentType": like["componentType"], "count": int(arr.shape[0]), "type": like["type"]}
        if like.get("normalized"):
            acc["normalized"] = True
        if like.get("min") is not None or target == 34962 and like["type"] == "VEC3":
            if arr.shape[0]:
                acc["min"] = [float(x) for x in arr.min(axis=0)]
                acc["max"] = [float(x) for x in arr.max(axis=0)]
        new_accessors.append(acc)
        return len(new_accessors) - 1

    for mesh in gltf.get("meshes", []):
        groups = {}
        for p in mesh["primitives"]:
            if p.get("targets"):
                skip("morph targets")
            attrs = p["attributes"]
            signature = tuple(sorted((name, accessors[i]["type"], accessors[i]["componentType"], bool(accessors[i].get("normalized"))) for name, i in attrs.items()))
            material = material_map.get(p["material"]) if "material" in p else None
            groups.setdefault((material, p.get("mode", 4), signature), []).append(p)
        merged = []
        for (material, mode, _signature), prims in groups.items():
            names = sorted(prims[0]["attributes"])
            columns = {name: [] for name in names}
            indices, base = [], 0
            for p in prims:
                count = accessors[p["attributes"][names[0]]]["count"]
                for name in names:
                    columns[name].append(read(p["attributes"][name]))
                idx = read(p["indices"]).ravel().astype(np.uint32) if "indices" in p else np.arange(count, dtype=np.uint32)
                indices.append(idx + base)
                base += count
            prim = {"attributes": {}, "mode": mode}
            for name in names:
                like = accessors[prims[0]["attributes"][name]]
                prim["attributes"][name] = add_accessor(np.concatenate(columns[name]), like, 34962)
            idx = np.concatenate(indices)
            if base < 65536:
                prim["indices"] = add_accessor(idx.astype(np.uint16).reshape(-1, 1), {"componentType": 5123, "type": "SCALAR"}, 34963)
            else:
                prim["indices"] = add_accessor(idx.reshape(-1, 1), {"componentType": 5125, "type": "SCALAR"}, 34963)
            if material is not None:
                prim["material"] = material
            merged.append(prim)
        mesh["primitives"] = merged

    for image in gltf.get("images", []):
        if "bufferView" in image:
            v = views[image["bufferView"]]
            start = v.get("byteOffset", 0)
            image["bufferView"] = add_view(bytes(binary[start:start + v["byteLength"]]))

    gltf["materials"] = new_materials
    gltf["accessors"] = new_accessors
    gltf["bufferViews"] = new_views
    while len(out) % 4:
        out.append(0)
    gltf["buffers"] = [{"byteLength": len(out)}]

    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(out)))
        f.write(struct.pack("<I4s", len(text), b"JSON"))
        f.write(text)
        f.write(struct.pack("<I4s", len(out), b"BIN\x00"))
        f.write(out)
    print(f"COMPACT_OK materials {len(materials)} -> {len(new_materials)}, accessors {len(accessors)} -> {len(new_accessors)}, json {jlen // 2**20} MB -> {len(text) // 2**20} MB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
