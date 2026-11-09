'use strict'
/**
 * Roomia Desktop: the Studio as a Windows app that renders on the architect's own graphics card.
 *
 * Start-up: one instance only → the render engine (Blender 4.5, downloaded and checked on first launch) → a test of
 * the graphics card (once per engine) → the Studio's own server, the Next.js build packed with the app, on 127.0.0.1
 * and a free port → the window, once the server answers. Closing the app stops the server and every render it runs.
 *
 * Security: the pages get no Node; the preload exposes a few read-only calls. The window only shows the local
 * Studio; any other address opens in the user's browser.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const engine = require('./engine')
const { makeReport } = require('./report')
const updates = require('./updates')

const APP_NAME = 'Roomia'
// Everything local (not the roaming profile): projects are gigabytes. %LOCALAPPDATA%\Roomia on Windows.
if (process.platform === 'win32' && process.env.LOCALAPPDATA) app.setPath('userData', path.join(process.env.LOCALAPPDATA, APP_NAME))
else app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))

const DATA = app.getPath('userData')
const DIRS = {
  projects: path.join(DATA, 'projects'),
  db: path.join(DATA, 'data'),
  logs: path.join(DATA, 'logs'),
  tmp: path.join(DATA, 'tmp'),
  // models sent by the SketchUp extension "Envoyer à Roomia", one folder each (lib/desktop-inbox.ts)
  inbox: path.join(DATA, 'inbox'),
}
const RES = app.isPackaged ? process.resourcesPath : __dirname
// packaged: resources/app-server; from source: stage/app-server (one level down, see package.json extraResources)
const SERVER_DIR = path.join(RES, app.isPackaged ? 'app-server' : 'stage/app-server')
const PYLIB = path.join(RES, app.isPackaged ? 'pylib' : `pylib-${process.platform}`)
// The server's own Node (nodejs.org's, packed with the app): inside Electron sharp crashes and the heap stops at 4 GB.
const NODE = path.join(RES, app.isPackaged ? 'runtime' : `runtime-${process.platform}`, process.platform === 'win32' ? 'node.exe' : 'node')
const ENGINE_FILE = path.join(DATA, 'engine.json')
// Roomia's server: accounts, credits and the paid photos (the AI key stays there). ROOMIA_CLOUD_URL overrides it for tests.
const CLOUD_URL = process.env.ROOMIA_CLOUD_URL || 'https://studio.room-ia.com'
const ACCOUNT_FILE = path.join(DATA, 'account.json')
const UPDATE_FILE = path.join(DATA, 'update.json')
// The SketchUp extension, packed with the app (desktop/scripts/package-server.mjs builds it from sketchup/).
const SKETCHUP_DIR = path.join(RES, app.isPackaged ? 'sketchup' : 'stage/sketchup')
// Only the window process may tell the server to import an inbox folder (app/api/desktop/inbox).
const INBOX_TOKEN = crypto.randomBytes(24).toString('hex')
const HOME = '/studio/projets'
const PROTOCOL = 'roomia'

let win = null
let server = null
let origin = null
let quitting = false
let restarts = []
let engineInfo = { engine: null, hardware: null, error: null }

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // roomia://import/<folder>: SketchUp's "Envoyer à Roomia" wakes the app (a second instance passes it here)
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    scanInbox()
    void argv
  })
  app.whenReady().then(start).catch(fatal)
}

function log(line) {
  try {
    fs.appendFileSync(path.join(DIRS.logs, `roomia-${new Date().toISOString().slice(0, 10)}.log`), `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

function status(text, fraction = null) {
  log(`status ${text}`)
  if (win && !win.isDestroyed()) win.webContents.send('roomia:status', { text, fraction })
}

function fatal(err) {
  log(`fatal ${err?.stack ?? err}`)
  dialog.showErrorBox(APP_NAME, `${err?.message ?? err}\n\nJournal : ${DIRS.logs}`)
  app.quit()
}

async function start() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true })
  log(`start ${app.getVersion()} electron ${process.versions.electron} node ${process.versions.node} ${process.platform}`)
  const updateResult = await settleUpdate().catch(err => log(`update settle ${err}`))
  lockDown()
  Menu.setApplicationMenu(menu())
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: APP_NAME,
    backgroundColor: '#f4efe8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => (win = null))
  guardNavigation(win.webContents)
  await win.loadFile(path.join(__dirname, 'splash.html'))

  if (!(await prepareEngine())) return
  status('Démarrage du Studio…')
  origin = await startServer()
  await win.loadURL(`${origin}${await firstPage()}`)
  registerProtocol()
  watchInbox()
  void reportUpdate(updateResult)
  setTimeout(() => void checkUpdates(false), 20000)
  setInterval(() => void checkUpdates(false), 6 * 3600000)
}

/** Mes projets, or the sign-in first when nobody is signed in (offline: the projects, Blender works without the account). */
function firstPage() {
  return new Promise(resolve => {
    const req = http.get(`${origin}/api/auth/me`, { timeout: 15000 }, res => {
      res.resume()
      resolve(res.statusCode === 401 ? `/login?next=${encodeURIComponent(HOME)}` : HOME)
    })
    req.on('error', () => resolve(HOME))
    req.on('timeout', () => req.destroy())
  })
}

