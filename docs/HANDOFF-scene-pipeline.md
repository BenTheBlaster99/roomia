# Handoff: scene pipeline (import → saved views → photo render)

Written 2026-10-12 for anyone (human or AI) picking this work up. Read this before touching the Studio import or render code.

## What the product does now

A designer exports a SketchUp scene (`.glb`, or `.dae`, or a `.zip`), uploads it in `/studio`, picks one of their **saved SketchUp scenes**, sets the light (time of day, sun on/off) and gets a **photoreal image** of exactly that design.

```
upload ─► server prepares ─► Studio shows a light copy ─► user picks a saved view + light
                  │                                                    │
        original kept (source.glb)                                     ▼
                  └──────────────► Blender captures that view from the FULL file (~8 s)
                                                    │
                                                    ▼
                                  GPT Image turns the capture into a photo (~2 min at high quality)
```

Why two copies: real scenes are 2M+ triangles / 100+ MB, too heavy for a browser. Studio opens a light copy (under 40 MB and 800k triangles); renders use the untouched full file.

## Flow in files

| Stage | Files |
|---|---|
| Client upload + download of the light copy | `lib/studio-import/server-prep.ts` (XHR upload with progress, status polling, **2 MB ranged download** straight into memory), `lib/studio-import/import-room.ts` |
| Upload API | `app/api/scenes/uploads` + `[id]/chunk` + `[id]/complete` (**resumable upload in 8 MB pieces, used by the browser for files over 8 MB**; each piece is retried, `complete` lists missing pieces), `app/api/scenes/route.ts` (single POST streams the raw body to disk, small files), `[id]/route.ts` (status), `[id]/viewport/route.ts` (light GLB, supports Range), `[id]/cameras/route.ts` (GET/PUT saved views) |
| Storage + queue | `lib/scene-store.ts` (`.scenes/<id>/…`), `lib/scene-jobs.ts` (queue; **each job runs in a child process**: `tsx scripts/prepare-scene.ts`) |
| Preparation | `lib/scene-prep/index.ts` (`prepareScene`), `viewport.ts` (light copy), `dae-to-glb.ts`, `normalize-glb.ts`, `textures.ts`, `skp-textures.ts`, `unzip.ts`, `studio-check.ts` |
| Saved views | `lib/scene-cameras.ts` (types, SketchUp JSON conversion, look-at, fov) |
| Capture | `lib/blender-render.ts` (Blender script + `renderSceneView`), `lib/render-lighting.ts` (time-of-day presets for Blender and for the prompt) |
| Photo | `lib/photoreal.ts` (GPT Image call, shared), `lib/scene-render-prompt.ts` (strict "keep the design" prompt) |
| Render routes | `app/api/render/scene-photo/route.ts` (**the product path**), `heavy-view/route.ts` (grey capture only), `photorealistic/route.ts` (old Studio-screenshot path, still used for preset rooms) |
| Studio UI | `app/studio/components/SceneSidebar.tsx` (right panel), `TopBar.tsx`, `ViewControls.tsx`, `ImportedRoom.tsx` (camera mover), `StudioScene.tsx` (flat look for imported scenes, dolly-to-cursor), `app/studio/studio-flags.ts` (`CATALOG_ENABLED = false`) |
| Optional gate | `middleware.ts`, `lib/access.ts`, `lib/access-guard.ts`, `app/access/page.tsx`, `app/api/access/route.ts`, `lib/render-limit.ts` |

## Per-scene folder (`.scenes/<id>/`, git-ignored, auto-deleted after 7 days)

`original.<dae|glb|zip>` (never modified) · `source.glb` (full quality, used for renders) · `viewport.glb` (light copy for Studio) · `cameras.json` (saved views, glTF frame) · `report.json` · `meta.json` · `runs.jsonl` (one line per photo render: view, light, capture/photo/total seconds, quality, ok/error).

## What the preparation does

