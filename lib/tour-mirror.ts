import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

/**
 * 25 Nov: the clients' links keep working when this PC is off. Every published tour is copied, exactly as a visitor's
 * browser receives it from the public address, to a Cloudflare R2 bucket; a Worker in front of studio.room-ia.com
 * (cloudflare/tour-fallback/) answers from that copy whenever the tunnel does not (PC off, tunnel down, Studio restarting).
 *
 * The copy's keys are the request paths without the leading slash ("studio/tour/<id>", "api/scenes/<id>/tour",
 * "api/scenes/<id>/tour/pano-3.jpg", "_next/static/..."); a carousel cover is "<pano path>@cover" (the Worker ignores
 * ?v= and the cover's yaw, which this copy computes the same way the page does).
 *
 * Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET; without them it only writes nothing and
 * says so. ROOMIA_MIRROR_ORIGIN is where the Studio answers on this PC (http://127.0.0.1:3000).
 */

const PUBLIC_HOST = 'studio.room-ia.com'
const ORIGIN = process.env.ROOMIA_MIRROR_ORIGIN ?? 'http://127.0.0.1:3000'

export type MirrorObject = { key: string; body: Buffer; type: string }

export function mirrorConfigured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET)
}

/** GET a path from the local Studio as the public address sees it (the proxy's public rules apply). */
function get(pathname: string): Promise<{ status: number; type: string; body: Buffer }> {
  const url = new URL(pathname, ORIGIN)
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { host: PUBLIC_HOST, 'user-agent': 'roomia-mirror' }, timeout: 60_000 }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? 'application/octet-stream'), body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error(`timeout ${pathname}`)))
    req.on('error', reject)
  })
}

type View = {
  pano: string | null
  panoHd?: string | null
  photo: string | null
  position: number[]
  target: number[]
  eye?: number[]
  ahead?: number[]
  startYaw: number | null
  noPhoto?: boolean
  auto?: boolean
}

/** The same yaw as TourClient's coverYaw, so the copy's cover is the one the page shows. */
function coverYaw(v: View): number {
  if (v.startYaw != null) return v.startYaw
  const e = v.eye ?? v.position
  const a = v.ahead ?? v.target
  const middle = Math.atan2(-(a[2] - e[2]), a[0] - e[0])
  const looks = Math.atan2(-(v.target[2] - v.position[2]), v.target[0] - v.position[0])
  const yaw = middle - looks + (v.noPhoto && !v.auto ? Math.PI : 0)
  return Math.atan2(Math.sin(yaw), Math.cos(yaw))
}