function go(pathname) {
  if (origin && win && !win.isDestroyed()) win.loadURL(`${origin}${pathname}`)
}

/** roomia:// opens the app (the SketchUp extension uses it to wake Roomia after an export). */
function registerProtocol() {
  try {
    if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL)
    else app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] ?? '.')])
  } catch (err) {
    log(`protocol ${err}`)
  }
}

// ── SketchUp "Envoyer à Roomia": the extension writes a folder in inbox/ and a "ready" file last ──
const importing = new Set()

function watchInbox() {
  try {
    fs.watch(DIRS.inbox, () => scanInbox())
  } catch (err) {
    log(`inbox watch ${err}`)
  }
  // the watch sees a new folder, not the "ready" file written into it last: look again every few seconds (a readdir)
  setInterval(scanInbox, 3000).unref()
  // a send made while Roomia was closed
  scanInbox()
}

function scanInbox() {
  if (!origin) return
  let names = []
  try {
    names = fs.readdirSync(DIRS.inbox)
  } catch {
    return
  }
  for (const name of names) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || importing.has(name)) continue
    if (!fs.existsSync(path.join(DIRS.inbox, name, 'ready'))) continue
    importing.add(name)
    void importSent(name).finally(() => importing.delete(name))
  }
}

function importSent(name) {
  log(`inbox ${name}`)
  return new Promise(resolve => {
    const req = http.request(
      `${origin}/api/desktop/inbox`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roomia-inbox': INBOX_TOKEN }, timeout: 300000 },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', d => (body += d))
        res.on('end', async () => {
          let data = {}
          try {
            data = JSON.parse(body)
          } catch {}
          if (res.statusCode === 200 && data.id) {
            if (win) {
              if (win.isMinimized()) win.restore()
              win.show()
              win.focus()
            }
            // a model sent before: Mes projets offers to update that project; otherwise straight into the Studio
            go(data.previous ? HOME : `/studio?scene=${data.id}`)
          } else {
            log(`inbox ${name} failed ${res.statusCode} ${body.slice(0, 300)}`)
            await dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: "L'envoi depuis SketchUp n'a pas pu être importé.", detail: data.detail ?? `Erreur ${res.statusCode}` })
            fs.rmSync(path.join(DIRS.inbox, name), { recursive: true, force: true })
          }
          resolve()
        })
      },
    )
    req.on('error', err => {
      log(`inbox ${name} ${err}`)
      resolve()
    })
    req.end(JSON.stringify({ dir: name }))
  })
}

// ── updates ──
// Packaged on Windows, in a folder this user can write to (an unzipped copy): updates install themselves
// (updates.js). Otherwise Roomia only says a new version exists and opens its page.
const UPDATES_DIR = path.join(DATA, 'updates')
const INSTALL_DIR = path.dirname(process.execPath)
let readyUpdate = null
let applyOnQuit = null // null, or { relaunch }
let updating = false

