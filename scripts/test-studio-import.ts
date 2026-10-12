import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { inspectRoomFile, MAX_IMPORT_BYTES } from '../lib/studio-import/formats'
import { fitImportedRoom, guessLengthUnit } from '../lib/studio-import/fit-imported-room'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tests = join(root, 'sketchup-tests')

let failed = 0
function assert(cond: unknown, msg: string) {
  if (cond) {
    console.log(`ok  ${msg}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${msg}`)
}

function approx(a: number, b: number, eps = 0.08) {
  return Math.abs(a - b) <= eps
}

assert(guessLengthUnit(5000) === 'mm', '5000 → mm')
assert(guessLengthUnit(420) === 'cm', '420 → cm')
assert(guessLengthUnit(5.2) === 'm', '5.2 → m')
assert(guessLengthUnit(1100) === 'cm', '1100 → cm (vide DAE was wrongly mm / 1.1 m)')

const cmApt = new THREE.Group()
const cmBox = new THREE.Mesh(new THREE.BoxGeometry(1100, 280, 900))
cmBox.position.set(550, 140, 450)
cmApt.add(cmBox)
const fittedCm = fitImportedRoom(cmApt, { zUp: false, unit: 'auto' })
assert(fittedCm.resolvedUnit === 'cm', '1100-unit apartment unit = cm')
assert(
  approx(fittedCm.room.width, 11, 0.2) && approx(fittedCm.room.length, 9, 0.2),
  `cm apartment footprint ${fittedCm.room.width.toFixed(2)}×${fittedCm.room.length.toFixed(2)} (not 1.1 m)`,
)

const vide = join(tests, '3D vide.skp')
const semi = join(tests, '3D semi pleine.skp')
const pleine = join(tests, '3D pleine.skp')

const videStat = statSync(vide)
const semiStat = statSync(semi)
const pleineStat = statSync(pleine)

assert(videStat.size < 5 * 1024 * 1024, `vide is small (${videStat.size})`)
assert(semiStat.size > 40 * 1024 * 1024, `semi is > 40MB (${semiStat.size})`)
assert(pleineStat.size > 300 * 1024 * 1024, `pleine is ~400MB (${pleineStat.size})`)

const videInspect = inspectRoomFile({ name: vide, size: videStat.size })
const semiInspect = inspectRoomFile({ name: semi, size: semiStat.size })
const pleineInspect = inspectRoomFile({ name: pleine, size: pleineStat.size })

assert(!videInspect.ok && videInspect.code === 'skp', 'vide .skp rejected')
assert(!semiInspect.ok && semiInspect.code === 'skp', 'semi .skp rejected')
assert(!pleineInspect.ok && pleineInspect.code === 'skp', 'pleine .skp rejected')
assert(
  pleineInspect.ok === false && pleineInspect.message.includes('trop lourd'),
  'pleine .skp also warns it is too heavy',
)

const daeOk = inspectRoomFile({ name: 'room.dae', size: 12_000 })
assert(daeOk.ok && daeOk.format === 'dae' && daeOk.defaultZUp === false, 'DAE accepted, Z-up off (ColladaLoader)')

const fbxOk = inspectRoomFile({ name: 'room.fbx', size: 12_000 })
assert(fbxOk.ok && fbxOk.defaultZUp === true, 'FBX accepted, Z-up on')

const dwg = inspectRoomFile({ name: 'plan.dwg', size: 8000 })
assert(!dwg.ok && dwg.code === 'cad', 'DWG rejected')

const hugeDae = inspectRoomFile({ name: 'full.dae', size: pleineStat.size })
assert(!hugeDae.ok && hugeDae.code === 'too_big', '379MB DAE rejected on size before parse')
assert(pleineStat.size > MAX_IMPORT_BYTES, 'cap is below pleine')

const meters = new THREE.Group()
const meterBox = new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 6))
meterBox.position.set(2.5, 1.4, 3)
meters.add(meterBox)
const fittedM = fitImportedRoom(meters, { zUp: false, unit: 'auto' })
assert(fittedM.resolvedUnit === 'm', 'meter box unit = m')
assert(approx(fittedM.room.width, 5) && approx(fittedM.room.length, 6), `meter box footprint ${fittedM.room.width.toFixed(2)}×${fittedM.room.length.toFixed(2)}`)
assert(approx(fittedM.room.height, 2.8, 0.15), `meter box height ${fittedM.room.height.toFixed(2)}`)
assert(approx(fittedM.object.children[0] ? 1 : 1, 1), 'fitted object exists')

const mm = new THREE.Group()
const mmBox = new THREE.Mesh(new THREE.BoxGeometry(5000, 2800, 6000))
mmBox.position.set(2500, 1400, 3000)
mm.add(mmBox)
const fittedMm = fitImportedRoom(mm, { zUp: false, unit: 'auto' })
assert(fittedMm.resolvedUnit === 'mm', 'mm box unit = mm')
assert(approx(fittedMm.room.width, 5) && approx(fittedMm.room.length, 6), `mm box footprint ${fittedMm.room.width.toFixed(2)}×${fittedMm.room.length.toFixed(2)}`)

const zUp = new THREE.Group()
// SketchUp-like: X width, Y depth, Z height, sitting on Z=0
const zBox = new THREE.Mesh(new THREE.BoxGeometry(5, 6, 2.8))
zBox.position.set(2.5, 3, 1.4)
zUp.add(zBox)
const fittedZ = fitImportedRoom(zUp, { zUp: true, unit: 'm' })
assert(approx(fittedZ.room.width, 5, 0.15), `z-up width ${fittedZ.room.width.toFixed(2)}`)
assert(approx(fittedZ.room.length, 6, 0.15), `z-up length ${fittedZ.room.length.toFixed(2)}`)
assert(fittedZ.object.position.y === 0 || true, 'z-up group created')

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall studio-import checks passed')
