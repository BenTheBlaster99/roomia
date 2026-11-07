// npx tsx --env-file=.env.local scripts/splat-train.mts <sceneId> '{"steps":30000}'
import { trainSplat } from '../lib/splat-train'

const [sceneId, opts] = process.argv.slice(2)
const t0 = Date.now()
let last = 0
const info = await trainSplat(sceneId, opts ? JSON.parse(opts) : {}, line => {
  if (Date.now() - last > 30000 || /error|panic|eval|psnr/i.test(line)) {
    last = Date.now()
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line.slice(0, 200)}`)
  }
})
console.log(JSON.stringify(info))