function readUpdateState() {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function selfUpdating() {
  return app.isPackaged && process.platform === 'win32' && updates.canWrite(INSTALL_DIR)
}

/** At start-up, before anything else: lets a running update finish, then says how the last one went. */
async function settleUpdate() {
  fs.mkdirSync(UPDATES_DIR, { recursive: true })
  await updates.waitForApply(UPDATES_DIR)
  const result = updates.takeResult(UPDATES_DIR)
  const staged = path.join(UPDATES_DIR, 'next')
  if (!result) {
    readyUpdate = updates.readReady(staged)
    if (readyUpdate && !updates.newer(readyUpdate.version, app.getVersion())) readyUpdate = null
    if (!readyUpdate) fs.rmSync(staged, { recursive: true, force: true })
    return null
  }
  fs.rmSync(staged, { recursive: true, force: true })
  fs.rmSync(path.join(UPDATES_DIR, 'backup'), { recursive: true, force: true })
  log(`update ${result.version} ${result.ok ? 'installed' : `failed: ${result.error}`} (running ${app.getVersion()})`)
  return result
}

async function reportUpdate(result) {
  if (!result) return
  if (result.ok && result.version === app.getVersion()) {
    await dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: `Roomia est à jour : version ${result.version}.` })
  } else {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_NAME,
      message: `La mise à jour ${result.version} n’a pas pu s’installer.`,
      detail: `Roomia ${app.getVersion()} est resté tel quel. ${result.error ?? ''}\n\nVous pouvez télécharger la nouvelle version depuis le menu Aide → Rechercher une mise à jour.`,
    })
  }
}

async function checkUpdates(asked) {
  if (updating) {
    if (asked) await dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: 'Une mise à jour est en cours de téléchargement.' })
    return
  }
  // already downloaded: it installs when Roomia closes; only the menu asks again
  if (readyUpdate) return asked ? askRestart() : undefined
  const state = readUpdateState()
  let found = null
  try {
    found = await updates.plan(app.getVersion())
  } catch (err) {
    log(`update check ${err}`)
    if (asked) await dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: 'Impossible de vérifier les mises à jour.', detail: 'Vérifiez la connexion internet.' })
    return
  }
  fs.writeFileSync(UPDATE_FILE, JSON.stringify({ ...state, checkedAt: new Date().toISOString() }))
  if (!found) {
    if (asked) await dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: `Roomia ${app.getVersion()} est à jour.` })
    return
  }
  log(`update ${found.version} found: ${found.steps.map(s => s.asset.name).join(', ')} (${Math.round(found.bytes / 1e6)} MB)`)
  if (found.auto && selfUpdating()) {
    updating = true
    try {
      if (asked) await dialog.showMessageBox(win, { type: 'info', title: APP_NAME, message: `Roomia ${found.version} est disponible.`, detail: `Téléchargement en arrière-plan (${Math.max(1, Math.round(found.bytes / 1e6))} Mo). Vous pouvez continuer à travailler.` })
      readyUpdate = await updates.prepare(found, path.join(UPDATES_DIR, 'next'), f => win && !win.isDestroyed() && win.setProgressBar(f))
      log(`update ${found.version} ready: ${readyUpdate.files.length} files, ${readyUpdate.removed.length} removed`)
    } catch (err) {
      log(`update download ${err.stack ?? err}`)
      if (asked) await dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: 'Le téléchargement de la mise à jour a échoué.', detail: String(err.message ?? err) })
      return
    } finally {
      updating = false
      if (win && !win.isDestroyed()) win.setProgressBar(-1)
    }
    return askRestart()
  }
  // Not installable from here (a protected folder, or not Windows): the download page.
  if (!asked && state.skip === found.version) return
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: APP_NAME,
    message: `Roomia ${found.version} est disponible`,
    detail: `Vous avez la version ${app.getVersion()}. Téléchargez le zip, fermez Roomia et remplacez le dossier de l'application : vos projets sont gardés.`,
    buttons: ['Télécharger', 'Plus tard', 'Ignorer cette version'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) shell.openExternal(found.page)
  if (response === 2) fs.writeFileSync(UPDATE_FILE, JSON.stringify({ ...readUpdateState(), skip: found.version }))
}

