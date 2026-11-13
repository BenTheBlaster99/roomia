#!/usr/bin/env node
/**
 * Packs the Studio for Roomia Desktop: node desktop/scripts/package-server.mjs [--platform=win32|linux] [--skip-build]
 *
 * 1. builds the Studio as a standalone Next.js server into .next-desktop (the Studio's own .next is not touched);
 * 2. copies it to desktop/stage/app-server with its static files and public/;
 * 3. bundles scripts/prepare-scene.ts (the import, which the Studio runs through tsx) into desktop-bin/;
 * 4. swaps sharp's native part for the target platform's;
 * 5. fetches scipy and Pillow for Blender's Python 3.11 (desktop/pylib-<platform>) and the Node the server runs on
 *    (desktop/runtime-<platform>);
 * 6. refuses to finish if any secret of .env.local is in the package: the app goes to clients' PCs.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(DESKTOP, '..')
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const PLATFORM = args.platform ?? process.platform
const OUT = path.join(DESKTOP, 'stage', 'app-server')
const DIST = '.next-desktop'
const SHARP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/sharp/package.json'), 'utf8')).version
// Blender 4.5's Python is 3.11 with numpy 1.26.4: scipy 1.13 is the last line built against numpy 1.x
const WHEELS = ['scipy==1.13.1', 'pillow==11.0.0', 'opencv-python-headless==4.10.0.84'] // opencv: the look pipeline's finishing scripts (scripts/pano_*.py)
const BLENDER_PYTHON = process.env.ROOMIA_BLENDER ? path.join(path.dirname(process.env.ROOMIA_BLENDER), '4.5/python/bin/python3.11') : null

// the Node the server runs on, nodejs.org's own build (https://nodejs.org/dist/v24.18.0/SHASUMS256.txt)
const NODE_VERSION = '24.18.0'
const NODE_SHA256 = {
  'node-v24.18.0-win-x64.zip': '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
  'node-v24.18.0-linux-x64.tar.xz': '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742',
}

const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, ...opts })
const step = s => console.log(`\n== ${s}`)

if (!['win32', 'linux'].includes(PLATFORM)) throw new Error(`platform ${PLATFORM}: win32 or linux`)

// 1. the build. On the NTFS data drive Next's lockfiles fail: the build folder lives on ext4, as .next does
// (scripts/ensure-next-cache.mjs).
if (!args['skip-build']) {
  step(`next build (standalone, ${DIST})`)
  const link = path.join(ROOT, DIST)
  if (process.platform === 'linux') {
    const target = path.join(os.homedir(), '.cache', 'roomia-next-desktop')
    fs.mkdirSync(target, { recursive: true })
    const isLink = fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()
    if (!isLink) {
      fs.rmSync(link, { recursive: true, force: true })
      fs.symlinkSync(target, link)
    }
    const nm = path.join(target, 'node_modules')
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, 'node_modules'), nm)
  }
  // Next points tsconfig.json and next-env.d.ts at the build folder's types: the Studio's own are put back after
  const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'))
  const nextEnv = fs.readFileSync(path.join(ROOT, 'next-env.d.ts'))
  try {
    sh(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
      env: { ...process.env, ROOMIA_DESKTOP_BUILD: '1', NODE_PATH: path.join(ROOT, 'node_modules'), NEXT_TELEMETRY_DISABLED: '1' },
    })
  } finally {
    fs.writeFileSync(path.join(ROOT, 'tsconfig.json'), tsconfig)
    fs.writeFileSync(path.join(ROOT, 'next-env.d.ts'), nextEnv)
  }
}

// 2. the server, its static files, public/
step('copy the standalone server')
const standalone = path.join(fs.realpathSync(path.join(ROOT, DIST)), 'standalone')
// with a tracing root above the project (next.config.ts, linked node_modules) the app is nested: standalone/<project>/server.js and
// the packages in standalone/<other checkout>/node_modules
const nested = !fs.existsSync(path.join(standalone, 'server.js'))
const appIn = nested ? path.join(standalone, path.basename(ROOT)) : standalone
if (!fs.existsSync(path.join(appIn, 'server.js'))) throw new Error(`no standalone server in ${standalone}`)
fs.rmSync(OUT, { recursive: true, force: true })
fs.cpSync(appIn, OUT, { recursive: true, dereference: true })
// 13 Nov: the build folder is a link to ~/.cache (NTFS), and Next 16.2.7 copied that link into the standalone output instead of
// the server's files: put back what a standalone build folder holds (the files 0.4.7 shipped), from the real build
{
  const dist = path.join(OUT, DIST)
  if (fs.existsSync(dist) && fs.lstatSync(dist).isSymbolicLink()) {
    const real = fs.realpathSync(path.join(ROOT, DIST))
    fs.unlinkSync(dist)
    fs.mkdirSync(dist, { recursive: true })
    for (const f of ['BUILD_ID', 'app-path-routes-manifest.json', 'build-manifest.json', 'package.json', 'prerender-manifest.json', 'react-loadable-manifest.json', 'required-server-files.json', 'routes-manifest.json']) {
      if (fs.existsSync(path.join(real, f))) fs.copyFileSync(path.join(real, f), path.join(dist, f))
    }
    fs.cpSync(path.join(real, 'server'), path.join(dist, 'server'), { recursive: true, dereference: true, filter: src => !src.endsWith('.nft.json') })
    console.log(`${DIST} was a link in the standalone output: rebuilt from ${real}`)
  }
}
fs.cpSync(path.join(ROOT, DIST, 'static'), path.join(OUT, DIST, 'static'), { recursive: true, dereference: true })
fs.cpSync(path.join(ROOT, 'public'), path.join(OUT, 'public'), { recursive: true, dereference: true })
// 12 Nov: with node_modules a link to another checkout, the standalone output's node_modules is itself a link (cpSync keeps it):
// make it a real folder, or the sharp swap below never sees it and the package depends on this PC's cache
{
  const nm = path.join(OUT, 'node_modules')
  if (fs.existsSync(nm) && fs.lstatSync(nm).isSymbolicLink()) {
    const real = fs.realpathSync(nm)
    fs.unlinkSync(nm)
    fs.cpSync(real, nm, { recursive: true, dereference: true })
  }
  if (nested) {
    for (const d of fs.readdirSync(standalone)) {
      const from = path.join(standalone, d, 'node_modules')
      if (d !== path.basename(ROOT) && fs.existsSync(from)) fs.cpSync(from, nm, { recursive: true, dereference: true })
    }
  }
  // compilers the build needed, never the server
  for (const rel of ['@next/swc-linux-x64-gnu', '@next/swc-linux-x64-musl', '@esbuild', 'typescript', '@swc/core', '@swc/core-linux-x64-gnu', '@swc/core-linux-x64-musl']) {
    fs.rmSync(path.join(nm, rel), { recursive: true, force: true })
  }
  for (const pkg of ['next', 'react', 'react-dom', 'styled-jsx', '@swc/helpers']) {
    if (!fs.existsSync(path.join(nm, pkg, 'package.json'))) throw new Error(`the standalone server has no ${pkg}`)
  }
}
// never the project's data or env files, whatever the tracer picked up
for (const name of fs.readdirSync(OUT)) {
  if (name.startsWith('.env') || ['.scenes', '.data', 'd5-tests', 'sketchup-tests'].includes(name)) {
    fs.rmSync(path.join(OUT, name), { recursive: true, force: true })
    console.log('removed', name)
  }
}

// 3. the import script, bundled (the Studio runs it through tsx: lib/scene-jobs.ts)
step('bundle prepare-scene')
const bin = path.join(OUT, 'desktop-bin')
fs.mkdirSync(bin, { recursive: true })
sh(path.join(ROOT, 'node_modules/.bin/esbuild'), [
  'scripts/prepare-scene.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--external:sharp',
  `--outfile=${path.join(bin, 'prepare-scene.mjs')}`,
  "--banner:js=import { createRequire as __roomiaRequire } from 'node:module'; const require = __roomiaRequire(import.meta.url);",
  '--log-level=warning',
])
fs.copyFileSync(path.join(ROOT, 'scripts/compact-glb.py'), path.join(bin, 'compact-glb.py'))

// the look pipeline (lib/look-pipeline.ts runs these from <server>/scripts, like the tour's own Blender scripts) and the two sky pictures
step('look pipeline scripts and skies')
const LOOK_SCRIPTS = [
  'look_pipeline.py', 'look_analyze.py', 'look_make_recipe.py', 'look_apply.py', 'look_render.py', 'look_prep.py', 'look_grade.py',
  'look_finalize_panos.py', 'look_install_tour.py', 'roomia_flags.py', 'pano_tiles.py', 'pano_finish.py',
]
fs.mkdirSync(path.join(OUT, 'scripts'), { recursive: true })
for (const f of LOOK_SCRIPTS) fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(OUT, 'scripts', f))
fs.cpSync(path.join(ROOT, 'assets/hdri'), path.join(OUT, 'assets/hdri'), { recursive: true })

// 4. sharp for the target
step(`sharp ${SHARP_VERSION} for ${PLATFORM}`)
const img = path.join(OUT, 'node_modules/@img')
if (!fs.existsSync(path.join(OUT, 'node_modules/sharp'))) {
  fs.cpSync(path.join(ROOT, 'node_modules/sharp'), path.join(OUT, 'node_modules/sharp'), { recursive: true, dereference: true })
}
// 12 Nov: since node_modules became a link to another checkout, the tracer leaves out everything beside sharp (its dependencies and
// @img with the native part): 0.4.7's first zip had no sharp binary at all. Copy its dependencies, and always have an @img folder
// so the swap below puts the target's binary in.
for (const dep of Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/sharp/package.json'), 'utf8')).dependencies ?? {})) {
  const to = path.join(OUT, 'node_modules', dep)
  if (!fs.existsSync(to) && !fs.existsSync(path.join(OUT, 'node_modules/sharp/node_modules', dep))) fs.cpSync(path.join(ROOT, 'node_modules', dep), to, { recursive: true, dereference: true })
}
fs.mkdirSync(img, { recursive: true })
if (PLATFORM !== process.platform) {
  // every copy of sharp (Next carries its own in next/node_modules) gets the target's binary, at its own version
  const imgDirs = []
  const findImg = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      if (e.name === '@img' && path.basename(d) === 'node_modules') imgDirs.push(p)
      else findImg(p)
    }
  }
  findImg(OUT)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roomia-sharp-'))
  for (const dir of imgDirs) {
    const linux = fs.readdirSync(dir).find(n => /^sharp-linux-x64$/.test(n))
    const version = linux ? JSON.parse(fs.readFileSync(path.join(dir, linux, 'package.json'), 'utf8')).version : SHARP_VERSION
    for (const name of fs.readdirSync(dir)) {
      if (/^sharp-(libvips-)?(linux|linuxmusl|darwin)/.test(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    }
    const pkg = `@img/sharp-win32-x64@${version}`
    const tgz = execFileSync('npm', ['pack', pkg, '--silent', '--pack-destination', tmp], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop()
    const dest = path.join(dir, 'sharp-win32-x64')
    fs.mkdirSync(dest, { recursive: true })
    sh('tar', ['-xzf', path.join(tmp, tgz), '-C', dest, '--strip-components=1'])
    console.log(`${path.relative(OUT, dir)}: sharp-win32-x64 ${version}`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  const bin = path.join(img, 'sharp-win32-x64', 'lib')
  if (PLATFORM === 'win32' && !(fs.existsSync(bin) && fs.readdirSync(bin).some(f => f.endsWith('.node')))) throw new Error('no sharp-win32-x64 binary in the package')
}
const natives = []
const walk = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.node')) natives.push(path.relative(OUT, p))
  }
}
walk(OUT)
console.log('native modules:', natives.join(', ') || 'none')

// 5. scipy and Pillow for Blender's Python
step(`Python packages for ${PLATFORM}`)
const pylib = path.join(DESKTOP, `pylib-${PLATFORM}`)
if (!fs.existsSync(path.join(pylib, 'scipy')) || !fs.existsSync(path.join(pylib, 'cv2'))) {
  const pip = BLENDER_PYTHON && fs.existsSync(BLENDER_PYTHON) ? BLENDER_PYTHON : 'python3'
  const wheels = fs.mkdtempSync(path.join(os.tmpdir(), 'roomia-wheels-'))
  const plat = PLATFORM === 'win32' ? ['win_amd64'] : ['manylinux2014_x86_64', 'manylinux_2_17_x86_64']
  sh(pip, ['-m', 'pip', 'download', '--quiet', '--only-binary=:all:', '--no-deps', '--python-version', '3.11', '--implementation', 'cp', '--abi', 'cp311',
    ...plat.flatMap(p => ['--platform', p]), '-d', wheels, ...WHEELS])
  fs.rmSync(pylib, { recursive: true, force: true })
  fs.mkdirSync(pylib, { recursive: true })
  // a wheel is a zip of the site-packages folder it installs into
  for (const w of fs.readdirSync(wheels).filter(f => f.endsWith('.whl'))) sh('unzip', ['-q', '-o', path.join(wheels, w), '-d', pylib])
  for (const f of fs.readdirSync(pylib).filter(f => f.endsWith('.whl'))) fs.rmSync(path.join(pylib, f))
  fs.rmSync(wheels, { recursive: true, force: true })
}

// 5b. the Node that runs the server. Not Electron's own: inside Electron (ELECTRON_RUN_AS_NODE) sharp crashes on every
// buffer it hands back (V8's memory cage, 2 Nov) and the heap stops at 4 GB, where big scenes take 8.
step(`Node ${NODE_VERSION} for ${PLATFORM}`)
const runtime = path.join(DESKTOP, `runtime-${PLATFORM}`)
const nodeExe = path.join(runtime, PLATFORM === 'win32' ? 'node.exe' : 'node')
if (!fs.existsSync(nodeExe)) {
  const file = PLATFORM === 'win32' ? `node-v${NODE_VERSION}-win-x64.zip` : `node-v${NODE_VERSION}-linux-x64.tar.xz`
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roomia-node-'))
  const archive = path.join(tmp, file)
  sh('curl', ['-fsSL', '--max-time', '600', '-o', archive, `https://nodejs.org/dist/v${NODE_VERSION}/${file}`])
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
  if (digest !== NODE_SHA256[file]) throw new Error(`${file}: checksum ${digest} is not nodejs.org's`)
  if (file.endsWith('.zip')) sh('unzip', ['-q', archive, '-d', tmp])
  else sh('tar', ['-xJf', archive, '-C', tmp])
  const dir = path.join(tmp, file.replace(/\.(zip|tar\.xz)$/, ''))
  fs.rmSync(runtime, { recursive: true, force: true })
  fs.mkdirSync(runtime, { recursive: true })
  fs.copyFileSync(path.join(dir, PLATFORM === 'win32' ? 'node.exe' : 'bin/node'), nodeExe)
  fs.chmodSync(nodeExe, 0o755)
  fs.copyFileSync(path.join(dir, 'LICENSE'), path.join(runtime, 'LICENSE'))
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log('node', nodeExe)

// 5c. the SketchUp extension "Envoyer à Roomia" (sketchup/), as the .rbz SketchUp's Extension Manager installs
step('SketchUp extension')
{
  const { zipSync } = await import('fflate')
  const src = path.join(ROOT, 'sketchup')
  const files = {}
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), r)
      else files[r] = new Uint8Array(fs.readFileSync(path.join(dir, e.name)))
    }
  }
  walk(src)
  const target = path.join(DESKTOP, 'stage', 'sketchup')
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'Roomia-Envoyer.rbz'), zipSync(files, { level: 9 }))
  console.log('sketchup', Object.keys(files).join(', '))
}

// 6. no secrets in what goes to clients
step('secret check')
const envFile = path.join(ROOT, '.env.local')
const secrets = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, 'utf8').split('\n')
      .map(l => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(l))
      .filter(m => m && !m[1].startsWith('NEXT_PUBLIC_') && m[2].length >= 12 && !/^(\/|https?:\/\/|true|false)/.test(m[2]))
      .map(m => ({ name: m[1], value: m[2] }))
  : []
const leaks = new Set()
const scan = d => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) scan(p)
    else if (/\.(js|mjs|cjs|json|html|txt|map|rsc|env.*)$/.test(e.name) || e.name.startsWith('.env')) {
      const text = fs.readFileSync(p, 'latin1')
      for (const s of secrets) if (text.includes(s.value)) leaks.add(`${s.name} in ${path.relative(OUT, p)}`)
    }
  }
}
scan(OUT)
if (leaks.size) {
  console.error('SECRETS FOUND, not packaging:\n ' + [...leaks].join('\n '))
  fs.rmSync(OUT, { recursive: true, force: true })
  process.exit(1)
}
console.log(`no secret of .env.local (${secrets.length} checked) in the package`)
const size = execFileSync('du', ['-sh', OUT], { encoding: 'utf8' }).split('\t')[0]
console.log(`\nREADY ${OUT} (${size}), ${PLATFORM}`)
