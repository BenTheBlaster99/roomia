# Engineering map: Roomia performance (12 Nov 2026)

Source: chatgpt9.txt (our brief) and feedback2.txt (ChatGPT's answer). This map keeps what is right in that answer, corrects what the code shows to be wrong, and turns it into ordered steps with files, tests and acceptance rules. Rule throughout: **one change at a time, judged by eye on crops, never by PSNR.** No step may make an approved image worse.

## 0. Facts the code settles (so nobody re-investigates them)

| ChatGPT's question | Answer from the code |
|---|---|
| Are the 14 points rendered in one Blender process? | **Yes.** `scripts/look_pipeline.py` writes one `job-render.json` with every view; `look_render.py` opens `prepared.blend` once, `use_persistent_data = True`. Nothing to fix. |
| Does the video spawn Blender per frame? | **No.** `lib/scene-video.ts` runs one Blender, `bpy.ops.render.render(animation=True)` (line ~519). But frames are PNG written to `<scene>/video/work/frames` = **the NTFS/FUSE data disk**. That is a candidate for the fixed per-frame cost. |
| Does the 3D plan import the GLB? | **Yes.** `renderPlan3d` uses `SCENE_SETUP_SCRIPT` + `tourSceneSpec` (glb: `source.glb`). `prepared.blend` (look prep) or the tour's `scene-cache-*.blend` already hold the same scene. |
| Is the camera search 4,096 casts per candidate? | No: per *camera that needs moving* (16 dirs × 8 radii candidates × 32 clearance casts). Only cameras with < 0.75 m clearance search. The likely dominant cost of the 290 s is the **sun search**: 24 azimuths × 3 elevations × (points × 25 floor samples) ≈ 25,000 casts, each re-cast up to 12 times through glass, on a 2 M-triangle depsgraph. Must be profiled (step 1). |
| Plan drawing: replace the 60-iteration dilation by one big dilation? | **Wrong.** It is a *geodesic* growth (constrained by `free`, stopped by walls). A plain dilation crosses walls. Replacement must be a constrained propagation (step 6). |
| Path guiding | Not on GPU. Dropped. |
| Bounces | Keep 12/8/6. Dropped. |

## 1. Profile the scene analysis (CPU, ~290 s) — first, 10 min, zero risk

File: `scripts/look_analyze.py`. Add `time.time()` marks and print `LOOK_TIME sun %.1f`, `LOOK_TIME emissive %.1f`, `LOOK_TIME cameras %.1f`, `LOOK_TIME move %.1f`. Run on DayTestF5 (`auto-dir` of your choice; delete that dir's `analysis.json` first). Read the four numbers before touching anything.

Then, in this order, each one re-timed:
1. **Cache**: `look_pipeline.analysis()` already skips when `analysis.json` exists. Make the key explicit: store `{"sourceMtime", "sourceSize"}` of `source.glb` (or `prepared.blend`) in `analysis.json`; reuse across auto-dirs by also writing a copy to `look/analysis-cache.json`. A re-render of the same file never re-analyses.
2. **Sun search coarse-to-fine**: azimuth step 30° with 9 floor samples per point (the 3×3 subset of the 5×5 grid) and 2 elevations (5, 13) → pick the best 2 azimuths → refine at 15° and 7.5° around them with the full grid and 3 elevations. Keep the same scoring. Acceptance: the chosen azimuth is within 15° of today's on DayTestF5 (15°), Suite and F2.
3. **Clearance casts**: `clearance()` casts 32 rays per candidate. Pre-filter candidates with 8 directions at eye height; only candidates whose 8-ray minimum is ≥ `old + 0.2` get the full 32. Acceptance: the same `moved` positions on DayTestF5 (`analysis.json` cameras[].moved within 5 cm).
4. The emissive scan iterates every material's nodes and every object's slots: cheap, leave it.

Target: 290 s → under 120 s. Hard rule: the final camera positions still pass the existing full clearance check.

## 2. 48 → 32 samples A/B on the 360 — 10 min, decision by eye

Bench exists: the session's `bench.py` pattern (job with `samples`, `noise`, same recipe). Points: DayTestF5 **t4** (dining + kitchen: black counters, LED lines, pendants) and **t11** (bedroom: curtains, slats, fabric). Render 48/0.03 and 32/0.03, same seed, finalize both with `look_finalize_panos.py`. Crops at 100 %: marble veining, curtain edge, slat shadows, LED strip, pendant highlight, black counter noise. Also enable `vl.cycles.pass_debug_sample_count` for one render and report the share of pixels that reached 48: if under 30 %, the saving is small and the test is moot.

Adopt 32 only if the user cannot tell them apart. Then it goes in `look_pipeline.job()` (`ROOMIA_LOOK_SAMPLES` default). Never 24 without a second approved A/B.

## 3. 3D plan from the prepared scene — 10 min, the memory fix

File: `lib/scene-tour.ts` `renderPlan3d` + `PLAN3D_SCRIPT`.
- Replace the GLB import (`SCENE_SETUP_SCRIPT`) by opening `look/prepared.blend` when it exists, else the newest `scene-cache-*.blend` in the scene dir, else fall back to the GLB import. Opening a `.blend` is `bpy.ops.wm.open_mainfile`; the script then applies only what the plan needs (cut at 1.6 m, white world, sun, remove roomia lights/sky objects named `roomia_*`/`look_*`).
- `prepared.blend` carries the look's lights and sky dome: hide every `look_*` light and the dome for the plan (it has its own flat light).
- Keep the memory guard. Measure peak RSS both ways on DayTestF5 with only Cursor open (`/usr/bin/time -v`). Acceptance: the plan looks the same (walls, furniture, cut height) and the peak is lower; the F5 3D plan must succeed with a browser open (≈3 GB less headroom).

## 4. Video: measure the fixed cost, then move it onto the recipe

### 4a. Measure (10 min, F2, 10 frames)
In `VIDEO_SCRIPT` (`lib/scene-video.ts`): print `VIDEO_TIME frame <n> sync <s> render <s> write <s>` using a `render_pre`/`render_post`/`render_write` handler set and `time.time()`. Run the same 10 frames three ways: (a) as today; (b) frames written to ext4 (`os.environ["ROOMIA_VIDEO_WORK"]`, default `~/.cache/roomia-video/<scene>`); (c) OPEN_EXR half instead of PNG (only if write time matters). Expect: if write is > 2 s/frame on NTFS, (b) alone is the win.

### 4b. The video on the daylight recipe (the look must match the 360)
New path, same file: when `look/prepared.blend` and `look/<auto>/recipe-auto.json` exist, the video opens `prepared.blend`, `exec`s `look_apply.py` with that recipe (exactly as `look_render.py` does), renders **Cycles** with the recipe's groups summed in the compositor (copy the compositor block of `look_render.py` mode `pano`), applies the look's grade (`look_grade.grade`) per frame in the compositor or in a post pass, **24 spp, adaptive 0.05, OptiX denoise per frame first**. The EEVEE path stays as the fallback when no recipe exists (projects without the look).
- Test: a 10-second clip = 150 frames at 15 fps, 1280×720, on DayTestF5 Scène 5's shot. Record s/frame. Compare the same frame with the 360's crop at that direction: same light, same colour.
- Then test `bpy.ops.cycles.denoise_animation` on a 20-frame segment (needs multilayer EXR with denoising data + vector pass) against per-frame OptiX; watch curtains, thin edges, floor highlights frame by frame. Keep whichever has no flicker.
- Frame rate: keep 15 fps for the user's approval; interpolation (RIFE) is a later, separate decision (it saves nothing unless source fps drops below 15).
Acceptance: the user approves the 10-second clip before any 4-hour run.

### 4c. Object count (later, medium risk)
`scripts/look_prep.py` makes `prepared.blend`. Add a render-only pass: share identical mesh datablocks (same vertex count + same bounds + same material set → `obj.data = first.data`), then join static objects per material within 3 m cells, keeping a `roomia_src` custom property with the original names. Measure sync time per frame before/after (4a's numbers). Do this only after 4a says sync dominates.

## 5. Scheduling: the GPU never waits (no second Blender)

Today `look_pipeline.render` is: Blender (all points) → finalize (all) → install. Change to streaming:
- `look_render.py` already prints `LOOK_PANO {...}` per point and writes `<name>-lin.npy` when the point is done. `look_pipeline.blender()` reads stdout line by line (it currently redirects to a file: switch to `subprocess.Popen` with a tee to the log). On each `LOOK_PANO`, push the point to a **single** CPU worker thread that runs the finalize for that point alone (`look_finalize_panos.py` must accept one name and a fixed group exposure: add `--exposure <ev>` so the per-point pass can run before the group median is known; the group median pass at the end only re-grades the PNGs, which is seconds).
- `cv2.setNumThreads(2)`, `OMP_NUM_THREADS=2` for the worker so Blender's CPU side keeps 4 cores.
- The AI finish: `ai-prepare` renders all points then cuts; make the gateway sends start per point as soon as its tiles are cut (the gateway script already takes a dir), 2 requests in flight, while Blender renders the next point's masks.
- Queue limit 1 unfinished point for the lay-back (each holds ~1.5 GB of arrays). Never run the 3D plan while a lay-back runs.
Test: 3 consecutive points with and without the worker; Blender per-point time must not grow by more than 5 %, RSS must stay under 11 GB.

## 6. Plan drawing (33 s) — small, last

`scripts/plan_arch.py`: the geodesic growth loop. Replace by: label the connected components of `free & ~dil(barrier, m(0.05))`; for each component that contains exactly one seed label, assign the label to the component where `distance_transform_edt` from the seed region ≤ 0.75 m (compute the EDT once on `~seeds` per label only for the few labels, at half size). Components with several seeds keep the iterative loop (rare). Acceptance: identical `plan-rooms.json` areas within 0.1 m² on DayTestF5 and F2.

## 7. Budget to aim for (RTX 3060, F5, 14 points)

| Stage | Today | After steps | Note |
|---|---|---|---|
| Analysis | 290 s | ≤ 120 s, 0 s when cached | step 1 |
| 360 render | 14 × 60 s | 14 × 45–60 s | step 2 only if approved |
| Finalize + install | 70 s after | hidden in render | step 5 |
| 2D plan | 2–3 min | 2 min (cut dominates: opens prepared.blend) | the cut could run inside the same Blender session as the render: later |
| 3D plan | fails / unmeasured | measured, memory-safe | step 3 |
| **360 + both plans** | 22–25 min + 3D | **17–20 min** realistic; 15 min needs step 2 approved and the cut merged into the render session | |
| Video 70 s | 4 h (EEVEE) | measured by 4b; target ≤ 2.5 h at 720p/15 fps/24 spp | |

Laptops: publish three measured tiers (entry / mid / high RTX) from real runs; never a blanket promise. CPU-only machines: a separate expected time.

## 8. What stays untouched

Bounces 12/8/6; light groups and the compositor sum; the per-point exposure and neutral white balance; the AgX grade; the camera clearance validation; the fence in `pano_finish.py`; the cost gate (`--yes`) on every AI call.

## 9. Order of work and who

1 → 2 → 3 → 4a → 4b (user approves the clip) → 5 → 6 → 4c. Each step is one commit with its measurement in the message. Logs to keep: `analyze.log` (`LOOK_TIME`), `render.log`, `video/status.json` timings, `/usr/bin/time -v` for the 3D plan.
