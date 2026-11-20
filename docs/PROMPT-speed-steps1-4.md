# Roomia: cut the F5 render time (steps 1–4) and help the architect choose the points (step 5), engineering brief for Sonnet 5.5

You work alone on this. Implement, measure and verify the five changes below, then write a report. Read the whole brief before touching anything. When the brief and your own judgement disagree, follow the brief and note the disagreement in the report.

## 1. Context

Roomia turns an architect's SketchUp file (GLB) into a 360° virtual tour, rendered with Blender 4.5.9 Cycles on the user's PC, then finished by an image model that relights each 360°. The desktop app (Electron + Next.js server + Blender) runs the whole chain from one button.

The image quality was approved by our partner architect on 19–20 Nov. **It is locked.** Your job is to save time without any visible change.

Test apartment: "F5", 15 viewpoints, 512 MB GLB, about 2M triangles, 543 materials.
Machine: RTX 3060 12 GB, i5-9400F (6 cores), 16 GB RAM. Projects live on a slow NTFS hard disk (FUSE). The root SSD has about 8 GB free.

### Measured baseline (20 Nov, one launch on a new F5 file, about 80 min, all stages in sequence)

| Stage | Time | Where |
|---|---|---|
| A. Tour build | 20.5 min: open 36 s, placement 99 s, plan 17 s, **quick 360s ("faces") 1,040 s**, assembly 31 s | `lib/scene-tour.ts`: TOUR_SCRIPT (embedded Python), `build()`, TOUR_TIME lines |
| B. Prepare + analysis | about 8–10 min first time: prepared.blend 949 MB, sun search 168 s, camera check 48 s, material recognition about 4 min (cached after) | `scripts/look_pipeline.py` (ensure_prepared, analysis), `scripts/look_analyze.py`, `scripts/look_materials.py` |
| C. Quality render | about 2 min 15 s per view: open about 13 s per Blender process, scene sync about 7 s, **path tracing about 88 s**, **compositor denoise + light-group sum about 22 s (CPU)**, save about 2 s. Rendered in 2 tiles ("Reading full buffer from disk"). GPU memory used: 3.4 GB of 12. 2 views per Blender process (ROOMIA_LOOK_BATCH). | `scripts/look_pipeline.py` render stage, `scripts/look_render.py` |
| D. AI light finish | generation through the gateway, 2 at a time, about 60–90 s each; transfer 33–50 s per view, one at a time, **after** all of stage C | `lib/look-pipeline.ts` (startLookAi, makeLight), `scripts/pano_ai_light.py`, `scripts/pano_look_transfer.py` |

Profile of one transfer (cProfile, 38.5 s): **24.6 s in 13 calls to `cv2.GaussianBlur` at full 4096×2048**, 2.9 s optical flow, 1.3 s boxFilter, about 3 s sRGB/linear conversions.

## 2. The five changes

### Step 1: skip stage A's quick 360s when the quality render follows (target: −17 min)
- The quick 360s (TOUR_SCRIPT, from `# Cycles (28 Oct, ChatGPT): one equirectangular render per viewpoint` up to `TOUR_TIME faces`, including the per-view meter and fill renders) are replaced by stage C. The client never sees them; the 15 Nov rule is "never show a Blender-only image".
- Add a spec flag (for example `skipPanos`) that `build()` sets when the quality render runs right after (the AUTO_LOOK / one-launch path). Everything that is not a 360 render must still happen: placement, plan, nav.json, objects.json, views' positions/yaw/level, hotspot links, plan geometry.
- Known safe so far: `look_pipeline.py` takes positions from tour.json (`points()`), computes its fills from positions (`job()`), and `install()` sets `v["pano"]` when it is missing.
- **You must audit every other reader of `tour/pano-N.jpg` and `pano-raw-*`** before relying on it: the points editor (`proposalFromBuild`, `openPointsEditor`, PointsEditor.tsx), the tour page while building, partial rebuilds (keep.json / Reuse), the AI step (`blenderPano`), photos framed in the 360 (`source: "360"`), publish, the walk, video. List every reader and how it behaves without the quick 360 in the report.
- During the build the project page must show progress, never an empty or broken tour.

