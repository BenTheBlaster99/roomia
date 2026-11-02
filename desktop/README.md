# Roomia Desktop

The Studio as a Windows app. Renders run on the architect's own graphics card.

## What it does at start-up

1. It allows one instance only.
2. It finds the render engine: Blender 4.5.9 LTS.
   - On first launch it downloads Blender from blender.org (about 400 MB) and checks it against the official SHA-256 pinned in `engine.js`. It unpacks it into `%LOCALAPPDATA%\Roomia\engine`.
   - A Blender 4.5 that's already installed in Program Files is used as is.
3. It tests the graphics card once per engine. It asks Blender which backends see a device (OptiX, CUDA, HIP, oneAPI), renders a 64 px test, and reads RAM and graphics memory.
   - The result is saved in `engine.json`.
   - The server receives it as `ROOMIA_GPU_BACKEND` and `ROOMIA_RENDER_PROFILE` (`high`, `balanced`, `low` or `cpu`).
4. It starts the Studio's standalone server on `127.0.0.1` with a free port, waits for `/api/desktop/health`, then opens `/studio`.
5. If the server crashes, it restarts it, up to three times a minute.
6. Closing the app stops the server and every render it started.

## Where the files go (Windows)

| What | Where |
|---|---|
| Projects (`SCENES_DIR`) | `%LOCALAPPDATA%\Roomia\projects` |
| Database | `%LOCALAPPDATA%\Roomia\data\roomia.db` |
| Logs | `%LOCALAPPDATA%\Roomia\logs` |
| Engine | `%LOCALAPPDATA%\Roomia\engine` |
| Graphics card test result | `%LOCALAPPDATA%\Roomia\engine.json` |

## Security

- The pages get no Node: `contextIsolation` is on, `nodeIntegration` is off, and they are sandboxed.
- The preload exposes only the start-up progress, a read-only engine report and "open the projects folder".
- The window only navigates within the local Studio. Any other address opens in the browser.
- The packaging step fails if any server secret from `.env.local` ends up in the package. AI calls are meant to go through Roomia's server (part 3), never with the key on a client's PC.

## Build

```bash
cd desktop
npm install
node node_modules/electron/install.js   # if npm's script policy skipped Electron's download

# Linux build, to test here
npm run dist:linux              # → dist/linux-unpacked/roomia-desktop
# Windows installer, built from Linux
npm run dist:win                # → dist/Roomia-Setup-0.1.0.exe
```

`scripts/package-server.mjs` does the following:
1. Builds the Studio with `ROOMIA_DESKTOP_BUILD=1`: standalone output in `.next-desktop`, so the Studio's own `.next` is not touched.
2. Bundles `scripts/prepare-scene.ts`, so the app doesn't need tsx.
3. Swaps sharp's native part for the target platform's.
4. Unpacks scipy 1.13.1 and Pillow 11 for Blender's Python 3.11 into `pylib-<platform>`.
5. Runs the secret check.

## Not yet

- Code signing: until it's signed, Windows SmartScreen warns on install.
- Automatic updates.
- The AI service through Roomia's server, plus accounts and credits.
- The SketchUp plugin.
- Sync.

When the app runs from VS Code's terminal, unset `ELECTRON_RUN_AS_NODE` first: VS Code sets it, and Electron then starts as plain Node.
