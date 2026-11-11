# Visite libre with the AI's detail: engineering plan (11 Nov 2026)

Written for the engineer (Claude Sonnet 5.5 or whoever) who builds this in a later session. It assumes the Roomia
repo at commit 54b0b34 (branch work/look-recipe-and-desktop-8nov) and the memory notes splat-walk.md, look-recipe.md,
roomia-explorer.md, splat-feedback-7nov.md. Read docs/HANDOFF-scene-pipeline.md first, as AGENTS.md says.

## 0. The one idea

The walk ("Rendu reel", app/studio/explore/[id]/splatLayer.ts) draws each surface as

    picture = light(splat, per 3D position)  x  colour(model texture, unlit)

and the trainer (scripts/splat_train.py, `albedo_of`, line ~127) builds the light as

    light = Cycles picture / the model's own colour pass (<pano>-albedo.npy, rendered from model.glb unlit)

So if the model's colour textures gain fine detail AFTER training, the walk shows picture x (new colour / old colour)
with no retraining. The AI-finished 360s (look/auto/t<N>-final.png, 6144 px) hold exactly that kind of detail, and
their Blender base (t<N>-pano.png) was rendered with the same light, so

    detail ratio  r = final / base  (high-passed)

is light-free: it is the multiplier the AI applied to the surface's texture. The whole plan is: give every surface a
texture of its own (unique UVs), project r from the AI 360s onto those textures, repack the model, show it.
No AI call is needed for a room whose 360 is already finished; new rooms cost the usual 84 DA per point (6 tiles)
or 140 DA with the ring row, through the existing `look_pipeline.py ai-prepare / ai-finish` stages.

Why the earlier attempts failed, and what this avoids (see roomia-explorer.md, 31 Oct): projecting WHOLE AI pictures
onto the model smeared colour and shapes from one viewpoint over surfaces seen at grazing angles. Here only the
high-pass ratio moves, colour and light never do, and texels with no good source stay as they are (SketchUp texture).

## 1. Scope of the proof: one room, zero DA

Room: the F5 dining room (scene ULG_TkfMj3WOXDBmlVtm2, tour view index 6 "Scene 7"; eye = view position in
tour.json, the AI-finished pano is look/auto/t6-final.png with t6-pano.png, t6-masks.npz, t6-albedo.npy,
tiles in look/auto/tiles-t6/ incl. the ring row r0..r3). CAVEAT 11 Nov: these files were unreadable after the
NTFS crash (see section 7). If chkdsk does not bring them back, re-buy the dining point: 84 DA + 56 DA ring,
via `look_pipeline.py ai <id> --points 6 --ring 6 --yes` (credit was topped up by Mehdi on 11 Nov).