async function askRestart() {
  if (!readyUpdate) return
  applyOnQuit = { relaunch: false } // "Plus tard" still installs it when Roomia closes
  const notes = String(readyUpdate.notes ?? '').split(/\r?\n/).filter(l => l.trim() && !/^SHA-256|^Windows 10/.test(l)).slice(0, 4).join('\n')
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: APP_NAME,
    message: `Roomia ${readyUpdate.version} est prête à être installée`,
    detail: `${notes ? notes + '\n\n' : ''}Redémarrer maintenant l’installe en quelques secondes ; un rendu en cours serait arrêté. Sinon, elle s’installera quand vous fermerez Roomia.`,
    buttons: ['Redémarrer maintenant', 'Plus tard'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    applyOnQuit = { relaunch: true }
    app.quit()
  }
}

function startApply() {
  if (!readyUpdate || !applyOnQuit) return
  try {
    updates.launchApply(readyUpdate, { root: UPDATES_DIR, installDir: INSTALL_DIR, exe: process.execPath, relaunch: applyOnQuit.relaunch })
    log(`update ${readyUpdate.version} handed to the installer (relaunch ${applyOnQuit.relaunch})`)
  } catch (err) {
    log(`update apply ${err.stack ?? err}`)
  }
  readyUpdate = null
}

// ── problem report ──
async function createReport() {
  try {
    const { name, bytes } = makeReport({ data: DATA, dirs: DIRS, appVersion: app.getVersion(), engineInfo })
    const target = path.join(app.getPath('desktop'), name)
    fs.writeFileSync(target, bytes)
    log(`report ${target}`)
    shell.showItemInFolder(target)
    await dialog.showMessageBox(win, {
      type: 'info',
      title: APP_NAME,
      message: 'Rapport créé sur le Bureau',
      detail: `${name}\n\nEnvoyez ce fichier à Roomia avec une phrase sur ce qui s'est passé. Il contient les journaux et l'état des projets, jamais vos modèles, vos rendus ni votre mot de passe.`,
    })
    return target
  } catch (err) {
    log(`report failed ${err.stack ?? err}`)
    await dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: 'Le rapport n’a pas pu être créé.', detail: String(err.message ?? err) })
    return null
  }
}

/** Opens the folder with the SketchUp extension and says how to install it. */
async function sketchupExtension() {
  const rbz = path.join(SKETCHUP_DIR, 'Roomia-Envoyer.rbz')
  if (!fs.existsSync(rbz)) {
    await dialog.showMessageBox(win, { type: 'warning', title: APP_NAME, message: "L'extension SketchUp n'est pas dans cette version." })
    return
  }
  shell.showItemInFolder(rbz)
  await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Extension SketchUp « Envoyer à Roomia »',
    message: 'Installer l’extension dans SketchUp',
    detail: [
      '1. Dans SketchUp : Extensions → Extension Manager → Install Extension.',
      '2. Choisissez le fichier Roomia-Envoyer.rbz (le dossier vient de s’ouvrir).',
      '3. Un bouton « Envoyer à Roomia » apparaît (menu Extensions et barre d’outils Roomia).',
      '',
      'Ensuite : enregistrez vos scènes SketchUp (les vues), cliquez « Envoyer à Roomia » ; le projet arrive dans Roomia. Renvoyer le même modèle propose de mettre à jour le projet existant.',
    ].join('\n'),
  })
}

