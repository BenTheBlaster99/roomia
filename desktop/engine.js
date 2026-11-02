'use strict'
/**
 * Roomia Desktop's render engine: Blender 4.5 LTS on the architect's own PC.
 *
 * - find(): a Blender already set up for Roomia (downloaded by the app, or ROOMIA_BLENDER), else a Blender 4.5
 *   installed by the user (Program Files on Windows).
 * - install(): downloads the pinned Blender from blender.org, checks its SHA-256 against the manifest below (the
 *   official checksums of the release) and unpacks it into the app's data folder. Nothing else is ever downloaded.
 * - probe(): asks that Blender which render devices work (OptiX, CUDA, HIP, oneAPI), renders a tiny test image on the
 *   best one, and reads RAM and graphics memory; the result picks a render profile.
 */
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')

const VERSION = '4.5.9'
const SERIES = '4.5'
/** blender.org's own checksums for 4.5.9 (https://download.blender.org/release/Blender4.5/blender-4.5.9.sha256) */
const BUILDS = {
  win32: {
    file: `blender-${VERSION}-windows-x64.zip`,
    sha256: '41da973b9bf95bb312cbeff4d1982feb13259b43c821686b9bafea4dfe5477cf',
    size: 399051129,
    exe: 'blender.exe',
    python: path.join(SERIES, 'python', 'bin', 'python.exe'),
  },
  linux: {
    file: `blender-${VERSION}-linux-x64.tar.xz`,
    sha256: 'dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d',
    size: 0,
    exe: 'blender',
    python: path.join(SERIES, 'python', 'bin', 'python3.11'),
  },
}
const URL_BASE = `https://download.blender.org/release/Blender${SERIES}/`

function build() {
  const b = BUILDS[process.platform]
  if (!b) throw new Error(`Roomia Desktop ne gère pas encore ${process.platform}`)
  return b
}

/** the folder a downloaded Blender lives in: <data>/engine/blender-4.5.9-windows-x64 */
function engineDir(dataDir) {
  return path.join(dataDir, 'engine', build().file.replace(/\.(zip|tar\.xz)$/, ''))
}

function exists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** The Python next to a Blender (its own 3.11, numpy included): Roomia's plan and 360° scripts run in it. */
function pythonOf(blenderExe) {
  const p = path.join(path.dirname(blenderExe), build().python)
  return exists(p) ? p : null
}

function blenderVersion(exe) {
  return new Promise(resolve => {
    execFile(exe, ['--version'], { timeout: 60000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null)
      const m = /Blender (\d+\.\d+\.\d+)/.exec(String(out))
      resolve(m ? m[1] : null)
    })
  })
}

/** Where a Blender for Roomia is, or null. Only a 4.5.x is taken: the scripts are written for it. */
async function find(dataDir) {
  const candidates = []
  if (process.env.ROOMIA_BLENDER) candidates.push({ exe: process.env.ROOMIA_BLENDER, source: 'env' })
  candidates.push({ exe: path.join(engineDir(dataDir), build().exe), source: 'roomia' })
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      candidates.push({ exe: path.join(root, 'Blender Foundation', `Blender ${SERIES}`, 'blender.exe'), source: 'installed' })
    }
  }
  for (const c of candidates) {
    if (!exists(c.exe)) continue
    const version = c.source === 'roomia' ? VERSION : await blenderVersion(c.exe)
    if (!version || !version.startsWith(SERIES + '.')) continue
    return { exe: c.exe, python: pythonOf(c.exe), version, source: c.source }
  }
  return null
}

function get(url, onResponse, onError, redirects = 5) {
  https
    .get(url, { headers: { 'User-Agent': 'RoomiaDesktop' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        return get(new URL(res.headers.location, url).toString(), onResponse, onError, redirects - 1)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return onError(new Error(`téléchargement refusé (${res.statusCode})`))
      }
      onResponse(res)
    })
    .on('error', onError)
}

/** Downloads the pinned Blender, checks it, unpacks it. onProgress(fraction, text). */
async function install(dataDir, onProgress = () => {}) {
  const b = build()
  const dir = engineDir(dataDir)
  const root = path.dirname(dir)
  await fsp.mkdir(root, { recursive: true })
  const part = path.join(root, b.file + '.part')
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    get(
      URL_BASE + b.file,
      res => {
        const total = Number(res.headers['content-length']) || b.size || 0
        let got = 0
        let last = 0
        const out = fs.createWriteStream(part)
        res.on('data', chunk => {
          hash.update(chunk)
          got += chunk.length
          const now = Date.now()
          if (now - last > 250) {
            last = now
            onProgress(total ? got / total : 0, `Téléchargement du moteur de rendu : ${Math.round(got / 1e6)} / ${Math.round(total / 1e6)} Mo`)
          }
        })
        res.pipe(out)
        out.on('finish', resolve)
        out.on('error', reject)
        res.on('error', reject)
      },
      reject,
    )
  })
  const digest = hash.digest('hex')
  if (digest !== b.sha256) {
    await fsp.rm(part, { force: true })
    throw new Error('le fichier téléchargé ne correspond pas à la version officielle de Blender (somme de contrôle)')
  }
  onProgress(1, 'Installation du moteur de rendu…')
  const staging = dir + '.unpack'
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.mkdir(staging, { recursive: true })
  if (b.file.endsWith('.zip')) await unzip(part, staging, onProgress)
  else await run('tar', ['-xJf', part, '-C', staging])
  // the archive holds one folder, blender-4.5.9-windows-x64
  const inner = (await fsp.readdir(staging)).map(n => path.join(staging, n))
  const top = inner.length === 1 && fs.statSync(inner[0]).isDirectory() ? inner[0] : staging
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.rename(top, dir)
  await fsp.rm(staging, { recursive: true, force: true })
  await fsp.rm(part, { force: true })
  const exe = path.join(dir, b.exe)
  if (!exists(exe)) throw new Error("Blender n'a pas été trouvé après l'installation")
  return { exe, python: pythonOf(exe), version: VERSION, source: 'roomia' }
}

