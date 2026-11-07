// npx tsx --env-file=.env.local scripts/splat-install.mts <sceneId> <trainDir> [destDir|-] [name]
// A trained splat (scripts/splat_train.py output) into the walk (tour folder by default).
import path from 'node:path'
import { installSplat } from '../lib/splat-train'

const [sceneId, out, dest, name] = process.argv.slice(2)
console.log(JSON.stringify(await installSplat(sceneId, { out: path.resolve(out), dest: dest && dest !== '-' ? path.resolve(dest) : undefined, name }), (k, v) => (k === 'mirrors' ? `${v.length} triangles` : v)))
