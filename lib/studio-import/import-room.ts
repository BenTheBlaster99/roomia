import type { LoadableRoomFormat } from './formats'
import {
  IMPORT_COPY,
  inspectRoomFile,
  type InspectOk,
  MAX_IMPORT_TRIANGLES,
  WARN_IMPORT_TRIANGLES,
} from './formats'
import { countTriangles, fitImportedRoom, type ImportLengthUnit } from './fit-imported-room'
import { clearImportedSource, setImportedSource } from './imported-room-cache'
import { loadRoomObject, loadRoomObjectFromGlbBuffer } from './load-room-file'
import { canPrepareOnServer, prepareOnServer, waitForScene } from './server-prep'

export interface ImportedRoomMeta {
  fileName: string
  format: LoadableRoomFormat
  objectUrl: string
  zUp: boolean
  unit: ImportLengthUnit
  resolvedUnit: Exclude<ImportLengthUnit, 'auto'>
  triangleCount: number
  warning: string | null
  /** Set when Studio shows a light copy of a heavy scene prepared (and kept) on the server. */
  sceneId?: string
}

export type ImportRoomResult =
  | {
      ok: true
      meta: ImportedRoomMeta
      room: { width: number; length: number; height: number }
    }
  | { ok: false; message: string }

export interface ImportRoomOptions {
  /** Progress text for long server preparations ("Envoi… 40 %", "Préparation de la scène…"). */
  onPhase?: (message: string) => void
}

export async function importRoomFile(
  file: File,
  options: ImportRoomOptions = {},
): Promise<ImportRoomResult> {
  // Scene formats always go through the server: it fixes materials and textures, keeps the
  // full file for rendering, and sends Studio a light copy. Other formats open locally.
  if (canPrepareOnServer(file.name)) return importViaServer(file, options)

  const inspected = inspectRoomFile(file)
  if (!inspected.ok) {
    if (inspected.code === 'too_big' && canPrepareOnServer(file.name)) {
      return importViaServer(file, options)
    }
    return { ok: false, message: inspected.message }
  }

  const local = await importLocal(file, inspected, {})
  if (!local.ok && local.tooHeavy && canPrepareOnServer(file.name)) {
    return importViaServer(file, options)
  }
  return local.ok ? local : { ok: false, message: local.message }
}

/** Opens a scene that is already prepared on the server (a shared `?scene=` link). */
export async function importSceneById(sceneId: string, options: ImportRoomOptions = {}): Promise<ImportRoomResult> {
  const prepared = await waitForScene(sceneId, options.onPhase ?? (() => {}))
  if (!prepared.ok) return prepared
  const inspected = inspectRoomFile({ name: 'viewport.glb', size: prepared.viewport.byteLength })
  if (!inspected.ok) return { ok: false, message: inspected.message }
  const local = await importLocal(null, inspected, {
    fileName: prepared.fileName ?? 'scene.glb',
    sceneId,
    buffer: prepared.viewport,
    missingTextures: prepared.missingTextures.length,
    note: 'Aperçu allégé : le rendu final utilisera votre fichier d’origine, sans rien supprimer.',
  })
  return local.ok ? local : { ok: false, message: local.message }
}

async function importViaServer(file: File, options: ImportRoomOptions): Promise<ImportRoomResult> {
  const prepared = await prepareOnServer(file, options.onPhase ?? (() => {}))
  if (!prepared.ok) return prepared

  const inspected = inspectRoomFile({ name: 'viewport.glb', size: prepared.viewport.byteLength })
  if (!inspected.ok) return { ok: false, message: inspected.message }
  const local = await importLocal(null, inspected, {
    fileName: file.name,
    sceneId: prepared.sceneId,
    buffer: prepared.viewport,
    missingTextures: prepared.missingTextures.length,
    note: 'Aperçu allégé : le rendu final utilisera votre fichier d’origine, sans rien supprimer.',
  })
  return local.ok ? local : { ok: false, message: local.message }
}

type LocalResult = Extract<ImportRoomResult, { ok: true }> | { ok: false; message: string; tooHeavy: boolean }

async function importLocal(
  file: File | null,
  inspected: InspectOk,
  extra: {
    fileName?: string
    sceneId?: string
    note?: string
    buffer?: ArrayBuffer
    missingTextures?: number
  },
): Promise<LocalResult> {
  // Studio only uses this as a cache key; revoking a non-blob key is a harmless no-op.
  const objectUrl = file ? URL.createObjectURL(file) : `scene:${extra.sceneId}`
  try {
    const source = extra.buffer
      ? await loadRoomObjectFromGlbBuffer(extra.buffer)
      : await loadRoomObject(objectUrl, inspected.format)
    const triangleCount = countTriangles(source)
    if (triangleCount > MAX_IMPORT_TRIANGLES) {
      URL.revokeObjectURL(objectUrl)
      return { ok: false, message: IMPORT_COPY.tooHeavyMesh, tooHeavy: true }
    }

    setImportedSource(objectUrl, source)
    const fitted = fitImportedRoom(source, {
      zUp: inspected.defaultZUp,
      unit: 'auto',
      maxRoomMeters: extra.sceneId ? 200 : 40,
    })

    const warnings = [
      inspected.warning,
      fitted.scaleWarning,
      extra.missingTextures ? IMPORT_COPY.missingTextures(extra.missingTextures) : null,
      extra.note ?? null,
    ]
    if (triangleCount > WARN_IMPORT_TRIANGLES) {
      warnings.push('Modèle lourd — le studio peut ramer.')
    }

    return {
      ok: true,
      meta: {
        fileName: extra.fileName ?? file?.name ?? 'scene.glb',
        format: inspected.format,
        objectUrl,
        zUp: inspected.defaultZUp,
        unit: 'auto',
        resolvedUnit: fitted.resolvedUnit,
        triangleCount,
        warning: warnings.filter(Boolean).join(' ') || null,
        sceneId: extra.sceneId,
      },
      room: fitted.room,
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    clearImportedSource()
    const detail = err instanceof Error ? err.message : ''
    return {
      ok: false,
      tooHeavy: false,
      message: detail ? `${IMPORT_COPY.loadFail} (${detail})` : IMPORT_COPY.loadFail,
    }
  }
}
