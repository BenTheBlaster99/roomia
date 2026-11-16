# Roomia redesign brief (16 Nov 2026)

You are redesigning the look and the screen layouts of Roomia: the public website and the desktop application. The owner of the product wrote the wishes below; I surveyed the code and turned them into this brief. Read all of it before you touch a file.

## 1. What Roomia is and who uses it

Roomia turns an architect's SketchUp model into things they sell to their own clients: a 360° virtual visit, photoreal photos, a 2D plan, a 3D plan and a video. The architect works in **Roomia Desktop** (an Electron app that runs a local Next.js server and Blender on their PC). Their clients open a **published visit link** in a browser, often on a phone. The **website** (room-ia.com) sells Roomia to architects and developers in Algeria. All interface text is in French.

The buyers are high-end: architects selling luxury interiors to people who want to see the place before they pay for it. The first real user, Sarah (an architect, not technical), says the app "still feels hard and a bit complicated". The owner says the app looks like "a CS student exercise", not like a desktop application, and that one panel is "hideous, the most basic thing ever". Fixing both of those is the job: it must be easy, calm, and look expensive.

## 2. The outcome wanted

1. One brand across the website, the app and the client visit: **petrol blue, gold and white**.
2. A website that shows more than the one landing page: the other existing pages restyled and reachable from the navbar, and the whole site feeling more alive.
3. A desktop app that is mostly **white**, with blue and gold as the action and accent colours, that reads as a real application and is obvious to use.
4. A new layout for the project page (a vertical approach) and a rebuilt Studio side panel.

This is a redesign of colours, typography, layout and wording. It is not a change of what the product does. Section 9 lists what must not change.

## 3. Where things are

- Repository: `/media/jackhammer/DATA/Linux-Work/Projects/roomia-w`, branch `work/look-recipe-and-desktop-8nov`. Work here and commit here.
- `AGENTS.md` at the root: this Next.js (16.2.7) differs from what you know. Read the guide in `node_modules/next/dist/docs/` for anything you are unsure of before writing code.
- Website, new landing: `app/[locale]/page.tsx` with `app/[locale]/landing.css` (every rule scoped under `.rl`; fonts loaded in the page with `next/font`). Locales are `fr` (default) and `en` (`i18n/routing.ts`).
- Website, older pages: `app/[locale]/about`, `contact`, `styles`, `styles/[id]`, `rooms`, `marketplace`, `partners`, `generateur`, `quiz`. They use the older `rm-*` classes in `app/globals.css` (1,747 lines, green and cream tokens at `:root`) and components in `components/marketing` and `components/landing`. `app/[locale]/_ancienne-accueil` is the retired home page: leave it out.
- App shell and theme: `app/studio/layout.tsx` wraps everything in `.studio-theme`, defined at the end of `app/globals.css`. It overrides the site's `--rm-*` tokens with a dark "Graphite" theme and patches a few Tailwind utility classes for the dark background. Many Studio components use Tailwind classes directly.
- App screens:
  - Projects list: `app/studio/projets/ProjectsClient.tsx`
  - Account ("Mon espace"): `app/studio/compte/AccountClient.tsx`
  - App navigation: `app/studio/components/DesktopNav.tsx`, `TopBar.tsx`
  - Studio (the 3D view of a project): `app/studio/Studio.tsx`, `StudioClient.tsx`, and the left panel `app/studio/components/SceneSidebar.tsx` with `RenderPanel.tsx`, `DesktopRenderNotice.tsx`
  - Project page (visit, plans, gallery, video): `app/studio/tour/[id]/TourClient.tsx`, `TourSheets.tsx`, `LookPanel.tsx`, `PointsEditor.tsx`, `PanoViewer.tsx`, `DesktopPublish.tsx`, styles in `tour.css`
  - Sign-in: `app/login/page.tsx`. Admin (owner only): `app/studio/admin`.
- Electron side: `desktop/main.js` (window, native menu), `desktop/splash.html`, `desktop/installer/roomia.nsi`, icon made by `desktop/scripts/make-icon.mjs`.
- The standalone web visit that goes into a client's export: `lib/scene-web-visit.ts` (self-contained HTML, its own inline styles).

## 4. The brand

**Colours.** Sampled from the business card the architect is designing (a gold mark on a petrol-blue ground):

