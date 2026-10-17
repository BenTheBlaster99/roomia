import { createRequire } from 'node:module'

type SharpFn = (input?: unknown, opts?: unknown) => SharpInstance

let cached: SharpFn | null = null

type SharpInstance = {
  metadata: () => Promise<{ width?: number; height?: number }>
  greyscale: () => SharpInstance
  raw: () => SharpInstance
  blur: (sigma: number) => SharpInstance
  threshold: (value: number) => SharpInstance
  resize: (width: number, height: number, opts?: { fit?: string; withoutEnlargement?: boolean }) => SharpInstance
  stats: () => Promise<{ channels: { mean: number; stdev: number }[] }>
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
/** Webpack (the production build) provides the real Node require under this name; Turbopack and tsx do not. */
declare const __non_webpack_require__: NodeJS.Require | undefined

export function loadSharp(): SharpFn {
  if (cached) return cached
  // The production bundler cannot compile createRequire(): it turns the call into `(void 0)` and
  // photo generation then fails at runtime. Use its own require there.
  // createRequire(process.cwd()) makes the file tracer walk the whole project.
  // import.meta.url keeps the trace on sharp itself.
  const req =
    typeof __non_webpack_require__ === 'function'
      ? __non_webpack_require__
      : createRequire(import.meta.url)
  const loaded = req('sharp') as SharpFn | null
  if (!loaded) throw new Error('sharp is not available')
  cached = loaded
  return cached
}
