// npx tsx --env-file=.env.local scripts/splat-capture.mts <sceneId> '{"maxPositions":150}'
import { captureSplat } from '../lib/splat-capture'

const [sceneId, opts] = process.argv.slice(2)
const t0 = Date.now()
const out = await captureSplat(sceneId, opts ? JSON.parse(opts) : {}, line => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`))
console.log('capture in', out)
