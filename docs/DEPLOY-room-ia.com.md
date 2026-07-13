# Roomia Post-Deploy Checklist

Last updated: July 12, 2026

Live site: `https://www.room-ia.com`

This file tracks what is done and what is left across deployment, Studio, AI Photo Studio, generated 3D models, floor plan AI, and product polish.

## Legend

- `[x]` Done
- `[~]` Partially done / needs polish
- `[ ]` Not done
- `GPU` needs local RTX 3060 or future GPU server
- `No GPU` can be done in the normal Next.js/Supabase app

## Deployment

- [x] Deploy Roomia frontend to Vercel.
- [x] Connect Hostinger domain `room-ia.com`.
- [x] Confirm live site at `https://www.room-ia.com`.
- [x] Set Vercel `NEXT_PUBLIC_BASE_URL=https://www.room-ia.com`, then redeploy.
- [ ] Test live pages on desktop and phone:
  - [ ] `/`
  - [ ] `/studio`
  - [ ] `/marketplace`
  - [ ] `/rooms`
  - [ ] `/configure`
  - [ ] `/result`
- [ ] Confirm email/share links use `https://www.room-ia.com`.
- [ ] Confirm Supabase reads work in production with current RLS policies.
- [ ] Do not set `NEXT_PUBLIC_AI_BACKEND_URL` on Vercel until the AI backend has a public URL.

## Current Live Limitation

- [~] `/photo-studio` exists on the live site, but AI generation only works locally right now.
- [ ] Deploy `roomia-ai-backend` to a public GPU-capable server later.
- [ ] After backend is public, set Vercel env:
  - `NEXT_PUBLIC_AI_BACKEND_URL=https://ai.room-ia.com` or another public AI backend URL.
- [ ] Update backend CORS:
  - `CORS_ORIGINS=http://localhost:3000,https://www.room-ia.com,https://room-ia.com`

## AI Photo Studio

### Done

- [x] Upload room photo.
- [x] Click furniture to create SAM2 mask.
- [x] Show red overlay selection.
- [x] Remove selected object.
- [x] Custom prompt replacement.
- [x] Style chip replacement using stronger prompt templates.
- [x] Better prompt builder in `roomia-ai-backend/models/prompt_builder.py`.
- [x] IP-Adapter endpoint exists at `/inpaint/replace-ip`.
- [x] Reference-aware backend wrapper exists in `roomia-ai-backend/models/ip_adapter_inpainting.py`.
- [x] Validated MVP with clear sofa photo:
  - Click sofa
  - Choose style/custom prompt
  - Generate believable replacement

### Needs Fix / Polish

- [ ] Make production page clearly say: "AI Photo Studio requires local AI backend for now" if backend is unavailable.
- [ ] Add friendly error when `/segment` fails because backend is offline.
- [ ] Add better loading messages:
  - "Loading SAM2"
  - "Generating image"
  - "First run can take a few minutes"
- [ ] Add mask tools:
  - [ ] Expand mask
  - [ ] Shrink mask
  - [ ] Reselect
  - [ ] Maybe draw/edit mask manually
- [ ] Add before/after slider instead of only side-by-side.
- [ ] Save generated outputs locally or to Supabase Storage.
- [ ] Add demo copy for Sarah:
  - "Inspiration preview, not exact product placement yet."

### IP-Adapter Status

- [~] Backend is built.
- [ ] Not truly usable from normal catalog yet because catalog items do not have product photos.
- [ ] Need product reference images before IP-Adapter becomes useful.
- [ ] Options:
  - [ ] Upload Sarah product photos to Supabase Storage.
  - [ ] Add image/reference URL column if needed.
  - [ ] Or render GLB to PNG and use that PNG as `reference_base64`.
- [ ] Test manual API call with:
  - `image_base64`
  - `mask_base64`
  - `prompt`
  - `reference_base64`

## Side Project: roomia-ai-backend

Path: `/media/jackhammer/DATA/Linux-Work/Projects/roomia-ai-backend`

Purpose: FastAPI GPU service for Roomia AI photo features (segmentation, inpainting, IP-Adapter, depth prototype). Runs locally today; Roomia frontend calls it via `NEXT_PUBLIC_AI_BACKEND_URL`.

### What Exists