- **Light copy:** merges duplicate meshes into GPU instances, welds vertices, simplifies, converts textures to 1024 px webp, drops lines/points (SketchUp guide lines once made Studio see a 7,000 m room). Same world coordinates as the full file, verified by `studio-check.ts`, which loads the output with Studio's own loader and sizing code and **throws** if Studio would reject or misread it.
- **DAE → GLB** with three's `ColladaLoader` in Node (needs an XML parser polyfill and a stubbed `TextureLoader`). Embeds textures at full size, flips V (COLLADA vs glTF), turns missing textures into light grey (never black), reads the scene cameras.
- **GLB:** old specular/glossiness materials (SimLab exporter) are converted to metal/roughness and the exporter's placeholder IOR/specular is dropped. Without this, wood renders black.
- **Glass:** any material named glass/verre/vitre/window that is opaque becomes 25% alpha (SketchUp keeps glass opacity in a setting the exports drop).
- **Zip:** may hold `.dae` + texture folder, and/or the `.skp` (a `.skp` is a zip with every texture; matched to DAE materials by name: exact, then ignoring numeric suffix, then fuzzy; 42/51 on Sarah's kitchen) and/or a scenes `.json`.

## Coordinates (easy to get wrong)

- SketchUp: inches, Z-up. Prepared GLB: metres, Y-up. Conversion `(x, y, z) → (x, z, −y) × 0.0254`.
- SketchUp's saved-scene `fov` is the **horizontal** field of view (the DAE writes it in a field called `yfov`). Blender needs vertical: `verticalFov(hfov, 16/9)`.
- `fitImportedRoom` shifts the room so its corner is the origin. Studio's camera capture converts back to the file's own frame; `registerCameraMover` converts a saved view forward again.
- Sarah's Z5 JSON format: `[{ name, camera: { eye, target, up, fov, perspective } }]` in inches.

## Run it

- Dev: `npm run dev`. Prepare a file by hand: `npm run prepare-scene -- <file> [outDir]` (prints times, memory and the Studio check).
- Blender (full-file captures): `ROOMIA_BLENDER=/media/jackhammer/DATA/Linux-Work/tools/blender-4.5.9-linux-x64/blender` (already in `.env.local`).
- Env: `RENDER_IMAGE_QUALITY` (low|medium|high, default **high**), `RENDER_DAILY_LIMIT` (default 40 paid photos/day, in memory), `ACCESS_CODE` (**unset = nothing gated**; if set, gates `/studio` and the APIs; `/api/access?code=…` is a one-click login link), `SCENES_DIR`, `SCENE_MAX_BYTES` (2 GB), `SCENE_TTL_HOURS` (168), `SCENE_PREP_MAX_MB`, `SCENE_PREP_CONCURRENCY`, `ROOMIA_BLENDER_ENGINE` (`eevee` default = needs a GPU; `cycles` = CPU only, works on a plain server with no display), `ROOMIA_CYCLES_SAMPLES` (32), `ROOMIA_BLENDER_CONCURRENCY` (1: captures share the GPU, two at once are slower than one after the other).
- **Production needs `tsx` installed** (devDependency): the prep job spawns `node_modules/tsx/dist/cli.mjs scripts/prepare-scene.ts`.

## Running it for real (production, updated 2026-10-14)

- **Build:** `npm run build` (uses **webpack**: Turbopack's generated external-package aliases can't be created on the NTFS project drive, so its build fails). `~/.cache/node_modules` is a symlink to the project's `node_modules` so the build cache (`~/.cache/roomia-next`, kept on ext4) can resolve packages; recreate it with `ln -sfn <project>/node_modules ~/.cache/node_modules` if missing. `NODE_PATH` is also set in the build/start scripts.
- **Start/stop (manual, never at boot):** `systemctl --user start roomia-studio` / `stop` / `restart`; logs: `journalctl --user -u roomia-studio -f`. The unit (`deploy/roomia-studio.service`) has no `[Install]` section on purpose. It runs `npm start` on port 3000; don't also run `npm run dev` (port clash).
- **Pilot access:** `ACCESS_CODE` is set in `.env.local`. One-click link for a tester: `https://<host>/api/access?code=<code>&next=/studio` (cookie lasts 30 days). Without the code, `/studio` redirects to `/access` and the APIs return 401. `RENDER_DAILY_LIMIT` caps paid photos per day.
- **Route files may only export Next's allowed fields** (a shared constant exported from a route broke the type check): put shared constants in `lib/`.

## Gotchas (each one bit us)

1. **Never `import sharp` in app code** (routes, components): Turbopack invents a fake package and it fails. Use `lib/load-sharp.ts`. Scripts and `lib/scene-prep/` (run by tsx in a child process) may import it directly.
2. **Do not add `/api/scenes` (or any upload route) to the `middleware.ts` matcher.** Next buffers request bodies in the proxy layer and cuts them at 10 MB. Access checks live inside the routes (`lib/access-guard.ts`).
3. Next 16.2 renamed middleware to *proxy*; `middleware.ts` still works. Read `node_modules/next/dist/docs/` before changing Next conventions (see `AGENTS.md`).
4. ESLint `react-hooks` rules here reject `setState` called synchronously in an effect and mutating values returned by hooks. Pattern used: set state inside a `.then`/interval callback, or mutate through a small helper function. A few older files still fail lint (`ImportedRoom.tsx` line ~38, `CatalogSidebar.tsx`, `StudioEntryGate.tsx`, `compose/room/route.ts`); not ours.
5. `.next` is a symlink to `~/.cache/roomia-next` because the project is on NTFS (`scripts/ensure-next-cache.mjs`).
6. **Image gateway** (`OPENAI_BASE_URL` → `p.coconutstudio.io`, behind Cloudflare): high quality takes 110–120 s and can hit a 524; the OpenAI client must not retry (each retry is a paid generation); the gateway sometimes returns an instant `upstream_400 Invalid value for 'image'` for a picture it accepts a moment later, which `photoreal.ts` retries (unbilled). Medium quality is ~70 s if it keeps timing out.
7. **Always drain a child process's stdout** (`child.stdout.resume()`): Blender prints progress there, and an unread pipe fills and freezes it (this made Cycles look like it hung).
8. **Do not run probe loops against the paid image API** without asking: it costs real credits.

## Testing without spending credits

- Headless Chromium via Playwright (install in a temp dir; browsers are in `/media/jackhammer/DATA/Linux-Work/tools/playwright-browsers`, launch with `--use-gl=swiftshader`). Fake the paid route with `page.route('**/api/render/scene-photo', …)` and an NDJSON body.
- Blender capture lighting can be checked on its own with `renderSceneView` (no image model).
- Real test data (not in the repo): `~/Downloads/CUISINE BELFAR.{glb,dae,skp}` and `CUISINE BELFAR scenes.json` (Sarah's kitchen), `one room furnished.dae` (2.1M-triangle bar scene).

## State and open items

- Done: server preparation, DAE/GLB/zip import, texture handling, saved scenes, Blender capture from the full file, photo render, lighting presets, strict prompt, run log, sidebar UI.
- **Nothing is committed to git yet** (local `main` has no commits; the remote is two months behind).
- Not done: the **10-run measurement** (median time, failures, cost per image; `runs.jsonl` collects the data); **hosting** (the Studio needs Blender and a disk, so not Vercel; plan: run on the dev PC in production mode behind a `cloudflared` tunnel, later a rented server); **production build never test-run**; Draco/Meshopt-compressed GLBs unsupported; FBX/OBJ only open locally with none of the server fixes; other exporters (SketchUp native glTF, Enscape, KitchenDraw) untested.
- **DAE size limit (found 2026-10-12):** the DAE is read as one JS string, which Node caps at ~512M characters, so DAEs over ~480 MB are refused with a clear message (`assertDaeReadable`). Real case: a beauty-salon zip held a **1.44 GB DAE** + 13,000 textures (324 MB zipped). Blender's own COLLADA importer was tried on it (5 GB memory cap): no result after 20 minutes, so it is not a live option. Real fix = ask for **GLB** (Studio's entry text now recommends it), or write a streaming DAE parser (large job, not started).
- **Hosting findings (2026-10-12):** Blender's default EEVEE renderer needs a GPU/OpenGL context; headless with Mesa failed here (`EGL_BAD_MATCH`), and "software GL" env vars silently still used the RTX 3060, so don't trust that test. The **Cycles CPU path works with no display**: ~14 s at 16 samples, ~23-27 s at 32-48 samples on the dev PC (i5-9400F, 6 cores) for Sarah's kitchen. It is darker and harsher than EEVEE (a closed room gets almost no light, so a point light sits at the camera), so it would need tuning before use. Untested on actual cheap VPS CPUs.
- **Big uploads through a tunnel (found 2026-10-13):** one long upload request is fragile. A 231 MB GLB was cut at ~1m45s by the far end (`context canceled` in the cloudflared log), so uploads now go in 8 MB pieces with per-piece retry (server state in `<scene>/upload.json`, status `uploading`). Verified with a flaky-connection browser test.
- Ask Sarah what the **pink wall** should be: it is SketchUp's "texture missing" pattern in her file.
