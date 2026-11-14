#!/usr/bin/env node
/**
 * Roomia's Windows icon (14 Nov): the SketchUp extension's mark (a white house on dark green) at every size Windows uses, as one
 * .ico with PNG entries (Vista and later). Used by the installer, the shortcuts and the window. node scripts/make-icon.mjs
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(DESKTOP, '..', 'package.json'))
const sharp = require('sharp')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f4d40"/><stop offset="1" stop-color="#123128"/></linearGradient></defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
  <path d="M128 52 L210 122 L190 122 L190 200 L148 200 L148 152 L108 152 L108 200 L66 200 L66 122 L46 122 Z" fill="#ffffff"/>
  <rect x="166" y="64" width="18" height="38" rx="3" fill="#ffffff"/>
  <rect x="108" y="196" width="40" height="6" rx="3" fill="#d9a65c"/>
</svg>`

const sizes = [256, 64, 48, 32, 24, 16]
const pngs = await Promise.all(sizes.map(s => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer()))
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