| Token | Value | Use |
|---|---|---|
| Blue | `#124C5E` | the brand colour: primary buttons in the app, headers, dark sections of the site |
| Blue, deep | about `#0C3644` | hover and pressed states, footer, text on white where black would be too hard |
| Blue, tint | about `#E8F0F2` | selected rows, quiet panels, info notices |
| Gold | `#C0904D` | the accent: highlights, the active item, the one key action on a blue ground |
| Gold, light to dark | `#D6AA67` to `#B68444` | the card's gradient; use it sparingly, for the logo and one hero detail |
| White | `#FFFFFF` | the app's ground |
| Off-white | about `#F6F4EF` | page ground behind white cards, so cards have an edge without heavy borders |

Derive the rest (borders, muted text, danger, success, warning) yourself and keep them in the same family: a warm grey for muted text, never a pure neutral grey next to the gold. Put every colour in tokens; no hex values scattered in components.

Two rules that follow from the colours:
- **Gold is not a text colour on white.** `#C0904D` on white is about 2.9:1, below what is readable. On white, use gold as a fill (with deep-blue text on it), a border, an icon or an underline; if gold text is unavoidable, use a darker gold of at least 4.5:1. Gold text is fine on the blue.
- **Blue carries the actions in the app; gold marks what is special.** A screen has one primary button, and it is blue. Gold is for the active tab, the selected card, a "finished" state, the final-quality action. If everything is gold, nothing is.

**Where each surface sits:**
- App: white overall, as the owner asked. Blue and gold as touches.
- Website: blue, gold and white are the three colours. Alternate deep-blue sections (the hero, the proof, the final call) with white sections so the page has rhythm; the current page is one long near-black sheet.
- 360° viewer, photo lightbox, video player: the image is the content, so the stage around it stays dark (deep blue-black, not the old graphite) and the controls float on it. This is the one exception to "white overall", and it is deliberate: white chrome around a photo washes it out.

**Type.** Keep the landing's four families and extend them to the app, which currently uses different fonts (Syne, Figtree):
- Archivo, variable width axis, for headings and the wordmark. The wordmark "ROOMIA." is Archivo 900 at width 125, capitals, with the full stop in gold.
- Hanken Grotesk for body text and interface text.
- Instrument Serif italic for the occasional emphasised word in a heading.
- JetBrains Mono for small spaced labels.
In the app, use the wide Archivo only for page titles and the wordmark; interface text stays Hanken Grotesk at comfortable sizes (15 to 16 px base, not 13).

**Logo.** The architect is drawing a mark (an "R" whose leg becomes a roof with a small window). I only have a screenshot of it. Do not redraw it, trace it or invent a substitute. Keep the "ROOMIA." wordmark everywhere, and build the header, the splash screen and the app icon so that a real logo file can be dropped in at one place later. Say in your final report where that place is.

## 5. The website

1. **Restyle the landing** (`app/[locale]/page.tsx`) into the new palette. Its structure and its content work: the "≈ 2 h vs 3 min" comparison, the before-and-after wipe, results, steps, who it is for, offers, demo. Keep them. Change the colours, give sections alternating grounds, and add life: real project images larger and earlier, movement that serves the content (the wipe, a looping 360° preview, a reveal on scroll), not decoration.
2. **Bring the other pages in.** Audit each one listed in section 3: open it, read it, and decide. The owner wants them restyled and linked in the navbar, because the site should be more than one page. Some were written for an earlier idea of the product (a furniture marketplace, a style quiz, an image generator) and may contradict what Roomia sells today.
   - Pages whose content still holds: restyle them to the new brand and link them.
   - Pages whose content is out of date: restyle them, do not link them, and list them in your report with one line on what is wrong, so the owner decides. Do not rewrite a page's meaning on your own and do not delete any.
3. **One navbar and one footer for every page**, as shared components, replacing the landing's private header. The navbar holds the real pages plus the demo button; on a phone it becomes a menu. The landing's in-page anchors (Résultats, Offres and so on) can live in a second row on the landing or in the footer; do not lose them.
4. Move the landing's tokens and the old `:root` tokens to one shared set, so a page cannot drift from the brand. Keep the landing's rules scoped so they do not leak into the app.
5. Both locales must keep working. Every page must work at phone width.

## 6. The desktop app

General direction: a white, quiet, spacious application. Think of the desktop tools architects already trust, where the work is big and the controls are few and labelled. Each screen answers one question: "what do I do next?" Use fewer words, bigger targets, one obvious primary action, and plain French a non-technical person understands.

