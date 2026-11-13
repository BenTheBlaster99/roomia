#!/usr/bin/env node
/**
 * Roomia-Setup-<version>.exe from dist/win-unpacked (made by `npm run dist:win:zip`), on Linux, without Wine.
 *
 * electron-builder's own NSIS target needs Wine to build its uninstaller; installer/roomia.nsi writes the uninstaller
 * at install time instead (plain NSIS), so the Linux makensis that electron-builder already downloads is enough.
 *
 *   node scripts/build-installer.mjs            # after npm run dist:win:zip
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'))
const SRC = path.join(DESKTOP, 'dist', 'win-unpacked')
const OUT = path.join(DESKTOP, 'dist', `Roomia-Setup-${version}.exe`)

function findNsis() {
  const roots = [process.env.ELECTRON_BUILDER_CACHE, path.join(homedir(), '.cache', 'electron-builder')].filter(Boolean)
  for (const root of roots) {
    for (const top of existsSync(root) ? readdirSync(root).filter(d => /^nsis-\d/.test(d)) : []) {
      for (const inner of readdirSync(path.join(root, top))) {
        const dir = path.join(root, top, inner)
        if (existsSync(path.join(dir, 'linux', 'makensis'))) return dir
      }
    }
  }
  throw new Error('makensis for Linux not found: run `npx electron-builder --win nsis` once so it downloads NSIS')
}

if (!existsSync(path.join(SRC, 'Roomia.exe'))) throw new Error(`${SRC} has no Roomia.exe: run npm run dist:win:zip first`)
const nsis = findNsis()
console.log(`Roomia ${version}: ${SRC} -> ${OUT} (NSIS ${nsis})`)
execFileSync(
  path.join(nsis, 'linux', 'makensis'),
  ['-V2', `-DVERSION=${version}`, `-DSRC=${SRC}`, `-DOUTFILE=${OUT}`, path.join(DESKTOP, 'installer', 'roomia.nsi')],
  { stdio: 'inherit', env: { ...process.env, NSISDIR: nsis } },
)
console.log(`${OUT}: ${(statSync(OUT).size / 1e6).toFixed(0)} MB`)
