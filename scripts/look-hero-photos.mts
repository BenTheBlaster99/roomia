// Hero stills from the look recipe (8 Nov): the recipe render of a saved view goes through the product's own photo prompt
// to the gateway (one image, 14 DA each), and lands in the scene's photos like any photo made in the Studio.
// npx tsx --env-file=.env.local scripts/look-hero-photos.mts <sceneId> <heroDir> <name=Scène N,...> [time=soiree]
import { appendFile, copyFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generatePhotoreal } from '../lib/photoreal'
import { buildSceneRenderPrompt } from '../lib/scene-render-prompt'
import { sceneDir } from '../lib/scene-store'
import type { TimeOfDay } from '../lib/render-lighting'

const [sceneId, heroDir, pairs, time = 'soiree'] = process.argv.slice(2)
const lighting = { time: time as TimeOfDay, sun: true, interior: true }
const prompt = buildSceneRenderPrompt(lighting)
for (const pair of pairs.split(',')) {
  const [name, view] = pair.split('=')
  const capture = await readFile(path.join(heroDir, `${name}-golden.png`))
  const t0 = Date.now()
  try {
    const r = await generatePhotoreal(capture, prompt, { ask: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = `${stamp}-${view.replace(/[^A-Za-z0-9]/g, '_')}`
    const dir = path.join(sceneDir(sceneId), 'photos')
    await writeFile(path.join(dir, `${base}.jpg`), Buffer.from(r.base64, 'base64'))
    await copyFile(path.join(heroDir, `${name}-golden.png`), path.join(dir, `${base}-capture.png`))
    await copyFile(path.join(heroDir, `${name}-golden.png`), path.join(heroDir, `${name}-capture.png`))
    await writeFile(path.join(heroDir, `${name}-ai.jpg`), Buffer.from(r.base64, 'base64'))
    await appendFile(
      path.join(sceneDir(sceneId), 'runs.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), view, time, sun: true, interior: true, lens: '24', captureReused: true, photoSeconds: Math.round((Date.now() - t0) / 100) / 10, photoFile: `photos/${base}.jpg`, quality: r.quality, fellBack: r.fellBack, fidelity: r.fidelity, provider: r.provider, size: r.size, ok: true, source: 'look-recipe' }) + '\n',
    )
    console.log('HERO', JSON.stringify({ name, view, seconds: r.seconds, quality: r.quality, size: r.size, fellBack: r.fellBack }))
  } catch (err) {
    console.log('HERO', JSON.stringify({ name, view, error: String((err as Error).message).slice(0, 160) }))
  }
}
console.log('HERO_DONE')
