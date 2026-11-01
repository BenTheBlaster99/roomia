import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

/**
 * A sharper copy of a panorama for large screens (28 Oct, ChatGPT): an AI 360° comes back at 3840 px, and a 90° view of
 * it fills a 1500 px screen at ~1.6x. A super-resolution model on this PC's GPU doubles it to 8192 px; phones keep
 * the 4096 px panorama. Needs ROOMIA_UPSCALE_PYTHON (a Python with torch and spandrel) and ROOMIA_UPSCALE_MODEL
 * (a .pth, RealESRNet_x4plus: the conservative one, it sharpens without inventing texture); without them it is skipped.
 */

const exec = promisify(execFile)
const UPSCALE_PYTHON = process.env.ROOMIA_UPSCALE_PYTHON
const UPSCALE_MODEL = process.env.ROOMIA_UPSCALE_MODEL
/** Width of the sharper copy (2:1). */
export const HD_WIDTH = 8192

/**
 * upscale.py <in> <out.jpg> <model.pth> <width>: the panorama through the model in overlapping tiles, each brought
 * to the final scale at once (a whole 4x panorama would take 1.6 GB). Left and right are padded with the opposite
 * edge, so the wrap stays seamless; top and bottom are mirrored (the poles do not wrap onto each other).
 */
const UPSCALE_SCRIPT = String.raw`
import sys
import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

src, out, model_path, width = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
model = ModelLoader().load_from_file(model_path).eval()
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(dev)
if dev == "cuda":
    model = model.half()
scale = model.scale
img = np.asarray(Image.open(src).convert("RGB"), np.float32) / 255
H, W = img.shape[:2]
k = width / W  # final size over input size
PAD, TILE, OVER = 64, 384, 32
padded = np.concatenate([img[:, -PAD:], img, img[:, :PAD]], 1)
padded = np.concatenate([padded[PAD - 1::-1], padded, padded[:-PAD - 1:-1]], 0)
oh, ow = round(H * k), width
res = np.zeros((oh, ow, 3), np.uint8)
step = TILE - 2 * OVER
for y in range(0, H, step):
    for x in range(0, W, step):
        # The tile with OVER pixels of context on each side (inside the padding at the edges); only its core is kept,
        # resized to exactly the box it covers in the result, so the cores meet edge to edge without a gap.
        tile = padded[y + PAD - OVER:y + PAD - OVER + TILE, x + PAD - OVER:x + PAD - OVER + TILE]
        t = torch.from_numpy(np.ascontiguousarray(tile.transpose(2, 0, 1)))[None].to(dev)
        with torch.no_grad():
            r = model(t.half() if dev == "cuda" else t).float().clamp(0, 1)[0].cpu().numpy().transpose(1, 2, 0)
        ch, cw = min(step, H - y), min(step, W - x)
        core = r[OVER * scale:(OVER + ch) * scale, OVER * scale:(OVER + cw) * scale]
        oy0, oy1, ox0, ox1 = round(y * k), round((y + ch) * k), round(x * k), round((x + cw) * k)
        res[oy0:oy1, ox0:ox1] = np.asarray(Image.fromarray((core * 255 + 0.5).astype(np.uint8)).resize((ox1 - ox0, oy1 - oy0), Image.LANCZOS))
Image.fromarray(res).save(out, quality=88, optimize=True, progressive=True)
print("upscaled", W, "->", ow, "x%d model" % scale, dev)
`

/** Whether this PC can make the sharper copies. */
export async function canUpscale(): Promise<boolean> {
  if (!UPSCALE_PYTHON || !UPSCALE_MODEL) return false
  return stat(UPSCALE_MODEL).then(() => true, () => false)
}

/** Writes the sharper copy of `input` to `out`; false when this PC cannot make it. */
export async function upscalePanorama(input: string, out: string): Promise<boolean> {
  if (!(await canUpscale())) return false
  const work = await mkdtemp(path.join(tmpdir(), 'roomia-upscale-'))
  try {
    const script = path.join(work, 'upscale.py')
    await writeFile(script, UPSCALE_SCRIPT)
    await exec(UPSCALE_PYTHON!, [script, input, out, UPSCALE_MODEL!, String(HD_WIDTH)], { timeout: 10 * 60_000, maxBuffer: 1 << 20 })
    return true
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
