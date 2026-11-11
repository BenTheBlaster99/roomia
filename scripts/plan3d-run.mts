// The 3D plan of one scene on its own (11 Nov): the same renderPlan3d the tour build runs, for a tour built before it existed.
// npx tsx --env-file=.env.local scripts/plan3d-run.mts <sceneId>
import { renderPlan3d } from '../lib/scene-tour'

const made = await renderPlan3d(process.argv[2])
console.log('PLAN3D_RUN', JSON.stringify(made))
process.exit(0)
