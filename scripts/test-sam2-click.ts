import { pickMaskAtClick, type GrayMask } from '../lib/sam2-click'

function box(width: number, height: number, x0: number, y0: number, x1: number, y1: number): GrayMask {
  const data = new Uint8Array(width * height)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) data[y * width + x] = 255
  }
  return { width, height, data }
}

const room = box(100, 80, 0, 0, 100, 80)
const sofa = box(100, 80, 20, 30, 70, 70)
const vase = box(100, 80, 40, 40, 48, 52)

const picked = pickMaskAtClick([room, sofa, vase], 0.44, 0.56)
if (picked !== vase) {
  throw new Error('expected the smallest mask under the click (vase), not sofa/room')
}

try {
  pickMaskAtClick([sofa], 0.05, 0.05)
  throw new Error('empty click should fail')
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes('did not find furniture')) {
    throw err
  }
}

console.log('sam2-click ok')
