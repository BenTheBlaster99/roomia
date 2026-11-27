# Speed report, steps 1-5 (21 Nov 2026)

Branch `work/speed-steps1-4` (worktree `roomia-speed`), one commit per step. Nothing merged, pushed or released. The demo setup
(roomia-w, ~/roomia-fresh-config, project BlocBF5Demo0000000001) was not touched. Quality settings are unchanged.

## Result: one full visit of the F5 file, 11 points (5 scenes + 6 automatic), same PC, from "confirm points" to "finished"

|                                          | old pipeline | new pipeline |
|------------------------------------------|-------------:|-------------:|
| whole run (placement included)           | 3258 s (54.3 min) | 2029 s (33.8 min) |
| tour build (tour.json total)             | 362 s | 244 s (faces 73.6 -> 1.4 s, assembly 159 -> 124 s) |
| first picture rendered at                | +871 s | +572 s |
| render span (11 views)                   | 1573 s (143 s/view) | 1348 s (122 s/view) |
| after the last view rendered             | 814 s | 109 s |
| GPU idle (<10 %) over the whole run      | 65 % | 47 % |
| GPU idle in the tail                     | 800 s | 110 s |
| RAM peak (whole machine)                 | 13.6 GB | 12.9 GB |

"Old" = `ROOMIA_QUICK_PANOS=1 ROOMIA_LOOK_STREAM=0 ROOMIA_COMPOSITOR_GPU=0 ROOMIA_TRANSFER_FULLRES=1 ROOMIA_DUP_DISTANCE=0`.
Raw data: `roomia-speed-test/results/full-old|full-new` (e2e.log, sampler.csv, file-times.txt, state.json, tour.json).
Overall: -38 %, at the top of the 28-35 min target, not below it.

**The AI step is a stand-in.** The runs used the fake gateway (70 s per image, nothing spent, no real credit). The real gateway
latency may differ; the streaming gain in the tail depends on it. No real AI image was spent in this task.

## Per step

1. **No draft 360 pictures when the render follows the build** (d61a2cb). Build 362 -> 244 s. In the app the drafts were already
   small (1536 px / 16 spp); the brief's 1,040 s came from a non-preview build, so the gain here is the 73 s of faces plus part
   of the assembly, not 1,040 s. Readers of the draft pictures checked: editor and proposal use tour.json positions;
   look_pipeline points()/job() fill from positions; install() sets the pano; export/video filter `v.pano`; project cards fall
   back when pano-0.jpg is missing; sidebar thumbnails hide on error; Reuse copies finished panos only. A failed build without
   drafts retries the old way. A built visit with no pictures gets the pipeline screen and a way back to the render.
2. **Streaming** (6ee7e1c). AI image and transfer run beside the render; the group exposure/install at the end is unchanged.
   10 of 11 views were promoted as streamed; Scène 2 (exposure clamped by the group) reused its streamed AI image and only redid the
   transfer (9 s, no second paid image). The AI image's brightness does not depend on the input exposure (slope 0.02, r 0.04, 15
   real views), so no compensation. Promotion requires byte-identical draft and installed pictures (checked with the pipeline's
   own interpreter; another Python gives +-1 level).
3. **Light transfer** (47a3a31). 31-38 s -> 9 s per view; the far-field gain is computed at quarter size.
   `ROOMIA_TRANSFER_FULLRES=1` restores the old path.
4. **GPU compositor + OIDN** (325ea35). About -20 s per view (post 26.5 -> ~8 s); same pictures. Lost views retry with the CPU
   compositor. One-tile mode is not additive and stays off.
5. **Confirm points before the render** (cf343e7). Duplicates flagged (and not placed within 1.5 m in sight), live estimate
   from this PC's recorded visits. Today's F5 placement drops 0; the old F5's duplicates (Point 1 + Point 6, Scène 1 + Point 8) are
   flagged by the editor. Plan 3D (~114 s) and the architect plan (~48 s) are inside the build time above.

## Corrections found on the way

- Single-view renders differ from batch renders: the fill lights of the other points in the batch change a view's lighting. My
  first "GPU denoiser changes the picture" reading was this; same-batch comparisons show a noise floor of 0.003.
- The first exposure-compensation idea was removed after the free data analysis above.

## Not verified

- Real gateway behaviour in streaming (latency, forfait/credit accounting through cloudPhoto). The probe that would spend credits
  was refused by the safety check; I did not work around it.
- Old-vs-new pictures of the whole visit: the old run's output was overwritten by the new one. Quality was checked per step
  (steps 3 and 4 image diffs, streamed promotion byte-identity), not on the 11 finals side by side.
- Intermediate commits were not individually compiled; the final state typechecks (only the 2 existing `@sparkjsdev/spark` errors).
- Bigger apartments: the time grows with the number of views (about 2 min each, render-bound); the editor now shows the estimate.

## Next, in order of expected gain

1. 4-5 views per Blender process (less start-up, with malloc_trim) - watch that fill lights depend on the batch.
2. The ~110 s tail of the last batch (generation wait) and the 244 s build: overlap plan 3D/2D with the render.
3. Check `sunFast` and `emission_sampling NONE` on the render itself.
