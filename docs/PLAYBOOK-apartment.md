# Playbook: one apartment, from SketchUp to client deliverables

The template every new project follows (set on 11–12 Nov 2026 on Bloc B F5, the reference project). Each step says what runs, the parameters that matter and why they have that value, and where the step leaves its log, so that real projects can show what fails.

## The deliverables

| Deliverable | Made by | Cost |
|---|---|---|
| Visite 360° of the whole apartment, broad daylight | Blender Cycles on the PC (`look_pipeline.py render`) | free |
| AI finish of the 360° (optional, per point) | `look_pipeline.py ai --points … --ring …` | 14 DA per image: 6 per point, 10 with the ring |
| Plan 2D coté (rooms, m², doors, windows, dimensions, A3 PDF) | `plan_build.py`, at the end of every tour build | free (room names: Gemini key, not the gateway) |
| Plan 3D (furnished cutaway) | `renderPlan3d` (tour build), `plan3d-run.mts` for older tours | free |
| AI photos from SketchUp views, Jour / Soirée / Nuit | Studio, tab "Nouvelles photos" → `/api/render/scene-photo` | 14 DA each |
| AI photos framed in the 360° | `pano_photos.py <scene> '<frames>' --yes` | 14 DA each |
| Video | `lib/scene-video.ts` (still EEVEE lighting, not the daylight recipe: to be moved) | free |

