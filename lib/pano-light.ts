import { toFile } from 'openai'
import { extractImageBase64 } from './extract-image-b64'
import { loadSharp } from './load-sharp'
import { GPT_IMAGE_MODEL, getOpenAIClient } from './openai-client'

/**
 * "Blender + AI light" (chosen by the user on F5, 12 Nov): ONE AI edit of a whole 360 panorama at 2:1 (2560x1280), with an AI
 * photo of the project as the house-style reference. The result is used ONLY as the light and colour source
 * (scripts/pano_look_transfer.py): Blender keeps every object and texture. One call, nothing retried here (each try is paid).
 * Shared by the desktop's paid route (app/api/desktop/photo, kind 'pano-light') and the Studio's own mode (lib/look-pipeline.ts).
 */
export const PANO_LIGHT_VERSION = 'pl2'
export const PANO_LIGHT_SIZE = { width: 2560, height: 1280 }

export function panoLightPrompt(withReference: boolean): string {
  const ref = withReference
    ? `The SECOND input image is an AI photograph of this apartment. Use it ONLY as the reference for the look: photographic realism, bright clean white walls and ceiling, clarity, material richness, soft natural daylight, colour and contrast. It may show another room: never copy its furniture, objects or layout.

Make the whole first image look like that photograph while keeping its spatial structure exactly.`
    : `Make the whole image look like a high-end real-estate photograph (photographic realism, bright clean walls and ceiling, clarity, material richness, soft natural daylight) while keeping its spatial structure exactly.`
  return `Edit the FIRST input image. It is a complete 360-degree equirectangular panorama (2:1, 360 degrees across, 180 degrees top to bottom) of a real apartment interior, taken from one point. It is not an ordinary wide photograph.
${ref}

PROJECTION, keep exactly:
- The same 2:1 equirectangular layout and the same full spherical field of view. Do not crop, zoom, reframe or turn it into a normal perspective photo.
- The left and right edges are the same direction on the sphere: they must still meet seamlessly.
- The top row is straight up (the ceiling around one point) and the bottom row straight down (the floor): keep them continuous.
- Every curve that is a straight line in the room (wall edges, door and window frames, ceiling lines) keeps its exact curve and position.

ROOM, keep exactly:
- Every wall, window, door, ceiling, light fixture and piece of furniture at the same place, size and shape. Add nothing, remove nothing, redesign nothing (beds, sofas, tables, cupboards stay as they are).
- The same materials and colours as in the panorama.

LOOK:
- Broad daylight from the windows. Not golden hour, not sunset, not night.

INTERIOR LIGHTS, switched ON (this matters most): every light fixture that is in the panorama is clearly lit, as in a professional
interior photograph taken with all the lamps on:
- each recessed ceiling spot shows a bright glowing lens and a soft cone or pool of light on the wall or floor below it;
- LED strips, ceiling coves and lit niches glow along their whole length and wash the surface next to them;
- pendants, wall lamps, floor and table lamps glow from inside their shades and light what is around them;
- neutral warm white (about 3500-4000 K), never orange, never blown out.
Only the fixtures that already exist are lit: never add a lamp, a spot or a light source.
- Bright, clean walls and ceiling with subtle real shading; realistic floor reflections; crisp but natural detail; no oversharpening.
- One coherent room: the same light, colour and material look in every direction.

Return one single equirectangular image. No collage, no split, no borders, no text.`
}

/** The panorama at exactly the output size (the model keeps a picture's structure best when it does not rescale it), as PNG. */
export async function panoLightInput(pano: Buffer): Promise<Buffer> {
  return loadSharp()(pano).resize(PANO_LIGHT_SIZE.width, PANO_LIGHT_SIZE.height, { fit: 'fill' }).png().toBuffer()
}

export async function panoLightReference(photo: Buffer): Promise<Buffer> {
  return loadSharp()(photo).resize(1536, 1536, { fit: 'inside' }).png().toBuffer()
}

/** One paid edit. `pano` is already at 2560x1280 (panoLightInput); `reference` already resized (panoLightReference) or null. */
export async function editPanoLight(pano: Buffer, reference: Buffer | null): Promise<Buffer> {
  const client = getOpenAIClient()
  const images = [await toFile(pano, 'pano.png', { type: 'image/png' })]
  if (reference) images.push(await toFile(reference, 'reference.png', { type: 'image/png' }))
  const response = await client.images.edit(
    {
      model: GPT_IMAGE_MODEL,
      image: images,
      prompt: panoLightPrompt(Boolean(reference)),
      quality: 'high',
      input_fidelity: 'high',
      background: 'opaque',
      output_format: 'jpeg',
      response_format: 'b64_json',
      size: `${PANO_LIGHT_SIZE.width}x${PANO_LIGHT_SIZE.height}`,
    } as unknown as Parameters<typeof client.images.edit>[0],
    { maxRetries: 0, timeout: 300_000 },
  )
  return Buffer.from(await extractImageBase64(response), 'base64')
}