- [x] FastAPI app in `app/main.py` with lazy model loaders (`@lru_cache`).
- [x] CORS from `CORS_ORIGINS` env var.
- [x] Base64 helpers (raw base64 + browser data URLs).
- [x] Endpoints:
  - [x] `GET /health`
  - [x] `POST /segment` — SAM2 click segmentation
  - [x] `POST /inpaint/remove` — Stable Diffusion inpainting
  - [x] `POST /inpaint/replace` — text/catalog prompt replacement
  - [x] `POST /inpaint/replace-style` — style/category chip prompts
  - [x] `POST /inpaint/replace-ip` — IP-Adapter when `reference_base64` is sent; falls back to text inpainting otherwise
  - [x] `POST /depth` — Depth Anything V2 prototype
- [x] Model wrappers:
  - [x] `models/segmentation.py` (SAM2)
  - [x] `models/inpainting.py` (Stable Diffusion inpainting)
  - [x] `models/ip_adapter_inpainting.py` (IP-Adapter)
  - [x] `models/prompt_builder.py` (catalog + style prompts)
  - [x] `models/depth.py` (Depth Anything V2)
- [x] `requirements.txt`, `.env.example`, `README.md`, `main.py` entry point.
- [x] Roomia frontend `/photo-studio` wired to local backend when env is set.

### Validated Locally

- [x] SAM2 segmentation with click + red overlay (fixed float-mask indexing bug).
- [x] Remove selected furniture.
- [x] Style/custom prompt replacement on clear sofa photo (MVP passed).
- [x] First model load is slow; subsequent requests are faster.

### Not Done / Production Gaps

- [ ] Public deployment (GPU server, subdomain like `ai.room-ia.com`).
- [ ] Docker / systemd / process manager for production.
- [ ] HTTPS reverse proxy (nginx/Caddy) in front of uvicorn.
- [ ] Model weight caching strategy on server (avoid re-download on restart).
- [ ] Rate limiting and request size limits for base64 uploads.
- [ ] Auth or API key if exposed publicly.
- [ ] Health checks that verify GPU + model readiness (not just `"ok"`).
- [ ] Logging/monitoring for failed generations and OOM errors.
- [ ] Update `.env.example` CORS default from `roomia.dz` to include `room-ia.com`.
- [ ] Automated tests (segment, inpaint smoke tests with tiny fixtures).

### Needs Improvement

- [ ] Better mask quality UX support (expand/shrink mask server-side or client-side).
- [ ] Tune inpainting steps/guidance per category (bed vs sofa vs chair).
- [ ] IP-Adapter: test end-to-end with real product reference image.
- [ ] IP-Adapter: optional GLB-to-PNG render pipeline for catalog references.
- [ ] Depth endpoint: validate room dimension accuracy on real photos.
- [ ] Graceful error messages when CUDA OOM or model missing.
- [ ] Optional queue for long-running jobs instead of blocking HTTP request.

### Commands

```bash
cd /media/jackhammer/DATA/Linux-Work/Projects/roomia-ai-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install --no-build-isolation git+https://github.com/facebookresearch/sam2.git
cp .env.example .env
mkdir -p checkpoints
wget -P checkpoints https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
curl http://localhost:8000/health
```

Roomia local env:

```bash
NEXT_PUBLIC_AI_BACKEND_URL=http://localhost:8000
```

Production CORS (after deploy):

```bash
CORS_ORIGINS=http://localhost:3000,https://www.room-ia.com,https://room-ia.com
```

### GPU Notes

- `GPU` SAM2, Stable Diffusion inpainting, IP-Adapter, Depth Anything V2.
- RTX 3060 works locally; first request per model can take several minutes.
- Not runnable on Vercel — needs separate GPU host.

## Generated 3D Models

### Current Problems

- [ ] Generated GLBs sometimes float above the floor.
- [ ] Generated GLBs are uploaded/stored with wrong orientation.
- [ ] In Studio they appear upside down or rotated incorrectly.
- [~] Frontend currently compensates with `normalizeGlbScene()`, but this should be a safety net, not the main fix.

### Fix Plan

- [x] 3D generation pipeline lives in side project `furniture-3d-gen` (see section below).
- [ ] Fix orientation before upload:
  - [ ] Convert generated model to Three.js-friendly Y-up.
  - [ ] Center model footprint on X/Z.
  - [ ] Snap bottom of bounding box to Y=0.
  - [ ] Apply transforms before exporting/uploading GLB.