All AI spending prints its cost first and needs an explicit `--yes` (or the Studio's launch button).

## 1. The 360° light: "daylight" look (`scripts/look_make_recipe.py`, `looks.daylight`)

The 360° of the whole apartment is always broad daylight. Soirée and Nuit exist only for the AI photos.

- Fixtures: interior and downlights at **4000 K**. At 3200 K every room went beige and the white balance hit its 15 % limit (bench A–E, F5).
- Downlights: a spot under each small LED disc, **110 W, 45° cone, blend 0.5** (`ROOMIA_LOOK_DOWNLIGHT_DAY`). This gives visible pools on walls and wardrobes.
- Sky `WORLD_DAY` **150**, sun `SUN_DAY` **1.6**. At 320 the grass outside turned rooms green (bench E).
- Grade: contrast **1.4**, saturation 1.2, shadow lift **0.04** (`looks.daylight.lift`). A lift of 0.1 looked hazy.
- Cycles bounces **12 / 8 / 6** (total, diffuse, glossy): brighter corners at no measurable cost.
- Exposure is per point, ±3 stops around the apartment's median, with neutral white balance (`look_finalize_panos.py`).

What the file implies but does not model (`scripts/look_apply.py`, on by default):
- **Floating decorative glass is hidden**: thin, ≤ 1.2 m, starting 1 m or more above the floor (F5 Point 8's 80 cm disc read as a balloon). Recipe switch: `hideFloatingGlass`.
- **Pendant bulbs**: a 40 W 2900 K spot plus a small glow in every shade that hangs from a rod, a bar or the ceiling, with ≥ 50 cm free below and no wall at its side. Leaves are excluded. Switch: `pendantBulbs`; values: `pendants.energy`, `pendants.kelvin`.
- **Linear ceiling LEDs**: a dark profile ≥ 0.8 m long and ≤ 4.5 cm wide set in the ceiling gets a glowing strip and a 9 W/m light. Rails and rods are excluded. Switch: `slotLights`; values: `slots.wattsPerMetre`, `slots.strength`, `slots.kelvin`.

Logs (`.scenes/<id>/look/<auto-dir>/`): `analysis.json`, `recipe-auto.json`, `render.log` (each `LOOK_INFO` line: downlights, hidden glass, pendant bulbs, slot lights), `exposure.json`, `render-report.json`.

## 2. Cameras (`scripts/look_analyze.py`)

A point with less than **0.75 m** free around it (at eye height and at furniture height) moves to the spot with the most room within 1.6 m, on the same floor, under a ceiling and seen from the original eye. A camera shut inside a cupboard may move up to 2 m without that sight line. The tour's arrows and the plan's dot follow it. Log: `analysis.json` → `cameras[].moved`, `movedBy`, `clearance`.

## 3. AI finish of the 360° (`look_pipeline.py ai` / `ai-prepare` + `ai-finish`)

The points are re-rendered with masks and cut into 6 views (plus 4 views tilted up with the ring). Each view goes to the gateway. `pano_finish.py` then lays them back: the render's light, the AI's detail (weights floor 0.95, walls 0.7, fabric 0.9). This is free to redo on views already bought.

State on 12 Nov: no visible seams, but the result is short of a single AI photo, because the finish is cautious. The next step is to tune the weights on the F5 test points (Scène 5, Point 8); this costs nothing. Log: `tiles-<point>/gateway-report.json`, `<point>-final-report.json` (verdict).

## 4. Plans (`scripts/plan_build.py`)

1. `plan_capture.py` (Blender): a cut at **floor + 1.2 m**. Every segment is flagged wall (triangle ≥ 1 m tall), glass or object, with its height.
2. `plan_arch.py` (system python: numpy, scipy, PIL):
   - Wall faces up to 26 cm apart join into poché, plus long thin pockets.
   - Rooms are seeds 0.55 m from any wall, door or glass (so a 1.1 m opening splits rooms), grown back over the floor. Rooms too narrow for a seed are taken whole if ≥ 1 m².
   - Doors come from thin, tall, door-wide objects, plus 0.6–1.4 m gaps between rooms.
   - Size rules override the AI: under 5 m² is never Cuisine or Séjour; the largest room is the Séjour.
   - Enclosed pockets are drawn, never left white.
3. `plan-ai-names.mts`: Gemini names the numbered rooms from the furnished top view. It retries, and falls back to the current model when 2.5-flash is busy.
4. Installs `tour/plan-archi-{rendu,technique}.png`, `plan-archi.pdf`, `plan-archi.json`, plus `tour.json` → `plan.archi`.

For a tour built before 2 Nov, it writes `tour/plan-src/` and renders the 3D plan. The 3D plan needs about 9 GB free for a large file: close the browser.

Logs: `.scenes/<id>/plan-archi/` (capture.log, `plan-rooms.json`, `plan-names.json`, `plan-ids.jpg`).

## 5. AI photos

- From SketchUp views: Studio → Nouvelles photos. Each saved view, with Jour / Soirée / Nuit; the lighting maps to `lib/render-lighting.ts`.
- From the 360°: `pano_photos.py`. Frames as `{name, point, yaw, pitch, vfov}`, with yaw and pitch as the 360 viewer turns; vfov 80–95 frames a room. A dark frame is exposed brighter first, because the AI keeps the light it is given.
- Both land in `photos/` and `runs.jsonl` (view, ambiance, `source: "360"`, frame), which is what the Studio's Galerie shows.

## Feedback loop

On a real project, read in this order:
1. `look/<auto-dir>/render.log` (`LOOK_INFO` lines)
2. `analysis.json` (cameras moved or skipped)
3. `exposure.json` (white balance at the 0.85 or 1.15 limit means the light colour is wrong)
4. `plan-archi/plan-rooms.json` (rooms and names)
5. `runs.jsonl` (photos, fallbacks)
6. the gateway reports (failed views)

Each rule above names the project and the image that made it. Add the next project's lesson the same way.

## Building and running a test Studio on this PC (DATA disk notes)

- The project's own `node_modules/@sparkjsdev` is unreadable (EIO). Build with `ROOMIA_SPARK_DIR=~/roomia-mods/node_modules/@sparkjsdev/spark`, which makes the build skip its type check. Run the type check separately with a tsconfig that maps the package (`tsconfig.spark.json` pattern).
- A work clone must build into its own `.next` (`~/.cache/<name>-next`), never the live Studio's `~/.cache/roomia-next`.
- The test Studio: `SCENES_DIR=<roomia>/.scenes next start -p 3003`. Port 3002 is held by another program.
- Push through `ssh://git@ssh.github.com:443/…` when port 22 or HTTPS time out.
