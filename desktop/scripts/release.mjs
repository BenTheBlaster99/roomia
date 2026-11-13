#!/usr/bin/env node
/**
 * Publishes Roomia Desktop's current version on GitHub: the full Windows zip (first installs) and the update zip the app
 * installs by itself (desktop/updates.js).
 *
 *   npm run dist:win:zip                       # builds dist/Roomia-<version>-windows-x64.zip
 *   node scripts/release.mjs --notes notes.md  # [--from 0.3.0] [--dry-run] [--version 0.3.1, tests only]
 *
 * The update zip holds the files that differ from the previous published release (compared by CRC-32 and size in the
 * two zips), plus roomia-update.json { from, to, removed[] }. Roomia.exe is left out when it differs only by the
 * app.asar fingerprint electron-builder writes into it: that fingerprint is only checked when the
 * EnableEmbeddedAsarIntegrityValidation fuse is on, and the script refuses to skip it if it is.
 * Then the README's download link, version and SHA-256 are pointed at the new release (commit and push it after).
 * Needs the GitHub CLI, signed in (gh auth login).
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import yauzl from 'yauzl'

const REPO = 'BenTheBlaster99/roomia'
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(DESKTOP, '..')
const DIST = path.join(DESKTOP, 'dist')
const GH = process.env.GH ?? (existsSync(path.join(homedir(), '.local/bin/gh')) ? path.join(homedir(), '.local/bin/gh') : 'gh')
const MANIFEST = 'roomia-update.json'
// Electron's fuse wire: sentinel, version byte, length byte, then one char per fuse ('1' on). Index 4 is
// EnableEmbeddedAsarIntegrityValidation.
const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
const FUSE_ASAR_INTEGRITY = 4

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const dryRun = args.includes('--dry-run')
const fail = msg => {
  console.error(`release: ${msg}`)
  process.exit(1)
}

const gh = (...a) => execFileSync(GH, ['-R', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const fullName = v => `Roomia-${v}-windows-x64.zip`
const parse = v => v.replace(/^v/, '').split('.').map(Number)
const cmp = (a, b) => {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => (e ? reject(e) : resolve(z))))
}

/** name → { crc, size, entry } for every file of a zip (folders left out). */
async function listZip(zip) {
  const out = new Map()
  await new Promise((resolve, reject) => {
    zip.on('entry', entry => {
      if (!entry.fileName.endsWith('/')) out.set(entry.fileName, { crc: entry.crc32, size: entry.uncompressedSize, entry })
      zip.readEntry()
    })
    zip.on('end', resolve)
    zip.on('error', reject)
    zip.readEntry()
  })
  return out
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (e, stream) => {
      if (e) return reject(e)
      const parts = []
      stream.on('data', d => parts.push(d))
      stream.on('end', () => resolve(Buffer.concat(parts)))
      stream.on('error', reject)
    }),
  )
}

function asarIntegrityChecked(exe) {
  const i = exe.indexOf(FUSE_SENTINEL)
  if (i < 0) return true // unknown layout: assume it is, and ship the exe
  const wire = exe.subarray(i + FUSE_SENTINEL.length + 2, i + FUSE_SENTINEL.length + 2 + exe[i + FUSE_SENTINEL.length + 1]).toString('latin1')
  return wire[FUSE_ASAR_INTEGRITY] === '1'
}

// ── what to publish ──
const version = opt('version') ?? JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')).version
const full = path.join(DIST, fullName(version))
if (!existsSync(full)) fail(`${full} is missing: run npm run dist:win:zip first`)
const notesFile = opt('notes')
if (!notesFile || !existsSync(notesFile)) fail('--notes <file> is required (what changed, in English, one or two lines)')

const releases = JSON.parse(gh('release', 'list', '--limit', '100', '--json', 'tagName,isDraft'))
if (!dryRun && releases.some(r => r.tagName === `v${version}`)) fail(`v${version} already exists on GitHub: raise the version in desktop/package.json`)

// the previous published version: the newest non-draft release below this one that has a full zip
let from = opt('from')
let fromAsset = null
for (const r of releases.filter(r => !r.isDraft && cmp(r.tagName, version) < 0).sort((a, b) => cmp(b.tagName, a.tagName))) {
  if (from && r.tagName !== `v${from}`) continue
  const { assets } = JSON.parse(gh('release', 'view', r.tagName, '--json', 'assets'))
  const asset = assets.find(a => a.name === fullName(r.tagName.slice(1)))
  if (asset) {
    from = r.tagName.slice(1)
    fromAsset = asset
    break
  }
}
if (!fromAsset) fail(`no published release${from ? ` v${from}` : ''} with a Windows zip to build the update from`)

