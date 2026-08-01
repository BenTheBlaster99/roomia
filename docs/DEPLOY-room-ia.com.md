# Roomia Post-Deploy Checklist

Last updated: July 14, 2026

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

### Status (July 14)

- [x] Orientation fixed — InstantMesh fixed `rx=-90°` before export; validated in Studio.
- [~] Scale — uniform height scaling; use `--exact-dimensions` when W×D×H must match exactly.
- [x] Frontend `normalizeGlbScene()` is scale + floor only (no runtime rotation).

### Legacy checklist (pre-fix)

- [x] Convert generated model to Three.js-friendly Y-up.
- [x] Center model footprint on X/Z.
- [x] Snap bottom of bounding box to Y=0.
- [x] Apply transforms before exporting/uploading GLB.
- [ ] Fix scale before upload for every Sarah product (category dims table + `--exact-dimensions`).
- [ ] QA checklist per upload: upright, floor contact, facing, material brightness, bounding box.

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

- [x] Generated GLBs upside down / wrong rotation in Studio — **fixed** (InstantMesh fixed `rx=-90°` in `furniture-3d-gen`; validated on bed + chair-set).
- [~] Scale can still be off per category (uniform height scaling; width/depth may not match target metres).
- [ ] Textures sometimes too dark or noisy.
- [ ] `NAME_MAP` in `upload.py` is manual — easy to mismatch filename vs DB product name.
- [ ] Photogrammetry (`meshroom`) needs 3–4 good photos; not all Sarah products have them yet.

### Fix Plan (orientation — done July 14)

- [x] Fix orientation before upload: InstantMesh → fixed `-90°` X pitch → Y-up, footprint align, floor at Y=0.
- [x] Remove runtime rotation guessing in Roomia (`normalizeGlbScene` scale + floor only).
- [x] Validate in Studio: `testing-bed2`, `brown-chair`, `cozy-chair`, `long-chair`, `short-chair`.
- [ ] Use `--exact-dimensions` when width/depth must match Sarah's measurements exactly.
- [ ] Keep frontend `normalizeGlbScene()` as backup only.

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