Pass/fail is judged BY EYE on full-screen walk shots (1600x900 or the user's screen), never by PSNR
(splat-feedback-7nov.md). Three fixed camera poses, before vs after, same light:
  A. standing at the tour point, looking at the far wall + table (the easy view)
  B. 60 cm above the table, looking down at the table top, chairs and the floor around the legs (where 31 Oct failed)
  C. 40 cm from a wall, looking along it at a grazing angle (smears show here)
plus a 4th free shot the user chooses. Secondary number: high-frequency energy of A/B crops after vs before, as in
pano_finish.py's "detail gained" check; it must go UP and the low-pass must be UNCHANGED (< 1/255 mean difference),
otherwise the fence leaked light.

## 2. Step A: unique UVs and baked base colour (Blender, free)

New script `scripts/walk_unwrap.py`, run inside the capture scene (hook it into SPLAT_CAPTURE_PY in
lib/splat-capture.ts right before the model export, option `uniqueUV: {rooms|all, pxPerCm, maxSize}`), or as a
standalone pass over the saved capture .blend. It must run AFTER materialOverrides and BEFORE
`bpy.ops.export_scene.gltf` (lib/splat-capture.ts ~line 1162), and the colour pass `albedo_render` (~line 1183,
imports model.glb) must then use the SAME model.glb so light = picture / new-model colour stays consistent. Order:
  unwrap+bake -> export model.glb -> colour pass -> training.
For the proof, where the splat is already trained, the shortcut is: unwrap+bake -> export model-ai.glb -> packSplatModel
-> show. The light stays the old one. The ratio argument in section 0 holds because the baked colour equals the
old colour until step B multiplies it.

Per object in scope (objects whose bounding box centre is within R m of the room's tour point AND whose first
material is not glass/mirror/emissive; R = 6 for the dining room; take `seeThrough` from splat-v4.json to skip):
  1. Keep the original UV layer (name it `uv_src`), add `uv_unique`, make it active and active_render.
  2. Unwrap with `bpy.ops.uv.smart_project(angle_limit=66 deg, island_margin=0.003, correct_aspect=True,
     scale_to_bounds=False)` in edit mode on that object only. Objects with > 200k triangles: skip (keep tiled UVs;
     log them), they are furniture meshes from 3D66 and their textures are already unique in practice.
  3. Texture size from surface area: px = clamp(sqrt(area_m2) * 100 * pxPerCm, 256, maxSize), rounded to a power
     of 2; pxPerCm = 4 (a 4 m wall -> 1600 -> 2048 px), maxSize 4096 for the proof, 2048 in production.
     Group small objects (area < 0.5 m2) into shared atlases of 2048 with `bpy.ops.uv.pack_islands` after joining
     their unwrap into one UDIM-free layout: simplest is to leave them per object at 256..512 px.
  4. Bake, Cycles, into images named `rm_<object>_<kind>`:
     - `col`: bake type DIFFUSE with only Color enabled (no direct, no indirect) = the base colour as the walk draws it
       (texture x colour). 1 sample, margin 8 px, use_clear. Save PNG 8-bit sRGB.
     - `pos`: bake type POSITION (Blender 4.x, world space) -> EXR float32.
     - `nrm`: bake type NORMAL, space OBJECT? no: WORLD is not offered; use the "Position" trick instead:
       bake NORMAL in TANGENT space is useless here; bake with an emission shader that outputs the Geometry node's
       True Normal in world space (temporary material swap), EXR.
     - `id`: optional, the material index as a flat emission colour, PNG.
  5. Swap the object's material slots for copies whose Base Color is `rm_<object>_col` through `uv_unique`
     (UV Map node), keep roughness/metal/normal inputs as they were but ALSO through uv_unique only if they were
     image textures (else they tile wrongly): bake them too (`rough`) when present, or drop normal maps for the proof.
  6. Export model.glb as today (packSplatModel keeps textures at textureSize; set textureSize=4096 for the proof,
     the dining room alone is small). Record `walk-unwrap.json`: per object {texture, size, area, px_per_cm, skipped}.

Checks before going on: the walk shows the room with ?view=2 (colours alone, splatLayer.ts) IDENTICAL to before
(mean |diff| < 1/255 on shot A). If not, the bake changed colour (sRGB/linear mistake, margin bleeding) and step B
would inherit it.

## 3. Step B: project the AI detail ratio onto the textures (Python, no Blender, free)

New script `scripts/walk_ai_detail.py <scene> --sources 6[,9,...] --out look/walk-ai/`, run with the AI venv
(/home/jackhammer/roomia-ai-venv/bin/python; needs numpy, cv2, OpenEXR or `imageio` with the freeimage plugin;
tifffile is the fallback: save pos/nrm as float TIFF from Blender instead of EXR).

Inputs per source point k: eye_k (tour.json view position, glTF coords; convert with the same gl2b as
look_render.py: blender (x, -z, y)), base_k = t<k>-pano.png (3072x1536, display sRGB), final_k = t<k>-final.png
(6144x3072), masks_k = t<k>-masks.npz with `depth` (metres, half size 1536x768, float16), `mat`, and the fence
masks (ceiling, mirror, glass, sky, emit). Equirect convention = look_render's pano mode: middle column looks along
+yaw (yaw 0 = +x in Blender), rows from +z (up) at the top; reuse pano_tiles.look_bl / the `cut` math inverted.

For each texture T (from walk-unwrap.json) with pos (H,W,3 world Blender) and nrm:
  1. For each source k: d = pos - eye_k; dist = |d|; u,v = equirect(d). Validity:
     - depth test: dist <= depth_k(u,v) * 1.03 + 0.02 (the texel is what the pano saw, not something behind it)
     - facing: dot(nrm, -d/dist) >= 0.3 (no grazing projections: this is what smeared on 31 Oct)
     - not inside a fenced area of the pano: fence alpha from pano_finish's masks (ceiling 0, mirror 0, glass 0.15,
       emit 0, sky 0), eroded by 12 px at 6144
     - resolution: px_per_cm_at_texel = (6144 / 360) / (dist * 100 * pi / 180)... simpler: texel footprint in the pano
       in px = (texture px/cm)^-1 ... compute s = pano px per texel; require s >= 0.5 (the pano must have at least half
       a pixel per texel, else it adds nothing but blur)
  2. Ratio: r_k = final_k / max(base_k_upsampled_to_6144, 0.02), per channel, in display sRGB (both are display
     images; the ratio of two displays of the same light is a fine texture multiplier; do NOT linearise, the AI edit
     lives in display space too). High-pass: r_hp = r_k / gaussian(r_k, sigma = 8 px at 6144) so any residual low-frequency
     drift the AI left (pano_finish already removed most) cannot move colour. Clip r_hp to [0.6, 1.6].
  3. Weight w_k = facing^2 * min(1, s/2) * fence_alpha * seam_fade (fade over 6% of width at the pano's left/right seam,
     like look_finalize_panos). Blend: R = sum(w_k r_hp_k) / sum(w_k), where sum(w_k) < 0.05 -> R = 1 (texel untouched).
     Sample the panos with bilinear interpolation at the texel's (u,v); do it vectorised in numpy on the whole texture.
  4. Feather R toward 1 at UV island borders (distance transform of the island mask, 3 px) so no seam appears on the mesh.
  5. col_new = clip(col * R, 0, 1). Write `rm_<object>_col_ai.png` next to the original; keep both.
  6. Report per texture: covered fraction, mean |R-1| (should be 0.02..0.1), max, and a 512 px crop of before/after
     in look/walk-ai/sheet-<object>.jpg.
