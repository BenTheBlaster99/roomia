import { createRequire } from 'node:module'
import { join } from 'node:path'

type SharpFn = (input?: unknown, opts?: unknown) => SharpInstance

let cached: SharpFn | null = null

type SharpInstance = {
  metadata: () => Promise<{ width?: number; height?: number }>
  greyscale: () => SharpInstance
  raw: () => SharpInstance
  blur: (sigma: number) => SharpInstance
  threshold: (value: number) => SharpInstance
  png: () => SharpInstance
  toBuffer: {
    (): Promise<Buffer>
    (opts: { resolveWithObject: true }): Promise<{
      data: Buffer
      info: { width: number; height: number; channels: number }
    }>
  }
}

/** Load sharp from disk. Never write `import 'sharp'` — Turbopack invents a fake package on the DATA cache. */
export function loadSharp(): SharpFn {
  if (cached) return cached
  const req = createRequire(join(process.cwd(), 'package.json'))
  const loaded = req(join(process.cwd(), 'node_modules/sharp')) as SharpFn | null
  if (!loaded) throw new Error('sharp is not available')
  cached = loaded
  return cached
}