- [ ] Fix scale before upload:
  - [ ] Category dimensions should match Roomia meters.
  - [ ] Bed, chair, sofa, table should not be tiny/huge.
- [ ] Keep frontend `normalizeGlbScene()` as backup only.
- [ ] Add a small generated model QA checklist:
  - [ ] Opens upright in Studio.
  - [ ] Bottom touches floor.
  - [ ] Faces expected direction.
  - [ ] Material not too dark.
  - [ ] Bounding box matches category dimensions.

### Needs GPU?

- `GPU` for local AI 3D generation.
- `No GPU` for frontend display fixes and GLB normalization utilities.

See also: **Side Project: furniture-3d-gen** below.

## Side Project: furniture-3d-gen

Path: `/media/jackhammer/DATA/Linux-Work/Projects/furniture-3d-gen`

Purpose: Local pipeline to generate furniture GLB models from photos, normalize orientation/scale for Roomia Studio, and upload to Supabase Storage + `furniture_items`.

### What Exists

- [x] `generate.py` — main generator with three modes:
  - [x] `triposr` — single-image AI (small/simple items)
  - [x] `instantmesh` — single-image AI with synthetic multiviews
  - [x] `meshroom` — multi-photo photogrammetry (3–4 real photos)
- [x] Image prep: background removal (`rembg`), crop, Real-ESRGAN texture upscale (via `spandrel`).
- [x] Post-processing:
  - [x] `orient_for_room_view()` — Y-up, footprint aligned, floor at Y=0
  - [x] `scale_and_position()` — category dimensions in meters
  - [x] `export_glb()` — baked GLB export
- [x] `upload.py` — uploads GLB to Supabase Storage, updates `model_url` in `furniture_items` (with `NAME_MAP` + `GENERATED_ITEMS` fallbacks).
- [x] `fix_glb.py` — re-normalize existing GLBs without regenerating.
- [x] `batch.py` — batch run list for bed/chair/etc.
- [x] `.env.example` for Supabase credentials.
- [x] Successful upload: `chair2_textured.glb` → Mid-Way chair in Supabase.

### Validated

- [x] InstantMesh generation from single chair photo.
- [x] GLB upload to Supabase public bucket.
- [x] Model URL updated in DB; loads in Roomia Studio (with frontend normalization fallback).

### Current Problems

- [ ] Generated GLBs still float or appear upside down/rotated in Studio for some items.
- [ ] `orient_for_room_view()` logic may not cover all InstantMesh/TripoSR output orientations.
- [ ] Scale can be off per category (tiny/huge relative to room).
- [ ] Textures sometimes too dark or noisy.
- [ ] `NAME_MAP` in `upload.py` is manual — easy to mismatch filename vs DB product name.
- [ ] Photogrammetry (`meshroom`) needs 3–4 good photos; not all Sarah products have them yet.

### Not Done

- [ ] Run `fix_glb.py` on all already-uploaded Supabase models and re-upload.
- [ ] Audit every uploaded GLB in Studio (upright, floor contact, facing, scale).
- [ ] Batch-generate remaining Sarah catalog items with consistent photo guidelines.
- [ ] Automate upload after batch (generate → fix → upload in one script).
- [ ] Add product image column / reference PNG export for IP-Adapter (cross-project).
- [ ] Document photo capture guide for Sarah (angles, background, lighting, dimensions).
- [ ] CI or checklist script that opens each GLB and prints bounding box dims.

### Needs Improvement

- [ ] Harden `orient_for_room_view()` — detect inverted meshes, test more chair/bed/sofa outputs.
- [ ] Category-specific default dimensions table (bed 110×200×105 cm, chair 45×45×80 cm, etc.).
- [ ] Prefer `meshroom` for complex items when multi-photo sets exist.
- [ ] Mirror/glass items (closet) need special handling — InstantMesh struggles.
- [ ] Reduce duplicate SSD copy at `/home/jackhammer/furniture-3d-gen.ssd-backup` when confirmed stable on DATA.
- [ ] Keep frontend `normalizeGlbScene()` as safety net only after export fixes are reliable.

### Commands

