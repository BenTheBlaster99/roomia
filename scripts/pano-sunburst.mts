// One-pass AI finish of a whole 360 (12 Nov test, feedback2.txt): the panorama itself goes to gpt-image-2.5-sunburst as ONE edit at a
// 2:1 size, with an AI photo of the same room as the appearance reference. No tiles, so no seams between separate generations.
// One call, one image, nothing retried (each try is paid).
// npx tsx --env-file=.env.local scripts/pano-sunburst.mts <pano.jpg> <reference.jpg> <out.jpg> [size=2560x1280] [quality=high]
import { readFile, writeFile } from 'node:fs/promises'
import { toFile } from 'openai'
import { GPT_IMAGE_MODEL, getOpenAIClient } from '../lib/openai-client'
import { extractImageBase64 } from '../lib/extract-image-b64'
import { loadSharp } from '../lib/load-sharp'

const [panoPath, refPath, outPath, size = '2560x1280', quality = 'high'] = process.argv.slice(2)
const [W, H] = size.split('x').map(Number)
const sharp = loadSharp()
// the panorama at exactly the output size: the model keeps a picture's structure best when it does not have to rescale it
const pano = await sharp(await readFile(panoPath)).resize(W, H, { fit: 'fill' }).png().toBuffer()
const ref = await sharp(await readFile(refPath)).resize(1536, 1536, { fit: 'inside' }).png().toBuffer()

const prompt = `Edit the FIRST input image. It is a complete 360-degree equirectangular panorama (2:1, 360 degrees across, 180 degrees top to bottom) of a real apartment interior, taken from one point. It is not an ordinary wide photograph.
The SECOND input image is a photograph of the same room. Use it ONLY as the reference for the look: photographic realism, bright clean white walls and ceiling, clarity, material richness, soft natural daylight, colour and contrast.

Make the whole first image look like that photograph while keeping its spatial structure exactly.

PROJECTION, keep exactly:
- The same 2:1 equirectangular layout and the same full spherical field of view. Do not crop, zoom, reframe or turn it into a normal perspective photo.
- The left and right edges are the same direction on the sphere: they must still meet seamlessly.
- The top row is straight up (the ceiling around one point) and the bottom row straight down (the floor): keep them continuous.
- Every curve that is a straight line in the room (wall edges, door and window frames, ceiling lines) keeps its exact curve and position.

ROOM, keep exactly:
- Every wall, window, door, ceiling, light fixture and piece of furniture at the same place, size and shape. Add nothing, remove nothing.
- The same materials and colours (dark kitchen units, black worktop, light marble floor, white walls).

LOOK:
- Broad daylight from the windows, as in the reference photo. Not golden hour, not sunset, not night.
- The ceiling lights on and soft, neutral white (about 4000 K), never orange.
- Bright, clean walls and ceiling with subtle real shading; realistic polished floor reflections; crisp but natural detail; no oversharpening.
- One coherent room: the same light, colour and material look in every direction.

Return one single equirectangular image. No collage, no split, no borders, no text.`

const client = getOpenAIClient()
const t0 = Date.now()
const response = await client.images.edit(
  {
    model: GPT_IMAGE_MODEL,
    image: [await toFile(pano, 'pano.png', { type: 'image/png' }), await toFile(ref, 'reference.png', { type: 'image/png' })],
    prompt,
    quality: quality as 'high',
    input_fidelity: 'high',
    background: 'opaque',
    output_format: 'jpeg',
    response_format: 'b64_json',
    size: size as '1536x1024',
  } as Parameters<typeof client.images.edit>[0],
  { maxRetries: 0, timeout: 300_000 },
)
const b64 = await extractImageBase64(response)
const buf = Buffer.from(b64, 'base64')
await writeFile(outPath, buf)
const meta = await sharp(buf).metadata()
const usage = (response as unknown as { usage?: unknown }).usage
console.log('SUNBURST', JSON.stringify({ seconds: Math.round((Date.now() - t0) / 100) / 10, size: `${meta.width}x${meta.height}`, quality, usage }))
