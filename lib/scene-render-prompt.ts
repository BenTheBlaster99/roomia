import { lightingPrompt, type Lighting } from './render-lighting'

/**
 * Prompt for turning a capture of a professional's real design into a photo. The designer chose
 * every material and colour on purpose, so the model may add realism and light but must not
 * redesign anything (it used to swap white marble for wood and drop a pink wall).
 */
export function buildSceneRenderPrompt(lighting: Lighting): string {
  return [
    'Image 1 is a flat-shaded 3D capture of a REAL interior design made by a professional designer.',
    'Turn it into ONE photorealistic photograph of exactly that design, from exactly the same camera.',
    'PRESERVE EXACTLY: every cabinet, appliance, fixture, object, proportion and the camera angle.',
    'Every material and colour in the capture is intentional, even unusual ones: keep the floor material and colour,',
    'every wall colour (including strongly coloured or patterned walls), worktop colour and finish, and the colour and wood tone of every cabinet front.',
    'Do not replace, recolour or restyle any surface.',
    'FORBIDDEN: adding or removing furniture, objects, decor, plants, lights, windows or doors; changing the flooring;',
    'changing any wall colour; inventing a garden or view outside beyond a soft neutral daylight glow behind clear glass.',
    'ALLOWED: photographic realism only: real texture and reflectance on the existing surfaces, accurate light and shadows,',
    'subtle depth of field and natural imperfections.',
    `LIGHTING: ${lightingPrompt(lighting)}.`,
    'Professional architectural interior photography, 35mm lens, ultra realistic.',
  ].join(' ')
}
