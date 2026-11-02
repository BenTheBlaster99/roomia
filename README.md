# Roomia

Roomia turns an architect's 3D model into a client presentation: photoreal images, 360° virtual tours, a free walk-through, and 2D and 3D floor plans.

- **Website:** [room-ia.com](https://www.room-ia.com)
- **Roomia Desktop:** the Roomia Studio as a Windows application. Renders run on your own graphics card.

---

## Roomia Desktop

> **Version 0.1.1, preview.** Version 0.1.0 is withdrawn: its package was incomplete and the app couldn't start. Use 0.1.1 or later. Expect rough edges, and please report any problem (see [Troubleshooting](#troubleshooting)).

### Download

| File | Platform | Size |
|---|---|---|
| [**Roomia-0.1.1-windows-x64.zip**](https://github.com/BenTheBlaster99/roomia/releases/download/v0.1.1/Roomia-0.1.1-windows-x64.zip) | Windows 10 / 11, 64-bit | 280 MB |

All versions are on the [Releases page](https://github.com/BenTheBlaster99/roomia/releases).

**SHA-256** (optional; lets you check that the download is intact):

```
190fd39daab76952f455d17fa68ecc1fff0a4dd3ace706663c062aed4c804c1a
```

To check it in PowerShell:

```powershell
Get-FileHash .\Roomia-0.1.1-windows-x64.zip -Algorithm SHA256
```

### System requirements

| | Minimum | Recommended |
|---|---|---|
| System | Windows 10 64-bit | Windows 11 64-bit |
| Memory (RAM) | 8 GB | 16 GB or more |
| Graphics card | Any; without a supported GPU, renders run on the processor (slow) | NVIDIA RTX with 8 GB or more of graphics memory |
| Disk space | 3 GB free, plus space for your projects | 10 GB free |
| Internet | First launch (to download the render engine), sign-in, AI photos | Same |

**Graphics card support**

- NVIDIA: OptiX and CUDA. This is the tested path, on a GeForce RTX 3060.
- AMD: HIP.
- Intel Arc: oneAPI.

Some integrated graphics, such as older AMD Ryzen laptop chips, aren't supported by the render engine. Roomia then renders on the processor, which works but is slower.

The app detects your card by itself. Before you install, update your graphics driver from the manufacturer's site: [NVIDIA](https://www.nvidia.com/Download/index.aspx), [AMD](https://www.amd.com/en/support/download/drivers.html), [Intel](https://www.intel.com/content/www/us/en/download-center/home.html).

### Installation

1. Download **Roomia-0.1.1-windows-x64.zip** from the [Releases page](https://github.com/BenTheBlaster99/roomia/releases/tag/v0.1.1).
2. Right-click the file and choose **Extract All…**. Pick a folder you will keep, for example `C:\Roomia`.
   Don't run the app from inside the zip: Windows only shows its contents, and Roomia won't start.
3. Open the extracted folder and double-click **Roomia.exe**.
4. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. This appears because the preview build isn't code-signed yet.
5. Optional: right-click **Roomia.exe** and choose **Pin to taskbar** or **Send to → Desktop (create shortcut)**.

### First launch

The first start takes a few minutes. A progress window shows each step:

1. **Render engine.** Roomia downloads Blender 4.5 LTS from blender.org (about 400 MB) and checks it against blender.org's official checksum. This happens once. If Blender 4.5 is already installed on the PC, Roomia uses that copy.
2. **Graphics card test.** Roomia runs a short test render to find the best way to use your card, then picks a render profile:

   | Profile | Hardware |
   |---|---|
   | High | 16 GB or more of graphics memory and 32 GB of RAM |
   | Balanced | 8 GB or more of graphics memory and 16 GB of RAM |
   | Low | A smaller graphics card |
   | Processor | No supported graphics card found |

3. **Sign in.** Sign in with the Roomia account you were given, or click **Continuer sans compte** to use Blender renders only.

Later launches take about 15 seconds.

> **About your graphics card:** while Roomia renders a 360° tour, a walk-through or a plan, your graphics card runs at full load. Other heavy programs, like a game or a second renderer, will be slow during that time. Closing Roomia stops every render it started.

### Account and credits

| Feature | Account needed | Credits | Runs on |
|---|---|---|---|
| Blender renders, 360° tours, walk-through, 2D and 3D plans | No | Free | Your PC |
| AI photoreal images | Yes | 1 credit per image | Roomia's server |

- A credit is only used once the image has been delivered and checked. If an image fails, the credit is returned.
- If the connection drops while an image is being made, run it again: you get the same image back without paying twice.
- The images you pay for are also kept on your Roomia account.
- To get an account or more credits, contact Roomia through [room-ia.com](https://www.room-ia.com).

Use the **Compte** menu to sign in, switch accounts or sign out. The app stays signed in for 180 days.

### Menus

| Menu | What it's for |
|---|---|
| **Fichier** | Open the projects folder, open the log, quit |
| **Affichage** | Reload, zoom, full screen |
| **Compte** | Sign in, switch account, sign out |
| **Moteur** | See the graphics card and engine report; redo the graphics card test (after a driver update or a new card) |
| **Aide** | Version and engine information |

### Where your files are

Your projects stay on your PC, in your Windows user folder. They are kept when you update or remove the app.

| What | Folder |
|---|---|
| Projects | `%LOCALAPPDATA%\Roomia\projects` |
| Local database | `%LOCALAPPDATA%\Roomia\data` |
| Logs | `%LOCALAPPDATA%\Roomia\logs` |
| Render engine | `%LOCALAPPDATA%\Roomia\engine` |

To open one, paste its path into the File Explorer address bar.

### Updating

1. Close Roomia.
2. Download the new zip from the [Releases page](https://github.com/BenTheBlaster99/roomia/releases).
3. Delete the old app folder (for example `C:\Roomia`) and extract the new version in its place.

Your projects, your sign-in and the render engine are kept.

### Uninstalling

1. Close Roomia and delete the app folder.
2. To also delete your projects and settings, delete `%LOCALAPPDATA%\Roomia`.
   **This permanently removes your local projects.** Copy anything you want to keep first.

### Troubleshooting

| Problem | What to do |
|---|---|
| Nothing happens when you open Roomia.exe | Make sure you extracted the zip (step 2 of [Installation](#installation)). Only one Roomia window can be open at a time: check the taskbar. |
| "Windows protected your PC" | Click **More info**, then **Run anyway**. |
| Renders are very slow, or the profile says **Processor** | Update your graphics driver, then **Moteur → Refaire le test de la carte graphique**. |
| The render engine download fails | Check your internet connection and start Roomia again. The download starts over and is checked again. |
| "Le serveur Roomia est injoignable" | AI images need an internet connection. Blender renders keep working offline. |
| "Plus de crédits sur ce compte" | Contact Roomia to top up your account. |

To report a problem, send the following:

- the content of **Moteur → Carte graphique et moteur…**;
- the files from **Fichier → Ouvrir le journal**.

### Known limitations (0.1.1)

- Windows only.
- No installer yet: the app ships as a zip.
- Not code-signed yet, so Windows shows the SmartScreen warning.
- No automatic updates: download new versions from the Releases page.
- No sync between PCs yet. Projects stay on the PC where they were made.
- The SketchUp plugin and video walkthroughs are coming in later versions.

---

## For developers

The repository holds the website, the Roomia Studio (Next.js) and the desktop shell.

| Folder | Content |
|---|---|
| `app/` | Website, Studio pages and API routes |
| `lib/` | Render pipeline, scene import, tours, accounts and credits |
| `scripts/` | Scene preparation and Blender scripts |
| `desktop/` | Roomia Desktop (Electron shell, engine setup, packaging) |
| `docs/` | Technical notes, starting with [`docs/HANDOFF-scene-pipeline.md`](docs/HANDOFF-scene-pipeline.md) |

### Run the Studio locally

```bash
npm install
npm run dev        # http://localhost:3000
```

The Studio needs Blender 4.5 LTS and a `.env.local` file with the server settings. Never commit `.env.local`.

### Build Roomia Desktop

Build steps, the start-up sequence and the security model are in [`desktop/README.md`](desktop/README.md).
