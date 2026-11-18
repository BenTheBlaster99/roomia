# Roomia fixes brief: the 3D view and the 360° pipeline (18 Nov 2026)

You are changing Roomia Desktop: the Studio's 3D view and the way the 360° visit is produced. The product owner listed what bothers them after a live test with Sarah, our first real user (an architect, not technical). I read the code and turned the list into this brief. Read all of it before you change a file.

## 1. Context

Roomia turns an architect's SketchUp model into a 360° visit, photoreal photos, a 2D plan and a 3D plan. **Roomia Desktop** is an Electron app. It runs a local Next.js server and Blender on the architect's own PC. The AI image steps run on the owner's server, are paid per image, and are counted against the architect's package.

- Repository: `/media/jackhammer/DATA/Linux-Work/Projects/roomia-w`, branch `main` (last commit `6f92574`, Desktop 0.5.2).
- `AGENTS.md`: this Next.js (16.2.7) differs from what you know. Read `node_modules/next/dist/docs/` before you write code you are unsure of. Read `docs/HANDOFF-scene-pipeline.md` before you touch the pipeline.
- All interface text is French.

**Files involved:**
- `app/studio/components/SceneSidebar.tsx`: the Studio's side panel.
- `app/studio/components/ViewControls.tsx`: the view buttons at the bottom of the 3D view.
- `app/studio/StudioScene.tsx`: `CameraController`, the camera, using drei `CameraControls`.
- `app/studio/components/ImportedRoom.tsx`: loads the model and moves the camera to a SketchUp scene.
- `store/useStudioStore.ts`: `viewMode`.
- `app/studio/tour/[id]/TourClient.tsx`: the project page. It holds the visit, the "Points de vue" button and the `Pipeline` screen.
- `app/studio/tour/[id]/PointsEditor.tsx`: the points editor.
- `app/studio/tour/[id]/LookPanel.tsx`: the "Qualité finale" button.
- `lib/scene-tour.ts`:
  - `startTourPropose` / `propose`: the points placement.
  - `confirmTourPoints`, `startTourBuild` / `build`: the Blender build. The 2D plan and the architect plan (`scripts/plan_build.py`) are made at the end of the build.
  - `dropTourProposal`.
  - `startPlan3d` / `makePlan3d`: the 3D plan, made separately today.
- `lib/look-pipeline.ts`:
  - `startLookRender`: the daylight "Présentation", started by itself after the build when `AUTO_LOOK` is on.
  - the auto AI step (`auto-ai.json`, `startLookAi`).
- `app/api/scenes/[id]/tour/route.ts`: the API for all of the above.

## 2. The Studio 3D view

### 2.1 Remove the "← Mes projets" link from the side panel
`SceneSidebar.tsx`, the `desktop ? <Link href="/studio/projets">…` block at the top of the panel. Remove it. The app's top navigation (`DesktopNav.tsx`) already leads back to Mes projets. Keep "Fermer".

### 2.2 Remove the account line
This is the line under the project name: `{account.name} · N photos restantes · se déconnecter`. Remove it completely. The account menu in the header (`AccountMenu` in `DesktopNav.tsx`) already has the name and the sign-out.

Keep the `account` state itself. `noCredits` and the "Plus de photos dans votre forfait" warning still use it.

### 2.3 "Faire la photo" becomes "Faire le rendu"
Rename every visible string in `SceneSidebar.tsx`:
- the button (`'Faire la photo'`);
- its running state (`'Photo en cours…'` becomes `'Rendu en cours…'`);
- the hint ("Lancez « Faire la photo »").

Search the whole `app/studio` for other mentions of "Faire la photo" and rename them the same way.

### 2.4 Rename "Objectif"
"Objectif" is the lens choice (Fichier / 18 / 24 / 35 mm) in `SceneSidebar.tsx`: the label and its `aria-label`. Rename both to **"Angle de vue"**. The owner may pick another name, see section 5.

### 2.5 Replace orbiting with walking through the model
**What is wrong now.** In a project, `ViewControls` offers "Vue d'ensemble" and "Vue du dessus". `CameraController` orbits around the model as if it were a small object on a table: drag rotates the whole apartment, and the wheel dollies toward the cursor. The owner and Sarah do not want an outside view or a top view. They want to **move through the place at eye level** and see what the model really contains before anything is rendered.

**What to build** (only for an imported project, `sceneMode`; leave the old free-room mode as it is):

1. **Camera.**
   - The eye stays 1.6 m above the floor under it. Find the floor by casting a ray straight down from the camera onto the model.
   - When the floor height changes (steps, a mezzanine, another level of a duplex), the eye follows it smoothly.
2. **Looking around.** Left-drag turns the head: yaw without limit, pitch limited to about ±80°. The camera stays where it is. The view never rotates around a far-away target.
3. **Moving.**
   - Wheel: forward / back along the horizontal view direction.
   - Right-drag: sidestep.
   - Keys: ZQSD (French keyboards), WASD and the arrow keys, with Shift to go faster. Do not take the keys while a text field has focus.
   - Double-click on the floor: glide there in about 0.6 s, keeping the eye height.
   - Touch: one finger looks, two fingers move.