function unzip(file, dest, onProgress) {
  const yauzl = require('yauzl')
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      let n = 0
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        const target = path.resolve(dest, entry.fileName)
        // an entry may not write outside the folder
        if (!target.startsWith(path.resolve(dest) + path.sep)) return reject(new Error(`entrée refusée : ${entry.fileName}`))
        if (++n % 500 === 0) onProgress(1, `Installation du moteur de rendu : ${n} / ${zip.entryCount} fichiers`)
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true })
          return zip.readEntry()
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          const out = fs.createWriteStream(target)
          stream.pipe(out)
          out.on('finish', () => zip.readEntry())
          out.on('error', reject)
        })
      })
      zip.readEntry()
    })
  })
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts })
    let out = ''
    let errOut = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (errOut = (errOut + d).slice(-4000)))
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} a échoué (${code}) ${errOut.trim().split('\n').pop() ?? ''}`))))
  })
}

/** Run inside Blender: every backend that sees a device, then a 64 px Cycles render on the best one. */
const PROBE_SCRIPT = String.raw`
import bpy, json, time
prefs = bpy.context.preferences.addons["cycles"].preferences
found = {}
for kind in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        devs = [d for d in prefs.get_devices_for_type(kind) if d.type != "CPU"]
        if devs:
            found[kind] = [d.name for d in devs]
    except Exception:
        pass
best = next((k for k in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL") if k in found), None)
test = {"backend": best or "CPU"}
try:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    if best:
        prefs.compute_device_type = best
        for d in prefs.get_devices_for_type(best):
            d.use = d.type != "CPU"
        scene.cycles.device = "GPU"
    else:
        scene.cycles.device = "CPU"
    scene.render.resolution_x = scene.render.resolution_y = 64
    scene.cycles.samples = 16
    scene.render.filepath = bpy.app.tempdir + "roomia-probe.png"
    t = time.time()
    bpy.ops.render.render(write_still=True)
    test["seconds"] = round(time.time() - t, 2)
    test["ok"] = True
except Exception as e:
    test["ok"] = False
    test["error"] = str(e)[:300]
print("ROOMIA_PROBE " + json.dumps({"devices": found, "test": test, "blender": bpy.app.version_string}), flush=True)
`

function nvidiaMemory() {
  return new Promise(resolve => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeout: 5000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null)
      const [name, total, driver] = String(out).trim().split('\n')[0].split(',').map(s => s.trim())
      resolve({ name, vramMb: Number(total) || 0, driver })
    })
  })
}

/**
 * The PC's render profile: high (16 GB of graphics memory or more), balanced (8 GB or more), low (less), or cpu (no
 * card Blender can use). The Studio reads it to choose texture sizes, samples and how much runs at once.
 */
function profileOf(backend, vramMb, ramMb) {
  if (!backend || backend === 'CPU') return 'cpu'
  if (vramMb >= 16000 && ramMb >= 30000) return 'high'
  if (vramMb >= 8000 && ramMb >= 15000) return 'balanced'
  return 'low'
}

async function probe(engine) {
  const out = await run(engine.exe, ['--background', '--factory-startup', '--python-expr', PROBE_SCRIPT], { timeout: 300000 })
  const line = out.split('\n').find(l => l.startsWith('ROOMIA_PROBE '))
  if (!line) throw new Error("Blender n'a pas répondu au test de la carte graphique")
  const result = JSON.parse(line.slice('ROOMIA_PROBE '.length))
  const nvidia = await nvidiaMemory()
  const ramMb = Math.round(os.totalmem() / 1048576)
  const backend = result.test.ok ? result.test.backend : 'CPU'
  return {
    checkedAt: new Date().toISOString(),
    blender: engine.version,
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? '',
    ramMb,
    gpu: nvidia ?? (result.devices[backend]?.[0] ? { name: result.devices[backend][0], vramMb: 0, driver: '' } : null),
    devices: result.devices,
    test: result.test,
    backend,
    profile: profileOf(backend, nvidia?.vramMb ?? 0, ramMb),
  }
}

module.exports = { VERSION, find, install, probe, engineDir }