- Walls (shape / topology)
- Wall thickness
- Doors
- Windows
- **User-provided dimensions** (Sarah's workflow — see below)
- Editable after generation

### Sarah's Workflow (preferred)

> AI gives **only the form/shape** of the plan from the picture. The user then **clicks each wall** and enters its **length in metres**.

Why: reading dimension labels from photos is unreliable (scale, blur, handwriting). Shape extraction is easier; the user knows their real measurements.

**Target flow:**

1. Upload floor plan photo on `/configure` (or `/plan`).
2. AI returns **wall topology only** — connected segments, corners, door/window *positions* — in **normalized coordinates** (unitless 0–1 or relative), **not** guessed metres.
3. Redirect user to **2D plan editor** (`/plan`) with a prompt: *"Click each wall and enter its real length."*
4. User clicks wall → enters length (m) → plan scales that segment (already supported in `ArchitectureToolbar` + `setWallLength()`).
5. After all walls dimensioned (or at least exterior loop), compute room `width` × `length` → open Studio.

### Current vs Target

| Piece | Status |
|-------|--------|
| Gemini/OpenAI scan API (`/api/scan-room`) | [x] Exists |
| Scan prompt asks AI to read dimension labels + output metres | [~] **Wrong approach** — causes bad scale |
| Parse walls/doors/windows JSON → `FloorPlanData` | [x] Exists |
| 2D editor `/plan` — click wall, edit length/thickness | [x] Exists |
| Post-scan UX: guide user to dimension each wall | [ ] **Not done** |
| Shape-only scan prompt (no metric guessing) | [ ] **Not done** |
| Scale normalized topology → real metres from user wall lengths | [ ] **Not done** |
| End-to-end test with Sarah's real plan photos | [ ] **Not done** |

### Tasks

- [ ] **Rewrite `lib/scan-prompt.ts`**: extract shape only; output normalized wall graph; omit or null out `width_m`/`length_m` unless clearly labeled on drawing.
- [ ] **Update `parse-scan-result.ts`**: accept unitless coords; flag walls as `needsDimension: true` until user sets length.
- [ ] **Post-scan UI** on `/configure` or `/plan`: checklist — "Wall 1 of N — click wall, enter length".
- [ ] **Verify** click-wall → length input → plan updates → Studio dimensions match (manual QA with 2–3 Sarah plans).
- [ ] Render generated floor plan in 2D editor (already on `/plan`).
- [ ] Show walls with thickness, doors/windows visually (partially done on `/plan`).
- [ ] Later: optional AI suggestion when a dimension label *is* clearly visible (helper, not source of truth).

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
- [ ] Fix generated GLB floating/upside-down in `furniture-3d-gen` — **done** (fixed rotation); optional: re-upload older models.

### AI Work After That

- [ ] Photo Studio backend public deployment or GPU server plan.
- [ ] IP-Adapter test with real reference product image.
- [ ] Floor plan AI → **shape-only scan** + user clicks each wall to enter length (Sarah workflow).
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


//

Product & Business
Concept & Team

Interior design configurator targeting Algeria — first mover, no real competitor exists
Team: Jack (dev) + Sarah (architect/designer) + Lyna (graphic designer for branding)
Name: Roomia (Room + AI) under parent brand Archivalve
Second product planned: Sketchvault (sketchvault.com)
Domains registered: room-ia.com, sketchvault.com, archivalve.com via Hostinger

Marketing Strategy

Instagram-first organic growth (Sarah's account)
WhatsApp share built into product
Facebook group seeding for Algeria
Email waitlist on domain
Partner pitch: furniture stores — "multiply your business" framing
Commission model: direct with furniture partners, no intermediary
Goubba discussed and deprioritised — commission-on-commission not good enough

Hardware

Upgraded to RTX 3060 12GB (3-fan), new ASUS H310M-K R2.0 motherboard, 256GB SSD for Ubuntu 22.04 LTS
Old RX 570 4GB removed
PSU upgraded (450W was too tight for 3060)


Roomia — Frontend (Next.js + Supabase)
Phase 1 — Original MVP Configurator

Multi-step configurator: room dimensions + AI scan → style picker → budget
Result page: style header, moodboard grid, furniture list, budget summary
Email capture wired to Resend (real emails sending)
WhatsApp share button on result page
Landing page /, /about, /partners
AI floor plan scanner (Gemini 2.5 Flash) in Step 1 — upload photo → auto-fills width × length

Database (Supabase)

styles table — 5 styles (Maximalism, Minimalism, Industrial, Traditional Algerian, Mediterranean Coastal)
furniture_items table — Sarah's 36 items with prices, categories, rooms, style tags
moodboard_images table — 20 direct Pinterest image URLs from Sarah
budget_ranges table — DZD ranges per room per tier
room_presets table — 10 generated presets (5 styles × 2 rooms)
RLS public read policies on all tables

Phase 2 — IKEA-Style 3D Studio (full rebuild)
Zustand store (useStudioStore):

Room config (width, length, height, floor material, wall color)
Placed items with position, rotation, dimensions, color, price
Undo/redo (50-step history with snapshots)
Drag-to-move with room bounds clamping
Drag rotation via torus ring handle
Camera view state
Catalog filters (room, category, search, style pre-filter)
Cart with quantity and total
Cart drawer open/close

Studio (/studio):

Full 3D room — floor, 3 walls, ceiling, baseboard
Measurement labels on all edges
6 camera views (perspective, top, front, back, left, right) with smooth animation
Floor material picker (wood, tile, concrete, carpet, marble)
Wall color picker (presets + custom hex)
Room dimensions live edit
Grid overlay (1m squares)
Environment lighting + shadows
Drag furniture from catalog into room
Gold selection bounding box
Rotation handle (torus ring, drag to rotate freely)
Selection panel: rotate buttons, copy, remove, add to cart, dimensions display
Catalog sidebar: room tabs, category chips, search, available/unavailable state
Top bar: undo, redo, clear room, room settings, catalog toggle, scan, save, book, cart
Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y redo, Delete removes selected
Preset loading via ?preset=id URL param
Style pre-filter from configure via ?style= URL param
GLB model loading with auto-scale + floor snap + material fix
Box fallback when no GLB exists

Phase 2 — Room Presets

lib/preset-layout.ts — role-based furniture placement algorithm (sofa against wall, coffee table in front, chairs flanking, lights in corners)
lib/style-room-presentation.ts — floor material + wall color defaults per style
lib/studio-constants.ts — all category dimensions, colors, floor materials, wall presets
lib/mock-catalog.ts — 60 items across 5 styles × 2 rooms
scripts/generate-room-presets.ts — seeds 10 presets to Supabase in one command
/rooms gallery page — grid of preset cards by room type, click → studio

Phase 3 — Marketplace

/marketplace page — full catalog browse
Filters: room, style, category, budget tier, in-stock toggle, search
Product cards with emoji placeholder, price, budget badge, availability
"Add to Cart" → shared cart drawer
"Add to Studio" → drops item into studio and navigates there
CartDrawer component — shared across studio and marketplace, mailto quote request

Other Pages

/configure — simplified to dimensions + AI scan only, style/budget moved to studio sidebar
/result — style header, moodboard, furniture list, budget summary, email capture, WhatsApp share, book consultation
/photo-studio — full AI photo manipulation UI
/room-capture — depth estimation → studio dimensions
/plan — 2D Konva floor plan with draggable furniture
/about, /partners

Deployment

Vercel deployment — live at https://www.room-ia.com
NEXT_PUBLIC_BASE_URL set on Vercel
Hostinger domain connected


roomia-ai-backend (Python FastAPI)
Endpoints

GET /health
POST /segment — SAM2 click → mask + red overlay
POST /inpaint/remove — SD inpainting removes selected object
POST /inpaint/replace — text prompt replacement
POST /inpaint/replace-style — style chip prompts (Minimalism, Industrial etc.)
POST /inpaint/replace-ip — IP-Adapter with optional reference image, falls back to text
POST /depth — Depth Anything V2 → room dimensions estimate

Model wrappers

models/segmentation.py — SAM2 hiera large, click point → best mask, fixed float-indexing bug
models/inpainting.py — SD inpainting pipeline, dilate mask, remove + replace modes
models/ip_adapter_inpainting.py — IP-Adapter on SD inpainting, scale 0.7, text fallback when no reference
models/prompt_builder.py — structured prompts from catalog item fields + style descriptors + quality suffix
models/depth.py — Depth Anything V2 Small, normalised depth → room width/length/height estimate

Validated locally

SAM2 segmentation with red overlay confirmed working
Remove furniture confirmed working
Style prompt replacement confirmed working on sofa photo
First model load slow, cached after

Not deployed publicly yet — GPU server needed, ai.room-ia.com planned

furniture-3d-gen (Python CLI)
Pipeline

generate.py — three modes: TripoSR (simple items), InstantMesh (medium items), Meshroom (complex multi-photo)
Background removal with rembg + isnet-general-use model (better than default u2net)
Tight alpha crop + square canvas + 512×512 resize before inference
--preview-only mode — runs rembg only, saves .input.png, skips GPU generation
Texture export (--export-texmap) — UV maps instead of vertex colors
Quality tiers: low/medium (works on 3060), base/large (OOM on 12GB)
orient_for_room_view() — applies known correction per model type, then floor-snap + center
scale_and_position() — scales mesh to exact real-world dimensions in metres
export_glb() — baked GLB output
Manual rotation override: --fix-rx, --fix-ry, --fix-rz
fix_glb.py — re-normalize existing GLBs without regenerating
upload.py — uploads to Supabase Storage, updates model_url in furniture_items
batch.py — process multiple items in sequence
scale_existing.py — scale downloaded CC0 GLBs to Roomia dimensions

Results so far

TripoSR tested — bad on wardrobes/mirrors, OK on simple small objects
InstantMesh tested — better results, confirmed working on 3060 12GB at medium quality
chair2_textured.glb + chair-set (brown/cozy/long/short) uploaded to Supabase, load upright in Studio
GLB orientation fixed — fixed InstantMesh rx=-90° (July 14); no more normal/Euler guessing


What's Still Broken / Not Done
Item | Status
GLB models floating/upside-down | **Fixed** (July 14)
Real Supabase data in studio + marketplace | Not done
Sarah's furniture photos in DB | Not done
Live smoke test on phone + desktop | Not done
AI backend public deployment | Not done
IP-Adapter tested with real reference image | Not done
Floor plan → shape-only scan + user wall dimensions | **Next** (Sarah workflow; partial infra exists)
2D floor plan → 3D extrusion | Not done
Room capture depth → studio | Partial
Branding (logo from Lyna, final colors) | Not done
Slow compile (project on external drive) | Not fixed

That's everything. You've built a lot more than it feels like when you're in the middle of it. The site is live, three separate projects are running, and the core product works. The GLB orientation fix is the immediate task, then real data, then deploy the AI backend.