4. **Walls.**
   - Before each move, cast a ray in the move direction. Stop about 0.35 m before any surface.
   - Door openings are real gaps in the mesh, so walking through doors works.
   - Large models are slow to raycast. Use drei's `<Bvh>` (three-mesh-bvh) on the loaded model, or build the BVH once yourself.
   - If a ray finds no floor (outside the building), do not move.
5. **Where it starts.** At the first SketchUp scene of the file if there is one. Otherwise at the centre of the model's floor bounds, at eye height, facing the longest horizontal side.
6. **The bottom bar.**
   - Replace "Vue d'ensemble / Vue du dessus" with the file's SketchUp scenes, one chip per scene. Clicking a chip glides to that scene's position and direction (`ImportedRoom.tsx` already computes them for the photo views).
   - The model is often large, so keep a "Plan" chip that shows a top-down plan with a "vous êtes ici" dot. Clicking a place on that plan takes you there at eye height. This is optional: drop it if it costs too much. The owner said "no top view", so it must be a map for moving, never a way to look at the model from outside.
7. **The photo framing must keep working.**
   - Choosing a scene in the side panel still frames the photo exactly as today.
   - Walking away from it is the existing "cadrer librement" (`useCurrent`): the render uses where you stand and look.
8. **The hint line.** Replace the text under the bar in `ViewControls.tsx` with: `Glisser = regarder · Molette ou ZQSD = avancer · Clic droit = se décaler · Double-clic au sol = y aller`.

The owner expects this to be imperfect on some models. They want "a better way to see what we have before we blend it and AI it". A model with holes or missing floors may block or misplace the walk. That is acceptable, but it must never crash or leave the camera stuck in a wall. A "Revenir au point de départ" control must always work.

## 3. The 360° pipeline

### 3.1 One run, one result, plans included
**What happens now:**
1. The points are placed (Blender).
2. Blender builds the visit: draft 360° views, the 2D plan, then the architect plan.
3. The daylight Présentation starts by itself (`AUTO_LOOK`).
4. The AI finish runs on each point (`auto-ai.json`).
5. The **3D plan is separate**: a button, `startPlan3d`.

**What the owner wants.** The final quality is the only result anyone sees, so Blender and the AI count as one step. Nothing appears before everything is finished. The 2D plan, the architect plan and the 3D plan (with its AI version, `plan-3d-ai.jpg`) are made **in the same run** as the 360° views. No separate button, no second launch.

**What to do:**
- When the build ends, chain everything in one job with one progress:
  1. points;
  2. Blender 360° and plans;
  3. daylight;
  4. AI finish on every point;
  5. 3D plan and its AI version.
- Start `makePlan3d` from inside that job, not from a button. Keep the "only one Blender at a time" rule (the graphics slot).
- The project page shows the `Pipeline` screen until **all** of it is done. That includes the plans. Never show a Blender draft (owner rule since 15 Nov: "the 360 is the AI image itself").
- Show the steps in the `Pipeline` screen: "Placement des points de vue", "Rendu 360° et plans", "Lumière du jour, lampes allumées", "Finition IA", "Plan 3D". Give one estimated remaining time.
- Remove the "Faire le plan 3D maintenant" button. Keep `startPlan3d` only as an internal function.
- Credits: the AI images are still reserved and charged one by one, exactly as `lib/credits.ts` does now (`reserveCredit`, release on failure). Check how the AI version of the 3D plan is charged today and keep it the same. Do not invent a new price.

### 3.2 "Qualité finale" goes away
`LookPanel.tsx` puts a "Qualité finale" button on a visit that is already final. The owner asks why it exists if the first run already gives the final quality.

- Remove `LookPanel` from the visit toolbar in `TourClient.tsx`.
- If a final step failed, the visit must say so and offer one "Reprendre" button that resumes the interrupted part. Reuse the existing `stage === 'interrupted' | 'error'` states.

### 3.3 "Points de vue" must not start Blender again
**What happens now:**
- On a finished visit, the "Points de vue" button calls `propose()`, so `startTourPropose` opens the whole file in Blender again. The page shows "Recherche des pièces et placement des points de vue…" for minutes, with **no Stop button**.
- The editor only appears after that.