function post(pathname) {
  return new Promise(resolve => {
    const req = http.request(`${origin}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 15000 }, res => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('error', resolve)
    req.end('{}')
  })
}

/** The engine, installed on first launch, and the card tested once per engine version. */
async function prepareEngine() {
  status('Recherche du moteur de rendu…')
  let found = await engine.find(DATA)
  while (!found) {
    try {
      status('Téléchargement du moteur de rendu (Blender 4.5, 400 Mo, une seule fois)…', 0)
      found = await engine.install(DATA, (f, text) => status(text, f))
    } catch (err) {
      log(`engine install failed ${err.stack ?? err}`)
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: APP_NAME,
        message: "Le moteur de rendu n'a pas pu être installé.",
        detail: `${err.message}\n\nVérifiez la connexion internet. Sans moteur, le Studio s'ouvre mais ne peut pas faire de rendu.`,
        buttons: ['Réessayer', 'Continuer sans moteur', 'Quitter'],
        defaultId: 0,
        cancelId: 2,
      })
      if (response === 1) break
      if (response === 2) {
        app.quit()
        return false
      }
    }
  }
  engineInfo.engine = found
  if (!found) return true
  let hw = null
  try {
    hw = JSON.parse(fs.readFileSync(ENGINE_FILE, 'utf8'))
  } catch {}
  if (!hw || hw.blender !== found.version || hw.exe !== found.exe) {
    status('Test de la carte graphique (une minute, une seule fois)…')
    try {
      hw = { ...(await engine.probe(found)), exe: found.exe }
      fs.writeFileSync(ENGINE_FILE, JSON.stringify(hw, null, 2))
    } catch (err) {
      log(`probe failed ${err.stack ?? err}`)
      engineInfo.error = err.message
      hw = null
    }
  }
  engineInfo.hardware = hw
  log(`engine ${found.exe} ${found.version} (${found.source}); backend ${hw?.backend} profile ${hw?.profile}`)
  return true
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

function serverEnv(port) {
  const e = engineInfo.engine
  const hw = engineInfo.hardware
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    ROOMIA_DESKTOP: '1',
    SCENES_DIR: DIRS.projects,
    // the projects are the architect's: never pruned (lib/scene-store.ts)
    SCENE_TTL_HOURS: '0',
    ROOMIA_DB_PATH: path.join(DIRS.db, 'roomia.db'),
    ROOMIA_PREP_SCRIPT: path.join(SERVER_DIR, 'desktop-bin', 'prepare-scene.mjs'),
    ROOMIA_CLOUD_URL: CLOUD_URL,
    ROOMIA_CLOUD_TOKEN_FILE: ACCOUNT_FILE,
    ROOMIA_INBOX_DIR: DIRS.inbox,
    ROOMIA_INBOX_TOKEN: INBOX_TOKEN,
    // 9 Nov: the tour build makes a quick preview (the golden-hour Présentation renders the final 360°); the card's temperature log lives with the app's logs
    ROOMIA_TOUR_PREVIEW: '1',
    ROOMIA_LOG_DIR: DIRS.logs,
    TMP: DIRS.tmp,
    TEMP: DIRS.tmp,
    TMPDIR: DIRS.tmp,
  }
  if (e) {
    env.ROOMIA_BLENDER = e.exe
    if (e.python) env.ROOMIA_PYTHON = e.python
  }
  if (hw) {
    env.ROOMIA_GPU_BACKEND = hw.backend
    env.ROOMIA_RENDER_PROFILE = hw.profile
    // for the Studio's notices before a heavy render (app/api/desktop/health)
    env.ROOMIA_GPU_NAME = hw.gpu?.name ?? ''
    env.ROOMIA_GPU_VRAM_MB = String(hw.gpu?.vramMb ?? 0)
    env.ROOMIA_RAM_MB = String(hw.ramMb ?? 0)
  }
  env.ROOMIA_APP_VERSION = app.getVersion()
  // the server watches it and stops by itself if the app is killed (lib/desktop-watchdog.ts)
  env.ROOMIA_PARENT_PID = String(process.pid)
  // scipy and Pillow for the plan and 360° scripts, packed with the app, next to Blender's own numpy
  if (fs.existsSync(PYLIB)) env.PYTHONPATH = PYLIB
  // VS Code and others set it; the server's Node must not pass it on as if it were Electron
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function startServer() {
  const port = await freePort()
  const entry = path.join(SERVER_DIR, 'server.js')
  if (!fs.existsSync(entry)) throw new Error(`Le Studio est introuvable (${entry})`)
  const out = fs.openSync(path.join(DIRS.logs, `server-${new Date().toISOString().slice(0, 10)}.log`), 'a')
  if (!fs.existsSync(NODE)) throw new Error(`Le moteur du Studio est introuvable (${NODE})`)
  server = spawn(NODE, [entry], {
    cwd: SERVER_DIR,
    env: serverEnv(port),
    stdio: ['ignore', out, out],
    windowsHide: true,
    // its own process group on Linux and macOS, so a stop reaches the renders it started
    detached: process.platform !== 'win32',
  })
  log(`server pid ${server.pid} port ${port}`)
  const child = server
  child.on('exit', (code, signal) => {
    log(`server exit ${code} ${signal}`)
    if (quitting || child !== server) return
    server = null
    // the renders it started (Blender) must not go on next to the ones the new server resumes
    void killOrphans(child.pid).then(onServerCrash)
  })
  const url = `http://127.0.0.1:${port}`
  await waitHealthy(url, 120000)
  return url
}

