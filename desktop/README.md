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
- The packaging step fails if any server secret from `.env.local` ends up in the package. AI calls go through Roomia's server with the account's device token (`lib/roomia-cloud.ts`, `app/api/desktop/*`). The AI key never ships in the app.

## Build

```bash
cd desktop
npm install
node node_modules/electron/install.js   # if npm's script policy skipped Electron's download

# Linux build, to test here
npm run dist:linux              # → dist/linux-unpacked/roomia-desktop
# Windows zip (the release build), built from Linux
npm run dist:win:zip            # → dist/Roomia-<version>-windows-x64.zip
# Windows installer (NSIS): needs Wine on Linux, or build on Windows
npm run dist:win                # → dist/Roomia-Setup-0.1.0.exe
```

Publish a release by uploading the zip to the repository's Releases page, with its SHA-256 in the release notes, and update the version and checksum in the root `README.md`.

`scripts/package-server.mjs` does the following:
1. Builds the Studio with `ROOMIA_DESKTOP_BUILD=1`: standalone output in `.next-desktop`, so the Studio's own `.next` is not touched.
2. Bundles `scripts/prepare-scene.ts`, so the app doesn't need tsx.
3. Swaps sharp's native part for the target platform's.
4. Unpacks scipy 1.13.1 and Pillow 11 for Blender's Python 3.11 into `pylib-<platform>`.
   The server goes to `stage/app-server`. electron-builder always drops the top-level `node_modules` of a folder it copies, so `package.json` copies `app-server` from its parent, `stage/`.
5. Adds the official Node.js 24.18.0 runtime (`runtime-<platform>`). The server runs on real Node, not on Electron's: sharp crashes under `ELECTRON_RUN_AS_NODE`, and Electron caps the heap at 4 GB.
6. Runs the secret check.

## Not yet

- The NSIS installer (the zip ships for now).
- Code signing: until it's signed, Windows SmartScreen warns on install.
- Automatic updates.
- The SketchUp plugin.
- Sync.

When the app runs from VS Code's terminal, unset `ELECTRON_RUN_AS_NODE` first: VS Code sets it, and Electron then starts as plain Node.

## Checking a Windows build

electron-builder's `${platform}` macro is the platform of the machine that builds, not the target. So `package.json` names the Windows and Linux resources explicitly, in `build.win` and `build.linux`. Before publishing a zip, check:

```bash
R=dist/win-unpacked/resources
file $R/runtime/node.exe                                # PE32+ (Windows), not ELF
find $R/pylib -name '*.pyd' | wc -l                     # > 0, and no *.so files
ls $R/app-server/node_modules/@img                      # sharp-win32-x64
```
