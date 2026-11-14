import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Zip, ZipPassThrough } from 'fflate'
import { loadSharp } from './load-sharp'
import { listPhotos, photosDir } from './scene-photos'
import { readMeta } from './scene-store'
import { readTour, tourDir } from './scene-tour'
import { readVideo, videoDir } from './scene-video'

/**
 * Downloads of a project (14 Nov, the user's ask): each 360° as a standard equirectangular JPEG, and everything the project
 * made in one folder (a zip): the 360°, the AI photos, the plans (2D, lines, the architect's plan and its PDF, 3D) and the video.
 */

/** A name Windows accepts for a file or folder. */
export const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 90) || 'Roomia'

/** attachment; with the name in UTF-8 (accents) and a plain fallback. */
export function attachment(name: string) {
  const plain = name.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'roomia'
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * The 360° tag Facebook, Google and the 360° viewers read (Google's GPano XMP): without it a panorama opens as a flat, stretched
 * picture. Added as an APP1 segment after the JPEG's first segments; the pixels are not re-encoded.
 */
export async function withPanoXmp(jpg: Buffer): Promise<Buffer> {
  if (jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg
  if (jpg.includes(Buffer.from('GPano:ProjectionType'))) return jpg
  const { width = 0, height = 0 } = await loadSharp()(jpg).metadata()
  const xmp =
    '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"' +
    ` GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True"` +
    ` GPano:FullPanoWidthPixels="${width}" GPano:FullPanoHeightPixels="${height}"` +
    ` GPano:CroppedAreaImageWidthPixels="${width}" GPano:CroppedAreaImageHeightPixels="${height}"` +
    ` GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/>` +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  const body = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from(xmp, 'utf8')])
  if (body.length + 2 > 0xffff) return jpg
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body])
  // after SOI and a JFIF APP0 when there is one (some readers want JFIF first)
  let at = 2
  if (jpg[2] === 0xff && jpg[3] === 0xe0) at = 4 + ((jpg[4] << 8) | jpg[5])
  return Buffer.concat([jpg.subarray(0, at), segment, jpg.subarray(at)])
}

const exists = (file: string) => stat(file).then(s => s.isFile(), () => false)
const two = (n: number) => String(n).padStart(2, '0')

/** The project's name, as the folder and the files are named. */
export async function projectTitle(sceneId: string) {
  const meta = await readMeta(sceneId)
  return safeName((meta?.fileName ?? 'Projet').replace(/\.(zip|glb|gltf|dae|skp|fbx|obj)$/i, ''))
}

/** One 360° of the tour: its file (the sharper copy when there is one) and the name to give it. */
export async function panoDownload(sceneId: string, index: number) {
  const tour = await readTour(sceneId)
  const n = tour.views.findIndex(v => v.index === index)
  const view = tour.views[n]
  if (!view?.pano) return null
  const file = path.join(tourDir(sceneId), view.panoHd ?? view.pano)
  if (!(await exists(file))) return null
  return { file, name: `${await projectTitle(sceneId)} - 360 - ${two(n + 1)} ${safeName(view.name)}.jpg` }
}

interface Entry {
  name: string
  file: string
  /** a 360° gets its tag on the way */
  pano?: boolean
}

/** Everything the project made, as zip entries under one folder named after the project. */
export async function exportEntries(sceneId: string): Promise<{ folder: string; entries: Entry[] }> {
  const folder = await projectTitle(sceneId)
  const tour = await readTour(sceneId)
  const dir = tourDir(sceneId)
  const entries: Entry[] = []
  const add = async (name: string, file: string, pano = false) => {
    if (await exists(file)) entries.push({ name: `${folder}/${name}`, file, pano })
  }
  // the 360°, in the order of the visit list
  for (const [n, v] of tour.views.entries()) {
    if (v.pano) await add(`360/${two(n + 1)} ${safeName(v.name)}.jpg`, path.join(dir, v.panoHd ?? v.pano), true)
  }
  // the AI photos, named after their view (newest first in listPhotos: numbered when a view has several)
  const seen = new Map<string, number>()
  for (const p of [...(await listPhotos(sceneId))].reverse()) {
    const base = safeName(p.view ?? 'Photo')
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    await add(`Photos/${base}${k > 1 ? ` (${k})` : ''}${path.extname(p.file) || '.jpg'}`, path.join(photosDir(sceneId), p.file))
  }
  // the plans: per level when the site has several
  const levels = tour.levels && tour.levels.length > 1 ? tour.levels : null
  const plans = levels
    ? levels.map(l => ({ base: l.file.replace(/\.png$/, ''), hd: l.hd, lines: l.lines, label: ` - ${safeName(l.name)}` }))
    : [{ base: 'plan', hd: 'plan-hd.png', lines: 'plan-hd-traits.png', label: '' }]
  for (const { base, hd, lines, label } of plans) {
    await add(`Plans/Plan 2D${label}.png`, path.join(dir, hd ?? `${base}-hd.png`))
    await add(`Plans/Plan 2D - traits${label}.png`, path.join(dir, lines ?? `${base}-hd-traits.png`))
    await add(`Plans/Plan 3D${label}.jpg`, path.join(dir, `${base}-3d.jpg`))
  }
  const archi = (JSON.parse(await readFile(path.join(dir, 'tour.json'), 'utf8').catch(() => '{}')) as { plan?: { archi?: { rendu?: string; technique?: string; pdf?: string } } }).plan?.archi
  if (archi?.rendu) await add('Plans/Plan architecte.png', path.join(dir, archi.rendu))
  if (archi?.technique) await add('Plans/Plan architecte - technique.png', path.join(dir, archi.technique))
  if (archi?.pdf) await add('Plans/Plan architecte A3.pdf', path.join(dir, archi.pdf))
  const { video } = await readVideo(sceneId)
  if (video?.file) await add(`Video/${folder}.mp4`, path.join(videoDir(sceneId), video.file))
  return { folder, entries }
}

/**
 * The zip, streamed as it is made (stored, not compressed: JPEG, PNG and MP4 are compressed already, and a 100 MB project
 * then starts downloading at once).
 */
export function zipStream(entries: Entry[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const zip = new Zip((err, data, final) => {
        if (err) return controller.error(err)
        controller.enqueue(data)
        if (final) controller.close()
      })
      try {
        for (const e of entries) {
          const entry = new ZipPassThrough(e.name)
          entry.mtime = new Date()
          zip.add(entry)
          if (e.pano) {
            entry.push(await withPanoXmp(await readFile(e.file)), true)
            continue
          }
          await new Promise<void>((resolve, reject) => {
            const stream = createReadStream(e.file)
            stream.on('data', chunk => entry.push(chunk as Buffer))
            stream.on('end', () => {
              entry.push(new Uint8Array(0), true)
              resolve()
            })
            stream.on('error', reject)
          })
        }
        zip.end()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}
