import { DEFAULT_CAPTURE } from './blender-render'
import { lightingPrompt, type Lighting } from './render-lighting'

/**
 * Prompt for turning a capture of a professional's real design into a photo. The designer chose
 * every material, colour and camera on purpose, so the model may add realism but must not
 * redesign anything. Sarah's comparison (15 Oct) showed what it still invented: sunbeams and
 * leaf shadows, views through windows, terrazzo instead of stone, oak turned walnut at dusk,
 * and a tighter crop. Each of those is forbidden by name below.
 */
export function buildSceneRenderPrompt(lighting: Lighting): string {
  return [
    'Image 1 is a 3D capture of a REAL interior design made by a professional designer for a client.',
    'Make it look like a real photograph of exactly that room. This is a faithful render, not a redesign:',
    'the client must recognise every element of the design.',
    'FRAMING: keep exactly the same camera, field of view and framing as the capture.',
    'Do not crop, zoom, reframe or change the perspective. Everything visible at the edges of the capture stays visible.',
    'GEOMETRY: keep every wall, ceiling, cabinet, furniture piece, light fitting, object and plant exactly where it is,',
    'with the same shape and size. Add nothing, remove nothing.',
    'MATERIALS: keep every material and colour exactly as in the capture: same wood species and tone, same stone and its pattern,',
    'same fabrics, same paint colours, same metal finishes. A smooth stone stays smooth, a light oak stays light oak.',
    'Light may change how bright or warm a surface looks, never its own colour or material.',
    'Only add photographic realism to the existing surfaces: fine texture, natural reflectance, soft contact shadows.',
    'MIRRORS: a mirror reflects the room that is actually in front of it, nothing else.',
    'GLASS: clear or tinted glass keeps its tint and shows what is behind it.',
    'Through windows show only a simple, soft, slightly out-of-focus outdoor background that matches the time of day.',
    ...(DEFAULT_CAPTURE.neutralLight
      ? [
          'The capture is lit with plain neutral white light on purpose, only to show the true colour of every material:',
          'do not copy that flat light. Relight the room for the requested moment, keeping every material its own colour.',
        ]
      : []),
    `LIGHT: ${lightingPrompt(lighting)}.`,
    'Light comes only from the windows and light fittings that are visible in the capture or clearly just outside the frame.',
    'FORBIDDEN: invented sunbeams or light shafts, leaf or tree shadows, window-shaped light stripes where no window faces that wall,',
    'lens flare, haze, heavy vignetting, depth-of-field blur. The whole room stays sharp.',
    'Style: professional architectural interior photograph, natural exposure, true-to-life colours.',
  ].join(' ')
}
