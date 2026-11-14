'use strict'
/**
 * New versions, from Roomia's releases on GitHub.
 *
 * Each release carries the full Windows zip and, from 0.3.0 on, a small update zip "Roomia-X-update-from-Y.zip": only
 * the files that changed since the release before (usually the Studio's server and app.asar, a few MB), plus
 * roomia-update.json { from, to, removed[] }. scripts/release.mjs builds and publishes both.
 *
 * - plan(current): the newest version and how to get there: the chain of update zips from the installed version, or
 *   the full zip when a link of the chain is missing.
 * - prepare(): downloads each zip, checks its SHA-256 against the digest GitHub gives for the asset, and unpacks it
 *   into a staging folder in the app's data. Nothing in the app's own folder is touched yet.
 * - launchApply(): once Roomia has quit, a PowerShell script waits for it to exit, copies the staged files over the
 *   app's folder (backing each one up, and restoring them all if one copy fails), deletes the removed files, writes
 *   result.json and, if asked, starts Roomia again. Roomia.exe is never in an update zip unless Electron itself changed.
 *
 * Files are written with original-fs: Electron's fs treats a path ending in .asar as a folder.
 */
const https = require('node:https')
const crypto = require('node:crypto')
const path = require('node:path')
const { spawn } = require('node:child_process')
// original-fs only exists inside Electron; plain Node (tests) has no asar to avoid
const ofs = (() => {
  try {
    return require('original-fs')
  } catch {
    return require('node:fs')
  }
})()

const REPO = 'BenTheBlaster99/roomia'
const FEED = `https://api.github.com/repos/${REPO}/releases?per_page=30`
const FULL_RE = /^Roomia-(\d+\.\d+\.\d+)-windows-x64\.zip$/i
const PATCH_RE = /^Roomia-(\d+\.\d+\.\d+)-update-from-(\d+\.\d+\.\d+)\.zip$/i
const PATCH_MANIFEST = 'roomia-update.json'

const parse = v => (String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number)
function newer(a, b) {
  const [x, y] = [parse(a), parse(b)]
  if (x.length !== 3 || y.length !== 3) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

function request(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Roomia-Desktop', Accept: url.includes('api.github.com') ? 'application/vnd.github+json' : '*/*' }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        return resolve(request(new URL(res.headers.location, url).toString(), redirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      resolve(res)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function getJson(url) {
  // 14 Nov: some lines in Algeria drop GitHub's API now and then (a connect timeout, then fine a minute later): three tries
  let last = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(url)
      let body = ''
      res.setEncoding('utf8')
      for await (const chunk of res) body += chunk
      return JSON.parse(body)
    } catch (err) {
      last = err
      if (/^HTTP 4/.test(String(err.message))) break
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)))
    }
  }
  throw last
}

const assetOf = a => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? '')?.[1]?.toLowerCase() ?? null })

/**
 * The newest release with a Windows zip if it is newer than `current`, else null. `steps` is how to install it: the
 * update zips in order, or the full zip. A step without a published SHA-256 is never downloaded (auto = false).
 */
async function plan(current) {
  const releases = (await getJson(FEED)).filter(r => !r.draft)
  let best = null
  const patches = new Map() // from version → { to, asset }
  for (const r of Array.isArray(releases) ? releases : []) {
    const version = String(r.tag_name).replace(/^v/, '')
    for (const a of r.assets ?? []) {
      const p = PATCH_RE.exec(a.name)
      if (p && p[1] === version) patches.set(p[2], { to: version, asset: assetOf(a) })
    }
    const full = (r.assets ?? []).find(a => FULL_RE.test(a.name))
    if (full && (!best || newer(version, best.version))) {
      best = { version, page: r.html_url, notes: String(r.body ?? '').slice(0, 800), full: assetOf(full) }
    }
  }
  if (!best || !newer(best.version, current)) return null
  const chain = []
  for (let at = current; at !== best.version; ) {
    const link = patches.get(at)
    if (!link || !newer(link.to, at) || newer(link.to, best.version)) {
      chain.length = 0
      break
    }
    chain.push(link.asset)
    at = link.to
  }
  const steps = chain.length ? chain.map(asset => ({ kind: 'patch', asset })) : [{ kind: 'full', asset: best.full }]
  const bytes = steps.reduce((n, s) => n + (s.asset.size || 0), 0)
  return { ...best, steps, bytes, auto: steps.every(s => s.asset.sha256) }
}

async function download(asset, file, onBytes) {
  const res = await request(asset.url)
  const hash = crypto.createHash('sha256')
  const out = ofs.createWriteStream(file)
  await new Promise((resolve, reject) => {
    res.on('data', chunk => {
      hash.update(chunk)
      onBytes(chunk.length)
    })
    res.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    res.pipe(out)
  })
  const digest = hash.digest('hex')
  if (digest !== asset.sha256) {
    ofs.rmSync(file, { force: true })
    throw new Error(`${asset.name} : somme de contrôle incorrecte`)
  }
}

/** Unpacks every entry under `dest`; returns the files written (relative, with /) and the update manifest if any. */
function unzip(file, dest) {
  const yauzl = require('yauzl')
  const root = path.resolve(dest)
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      const files = []
      let manifest = null
      zip.on('error', reject)
      zip.on('end', () => resolve({ files, manifest }))
      zip.on('entry', entry => {
        const name = entry.fileName
        if (/\/$/.test(name)) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          if (name === PATCH_MANIFEST) {
            let text = ''
            stream.setEncoding('utf8')
            stream.on('data', d => (text += d))
            stream.on('end', () => {
              try {
                manifest = JSON.parse(text)
              } catch (parseErr) {
                return reject(parseErr)
              }
              zip.readEntry()
            })
            stream.on('error', reject)
            return
          }
          const target = path.resolve(root, name)
          if (!target.startsWith(root + path.sep)) return reject(new Error(`entrée refusée : ${name}`))
          ofs.mkdirSync(path.dirname(target), { recursive: true })
          const out = ofs.createWriteStream(target)
          stream.pipe(out)
          out.on('finish', () => {
            files.push(name)
            zip.readEntry()
          })
          out.on('error', reject)
        })
      })
      zip.readEntry()
    })
  })
}