// its zip: the copy in dist/ if it is the one on GitHub, else downloaded
let prev = path.join(DIST, fullName(from))
const wanted = String(fromAsset.digest ?? '').replace(/^sha256:/, '')
if (!existsSync(prev) || (wanted && sha256(prev) !== wanted)) {
  const dir = path.join(tmpdir(), `roomia-release-${from}`)
  mkdirSync(dir, { recursive: true })
  console.log(`downloading ${fullName(from)} from GitHub…`)
  gh('release', 'download', `v${from}`, '-p', fullName(from), '-D', dir, '--clobber')
  prev = path.join(dir, fullName(from))
  if (wanted && sha256(prev) !== wanted) fail(`${fullName(from)} downloaded does not match GitHub's SHA-256`)
}

// ── the update zip ──
const [newZip, oldZip] = [await openZip(full), await openZip(prev)]
const [now, before] = [await listZip(newZip), await listZip(oldZip)]
const changed = [...now.keys()].filter(n => before.get(n)?.crc !== now.get(n).crc || before.get(n)?.size !== now.get(n).size)
const removed = [...before.keys()].filter(n => !now.has(n))

const files = {}
for (const name of changed) {
  const data = await readEntry(newZip, now.get(name).entry)
  if (name === 'Roomia.exe' && before.has(name)) {
    const old = await readEntry(oldZip, before.get(name).entry)
    let diff = 0
    if (old.length === data.length) for (let i = 0; i < data.length; i++) if (old[i] !== data[i]) diff++
    if (old.length === data.length && diff <= 4096 && !asarIntegrityChecked(data)) {
      console.log(`Roomia.exe: ${diff} bytes differ (the app.asar fingerprint only, not checked): left out`)
      continue
    }
    console.log(`Roomia.exe: ${old.length === data.length ? `${diff} bytes differ` : 'size changed'}: shipped`)
  }
  files[name] = [new Uint8Array(data), { level: 9 }]
}
newZip.close()
oldZip.close()
files[MANIFEST] = [Buffer.from(JSON.stringify({ from, to: version, removed }, null, 1)), { level: 9 }]
const patch = path.join(DIST, `Roomia-${version}-update-from-${from}.zip`)
writeFileSync(patch, zipSync(files))
const patchSha = sha256(patch)
const fullSha = sha256(full)
const mb = f => (readFileSync(f).length / 1e6).toFixed(1)
console.log(`update ${from} → ${version}: ${Object.keys(files).length - 1} files, ${removed.length} removed, ${mb(patch)} MB (full zip ${mb(full)} MB)`)

// ── notes, release, README ──
// the installer (node scripts/build-installer.mjs, from 0.4.7): published with the release when it was built
const setup = path.join(DIST, `Roomia-Setup-${version}.exe`)
const setupSha = existsSync(setup) ? createHash('sha256').update(readFileSync(setup)).digest('hex') : null
const notes = `${readFileSync(notesFile, 'utf8').trim()}

Roomia 0.3.0 and later install this update by themselves (or menu Aide → Rechercher une mise à jour). ${
  setupSha
    ? `First install: Windows 10/11, 64-bit, run Roomia-Setup-${version}.exe (or extract the zip and run Roomia.exe).`
    : 'First install: Windows 10/11, 64-bit, extract the zip and run Roomia.exe.'
}
SHA-256: ${fullSha}
Update from ${from}: SHA-256 ${patchSha}
${setupSha ? `Setup: SHA-256 ${setupSha}\n` : ''}`
const notesOut = path.join(DIST, `notes-${version}.md`)
writeFileSync(notesOut, notes)
if (dryRun) {
  console.log(`dry run: nothing published. Notes in ${notesOut}, update zip ${patch}`)
  process.exit(0)
}
gh('release', 'create', `v${version}`, full, patch, ...(setupSha ? [setup] : []), '--target', 'main', '--prerelease', '--title', `Roomia Desktop ${version} (preview)`, '--notes-file', notesOut)
console.log(`published https://github.com/${REPO}/releases/tag/v${version}`)

const readme = path.join(ROOT, 'README.md')
const text = readFileSync(readme, 'utf8')
const updated = text
  .replace(/Roomia-\d+\.\d+\.\d+-windows-x64\.zip/g, fullName(version))
  .replace(/releases\/download\/v\d+\.\d+\.\d+\//g, `releases/download/v${version}/`)
  .replace(/releases\/tag\/v\d+\.\d+\.\d+/g, `releases/tag/v${version}`)
  .replace(/\*\*Version \d+\.\d+\.\d+, preview\.\*\*/, `**Version ${version}, preview.**`)
  .replace(/Known limitations \(\d+\.\d+\.\d+\)/, `Known limitations (${version})`)
  .replace(/^[0-9a-f]{64}$/m, fullSha)
if (updated !== text) {
  writeFileSync(readme, updated)
  console.log('README.md points at the new release: commit and push it')
}
