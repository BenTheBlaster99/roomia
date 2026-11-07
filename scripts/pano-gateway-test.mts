// Step 1 (8 Nov): how does the image gateway treat a 2:1 panorama today? Four paid images, one panorama:
//   A native 2560x1280, B native 3840x1920, C 3840x1920 padded to 16:9 with edge-extended bars (no squash),
//   D the current method (squashed to 16:9) as the control.
// Nothing is retried behind the scenes (ask mode): one call, one image.
// npx tsx --env-file=.env.local scripts/pano-gateway-test.mts <pano.png> <outDir> [A,B,C,D]
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { generatePhotoreal } from '../lib/photoreal'
import { panoPrompt } from '../lib/pano-ai'

const [src, outDir, only = 'A,B,C,D'] = process.argv.slice(2)
await mkdir(outDir, { recursive: true })
const want = new Set(only.split(','))
const prompt = panoPrompt()
const resized = (w: number, h: number) => sharp(src).resize(w, h, { fit: 'fill', kernel: 'lanczos3' })

async function padded(w: number, h: number, padTop: number) {
  // 2:1 content w x h centred in a w x (h + 2 padTop) canvas; the bars repeat the nearest edge row (mirrored), not black
  const content = await resized(w, h).png().toBuffer()
  const top = await sharp(content).extract({ left: 0, top: 0, width: w, height: padTop }).flip().png().toBuffer()
  const bottom = await sharp(content).extract({ left: 0, top: h - padTop, width: w, height: padTop }).flip().png().toBuffer()
  return sharp({ create: { width: w, height: h + 2 * padTop, channels: 3, background: '#808080' } })
    .composite([{ input: top, left: 0, top: 0 }, { input: content, left: 0, top: padTop }, { input: bottom, left: 0, top: padTop + h }])
    .png()
    .toBuffer()
}

const variants: Record<string, { label: string; input: () => Promise<Buffer>; size: string }> = {
  A: { label: 'native 2:1 2560x1280', input: () => resized(2560, 1280).png().toBuffer(), size: '2560x1280' },
  B: { label: 'native 2:1 3840x1920', input: () => resized(3840, 1920).png().toBuffer(), size: '3840x1920' },
  C: { label: 'padded to 16:9, 3840x2160', input: () => padded(3840, 1920, 120), size: '3840x2160' },
  D: { label: 'squashed to 16:9 (current)', input: () => resized(3840, 2160).png().toBuffer(), size: '3840x2160' },
}
const report: Record<string, unknown>[] = []
for (const [k, v] of Object.entries(variants)) {
  if (!want.has(k)) continue
  const input = await v.input()
  await writeFile(path.join(outDir, `${k}-input.png`), input)
  const t0 = Date.now()
  try {
    const r = await generatePhotoreal(input, prompt, { size: v.size, maxInput: 4096, ask: true })
    const buf = Buffer.from(r.base64, 'base64')
    await writeFile(path.join(outDir, `${k}-output.jpg`), buf)
    const meta = await sharp(buf).metadata()
    const entry = { variant: k, label: v.label, asked: v.size, received: [meta.width, meta.height], seconds: Math.round((Date.now() - t0) / 100) / 10, quality: r.quality, fellBack: r.fellBack, fidelity: r.fidelity }
    report.push(entry)
    console.log('GATEWAY', JSON.stringify(entry))
  } catch (e) {
    const entry = { variant: k, label: v.label, asked: v.size, error: String((e as Error).message).slice(0, 200), status: (e as { status?: number }).status }
    report.push(entry)
    console.log('GATEWAY', JSON.stringify(entry))
  }
}
await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1))
console.log('GATEWAY_DONE')