Then re-export: either re-run the Blender export with the _ai textures swapped (a tiny script that relinks image
paths and exports), or patch the textures inside model.glb directly with @gltf-transform (the repo already uses it in
packSplatModel): replace each image by name, then packSplatModel -> tour/splat-v5-model.glb (keep v4 untouched),
and a tour/splat-v5.json that is v4.json with `model` pointing at the new file. ExploreClient picks it with ?sv=v5.

## 4. Step C: the walk

Nothing new in the shader for the proof. Two small things:
  - the gloss pass uses the model's roughness; if step A baked `rough`, it keeps working; if it dropped normal maps,
    note it in the report (slat grooves may look flatter).
  - texture filtering: anisotropy 16 is already set; make sure the packed textures keep mipmaps (KTX/basis is
    not used; plain PNG/JPEG in GLB).
Shots for the judgement: scripts in /media/jackhammer/DATA/Linux-Work/roomia-splat/viewer (shot.mjs with
--use-angle=vulkan, see roomia-explorer.md 1 Nov) or the ?x=&y=&look= test spots in ExploreClient.

## 5. Production path (after the proof passes)

  - Step A runs inside the capture (lib/splat-capture.ts option `uniqueUV`) for ALL rooms, before export and before
    the colour pass, so training already uses the unique textures. Cost: bake time (~1-3 s per object, F5 has ~5000
    objects: budget 2-4 min; skip tiny objects < 0.05 m2 and the 3D66 furniture).
  - Step B runs after `look_pipeline.py ai-finish` for the chosen points (the desktop's "Finition IA" stage,
    lib/look-pipeline.ts), writing the _ai textures and repacking the model; the app then shows the new model.
  - Memory: a 4096 texture per wall is too much for F5 (hundreds of surfaces): 2 px/cm, 2048 max, 1024 for objects
    under 1 m2, JPEG in the GLB. Target packed model < 250 MB on desktop (there is no download: the app reads it
    from disk; browser Studio keeps v4).
  - Time: the 15-minute promise. Unwrap+bake ~3 min, projection ~1 min per source point on CPU; both can overlap
    the training (which is GPU).

## 6. Risks, in order

  1. Blender 4.5 bake types: POSITION exists (Cycles bake "Position"); verify on 4.5.9 in the first hour; the
     fallback is the emission-shader trick for both position and normal.
  2. SketchUp "twin sheets" (coplanar doubled faces, see splat-capture.ts 1036): the bake picks one; the walk draws
     both -> z-fighting shows the untouched twin. The capture already pushes twins apart; unwrap after that step.
  3. Objects shared by instancing (one mesh, many objects): make the mesh single-user before unwrapping or every
     copy gets the same texture (fine for chairs, wrong for walls).
  4. The ratio r at 6144 px vs a wall at 2 m: ~5 pano px per cm; the texture at 4 px/cm is matched. Chairs at 4 m
     get ~2.5 px/cm: the weight rule keeps blur out. Do not raise pano width to get more; it is paid.
  5. Judgement: looking down near furniture and the bathroom mirror are the two views that killed every earlier
     attempt (roomia-explorer.md). Shoot them first, not last.

## 7. State of the files on 11 Nov (NTFS crash)

After the PC crash of 10-11 Nov the DATA drive's MFT came back inconsistent ("Trying to read non-allocated mft
records"): every file written in the last days returns EIO, incl. .git/config, lib/splat-capture.ts,
scripts/look_render.py, F5's look/prepared.blend, look/auto/t6-final.png, t6-masks.npz, tour/splat-v4.json and
the benchmark copy roomia-benchmarks/F5-2026-11-08. The code is intact on GitHub (BenTheBlaster99/roomia, commit
54b0b34, tree saved in ~/roomia-salvage-11nov/github-tree.txt). Unsaved on GitHub and possibly lost: the 10 Nov
daylight edits (look_make_recipe.py and look_pipeline.py are saved in ~/roomia-salvage-11nov/; the three others,
look_apply.py `ob.visible_glossy = False` on downlights, look_render.py fills `visible_glossy = visible_camera =
False` + fill scaled by nearby spots, look_finalize_panos.py neutral target per look, are described in the 10 Nov
session and must be re-applied), visite-libre-ai-plan.txt, chatgpt*.txt, feedback*.txt, the DayTestF5 renders.
Next steps are in the chat of 11 Nov: chkdsk /f from Windows, then move the project to a healthy disk and re-clone.