```bash
cd /media/jackhammer/DATA/Linux-Work/Projects/furniture-3d-gen
cp .env.example .env   # fill Supabase keys

# Single AI generation
./venv/bin/python generate.py --model instantmesh --images photos/chair2.jpg \
  --width 0.45 --depth 0.45 --height 0.80 --output output/chair2_textured.glb

# Fix existing GLB without regenerating
./venv/bin/python fix_glb.py output/chair2_textured.glb

# Upload to Supabase (maps stem → furniture_items name)
./venv/bin/python upload.py --file chair2_textured.glb

# Batch (edit FURNITURE list in batch.py first)
./venv/bin/python batch.py
```

Direct model URL example (Mid-Way):

`https://pmsotwinvccacownpnpp.supabase.co/storage/v1/object/public/public/models/chair2_textured.glb`

### GPU Notes

- `GPU` InstantMesh, TripoSR, Real-ESRGAN upscale.
- `GPU` Meshroom photogrammetry (heavy; uses local Meshroom install).
- `No GPU` for `fix_glb.py`, `upload.py`, and frontend `normalizeGlbScene()`.

## Studio

### Done / Existing

- [x] 3D Studio exists.
- [x] Marketplace/catalog sidebar exists.
- [x] Furniture placement exists.
- [x] Cart exists.
- [x] Generated Bed/Chair can load from Supabase in Studio sidebar.
- [~] Undo/redo and drag rotation may already be partially implemented from earlier work, but verify.

### Needs Work

- [ ] Verify undo/redo works in Studio.
- [ ] Verify clear room/reset room exists.
- [ ] Verify delete selected item with keyboard.
- [ ] Improve free rotation UX:
  - [ ] Drag handle or rotate gizmo.
  - [ ] Better than only 90 degree buttons.
- [ ] Add snap-to-grid toggle.
- [ ] Add collision/overlap warning.
- [ ] Add item labels for GLB models.
- [ ] Add per-model error boundary so one bad GLB does not crash the room.
- [ ] Improve mobile canvas height/responsiveness.
- [ ] Make configure -> studio handoff feel seamless.
- [ ] Pre-filter Studio catalog by selected style from configure/preset.
- [ ] Save room layout:
  - [ ] Session storage quick win.
  - [ ] Supabase save later.

## Marketplace / Real Furniture Data

### Current Problem

- [ ] Marketplace still mainly uses `MOCK_CATALOG`.
- [ ] Studio still mixes generated Supabase items with `MOCK_CATALOG`.
- [ ] Sarah/partner real products are not the main source of truth yet.

### Fix Plan

- [ ] Inspect current `furniture_items` schema.
- [ ] Replace `MOCK_CATALOG` in Marketplace with Supabase `furniture_items`.
- [ ] Replace or reduce `MOCK_CATALOG` in Studio sidebar.
- [ ] Keep mock catalog only as fallback/demo data.
- [ ] Map DB fields into `CatalogItem` cleanly:
  - `id`
  - `name`
  - `category`
  - `room`
  - `style_id` -> display style
  - `price`
  - `model_url`
  - `image_keyword`
  - `notes`
- [ ] Confirm RLS public read policy for `furniture_items`.
- [ ] Add loading and empty states.

### Sarah Furniture Pictures

- [ ] Locate Sarah's Excel/product image source.
- [ ] Confirm which images belong to which products.
- [ ] Upload images to Supabase Storage or another CDN.
- [ ] Decide schema:
  - [ ] Add product image column if missing.
  - [ ] Or create separate product images table.
- [ ] Show real images on:
  - [ ] Result page
  - [ ] Marketplace
  - [ ] Studio sidebar cards
  - [ ] Future IP-Adapter reference flow

## Floor Plan AI

### Goal

Client uploads a floor plan image. AI reads it and creates a digital 2D floor plan:

- Walls
- Wall thickness
- Doors
- Windows
- Dimensions
- Editable after generation

### Current / Near-Term Approach

- [~] Existing floor plan scanner started with Gemini/OpenAI vision style flow.
- [ ] Improve extraction prompt/schema.
- [ ] Output structured JSON:
  - [ ] room size
  - [ ] walls
  - [ ] doors
  - [ ] windows
  - [ ] labels/dimensions
- [ ] Render generated floor plan in 2D editor.
- [ ] Allow user to edit generated plan.
- [ ] Show walls with thickness.
- [ ] Show doors/windows visually.

