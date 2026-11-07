/**
 * Python for Blender, shared by the tour (Cycles 360°) and the view capture (EEVEE): pulls apart surfaces that lie on
 * the same plane, so each renderer shows the one the designer sees in SketchUp.
 *
 * 5 Nov (Sarah's Suite, a Windows laptop): the capture had no such step and showed the colour laid UNDER the finish
 * (a lilac panel, bench and tray, blue cushions, no rug) while the 360° of the same file was right. Defines
 * sheets_apart(scene, spec); spec "layerLift" and "twinsOnly" as before.
 */
export const SHEETS_APART_PY = String.raw`
import time
import numpy as np

def sheets_apart(scene, spec):
    # SketchUp exports a face as two sheets back to back (the room's side, and the outside, often SketchUp's default
    # white), and glTF hides the back of a one-sided sheet. EEVEE does; Cycles hit both sheets at the same distance and
    # showed whichever came first: a white wall and a patchwork ceiling (Ecolodge, 28 Oct). Making the backs see-through
    # skipped the room's sheet too (walls turned to glass). Each surface is moved 1 mm the way it faces instead, so the
    # sheet facing the camera is always the nearer one.
    # Two sheets facing the SAME way at the same place (a floor finish laid exactly on the slab: the Pool's corridors,
    # 30 Oct) stay together through that move: Cycles showed one or the other in triangles, and the light leaving one
    # sheet was stopped by its twin, so those triangles came out black. Where faces of two parts (one material of one
    # object) lie on the same plane over each other, the faces of the smaller part, usually the finish, go 0.25 mm
    # further per part under them. Only those faces move: moving whole objects opened hairlines along door frames.
    LAYER_STEP, LAYER_MAX, LAYER_MIN_AREA = 0.00025, 4, 0.01

    def layer_lift():
        t_layers = time.time()
        unit_of, unit_area, mesh_names, mesh_index = {}, [], [], {}
        rec_key, rec_box, rec_unit, rec_mesh, rec_poly, rec_okey, rec_face = [], [], [], [], [], [], []
        for ob in scene.objects:
            if ob.type != "MESH" or ob.hide_render or not ob.data.polygons:
                continue
            me = ob.data
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            if nt == 0:
                continue
            tri = np.empty(nt * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            mat = np.empty(nt, np.int32)
            me.loop_triangles.foreach_get("material_index", mat)
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(ob.matrix_world, np.float64)
            p = (co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3])[tri.reshape(-1, 3)]
            del co, tri
            cr = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
            area = 0.5 * np.linalg.norm(cr, axis=1)
            mats = np.unique(mat)
            lut = np.zeros(int(mats.max()) + 1, np.int32)
            for m in mats:
                key = (me.name, int(m))
                if key not in unit_of:
                    unit_of[key] = len(unit_area)
                    unit_area.append(0.0)
                lut[m] = unit_of[key]
                unit_area[lut[m]] += float(area[mat == m].sum())
            keep = area >= LAYER_MIN_AREA
            if not keep.any():
                continue
            if me.name not in mesh_index:
                mesh_index[me.name] = len(mesh_names)
                mesh_names.append(me.name)
            poly = np.empty(nt, np.int32)
            me.loop_triangles.foreach_get("polygon_index", poly)
            p, cr, area = p[keep], cr[keep], area[keep]
            n = cr / (2 * area)[:, None]
            d = (n * p[:, 0]).sum(1)
            # Drop the plane's main axis: faces on one plane overlap in the two others exactly when they overlap.
            dom = np.abs(n).argmax(1)
            ax = np.stack([(dom + 1) % 3, (dom + 2) % 3], 1)
            q = np.take_along_axis(p, ax[:, None, :].repeat(3, 1), 2)
            rec_box.append(np.concatenate([q.min(1), q.max(1)], 1).astype(np.float32))
            rec_key.append(np.concatenate([np.round(n * 64), np.floor(d / 0.002)[:, None], np.floor(d / 0.002 + 0.5)[:, None]], 1).astype(np.int64))
            # the same plane whichever way the face looks, and which way that is (two faces back to back share the plane)
            sign = np.where(np.take_along_axis(n, dom[:, None], 1)[:, 0] >= 0, 1.0, -1.0)
            nc, dc = n * sign[:, None], d * sign
            rec_okey.append(np.concatenate([np.round(nc * 64), np.floor(dc / 0.002)[:, None], np.floor(dc / 0.002 + 0.5)[:, None]], 1).astype(np.int64))
            rec_face.append(sign.astype(np.int8))
            rec_unit.append(lut[mat[keep]])
            rec_mesh.append(np.full(int(keep.sum()), mesh_index[me.name], np.int32))
            rec_poly.append(poly[keep])
        if not rec_key:
            return {}, {}
        keys, boxes, units = np.concatenate(rec_key), np.concatenate(rec_box), np.concatenate(rec_unit)
        okeys, faces = np.concatenate(rec_okey), np.concatenate(rec_face)
        del rec_key, rec_box, rec_okey, rec_face
        def overlapping(keys, tag):
            # pairs of faces on one plane whose boxes overlap by more than 1 cm both ways, with a different tag
            hits_a, hits_b = [], []
            # Two height grids half a cell apart, so two faces less than 1 mm apart always share a cell of one of them.
            for grid in (3, 4):
                k = keys[:, [0, 1, 2, grid]]
                order = np.lexsort(k.T[::-1])
                ks = k[order]
                for g in np.split(order, np.flatnonzero(np.any(ks[1:] != ks[:-1], 1)) + 1):
                    if len(g) < 2 or len(np.unique(tag[g])) < 2:
                        continue
                    g = g[np.argsort(boxes[g, 0])]
                    b, un = boxes[g], tag[g]
                    for s in range(0, len(g), 512):
                        e = min(len(g), s + 512)
                        end = int(np.searchsorted(b[:, 0], b[s:e, 2].max(), "right"))
                        ox = np.minimum(b[s:e, None, 2], b[None, s:end, 2]) - np.maximum(b[s:e, None, 0], b[None, s:end, 0])
                        oy = np.minimum(b[s:e, None, 3], b[None, s:end, 3]) - np.maximum(b[s:e, None, 1], b[None, s:end, 1])
                        i, j = np.nonzero((ox > 0.01) & (oy > 0.01) & (un[s:e, None] != un[None, s:end]))
                        hits_a.append(g[s + i])
                        hits_b.append(g[s + j])
            return (np.concatenate(hits_a), np.concatenate(hits_b)) if hits_a else (np.zeros(0, np.int64), np.zeros(0, np.int64))
        # Faces back to back on one plane (a tiled wall's top against the ceiling above it, Bloc B F2): both are moved apart.
        oa, ob_ = overlapping(okeys, faces)
        both = np.unique(np.concatenate([oa, ob_]))
        all_mesh, all_poly = np.concatenate(rec_mesh), np.concatenate(rec_poly)
        opposed = {}
        for mi in np.unique(all_mesh[both]):
            opposed[mesh_names[mi]] = all_poly[both[all_mesh[both] == mi]]
        ra, rb = overlapping(keys, units)
        del keys, boxes, okeys
        if not len(ra):
            return {}, opposed
        # The bigger part stays, the smaller goes over it; a part over several others goes over the highest of them.
        rank = sorted(range(len(unit_area)), key=lambda u: (-unit_area[u], u))
        pos = np.empty(len(rank), np.int64)
        pos[rank] = np.arange(len(rank))
        ua, ub = units[ra], units[rb]
        a_big = pos[ua] < pos[ub]
        under = {}
        for small, big in set(zip(np.where(a_big, ub, ua).tolist(), np.where(a_big, ua, ub).tolist())):
            under.setdefault(small, []).append(big)
        level = np.zeros(len(rank), np.int32)
        for u in rank:
            if u in under:
                level[u] = min(LAYER_MAX, 1 + max(int(level[big]) for big in under[u]))
        top = np.unique(np.where(a_big, rb, ra))
        meshes, polys, levels = all_mesh[top], all_poly[top], level[units[top]]
        lift = {}
        for mi in np.unique(meshes):
            sel = meshes == mi
            lift[mesh_names[mi]] = (polys[sel], levels[sel])
        print("TOUR_INFO cycles layers %d faces of %d parts over others, %d faces back to back %.1fs" % (len(top), len(under), len(both), time.time() - t_layers), flush=True)
        return lift, opposed

    lift, opposed = layer_lift() if spec.get("layerLift", True) else ({}, {})
    # Only the sheets that have a twin back to back are moved (31 Oct, Bloc B F2's corridor): moving every surface opened
    # a slit along each outside corner and along a ceiling made of one sheet, and the daylight through it drew bright
    # lines along the tops and corners of the walls. A twin is a triangle at the same three corners (to the millimetre)
    # as another, in any object.
    def twin_sheets():
        t_twins = time.time()
        hashes, owners = [], []
        for ob in scene.objects:
            if ob.type != "MESH" or not ob.data.polygons:
                continue
            me = ob.data
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            if nt == 0:
                continue
            tri = np.empty(nt * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            co = np.empty(len(me.vertices) * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(ob.matrix_world, np.float64)
            q = np.round((co.reshape(-1, 3).astype(np.float64) @ mw[:3, :3].T + mw[:3, 3]) / 0.001).astype(np.int64)
            vh = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791)
            th = np.sort(vh[tri.reshape(-1, 3)], axis=1)
            hashes.append(th[:, 0] * 1000003 + th[:, 1] * 30999473 + th[:, 2] * 17)
            owners.append(me.name)
        if not hashes:
            return {}
        _, inv, cnt = np.unique(np.concatenate(hashes), return_inverse=True, return_counts=True)
        doubled = cnt[inv] >= 2
        twins, at = {}, 0
        for name, h in zip(owners, hashes):
            flags = doubled[at:at + len(h)]
            at += len(h)
            twins[name] = flags | twins[name] if name in twins else flags
        print("TOUR_INFO cycles %d of %d triangles are back-to-back twins %.1fs" % (int(doubled.sum()), len(doubled), time.time() - t_twins), flush=True)
        return twins
    twins = twin_sheets() if spec.get("twinsOnly", True) else None
    t_split = time.time()
    moved = set()
    for ob in scene.objects:
        if ob.type != "MESH" or ob.data.name in moved:
            continue
        me = ob.data
        moved.add(me.name)
        n = len(me.vertices)
        if n == 0:
            continue
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        nrm = np.empty(n * 3, np.float32)
        me.vertex_normals.foreach_get("vector", nrm)
        # 1 mm in the world, whatever the object's scale.
        scale = max(1e-6, float(np.mean([abs(x) for x in ob.matrix_world.to_scale()])))
        shift = np.full(n, 0.001, np.float32)
        if twins is not None:
            me.calc_loop_triangles()
            tv = np.empty(len(me.loop_triangles) * 3, np.int32)
            me.loop_triangles.foreach_get("vertices", tv)
            on = np.zeros(n, bool)
            flags = twins.get(me.name)
            if flags is not None and len(flags) * 3 == len(tv):
                on[tv.reshape(-1, 3)[flags].reshape(-1)] = True
            if me.name in opposed:
                tots = np.empty(len(me.polygons), np.int32)
                me.polygons.foreach_get("loop_total", tots)
                starts = np.empty(len(me.polygons), np.int32)
                me.polygons.foreach_get("loop_start", starts)
                lverts = np.empty(len(me.loops), np.int32)
                me.loops.foreach_get("vertex_index", lverts)
                pp = np.unique(opposed[me.name])
                idx = np.concatenate([np.arange(starts[q], starts[q] + tots[q]) for q in pp]) if len(pp) else np.zeros(0, np.int64)
                on[lverts[idx]] = True
            shift = np.where(on, shift, 0.0).astype(np.float32)
        if me.name in lift:
            pl = np.zeros(len(me.polygons), np.float32)
            np.maximum.at(pl, lift[me.name][0], lift[me.name][1].astype(np.float32))
            tots = np.empty(len(me.polygons), np.int32)
            me.polygons.foreach_get("loop_total", tots)
            lverts = np.empty(len(me.loops), np.int32)
            me.loops.foreach_get("vertex_index", lverts)
            vl = np.zeros(n, np.float32)
            np.maximum.at(vl, lverts, np.repeat(pl, tots))
            shift += vl * LAYER_STEP
        me.vertices.foreach_set("co", co + nrm * (np.repeat(shift, 3) / scale))
        me.update()
    print("TOUR_INFO cycles sheets apart %.1fs" % (time.time() - t_split), flush=True)

`