/**
 * Downloads and unpacks the plan into `dir` (emptied first). onProgress(fraction). Returns the ready update:
 * { version, dir, staged, files[], removed[] }, also saved as dir/ready.json.
 */
async function prepare(p, dir, onProgress = () => {}) {
  ofs.rmSync(dir, { recursive: true, force: true })
  const staged = path.join(dir, 'files')
  ofs.mkdirSync(staged, { recursive: true })
  let got = 0
  const files = new Set()
  const removed = new Set()
  for (const [i, step] of p.steps.entries()) {
    const zipFile = path.join(dir, `step-${i}.zip`)
    await download(step.asset, zipFile, n => onProgress(p.bytes ? Math.min(1, (got += n) / p.bytes) : 0))
    const { files: written, manifest } = await unzip(zipFile, staged)
    ofs.rmSync(zipFile, { force: true })
    if (step.kind === 'patch') {
      if (!manifest) throw new Error(`${step.asset.name} : ${PATCH_MANIFEST} manquant`)
      for (const rel of manifest.removed ?? []) {
        files.delete(rel)
        ofs.rmSync(path.join(staged, rel), { force: true })
        removed.add(rel)
      }
    }
    for (const rel of written) {
      files.add(rel)
      removed.delete(rel)
    }
  }
  const ready = { version: p.version, notes: p.notes, page: p.page, dir, staged, files: [...files], removed: [...removed] }
  ofs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify(ready))
  return ready
}

function readReady(dir) {
  try {
    const ready = JSON.parse(ofs.readFileSync(path.join(dir, 'ready.json'), 'utf8'))
    return ready.files.every(rel => ofs.existsSync(path.join(ready.staged, rel))) ? ready : null
  } catch {
    return null
  }
}