**6.1 Window and shell**
- The native menu strip ("Fichier, Affichage, Compte, Moteur, Aide") sits above the app as a grey system bar and makes it look like a web page in a frame. Hide it on Windows and Linux (it can still open with Alt), and make sure everything in it that a user needs is reachable inside the app: a help entry, "Rechercher une mise à jour", "Créer un rapport de problème", the render engine settings, sign out. `desktop/main.js` builds the menu; the pages reach Electron through `window.roomiaDesktop` (`desktop/preload.js`, `types/roomia-desktop.d.ts`).
- One app header: the wordmark, "Mes projets", "Mon espace", and "+ Nouveau projet" as the single blue button.
- Restyle `desktop/splash.html` to match. The app icon and installer art stay as they are until the real logo exists.

**6.2 Projects ("Mes projets")**
Today it is a list of text rows with four equal buttons each, a grey line about the graphics card, a yellow disk warning and a block of SketchUp instructions, all with the same weight.
- Projects become cards with a cover image (a 360° or photo of the project if one exists, a neutral placeholder if not), the name, the date, and what is ready, shown as small quiet marks (Visite 360°, Plans, Photos, Vidéo, Lien client).
- One primary action per card: open the project. Rename, 3D view and delete go into a "more" menu; delete keeps a confirmation.
- The first-run empty state is the SketchUp guidance: three short illustrated steps and the "Installer l'extension SketchUp" button. Once projects exist, that guidance shrinks to a small help link.
- Technical facts (graphics card, engine profile, disk space) move to a discreet status area or to "Mon espace". A warning appears only when the user must act, in words that say what to do.

**6.3 Project page (visit, plans, gallery, video)**
Today a single dark top bar holds everything in one row: back link, title, "Qualité finale", "Lien client", "Points de vue", "Tout télécharger", then seven tabs. The owner dislikes it and proposes a vertical layout. I agree, and this is the layout to build:
- A **vertical rail on the left** with the project's sections, each an icon with a label: Visite 360°, Galerie, Plan 2D, Plan 3D, Vidéo, Nouvelles photos. The current one is marked in gold. A section that does not exist yet is shown as "to make", with its action, not greyed out without explanation.
- The **content takes all the remaining space**. For the 360° that means the image edge to edge on the dark stage.
- **Actions grouped by intent**, away from the navigation: "Partager" (the client link, copy, publish again) and "Télécharger" (this 360°, everything) together at the top right; the actions that belong to one section (edit the viewpoints, final quality, rename a point) inside that section, next to what they change.
- The project name is a clear title that can be renamed in place.
- On a narrow screen the rail becomes a bottom bar.
- Before you build it, look at how the leading virtual-tour and property-presentation products lay out a tour (their navigation between rooms, the floor-plan inset, the gallery strip, how little chrome they show over the image), and take what serves this page. Do not copy any product's look.

The **published client view** uses the same components, opened by the architect's client in a browser, usually on a phone. It must stay minimal and must never show the architect's tools: no editing, no downloads they are not given, no account. Check it at 390 px wide.

The step screens before a visit exists (placing the viewpoints in `PointsEditor.tsx`, the four-step progress in `TourClient.tsx`) get the same treatment: white, calm, one primary button, the plan large.

**6.4 Studio side panel (`SceneSidebar.tsx`)**
This is the panel the owner called hideous. Today: three numbered blocks of grey boxes, three coloured dots for the time of day, a disabled gold button, and three stacked notices in small text. Rebuild it as a short guided panel:
1. **La vue.** The saved SketchUp scenes as thumbnail cards to pick from, and "Vue actuelle" (frame it freely in the 3D) as an equal first choice. The empty state still tells the user to import a JSON from a third-party extension ("Z5 Camera Transfer"); that is out of date. Roomia has its own SketchUp extension ("Envoyer à Roomia") which sends the scenes with the model, so the text must say that.
2. **L'ambiance.** Jour, Soirée, Nuit as three image cards that show what each looks like (a small rendered sample, or a well-made illustration of the light), not three dots.
3. **One primary button** at the bottom, always visible, whose label says what will happen ("Faire la photo"), disabled with the reason beside it when something is missing.
- The explanations (graphics card under load, expected minutes, server unreachable) are useful but must not stack as three boxes. Show the duration as one quiet line; show the others only when they apply, in one place.
- The link to the project page ("Page du projet : visite 360°, plans, vidéo") deserves to be a visible second action, not a box at the bottom of a scroll.
- The 3D viewport's ground and the controls over it move to the new theme too.