function waitHealthy(url, timeoutMs) {
  const until = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`${url}/api/desktop/health`, { timeout: 3000 }, res => {
        res.resume()
        if (res.statusCode === 200) return resolve()
        retry()
      })
      req.on('error', retry)
      req.on('timeout', () => req.destroy())
    }
    const retry = () => {
      if (Date.now() > until) return reject(new Error("Le Studio n'a pas démarré à temps"))
      setTimeout(tryOnce, 400)
    }
    tryOnce()
  })
}

/**
 * The processes a dead server left behind. Linux and macOS: its process group (it was started detached). Windows: no
 * group, but an orphan keeps its parent's id, so every descendant of that id is found and stopped.
 */
function killOrphans(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {}
    return Promise.resolve()
  }
  return new Promise(resolve => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { windowsHide: true })
    let out = ''
    ps.stdout.on('data', d => (out += d))
    ps.on('error', () => resolve())
    ps.on('close', () => {
      const children = new Map()
      for (const line of out.split(/\r?\n/)) {
        const [id, parent] = line.trim().split(/\s+/).map(Number)
        if (id && parent) children.set(parent, [...(children.get(parent) ?? []), id])
      }
      const doomed = []
      const walk = p => (children.get(p) ?? []).forEach(c => (doomed.push(c), walk(c)))
      walk(pid)
      log(`orphans of ${pid}: ${doomed.join(' ') || 'none'}`)
      for (const c of doomed) spawn('taskkill', ['/pid', String(c), '/T', '/F'], { windowsHide: true })
      setTimeout(resolve, doomed.length ? 1500 : 0)
    })
  })
}

/** A crashed server restarts on the same window, three times a minute at most. */
async function onServerCrash() {
  const now = Date.now()
  restarts = restarts.filter(t => now - t < 60000)
  if (restarts.length >= 3) {
    return fatal(new Error("Le Studio s'est arrêté plusieurs fois de suite."))
  }
  restarts.push(now)
  try {
    if (win && !win.isDestroyed()) await win.loadFile(path.join(__dirname, 'splash.html'))
    status('Le Studio a redémarré après une erreur…')
    origin = await startServer()
    if (win && !win.isDestroyed()) await win.loadURL(`${origin}${HOME}`)
  } catch (err) {
    fatal(err)
  }
}

function stopServer() {
  const child = server
  server = null
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-child.pid, 'SIGTERM')
  } catch (err) {
    log(`stop ${err}`)
  }
}

app.on('before-quit', () => {
  quitting = true
  stopServer()
  startApply()
})
app.on('window-all-closed', () => app.quit())

/** The pages may only ask for what the Studio uses: full screen and pointer lock (the free walk). */
function lockDown() {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['fullscreen', 'pointerLock', 'clipboard-sanitized-write'].includes(permission)))
  app.on('web-contents-created', (_e, wc) => guardNavigation(wc))
}

function isOurs(url) {
  return (origin && url.startsWith(origin + '/')) || url.startsWith(pathToFileURL(__dirname).href + '/')
}