/** True when this user can write in the app's folder (an unzipped copy can; Program Files cannot). */
function canWrite(installDir) {
  const probe = path.join(installDir, 'resources', `.roomia-write-${process.pid}`)
  try {
    ofs.writeFileSync(probe, 'ok')
    ofs.rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
}

// Plain ASCII on purpose: Windows PowerShell 5.1 reads a script without BOM in the ANSI code page. Paths come from the
// UTF-8 JSON plan.
const APPLY_PS1 = String.raw`param([string]$Plan)
$ErrorActionPreference = 'Stop'
$p = Get-Content -Raw -Encoding UTF8 -LiteralPath $Plan | ConvertFrom-Json
$log = Join-Path $p.root 'apply.log'
function Log($m) { Add-Content -LiteralPath $log -Encoding UTF8 -Value ((Get-Date).ToString('s') + ' ' + $m) }
function Retry([scriptblock]$Action) { for ($try = 0; $try -lt 40; $try++) { try { & $Action; return } catch { if ($try -eq 39) { throw }; Start-Sleep -Milliseconds 750 } } }
Log ('apply ' + $p.version + ' to ' + $p.install)
# A small window while the files are copied (14 Nov, Sarah: see that it is updating, then Roomia opens again by itself)
$ui = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $ui = New-Object System.Windows.Forms.Form
  $ui.Text = 'Roomia'
  $ui.FormBorderStyle = 'FixedDialog'
  $ui.ControlBox = $false
  $ui.StartPosition = 'CenterScreen'
  $ui.TopMost = $true
  $ui.ClientSize = New-Object System.Drawing.Size(420, 110)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $p.textUpdating
  $label.AutoSize = $false
  $label.Location = New-Object System.Drawing.Point(20, 18)
  $label.Size = New-Object System.Drawing.Size(380, 40)
  $label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  $ui.Controls.Add($label)
  $bar = New-Object System.Windows.Forms.ProgressBar
  $bar.Location = New-Object System.Drawing.Point(20, 66)
  $bar.Size = New-Object System.Drawing.Size(380, 18)
  $bar.Style = 'Marquee'
  $ui.Controls.Add($bar)
  $ui.Show()
  [System.Windows.Forms.Application]::DoEvents()
} catch { $ui = $null }
function Pump() { if ($ui) { try { [System.Windows.Forms.Application]::DoEvents() } catch {} } }
try { Wait-Process -Id $p.pid -Timeout 180 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2
if ($ui) { try { $bar.Style = 'Continuous'; $bar.Maximum = [Math]::Max(1, $p.files.Count + $p.removed.Count); $bar.Value = 0; Pump } catch {} }
$backup = Join-Path $p.root 'backup'
if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
$done = New-Object System.Collections.ArrayList
$result = @{ version = $p.version; ok = $false; at = (Get-Date).ToString('o') }
try {
  foreach ($rel in $p.files) {
    $src = Join-Path $p.staged $rel
    $dst = Join-Path $p.install $rel
    $had = Test-Path -LiteralPath $dst
    if ($had) {
      $b = Join-Path $backup $rel
      [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($b))
      Retry { Copy-Item -LiteralPath $dst -Destination $b -Force }
    }
    [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($dst))
    [void]$done.Add(@($rel, $had))
    Retry { Copy-Item -LiteralPath $src -Destination $dst -Force }
    if ($ui) { try { $bar.Value = [Math]::Min($bar.Maximum, $bar.Value + 1); Pump } catch {} }
  }
  foreach ($rel in $p.removed) {
    $dst = Join-Path $p.install $rel
    if (Test-Path -LiteralPath $dst) {
      $b = Join-Path $backup $rel
      [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($b))
      Retry { Copy-Item -LiteralPath $dst -Destination $b -Force }
      [void]$done.Add(@($rel, $true))
      Retry { Remove-Item -LiteralPath $dst -Force }
    }
  }
  $result.ok = $true
  Log ('done, ' + $p.files.Count + ' files, ' + $p.removed.Count + ' removed')
} catch {
  $result.error = "$_"
  Log ('failed: ' + $_ + ' -- restoring ' + $done.Count + ' files')
  for ($i = $done.Count - 1; $i -ge 0; $i--) {
    $rel = $done[$i][0]
    $dst = Join-Path $p.install $rel
    try {
      if ($done[$i][1]) { Retry { Copy-Item -LiteralPath (Join-Path $backup $rel) -Destination $dst -Force } }
      elseif (Test-Path -LiteralPath $dst) { Retry { Remove-Item -LiteralPath $dst -Force } }
    } catch { Log ('restore failed for ' + $rel + ': ' + $_) }
  }
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $p.root 'result.json') -Encoding UTF8
Remove-Item -LiteralPath (Join-Path $p.root 'applying') -Force -ErrorAction SilentlyContinue
if ($ui) { try { $label.Text = $(if ($p.relaunch) { $p.textRestart } else { $p.textDone }); $bar.Value = $bar.Maximum; Pump; Start-Sleep -Milliseconds 900; $ui.Close() } catch {} }
if ($p.relaunch) { Start-Process -FilePath $p.exe -WorkingDirectory $p.install }
`

/**
 * Starts the PowerShell apply script, detached. It waits for this process to exit. `root` is the updates folder
 * (DATA/updates): result.json and the "applying" marker land there.
 */
function launchApply(ready, { root, installDir, exe, relaunch }) {
  const script = path.join(root, 'apply.ps1')
  const planFile = path.join(root, 'apply.json')
  ofs.writeFileSync(script, APPLY_PS1)
  ofs.writeFileSync(
    planFile,
    JSON.stringify({
      root, pid: process.pid, install: installDir, exe, relaunch: !!relaunch, version: ready.version, staged: ready.staged, files: ready.files, removed: ready.removed,
      // the words of the progress window (the script itself stays ASCII for Windows PowerShell 5.1)
      textUpdating: `Mise à jour de Roomia vers la version ${ready.version}…\n${relaunch ? 'Roomia se rouvrira tout seul dans un instant.' : 'Un instant.'}`,
      textRestart: `Roomia ${ready.version} est installé. Ouverture…`,
      textDone: `Roomia ${ready.version} est installé.`,
    }),
  )
  ofs.writeFileSync(path.join(root, 'applying'), String(Date.now()))
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Plan', planFile], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

/** Waits (up to 90 s) while an update from the last run is still being copied, so a quick restart never runs half of it. */
async function waitForApply(root) {
  const marker = path.join(root, 'applying')
  for (let i = 0; i < 180; i++) {
    let since
    try {
      since = Number(ofs.readFileSync(marker, 'utf8'))
    } catch {
      return
    }
    // a marker older than 10 minutes is left from a script that never ran
    if (!(Date.now() - since < 600000)) {
      ofs.rmSync(marker, { force: true })
      return
    }
    await new Promise(r => setTimeout(r, 500))
  }
}

/** The result of the last apply (then forgotten), or null. */
function takeResult(root) {
  const file = path.join(root, 'result.json')
  try {
    const text = ofs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    ofs.rmSync(file, { force: true })
    return JSON.parse(text)
  } catch {
    return null
  }
}

module.exports = { plan, prepare, readReady, canWrite, launchApply, waitForApply, takeResult, newer, PATCH_MANIFEST }
