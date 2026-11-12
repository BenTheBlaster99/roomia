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
1. **Cache**: `look_pipeline.analysis()` already skips when `analysis.json` exists. Make the key explicit and reliable: `{"sourceHash": sha256 of source.glb (streamed, ~2 s for 512 MB; cache it beside the file as source.glb.sha256 keyed by mtime+size), "analysisVersion": 2, "params": {elevations, azimuthStep, eyeHeight, minClearance}, "blender": bpy.app.version_string}`. Store it in `analysis.json` and a copy in `look/analysis-cache.json`; reuse across auto-dirs only when every field matches. A re-render of the same file never re-analyses; a replaced file of the same size does.
2. **Sun search coarse-to-fine**: azimuth step 30° with 9 floor samples per point (the 3×3 subset of the 5×5 grid) and 2 elevations (5, 13) → pick the best 2 azimuths → refine at 15° and 7.5° around them with the full grid and 3 elevations. Keep the same scoring. Keep the exhaustive search behind `--sun-exhaustive` until the new one passes. Acceptance on DayTestF5 (15°), Suite and F2: azimuth within 15°, the score of the chosen direction within 10 % of the exhaustive best, and the sun patches of one rendered point (t4) visually in the same place.
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
- Test, in two sizes: first **15 frames** (per-frame time and a first look at flicker, ~5 min), then, only if the per-frame time is acceptable, the **10-second approval clip** (150 frames, 30–45 min at 12–18 s/frame). Record s/frame both times. Compare the same frame with the 360's crop at that direction: same light, same colour.
- Then test `bpy.ops.cycles.denoise_animation` on a 20-frame segment (needs multilayer EXR with denoising data + vector pass) against per-frame OptiX; watch curtains, thin edges, floor highlights frame by frame. Keep whichever has no flicker.
- Frame rate: keep 15 fps for the user's approval; interpolation (RIFE) is a later, separate decision (it saves nothing unless source fps drops below 15).
Acceptance: the user approves the 10-second clip before any 4-hour run.

