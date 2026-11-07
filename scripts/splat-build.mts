// The whole Visite libre build, timed: capture (Blender, Cycles) -> training (gsplat) -> the walk's files.
// npx tsx --env-file=.env.local scripts/splat-build.mts <sceneId> [name] ['<capture json>'] ['<train json>']
import { captureSplat } from '../lib/splat-capture'
import { trainSplat } from '../lib/splat-train'

const [sceneId, name = 'splat', cap = '{}', train = '{}'] = process.argv.slice(2)
const t0 = Date.now()
const at = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`
await captureSplat(sceneId, { mode: 'panos', maxPositions: 80, panoWidth: 1536, samples: 16, hover: 2, tests: 0, initPoints: 1500000, ...JSON.parse(cap) }, line => {
  if (/SPLAT_(TIME|INFO \d+ (walkable|points))|Error|Traceback/.test(line)) console.log(at(), line)
})
const tCap = (Date.now() - t0) / 1000
const info = await trainSplat(
  sceneId,
  { steps: 5000, sh: 1, v2: { res: 768, resStart: 512, resAt: 0.6, cap: 1200000, init: 1000000, reg: 0, ...JSON.parse(train) }, name },
  line => {
    if (/PSNR|trained|exported|Traceback|Error/.test(line)) console.log(at(), line)
  },
)
const total = (Date.now() - t0) / 1000
console.log(at(), `TOTAL ${(total / 60).toFixed(1)} min (capture ${(tCap / 60).toFixed(1)}, training + install ${((total - tCap) / 60).toFixed(1)}) -> ${info.file}, ${(info.bytes / 1e6).toFixed(1)} MB`)