/** Everything a visitor of one published tour can load: the page, its data, its pictures. */
export async function collectTour(id: string): Promise<MirrorObject[]> {
  const out: MirrorObject[] = []
  const need = async (pathname: string, key = pathname.replace(/^\/+/, '').replace(/\?.*$/, '')) => {
    const r = await get(pathname)
    if (r.status !== 200) throw new Error(`${pathname}: ${r.status}`)
    out.push({ key, body: r.body, type: r.type })
    return r
  }
  const page = await need(`/studio/tour/${id}`)
  const tour = JSON.parse((await need(`/api/scenes/${id}/tour`)).body.toString('utf8'))
  const photos = JSON.parse((await need(`/api/scenes/${id}/photos`)).body.toString('utf8'))
  await need(`/api/scenes/${id}/video`)
  // every file the tour data names (360°, sharper 360°, plans, 3D plan, archi plans): the strings that look like tour files
  const files = new Set<string>()
  JSON.stringify(tour, (_k, value) => {
    if (typeof value === 'string' && /^[A-Za-z0-9_.-]+\.(?:jpg|png|pdf|json)$/.test(value) && !value.includes('/')) files.add(value)
    return value
  })
  for (const f of files) {
    const r = await get(`/api/scenes/${id}/tour/${f}`)
    if (r.status === 200) out.push({ key: `api/scenes/${id}/tour/${f}`, body: r.body, type: r.type })
  }
  for (const v of (tour.views ?? []) as View[]) {
    if (!v.pano) continue
    const r = await get(`/api/scenes/${id}/tour/${v.pano}?cover=1&yaw=${coverYaw(v).toFixed(2)}`)
    if (r.status === 200) out.push({ key: `api/scenes/${id}/tour/${v.pano}@cover`, body: r.body, type: r.type })
  }
  const names = new Set<string>()
  JSON.stringify(photos, (_k, value) => {
    if (typeof value === 'string' && /\.(?:jpg|png|webp)$/i.test(value) && !value.includes('/')) names.add(value)
    return value
  })
  for (const n of names) {
    const r = await get(`/api/scenes/${id}/photos/${encodeURIComponent(n)}`)
    if (r.status === 200) out.push({ key: `api/scenes/${id}/photos/${n}`, body: r.body, type: r.type })
  }
  // the page's own assets: the icon, the logo, and the scripts and styles it names (the whole static folder goes up with mirrorStatic)
  for (const p of ['/favicon.ico', '/brand/roomia-mark.png']) await need(p).catch(() => undefined)
  const html = page.body.toString('utf8')
  for (const m of html.matchAll(/\/apple-icon[^"']*\.png/g)) {
    const r = await get(m[0])
    if (r.status === 200) out.push({ key: 'apple-icon.png', body: r.body, type: r.type })
    break
  }
  return out
}

/** The build's static folder (scripts, styles, fonts), shared by every tour: file names carry their content hash. */
export async function collectStatic(distDir: string): Promise<MirrorObject[]> {
  const root = path.join(distDir, 'static')
  const out: MirrorObject[] = []
  const TYPES: Record<string, string> = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' }
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push({ key: `_next/static/${path.relative(root, full).split(path.sep).join('/')}`, body: await readFile(full), type: TYPES[path.extname(e.name)] ?? 'application/octet-stream' })
    }
  }
  if ((await stat(root).catch(() => null))?.isDirectory()) await walk(root)
  return out
}

/** Writes the objects to a folder, one flat file per key (R2's keys are flat: "…/tour" is both an answer and a prefix). */
export async function writeToFolder(dir: string, objects: MirrorObject[]): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  for (const o of objects) {
    const file = path.join(dir, encodeURIComponent(o.key))
    await writeFile(file, o.body)
    await writeFile(`${file}.type`, o.type)
  }
}

/** Uploads to R2 what changed (an object of the same size and MD5 is left alone). Returns how many were sent. */
export async function uploadToR2(objects: MirrorObject[]): Promise<{ sent: number; kept: number }> {
  if (!mirrorConfigured()) throw new Error('R2 not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)')
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })
  const Bucket = process.env.R2_BUCKET!
  let sent = 0
  let kept = 0
  for (const o of objects) {
    const md5 = createHash('md5').update(o.body).digest('hex')
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: o.key })).catch(() => null)
    if (head?.ETag?.replace(/"/g, '') === md5) {
      kept++
      continue
    }
    await s3.send(new PutObjectCommand({ Bucket, Key: o.key, Body: o.body, ContentType: o.type }))
    sent++
  }
  return { sent, kept }
}

/** Removes a tour's copy (the link was taken down). */
export async function removeFromR2(id: string): Promise<number> {
  if (!mirrorConfigured()) return 0
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })
  const Bucket = process.env.R2_BUCKET!
  let n = 0
  for (const Prefix of [`studio/tour/${id}`, `api/scenes/${id}/`]) {
    const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix }))
    for (const o of list.Contents ?? []) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: o.Key! }))
      n++
    }
  }
  return n
}

const queued = new Map<string, NodeJS.Timeout>()

/** After a publication: the copy is refreshed a minute later (several uploads in a row make one copy). Never throws. */
export function scheduleMirror(id: string): void {
  if (!mirrorConfigured()) return
  clearTimeout(queued.get(id))
  queued.set(
    id,
    setTimeout(async () => {
      queued.delete(id)
      try {
        const dist = path.join(process.cwd(), process.env.ROOMIA_DIST ?? '.next')
        const objects = [...(await collectStatic(dist)), ...(await collectTour(id))]
        const r = await uploadToR2(objects)
        console.log(`tour mirror ${id}: ${r.sent} sent, ${r.kept} unchanged`)
      } catch (err) {
        console.error('tour mirror failed', id, err)
      }
    }, 60_000).unref(),
  )
}