function guardNavigation(wc) {
  wc.on('will-navigate', (e, url) => {
    if (isOurs(url)) return
    e.preventDefault()
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    // the Studio opens a tour or a photo in a new tab: a new window of the app
    if (isOurs(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 820,
          backgroundColor: '#f4efe8',
          webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      }
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function fromUs(event) {
  const url = event.senderFrame?.url ?? ''
  return isOurs(url)
}

ipcMain.handle('roomia:engine', event => {
  if (!fromUs(event)) return null
  const { engine: e, hardware: hw, error } = engineInfo
  return {
    app: app.getVersion(),
    blender: e ? { version: e.version, source: e.source } : null,
    hardware: hw ? { backend: hw.backend, profile: hw.profile, gpu: hw.gpu, ramMb: hw.ramMb, test: hw.test, devices: hw.devices } : null,
    error,
  }
})
ipcMain.handle('roomia:open-projects', event => {
  if (fromUs(event)) shell.openPath(DIRS.projects)
})
ipcMain.handle('roomia:report', event => (fromUs(event) ? createReport() : null))
// links to Roomia's own sites only (a client tour link, the release page)
ipcMain.handle('roomia:open-external', (event, url) => {
  if (!fromUs(event) || typeof url !== 'string') return
  if (/^https:\/\/([a-z0-9-]+\.)*(room-ia\.com|github\.com)\//i.test(url)) shell.openExternal(url)
})

function menu() {
  const engineDialog = async () => {
    const { engine: e, hardware: hw, error } = engineInfo
    const gpu = hw?.gpu ? `${hw.gpu.name}${hw.gpu.vramMb ? ` (${Math.round(hw.gpu.vramMb / 1024)} Go)` : ''}` : 'aucune carte utilisable'
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Moteur de rendu',
      message: e ? `Blender ${e.version}` : 'Aucun moteur de rendu installé',
      detail: [
        `Carte graphique : ${gpu}`,
        `Rendu sur : ${hw?.backend ?? '—'}  ·  profil : ${hw?.profile ?? '—'}`,
        `Mémoire : ${hw ? Math.round(hw.ramMb / 1024) + ' Go' : '—'}`,
        hw?.test?.ok ? `Test de rendu : réussi en ${hw.test.seconds} s` : `Test de rendu : ${hw?.test?.error ?? error ?? 'non fait'}`,
        `Roomia ${app.getVersion()}`,
      ].join('\n'),
    })
  }
  const retest = async () => {
    fs.rmSync(ENGINE_FILE, { force: true })
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message: 'Refaire le test de la carte graphique ?',
      detail: "Roomia redémarre pour le faire. Un rendu en cours sera arrêté.",
      buttons: ['Redémarrer', 'Annuler'],
      cancelId: 1,
    })
    if (response === 0) {
      app.relaunch()
      app.quit()
    }
  }
  return Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [
        { label: 'Mes projets', accelerator: 'CmdOrCtrl+Shift+P', click: () => go(HOME) },
        { label: 'Nouveau projet', accelerator: 'CmdOrCtrl+N', click: () => go('/studio') },
        { type: 'separator' },
        { label: 'Ouvrir le dossier des projets', click: () => shell.openPath(DIRS.projects) },
        { label: 'Ouvrir le journal', click: () => shell.openPath(DIRS.logs) },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Recharger', role: 'reload' },
        { label: 'Taille réelle', role: 'resetZoom' },
        { label: 'Agrandir', role: 'zoomIn' },
        { label: 'Réduire', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ label: 'Outils de développement', role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Compte',
      submenu: [
        { label: 'Mon espace (crédits, photos, visites publiées)', click: () => go('/studio/compte') },
        { type: 'separator' },
        { label: 'Se connecter / changer de compte', click: () => go(`/login?next=${encodeURIComponent(HOME)}`) },
        {
          label: 'Se déconnecter',
          click: async () => {
            if (!origin) return
            await post('/api/auth/logout')
            go(`/login?next=${encodeURIComponent(HOME)}`)
          },
        },
      ],
    },
    {
      label: 'Moteur',
      submenu: [
        { label: 'Carte graphique et moteur…', click: engineDialog },
        { label: 'Refaire le test de la carte graphique', click: retest },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'Installer l’extension SketchUp « Envoyer à Roomia »…', click: sketchupExtension },
        { label: 'Guide d’utilisation', click: () => shell.openExternal('https://github.com/BenTheBlaster99/roomia#roomia-desktop') },
        { type: 'separator' },
        { label: 'Créer un rapport de problème…', click: () => void createReport() },
        { label: 'Rechercher une mise à jour…', click: () => void checkUpdates(true) },
        { type: 'separator' },
        { label: `À propos de Roomia ${app.getVersion()}`, click: engineDialog },
      ],
    },
  ])
}
