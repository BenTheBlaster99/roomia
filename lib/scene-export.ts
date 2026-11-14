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
  /** a file on disk, or the bytes made for the export (the web visit's page) */
  file?: string
  data?: Buffer
  /** a 360° gets its tag on the way */
  pano?: boolean
}

/**
 * Everything the project made, as one folder named after the project (15 Nov, the user's layout):
 *   360/          the 360° images, and index.html: the whole visit, ready to put on a website (see lib/scene-web-visit.ts)
 *   Galerie/      the AI renders
 *   Plan 2D.png   one file (the architect's plan when there is one)
 *   Plan 3D.jpg   one file
 *   <Projet>.mp4  the video, when there is one
 */
export async function exportEntries(sceneId: string): Promise<{ folder: string; entries: Entry[] }> {
  const folder = await projectTitle(sceneId)
  const tour = await readTour(sceneId)
  const dir = tourDir(sceneId)
  const entries: Entry[] = []
  const add = async (name: string, file: string, pano = false) => {
    if (await exists(file)) entries.push({ name: `${folder}/${name}`, file, pano })
  }
  // the 360°, in the order of the visit list, and the web visit that shows them
  const panoNames = new Map<number, string>()
  for (const [n, v] of tour.views.entries()) {
    if (!v.pano) continue
    const name = `${two(n + 1)} ${safeName(v.name)}.jpg`
    const file = path.join(dir, v.panoHd ?? v.pano)
    if (!(await exists(file))) continue
    entries.push({ name: `${folder}/360/${name}`, file, pano: true })
    panoNames.set(v.index, name)
  }
  if (panoNames.size) {
    const { panoDataScript, webVisitHtml, WEB_VISIT_README } = await import('./scene-web-visit')
    entries.push({ name: `${folder}/360/index.html`, data: Buffer.from(webVisitHtml(folder, tour.views, panoNames), 'utf8') })
    // the same pictures as data URLs, only for the page opened from the disk (Chrome refuses files to WebGL)
    for (const v of tour.views) {
      const name = panoNames.get(v.index)
      if (name) entries.push({ name: `${folder}/360/visite-data/${name.slice(0, 2)}.js`, data: Buffer.from(panoDataScript(name.slice(0, 2), await readFile(path.join(dir, v.panoHd ?? v.pano!))), 'utf8') })
    }
    entries.push({ name: `${folder}/360/LISEZ-MOI.txt`, data: Buffer.from(WEB_VISIT_README.replace(/\n/g, '\r\n'), 'utf8') })
  }
  // the gallery: the AI renders, named after their view (numbered when a view has several)
  const seen = new Map<string, number>()
  for (const p of [...(await listPhotos(sceneId))].reverse()) {
    const base = safeName(p.view ?? 'Photo')
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    await add(`Galerie/${base}${k > 1 ? ` (${k})` : ''}${path.extname(p.file) || '.jpg'}`, path.join(photosDir(sceneId), p.file))
  }
  // one 2D plan and one 3D plan (per level when the site has several): the architect's plan when it was made
  const archi = (JSON.parse(await readFile(path.join(dir, 'tour.json'), 'utf8').catch(() => '{}')) as { plan?: { archi?: { rendu?: string } } }).plan?.archi
  const levels = tour.levels && tour.levels.length > 1 ? tour.levels : null
  if (levels) {
    for (const l of levels) {
      const base = l.file.replace(/\.png$/, '')
      await add(`Plan 2D - ${safeName(l.name)}.png`, path.join(dir, l.hd ?? `${base}-hd.png`))
      await add(`Plan 3D - ${safeName(l.name)}.jpg`, path.join(dir, `${base}-3d.jpg`))
    }
  } else {
    const architect = archi?.rendu && (await exists(path.join(dir, archi.rendu)))
    await add('Plan 2D.png', path.join(dir, architect ? archi!.rendu! : 'plan-hd.png'))
    await add('Plan 3D.jpg', path.join(dir, 'plan-3d.jpg'))
  }
  const { video } = await readVideo(sceneId)
  if (video?.file) await add(`${folder}.mp4`, path.join(videoDir(sceneId), video.file))
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
          if (e.data) {
            entry.push(new Uint8Array(e.data), true)
            continue
          }
          if (e.pano) {
            entry.push(await withPanoXmp(await readFile(e.file!)), true)
            continue
          }
          await new Promise<void>((resolve, reject) => {
            const stream = createReadStream(e.file!)
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