### 4c. Object count (later, medium risk)
`scripts/look_prep.py` makes `prepared.blend`. Add a render-only pass: share identical mesh datablocks only on a real fingerprint (sha1 of the vertex array rounded to 0.1 mm + the face index array + material slot names; vertex count and bounds alone are not identity: two different chairs can share them → `obj.data = first.data`), then join static objects per material within 3 m cells, keeping a `roomia_src` custom property with the original names. Measure sync time per frame before/after (4a's numbers). Do this only after 4a says sync dominates.

## 5. Scheduling: the GPU never waits (no second Blender)

Today `look_pipeline.render` is: Blender (all points) → finalize (all) → install. Change to streaming:
- `look_render.py` already prints `LOOK_PANO {...}` per point and writes `<name>-lin.npy` when the point is done. `look_pipeline.blender()` reads stdout line by line (it currently redirects to a file: switch to `subprocess.Popen` with a tee to the log). On each `LOOK_PANO`, push the point to a **single** CPU worker thread that runs the finalize for that point alone (`look_finalize_panos.py` must accept one name and a fixed group exposure: add `--exposure <ev>` so the per-point pass can run before the group median is known; the group median pass at the end only re-grades the PNGs, which is seconds).
- `cv2.setNumThreads(2)`, `OMP_NUM_THREADS=2` for the worker so Blender's CPU side keeps 4 cores.
- The AI finish: `ai-prepare` renders all points then cuts; make the gateway sends start per point as soon as its tiles are cut (the gateway script already takes a dir), 2 requests in flight, while Blender renders the next point's masks.
- Queue limit 1 unfinished point for the lay-back (each holds ~1.5 GB of arrays). Never run the 3D plan while a lay-back runs.
Test: 3 consecutive points with and without the worker; Blender per-point time must not grow by more than 5 %, RSS must stay under 11 GB.

## 6. Plan drawing (33 s) — small, last

**Update 12 Nov:** the component idea below is moot on real apartments: the free floor is nearly one connected region (rooms open onto each other), so components with a single seed are rare. What exists instead: `ROOMIA_PLAN_GROW_DS=4` runs the same geodesic growth at quarter size (about 4× less work). Profile first (time the growth loop alone), then compare the room masks at DS=2 and DS=4 on DayTestF5 and F2; adopt DS=4 if they differ by under 0.5 % of pixels.


`scripts/plan_arch.py`: the geodesic growth loop. Replace by: label the connected components of `free & ~dil(barrier, m(0.05))`; for each component that contains exactly one seed label, assign the label to the component where `distance_transform_edt` from the seed region ≤ 0.75 m (compute the EDT once on `~seeds` per label only for the few labels, at half size). Components with several seeds keep the iterative loop (rare). Acceptance: on DayTestF5 and F2, the room masks differ by under 0.5 % of pixels (compare the label images, not only the areas) and `plan-rooms.json` areas within 0.1 m².

## 7. Budget to aim for (RTX 3060, F5, 14 points)

| Stage | Today | After steps | Note |
|---|---|---|---|
| Analysis | 290 s | ≤ 120 s, 0 s when cached | step 1 |
| 360 render | 14 × 60 s | 14 × 45–60 s | step 2 only if approved |
| Finalize + install | 70 s after | hidden in render | step 5 |
| 2D plan | 2–3 min | 2 min (cut dominates: opens prepared.blend) | the cut could run inside the same Blender session as the render: later |
| 3D plan | fails / unmeasured | measured, memory-safe | step 3 |
| **360 + both plans** | 22–25 min + 3D | analysis (0–2) + render (10.5–14) + 2D plan (2) = **12.5–18 min before the 3D plan**, whose time is unmeasured; the bundle target is set only after step 3 gives that number. 15 min for everything needs step 2 approved, the cache hitting, the cut merged into the render session and a 3D plan under ~2 min | |
| Video 70 s | 4 h (EEVEE) | measured by 4b. 2.5 h needs ≤ 8.6 s/frame; the 12–18 s estimate gives 3.5–5.25 h. No production expectation until measured | |

Laptops: publish three measured tiers (entry / mid / high RTX) from real runs; never a blanket promise. CPU-only machines: a separate expected time.

## 8. What stays untouched

Bounces 12/8/6; light groups and the compositor sum; the per-point exposure and neutral white balance; the AgX grade; the camera clearance validation; the fence in `pano_finish.py`; the cost gate (`--yes`) on every AI call.

## 9. Order of work and who

1 → 2 → 3 → 4a → 4b (user approves the clip) → 5 → 6 → 4c. Step 3 may move ahead of 2 since the 3D plan is a production blocker. Streaming (step 5) must produce byte-identical finalized PNGs to the sequential pipeline on 3 points before it replaces it. Each step is one commit with its measurement in the message; never two optimizations in one commit. Logs to keep: `analyze.log` (`LOOK_TIME`), `render.log`, `video/status.json` timings, `/usr/bin/time -v` for the 3D plan.

## Status (12 Nov, written by Sonnet 5.5 while the F5 video rendered)

| Step | State | What is left |
|---|---|---|
| 1 analysis | DONE on F5, measured (`LOOK_TIME` marks): exhaustive **sun 138.6 s + cameras/moves 129.3 s = 268 s**. (a) Content-hash cache: same scene in a new folder 0 s. (b) Coarse-to-fine sun search (`ROOMIA_SUN_FAST=1`): **57.5 s** (11,115 casts instead of 27,000), same azimuth 15° and the same top scores. (c) Camera search with the exact 8-ray pre-test: **53.4 s**, identical moves (Point 6 1.6 m, Point 8 1.2 m). Total with (b)+(c): **~111 s** | Check the fast sun search on the Suite and F2 (needs their `look/prepared.blend`), then make it the default; until then the exhaustive search stays the default. The pre-test (c) is already the default (exact) |
| 2 48 vs 32 spp | Rendered and measured on F5 t4 and t11 (2048×1024 test size): **39.1 → 33.3 s and 28.2 → 22.0 s per point (−15 to −22 %)**; difference 1.6 and 2.6 /255 on average, on thin edges only. Slider page sent to the user. **Not adopted: waits for the user's eye** | If approved: `ROOMIA_LOOK_SAMPLES` default 48 → 32 in `look_pipeline.job()` (about 10 s per point at 3072×1536, 2–3 min over 14 points) |
| 3 3D plan | DONE and measured on DayTestF5: from `prepared.blend` **2:30, peak 7.9 GB**; from the GLB **3:36, peak 9.2 GB**; images identical (mean diff 0.6/255, 0.14 % of pixels). Uses the prepared scene when it is newer than `source.glb`, else the GLB (`ROOMIA_PLAN3D_GLB=1` forces the old path) | Peak is still 7.9 GB: Blender's own scene; a render-only copy (shared meshes, smaller textures) is the next lever |
| 4a video I/O | Frames and raw EXR go to `~/.cache/roomia-video/<id>/`, not the data disk. Per-frame `VIDEO_FRAME n render s grade s` printed in the log. Not yet compared against NTFS | If needed: same 15 frames with frames on the data disk, to see the gain |
| 4b video on the recipe | DONE and used. 15-frame test on F5: **~8 s/frame** at 1280×720, 24 spp, adaptive 0.05, per-frame OptiX/OIDN denoise in the compositor, the 360's own grade (exposure from `exposure.json` groupMedian, median white balance, lift). The F5 70 s video (1050 frames) = about 2 h 20. Resume after a stop is written (untested) | Temporal denoise test (`cycles.denoise_animation`) vs per-frame; 1920×1080 time; judge flicker in the finished video |
| 5 streaming | **Not done on purpose**: finalize is ~70 s in total and each point's exposure depends on the group median. The real saving is overlapping the AI gateway waits with Blender, which belongs in the app's job runner | Design it with the job runner, test byte-identical outputs |
| 6 plan growth | `ROOMIA_PLAN_GROW_DS=4` switch added (default 2). The component idea was dropped (see section 6) | Profile, compare masks, adopt |
| 4c object count | Not started | Only if the frame profile shows sync dominates (the 15-frame test suggests the fixed cost is not the problem: 8 s/frame is mostly rendering) |

Observation from the video test: the F5 prepared scene plus the shot-planning tree took about 26 s and ~9 GB of RAM; free memory during the render was ~3 GB with the browser open. The memory guard (1.5 GB) is the nearest risk for long renders on a 15 GB machine, hence the resume.

### Found while testing the video (12 Nov)
`look_finalize_panos.py` overwrote `exposure.json` with only the points it was run on. The AI step finalizes two points, so the file held two points and the video exposed every shot from them (Point 6, Point 9 and Scène 3 came out almost black). Fixed: finalize merges into the file; the video exposes each shot with its own point's exposure and white balance (`pointGrades`), as the 360 does. The 11 s of dark footage in the first F5 video came from this.

### Plan drawing profile (12 Nov, DayTestF5, cProfile)
31.8 s total: 14.6 s in 26 distance transforms (11 s in the feature transform), 8.4 s in dilations/erosions (59 full-image dilations; 55 of them were the door-gap search dilating the same room once per pair). Fixed the last (each room dilated once): **36 s → 26 s, byte-identical image and rooms.** The quarter-size growth (`ROOMIA_PLAN_GROW_DS=4`) saved only 4 s and moved a room's area by up to 1.3 m²: **not adopted**. Next lever, if wanted: the distance transforms (crop each to the apartment's box, or compute `dil()` with a bounded radius).
