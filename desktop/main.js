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
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const engine = require('./engine')

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
}
const RES = app.isPackaged ? process.resourcesPath : __dirname
const SERVER_DIR = path.join(RES, 'app-server')
const PYLIB = path.join(RES, app.isPackaged ? 'pylib' : `pylib-${process.platform}`)
// The server's own Node (nodejs.org's, packed with the app): inside Electron sharp crashes and the heap stops at 4 GB.
const NODE = path.join(RES, app.isPackaged ? 'runtime' : `runtime-${process.platform}`, process.platform === 'win32' ? 'node.exe' : 'node')
const ENGINE_FILE = path.join(DATA, 'engine.json')
// Roomia's server: accounts, credits and the paid photos (the AI key stays there). ROOMIA_CLOUD_URL overrides it for tests.
const CLOUD_URL = process.env.ROOMIA_CLOUD_URL || 'https://studio.room-ia.com'
const ACCOUNT_FILE = path.join(DATA, 'account.json')

let win = null
let server = null
let origin = null
let quitting = false
let restarts = []
let engineInfo = { engine: null, hardware: null, error: null }

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
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
}

/** The Studio, or the sign-in first when nobody is signed in (offline: the Studio, Blender works without the account). */
function firstPage() {
  return new Promise(resolve => {
    const req = http.get(`${origin}/api/auth/me`, { timeout: 15000 }, res => {
      res.resume()
      resolve(res.statusCode === 401 ? '/login?next=%2Fstudio' : '/studio')
    })
    req.on('error', () => resolve('/studio'))
    req.on('timeout', () => req.destroy())
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
    ROOMIA_DB_PATH: path.join(DIRS.db, 'roomia.db'),
    ROOMIA_PREP_SCRIPT: path.join(SERVER_DIR, 'desktop-bin', 'prepare-scene.mjs'),
    ROOMIA_CLOUD_URL: CLOUD_URL,
    ROOMIA_CLOUD_TOKEN_FILE: ACCOUNT_FILE,
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
  }
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
    onServerCrash()
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
    if (win && !win.isDestroyed()) await win.loadURL(`${origin}/studio`)
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
        { label: 'Se connecter / changer de compte', click: () => origin && win?.loadURL(`${origin}/login?next=%2Fstudio`) },
        {
          label: 'Se déconnecter',
          click: async () => {
            if (!origin) return
            await post('/api/auth/logout')
            win?.loadURL(`${origin}/login?next=%2Fstudio`)
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
      submenu: [{ label: `À propos de Roomia ${app.getVersion()}`, click: engineDialog }],
    },
  ])
}
