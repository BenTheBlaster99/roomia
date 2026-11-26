#!/usr/bin/env node
/**
 * Roomia's Windows icon (14 Nov; Roomia's logo since 25 Nov, a white house on green before) at every size Windows uses, as one
 * .ico with PNG entries (Vista and later). Used by the installer, the shortcuts and the window. node scripts/make-icon.mjs
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(DESKTOP, '..', 'package.json'))
const sharp = require('sharp')

// 25 Nov: Roomia's own logo (the R whose leg becomes a roof with a window, on gold), from build/roomia-logo-source.png
const source = path.join(DESKTOP, 'build', 'roomia-logo-source.png')

const sizes = [256, 64, 48, 32, 24, 16]
const pngs = await Promise.all(sizes.map(s => sharp(source).resize(s, s).png().toBuffer()))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((s, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(s >= 256 ? 0 : s, e)
  header.writeUInt8(s >= 256 ? 0 : s, e + 1)
  header.writeUInt16LE(1, e + 4)
  header.writeUInt16LE(32, e + 6)
  header.writeUInt32LE(pngs[i].length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += pngs[i].length
})
writeFileSync(path.join(DESKTOP, 'build', 'roomia.ico'), Buffer.concat([header, ...pngs]))
writeFileSync(path.join(DESKTOP, 'build', 'roomia-256.png'), pngs[0])
console.log('build/roomia.ico', sizes.join(', '))