### Needs GPU?

- `No GPU` if using Gemini/OpenAI API.
- `GPU` later if replacing API with local CV/deep learning models.

## 2D Floor Plan To 3D Room

### Goal

Turn 2D floor plan into 3D room:

- Wall extrusion
- Height specification
- Floor and ceiling
- Door/window openings
- Furniture from 2D layout appears in 3D

### Tasks

- [ ] Convert 2D walls to 3D wall meshes.
- [ ] Extrude walls to selected height.
- [ ] Add wall thickness.
- [ ] Cut/represent doors and windows.
- [ ] Sync 2D furniture positions into 3D Studio.
- [ ] Keep rotation and scale consistent from 2D to 3D.
- [ ] Allow switching between 2D and 3D without losing layout.

### Needs GPU?

- `No GPU`. This is math + Three.js.

## Room Capture / Depth

### Goal

Client uploads 1 or more real room photos. AI estimates room dimensions and opens Studio with approximate size.

### Current Status

- [~] Backend `/depth` endpoint exists as a prototype.
- [ ] Frontend `/room-capture` route not fully integrated.
- [ ] Need to decide local depth model vs API.

### Tasks

- [ ] Test `/depth` locally on real room photo.
- [ ] Build or restore `/room-capture` page.
- [ ] Let user edit estimated dimensions before opening Studio.
- [ ] Send width/length/height into `/studio`.
- [ ] Add disclaimer: dimensions are approximate.

### Needs GPU?

- `GPU` for local Depth Anything or heavier local models.
- `No GPU` if using cloud API.

## Performance / Slow Compile

### Current Observation

- [ ] Local dev/build feels slow.
- [ ] Next.js warned about slow filesystem under `/media/...`.

### Likely Causes

- Project is on external or slower mounted drive.
- Turbopack and `.next` are writing to that drive.

### Fixes

- [ ] Move project to local SSD/home directory for faster dev.
- [ ] Keep `node_modules` and `.next` on fast disk.
- [ ] Avoid running heavy AI backend and Next build at same time if RAM is tight.
- [ ] Check if antivirus/indexing or disk mount options slow `/media`.

## Branding / Product Polish

- [ ] Confirm Sarah's branding direction:
  - [ ] Beige/green?
  - [ ] Current amber?
  - [ ] Logo from Lyna?
- [ ] Align UI colors before deeper polish.
- [ ] Update copy:
  - [ ] "AI Photo" should be framed as inspiration preview.
  - [ ] Avoid promising exact product placement.
- [ ] Add contact email using domain:
  - [ ] `contact@room-ia.com`
- [ ] Add Instagram/social links when ready.

## Payments / Business Later

- [ ] Research Chargily.
- [ ] Research Goubba.
- [ ] Decide what is paid:
  - [ ] Quote requests?
  - [ ] Premium templates?
  - [ ] Partner leads?
- [ ] Not urgent for launch/demo.

## Suggested Priority Order

### Immediate

- [x] Set `NEXT_PUBLIC_BASE_URL=https://www.room-ia.com` on Vercel and redeploy.
- [ ] Full live smoke test on phone and desktop.
- [ ] Fix any production-only errors.

### Next Technical Work

- [ ] Real Supabase furniture in Studio + Marketplace.
- [ ] Sarah product images to result/marketplace/studio.
- [ ] Fix generated GLB floating/upside-down in `furniture-3d-gen` (`orient_for_room_view` + `fix_glb.py` on existing uploads).

### AI Work After That

- [ ] Photo Studio backend public deployment or GPU server plan.
- [ ] IP-Adapter test with real reference product image.
- [ ] Floor plan AI -> editable 2D plan.
- [ ] 2D plan -> 3D extrusion.
- [ ] Room capture depth -> Studio dimensions.

## Notes

- The public site is live at `https://www.room-ia.com`.
- Side projects live alongside Roomia on DATA:
  - `roomia-ai-backend` — 2D photo AI (local GPU only for now)
  - `furniture-3d-gen` — 3D model generation + Supabase upload
- IP-Adapter exists in code but needs real product reference images.
- Exact catalog-in-photo is not solved by text prompts alone.
- Procedural 2D → 3D does not need GPU.
- Local 3D generation, SD inpainting, IP-Adapter, SAM2, and local depth do need GPU.