**6.5 Account, sign-in, the rest**
"Mon espace" shows the user's package as what they have left in plain terms (photos, vues 360°, plans, updates). Restyle it, the sign-in page and every dialog, toast, notice and empty state. The owner's admin page only needs to be readable in the new theme.

## 7. How to work

1. **Look first.** Run the app and take screenshots of every screen in section 6 and every page in section 5 before changing anything, so you have the "before" and you know every state (empty, loading, error, finished).
2. **Tokens first.** Define the palette, type scale, spacing, radius, shadow, and the base components (button, card, field, tab, notice, dialog) once. Then apply them screen by screen. The `.studio-theme` block and the Tailwind patches under it are where the app's theme lives today; a light theme makes most of those dark-mode patches unnecessary, so remove what no longer applies instead of piling on.
3. **Order:** tokens and shared components, then the app (projects, project page, Studio panel, the rest), then the website. The app is what the user in front of us is struggling with.
4. **Commit after each screen** with a message that says what changed, so any one step can be undone.
5. **Check each screen in a real browser** at 1440, 1024 and 390 px wide, in each of its states, and look at the screenshot yourself before moving on. Keyboard focus must be visible and text contrast must pass 4.5:1.

Running it:
- The live Studio is a systemd service on port 3000 serving another build. Do not stop it, restart it or build into its folder. Port 3002 belongs to another program.
- Run your own copy on a free port (3005, for example) with its own build folder: set `ROOMIA_DIST` to a folder of your own, and `ROOMIA_DESKTOP=1` to see the desktop app's screens in a browser. Point `SCENES_DIR` at a copy of a test project; there is one at `~/roomia-test-scenes`. Do not edit the live projects in `/media/jackhammer/DATA/Linux-Work/Projects/roomia/.scenes`.
- Type-checking needs `ROOMIA_SPARK_DIR=/home/jackhammer/roomia-mods/node_modules/@sparkjsdev/spark` or it reports a missing module that is not your doing.
- A Chromium for screenshots is at `~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`; install `playwright-core` in a scratch folder, not in the repository.
- The Electron app starts from `desktop/` with `./node_modules/.bin/electron . --no-sandbox` after unsetting `ELECTRON_RUN_AS_NODE`; it needs `node scripts/package-server.mjs --platform=linux` first (several minutes) to pick up page changes. Use the browser copy for the day-to-day loop and the Electron window for a final check.

## 8. Done means

- Every screen and page listed in sections 5 and 6 is in the new brand, in every state, with no leftover graphite, green or cream.
- The app is white overall; each screen has one clear primary action; the project page uses the vertical layout; the Studio panel is rebuilt.
- The website has one shared navbar and footer, and the restyled pages that hold up are linked from it.
- Nothing in section 9 changed. Lint and type-check are clean, and you opened every screen and saw it work.
- A final report with: before-and-after screenshots per screen, the website pages you did not link and why, where the logo file goes, anything you could not verify, and any place where you departed from this brief and the reason.

## 9. What must not change

- **Behaviour.** No changes to the rendering pipeline, the API routes, the forfait and credit logic, the update system, or the scripts in `scripts/`. If a layout change seems to need a logic change, stop and say so in the report.
- **No prices in the app.** The user's package is shown as counts of what is left. No DA amounts and no "crédits" wording on any client-facing screen. This was a decision, not an oversight.
- **Blender's work is never shown to the client.** While a visit is being made the user sees the progress steps, not preview renders. Do not bring back a preview.
- **"Visite libre" stays hidden** (it is reachable only with `?edit=1`). Do not add it to the new rail.
- **The reviewer mode** (`?edit=1` on the project page) keeps working; it does not need to be pretty.
- **Do not publish, deploy or ship:** no desktop release, no push or merge to `main`, no change to the live Studio build. Commit on the work branch only.
- **Do not start the tunnel** (`roomia-tunnel`) and do not sign in as a client account.
- **Spend nothing:** do not trigger AI photos or the AI finish. If a screen needs a finished state to be styled, use the test project's existing files.
- **Two projects are off limits** even for a look: scenes `kYnk3lODJqnaFRsEzyy3c` and `laNvCV_VDPcXQgHv7of6g`.
- **No secrets** in anything under `desktop/`.
- The standalone web visit (`lib/scene-web-visit.ts`) should get the new colours and type, but it must stay one self-contained file that works when opened from a folder: no external fonts or scripts added to it.