### Step 2: run stage D per view while stage C renders (target: −15 to −20 min wall time)
- The renderer is the slow side (about 2.2 min per view). Generation (about 75 s) and transfer (about 10 s after step 3) should run on views that are already done while the GPU renders the next one.
- Have the render emit one line per finished view (for example `VIEW_DONE <index> <path>`). Node (`lib/look-pipeline.ts`) starts that view's AI generation (concurrency 3; the gateway sometimes answers 502, so keep the existing retry) and its transfer (one CPU worker; two at most).
- **Exposure caveat:** `look_finalize_panos.py` exposes each view for itself but clamps it to ±RANGE stops around the **group** median, so a view's final exposure depends on the others. Recommended approach: start the AI generation from the view's own exposure, then after the last view re-run the group finalize and redo only the cheap transfer for the views whose exposure moved. The AI image only gives light ratios, so a small exposure difference in its input does not matter. Verify this claim; if it is wrong, say so and choose another quality-neutral design.
- Keep every existing rule: an AI failure never publishes a Blender-only 360; `maxCost` and the credit ledger stay as they are; stopping (`stopLook`) must stop all three workers cleanly; a crash must be resumable (`lib/desktop-resume.ts`); progress text stays in French.

### Step 3: make the transfer fast (target: 38 s → 10 s or less per view, same image)
- In `pano_look_transfer.py` the big Gaussian blurs (sigma about r/2 = 48 px and wider) produce smooth maps. Compute those at 1/4 resolution (1024×512, sigma / 4, keep the horizontal wrap with `wrap()`/`unwrap()` scaled accordingly), then upsample with INTER_LINEAR. Do the same for any other full-resolution step whose output is smooth. Keep float32.
- Leave the 20 Nov tone settings untouched: `--knee 0.6`, `--knee-range 1.5`, `--lift 1.10`, `--hot 0`, `--hot-low 0`, `--headroom 0`, gain 0.75–1.6, radius 96.
- Acceptance on all 15 F5 views compared with the current output: mean absolute difference ≤ 0.5/255, 99.9th percentile ≤ 3/255, and no visible difference on 100% crops (window frames, the coffee table in view 17, dark corners, the bathroom floor in view 16).

### Step 4: final denoise on the GPU, one tile (target: about −20 s per view)
- `look_render.py` sums the light groups and denoises in the **compositor** (`CompositorNodeDenoise`, prefilter ACCURATE), which runs on the CPU. Find out from the Blender 4.5 Python API (inside Blender: `dir(scene.render)`, the manual) whether the compositor can run on the GPU in background renders (for example `scene.render.compositor_device`) and whether the Denoise node then uses the GPU. If yes, switch it on; if not, report it and propose the next-best quality-neutral option. Do not replace OIDN ACCURATE with something lower.
- Render in one tile if GPU memory allows (it uses 3.4 GB of 12): check the 4.5 property names (`use_auto_tile`, `tile_size`) and confirm the log no longer says "Reading full buffer from disk".
- Acceptance: same thresholds as step 3, on the linear EXR and on the final JPEG, for at least 4 views (0, 4, 16, 17).

### Step 5: duplicate points flagged, live time estimate before "Lancer" (product, no render change)
The flow stays as it is since 14 Nov: "Placer les points de vue" proposes the points on the 2D plan (`placementOnly` → proposal.json), the architect edits them in `PointsEditor.tsx`, and "Lancer" starts the render. The user's decision (21 Nov): the architect confirms every point on the plan before any render, and decides the number of points knowing what it costs. Two additions:

**5a. Near-duplicate points.**
- On the F5, Point 1 and Point 6 (views 8 and 13, auto-20 and auto-12) stand almost at the same spot in the kitchen and nobody noticed.
- Placement (the placementOnly run of TOUR_SCRIPT, `lib/scene-tour.ts`): do not create an automatic point that is too close to another point (automatic or architect scene) **and** sees it directly (no wall between them; use `scene.ray_cast`). Start from 1.5 m, report the value you settle on and why.
- The proposal also lists the remaining near-duplicate pairs (same level, close, clear line of sight), so the editor can show them. That includes pairs the architect creates by moving or adding a point (compute in the editor from plan positions, metres from the plan scale; the wall check may come from the placement data).
- PointsEditor: mark both points of a pair and say it plainly in French, for example « Les points 1 et 6 se ressemblent : vous pouvez en retirer un. » One click on the message selects the pair. Never remove a point by itself; the architect decides.
- Check on the F5 copy: re-run the placement, report the old and the new point count and positions, and make sure no room lost its only point.

**5b. Time estimate next to "Lancer", updating live.**
- Show, beside the launch button, the expected time for the points that are ticked, for example « 15 points · environ 35 min sur ce PC ». It updates at once when a point is added, removed, ticked or unticked.
- Reuse what exists: `app/studio/components/DesktopRenderNotice.tsx` already estimates a tour from a point count (and has a `fmt`). Base the per-point time on this PC's own measured renders when there are some (the render logs/state of earlier projects), else on the GPU profile the app already detects. Use the timings you obtain after steps 1–4, not today's.
- Keep the wording short and honest (« environ »), no price, no DA (the 14 Nov rule: no money shown in this flow).
- Check: screenshot the editor with 15 and with 20 points ticked for the report.

