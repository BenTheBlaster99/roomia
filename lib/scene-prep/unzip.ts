import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/** Only what a scene needs; everything else in the zip is ignored, never extracted. */
const ALLOWED_EXTENSIONS = new Set(['dae', 'glb', 'skp', 'json', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'])

export const MAX_UNZIPPED_BYTES = Number(process.env.SCENE_MAX_UNZIPPED_BYTES ?? 6 * 1024 ** 3)

/**
 * Extracts the scene files from a zip into destDir and returns the extracted paths.
 * Entry names come from an untrusted file: anything absolute or climbing out of destDir is
 * skipped, and the total unzipped size is capped.
 */
export function extractScene(zipPath: string, destDir: string): Promise<string[]> {
  const root = path.resolve(destDir)
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr ?? new Error('Zip illisible'))
      const extracted: string[] = []
      let total = 0

      zip.on('error', reject)
      zip.on('end', () => resolve(extracted))
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/')
        const ext = name.split('.').pop()?.toLowerCase() ?? ''
        const target = path.resolve(root, name)
        const unsafe =
          name.startsWith('/') ||
          name.split('/').includes('..') ||
          name.startsWith('__MACOSX/') ||
          !target.startsWith(root + path.sep)
        if (name.endsWith('/') || unsafe || !ALLOWED_EXTENSIONS.has(ext)) return zip.readEntry()

        total += entry.uncompressedSize
        if (total > MAX_UNZIPPED_BYTES) return reject(new Error('Zip trop volumineux une fois décompressé'))

        zip.openReadStream(entry, async (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error('Entrée zip illisible'))
          try {
            await mkdir(path.dirname(target), { recursive: true })
            await pipeline(stream, createWriteStream(target))
            extracted.push(target)
            zip.readEntry()
          } catch (err) {
            reject(err)
          }
        })
      })
      zip.readEntry()
    })
  })
}