**What to do:**
1. **Open the editor at once, with no Blender run.** When a build exists, open the points editor from:
   - the saved points (`points.json`, `readChosenPoints`);
   - the built visit's points and plan (`tour.json`: the plan image, levels, scale, each point's position and direction).

   Build the `TourProposal` the editor expects from those files, in milliseconds. If you need a field the build does not keep (for example the plan's pixel-to-metre mapping), add it to `tour.json` at build time.
2. **"Replacer automatiquement" is the only action that runs Blender** to place new points. It must show its progress inside the editor, with a "Arrêter" button that kills the Blender process. Reuse `killTree` and the live-process list that `stopTourBuild` uses.
3. **Confirming changed points re-renders only what changed.**
   - New and moved points are rendered.
   - Removed points are dropped.
   - Untouched points keep their final images, with no new AI charge.

   If a partial rebuild is too large for this round, at least show before the launch how many points will be rendered again and what it will cost: "3 points à refaire, 3 vues 360° de votre forfait".
4. **Any running placement or build must have a visible "Arrêter".** The owner had to wait with no way out.

### 3.4 The editor that will not go away (bug seen on 17 Nov with Sarah)
A proposal stays on disk (`tour/proposal.json`, state `ready`) until the person clicks "Lancer la visite 360°" or "Garder la visite actuelle". If they leave the editor with "← Mes projets", or close the app, the file stays. From then on, every time they open the 360°, `TourClient` shows the editor (`data.proposal?.state === 'ready'`) instead of the visit. Sarah thought the visit "would not open".

Fix:
- Leaving the editor while a visit exists drops the proposal: the same as "Garder la visite actuelle".
- A `ready` proposal older than the current build is ignored when a visit exists.
- After 3.3.1 this mostly disappears, because the editor no longer depends on a saved Blender proposal. Still make sure it cannot return.

### 3.5 The empty plan in the editor (seen on Sarah's PC)
On her project the editor showed a white area: the plan image did not load, and the three points were pushed to the edges. The `<img>` in `PointsEditor.tsx` loads `/api/scenes/<id>/tour/<level.file>?v=…`.

Find out why it can fail:
- missing file;
- name not matched by `TOUR_FILE` in `lib/scene-tour.ts`;
- level index;
- a proposal written by an older version.

When the plan cannot be shown, say so ("Le plan n'a pas pu être affiché") and offer "Replacer automatiquement". Never show points on a blank area.

## 4. What must not change

- Credits:
  - one reservation per AI image;
  - released on any failure;
  - never charged twice for the same job id (`lib/credits.ts`).
- Never show Blender's raw output to the user or their clients.
- One Blender at a time on the PC (the graphics slot); the thermal pause and resume keep working.
- Published visits and their public links (`proxy.ts`) are not touched.
- No new paid AI calls beyond what the pipeline already makes. Ask the owner before adding any.
- Do not run prettier on the repository. Keep each file's existing style.
- Do not use the projects of the client "Ouaret" (scene ids `kYnk3lODJqnaFRsEzyy3c` and `laNvCV_VDPcXQgHv7of6g`), not even to test.
- Do not run a build or a second Blender while a render is running on the owner's PC.

## 5. Open choices for the owner

1. **The name for "Objectif".** Options: **Angle de vue** (default in this brief), Champ de vision, Cadrage, Focale.
2. **The "Plan" chip in the walk view (2.5.6).** Keep it, as a map for moving only, or drop it.
3. **Partial re-render when points change (3.3.3).** Do it now, or for this round only show the count and the cost before the launch.

## 6. How to check it

Run each check on the Bloc B F5 demo project in the owner's test profile, and on one small project.

1. **The Studio side panel** has no "← Mes projets" and no account line. The button reads "Faire le rendu", and the lens group reads "Angle de vue".
2. **The walk.** In the 3D view of the F5:
   - you start at eye level;
   - the bottom bar lists the SketchUp scenes;
   - you can walk from the living room to a bedroom through the door with the keys and with double-click;
   - you stop at walls;
   - the eye stays at 1.6 m;
   - "Revenir au point de départ" works.
3. **The photo framing.** Choosing a scene and clicking "Faire le rendu" frames exactly as before. Walking away and rendering uses the free framing.
4. **A new visit:**
   - one launch produces the 360° views, the 2D plan, the architect plan and the 3D plan;
   - the page shows only the progress until everything is done;
   - no "Qualité finale" button appears on the finished visit;
   - "Faire le plan 3D maintenant" is gone.
5. **"Points de vue" on a finished visit:**
   - the editor opens at once, with the saved points on the plan;
   - no Blender process starts (check the process list);
   - "Garder la visite actuelle" and leaving with the top navigation both return to the visit;
   - reopening the 360° shows the visit, not the editor.
6. **"Replacer automatiquement"** shows its progress and an "Arrêter" button that really stops Blender.
7. **Credits.** In the credit history, each AI image of a new visit is reserved once, failures are released, and reopening or editing points without launching charges nothing.
8. **Release.** Bump `desktop/package.json` to 0.5.3 and write `desktop/release-notes/0.5.3.md` in French. Do not publish without the owner's go. Once they say go, run from `desktop/`:
   1. `npm run dist:win:zip`, with `ROOMIA_SPARK_DIR` set;
   2. `node scripts/build-installer.mjs`;
   3. `node scripts/release.mjs --notes release-notes/0.5.3.md`.

   The Windows build overwrites `desktop/stage`. Rebuild the Linux stage afterwards with `node scripts/package-server.mjs --platform=linux`.