## 3. Hard rules

1. **Do not touch tomorrow's demo.** The user demos the app from `/media/jackhammer/DATA/Linux-Work/Projects/roomia-w` with the F5 project. Never edit files in `roomia-w` or `roomia`, and never write into the project `BlocBF5Demo0000000001`.
   - Work in a git worktree: `git -C /media/jackhammer/DATA/Linux-Work/Projects/roomia-w worktree add ../roomia-speed -b work/speed-steps1-4 work/18nov-studio-quality`. Symlink `node_modules` and `desktop/node_modules` from roomia-w.
   - Test on a copy of the F5 in a separate projects folder, so it never appears in the demo app's project list: `cp -a /media/jackhammer/DATA/Linux-Work/roomia-desktop-test/projects/BlocBF5Demo0000000001 /media/jackhammer/DATA/Linux-Work/roomia-speed-test/projects/BlocBF5Speed000000001` (same 21-character id format). Point SCENES_DIR at `/media/jackhammer/DATA/Linux-Work/roomia-speed-test/projects`. Any test app or server you start must use its own data folder (for example `XDG_CONFIG_HOME=$HOME/roomia-speed-config`), never `~/roomia-fresh-config`.
2. **Quality is locked.** No change to samples (128), adaptive threshold (0.01), bounces (12/8/6), texture limits, resolution (3072×1536 render, 4096 final), downlights 90 W, exposure target 0.57, the denoiser type, the material rules, or the tone settings. No AI-generated textures.
3. **Services.** Never start, stop or restart `roomia-studio` or `roomia-tunnel`. If `systemctl --user is-active roomia-studio` says active, the user is demoing: do not start any new render until it is inactive again. Ports: 3000 is the Studio, 3002 belongs to another program; use 3011 for any test server.
4. **Heavy work.** Run every Blender render inside `systemd-run --user --scope -q -p MemoryMax=12G`. Never run two Blender processes at once, nor a Next build during a render. For Blender's Python use `PYTHONPATH=<worktree>/desktop/pylib-linux` and `/media/jackhammer/DATA/Linux-Work/tools/blender-4.5.9-linux-x64/4.5/python/bin/python3.11`. For the AI environment use `env -u PYTHONPATH /home/jackhammer/roomia-ai-venv/bin/python`. Render env: `ROOMIA_BLENDER=/media/jackhammer/DATA/Linux-Work/tools/blender-4.5.9-linux-x64/blender ROOMIA_GPU_VRAM_MB=12288 ROOMIA_GPU_BACKEND=OPTIX ROOMIA_RAM_MB=15415`.
5. **Money.** The copy already holds the AI images of the F5 (`look/sunburst/`), and `pano_ai_light.py --finish-only --transfer` reuses them for free. Test steps 1, 3 and 4 that way. For step 2, use a fake gateway (a delay of 60–90 s that returns the existing AI image) for all development runs. You may spend **at most 3 real AI images (about 48 DA)** on one final end-to-end check. Never more.
6. **Disk.** The root SSD has about 8 GB free; each Next build takes 600 MB. Delete what you create in `~/.cache` when you are done. Keep work files on the DATA disk or in your own scratch folder.
7. **Git.** One commit per step on `work/speed-steps1-4`, with the measurement in the message. Do not merge, push, release or publish anything. Do not delete branches.
8. **Never claim a saving you did not measure.** Every number in the report comes from a log you can quote.

## 4. Measurement protocol

- **Baseline first:** on the copy, run stage C + D as today (`look_pipeline.py render` then `pano_ai_light.py --finish-only --transfer`) for 4 views (0, 4, 16, 17). Record per-view times from the Blender log (sync, path tracing, compositing, saving) and per-transfer times. Keep those images as the reference.
- After each step, run the same 4 views and compare times and images with the thresholds above.
- At the end, run the full F5 copy from the app's one-button path (fake gateway, plus the 3 real images if you choose to) and record the wall-clock time per stage.

## 5. Deliverables

- `docs/REPORT-speed-steps1-4.md` in the worktree, containing:
  - the baseline and the result per step: times, image diffs, crops checked;
  - the list of quick-360 readers from step 1;
  - what you could not do, and why;
  - what you would do next (the queue was: 4–5 views per Blender process with `malloc_trim`, the fast sun search `sunFast` checked against today's azimuth, material recognition overlapped with stage A, `emission_sampling = 'NONE'` tested on decorative glow meshes).
- The five commits on `work/speed-steps1-4` (one per step).
- Expected end state: the F5 first run at about 35–40 min after steps 1–4 (80 min today), plus the editor flagging near-duplicates and showing the time before launch. State honestly where you landed.
