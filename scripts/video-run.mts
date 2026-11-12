// Films the video walkthrough of scenes one after the other, with options the Studio's POST does not take (11 Nov 2026).
// SCENES_DIR=<scenes folder> npx tsx --env-file=.env.local scripts/video-run.mts <width>x<height> <fps> <samples> <sceneId> [<sceneId> ...]
import { readVideoStatus, startVideoBuild } from '../lib/scene-video'

const [size, fpsArg, samplesArg, ...ids] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
// VIDEO_OPTS='{"maxShots":1,"shotSeconds":1,"keepWork":true,"recipe":false}' adds or overrides options
const options = { width, height, fps: Number(fpsArg), samples: Number(samplesArg), ...JSON.parse(process.env.VIDEO_OPTS ?? '{}') }
for (const id of ids) {
  console.log('VIDEO_RUN start', id, JSON.stringify(options))
  let attempt = 0
  await startVideoBuild(id, options)
  let last = ''
  for (;;) {
    await new Promise(r => setTimeout(r, 30_000))
    const s = await readVideoStatus(id)
    const line = `${s.state} ${s.step ?? ''}`
    if (line !== last && (s.state !== 'building' || Date.now() % 5 === 0)) console.log('VIDEO_RUN', id, line)
    last = line
    if (s.state === 'done') { console.log('VIDEO_RUN done', id); break }
    if (s.state === 'failed') {
      console.log('VIDEO_RUN failed', id, s.error)
      // stopped by the memory guard or a crash: continue after the last finished frame, up to 4 times
      if (++attempt < 4) { console.log('VIDEO_RUN resume', attempt); await startVideoBuild(id, { ...options, resume: true }); last = ''; continue }
      break
    }
    if (s.state === 'idle') { console.log('VIDEO_RUN idle (stopped?)', id); break }
  }
}
console.log('VIDEO_RUN_ALL_DONE')
process.exit(0)
