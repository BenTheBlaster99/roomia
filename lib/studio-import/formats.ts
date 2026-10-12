export const MAX_IMPORT_BYTES = 40 * 1024 * 1024
export const MAX_IMPORT_TRIANGLES = 800_000
export const WARN_IMPORT_TRIANGLES = 250_000

export type LoadableRoomFormat = 'dae' | 'fbx' | 'obj' | 'glb' | 'gltf' | 'stl'

export const LOADABLE_ROOM_FORMATS = new Set<string>([
  'dae',
  'fbx',
  'obj',
  'glb',
  'gltf',
  'stl',
])

export const IMPORT_ACCEPT =
  '.zip,.dae,.fbx,.obj,.glb,.gltf,.stl,.skp,.dwg,.dxf,.3ds,.kmz,.wrl'

const CAD_REJECT = new Set(['dwg', 'dxf', '3ds', 'kmz', 'wrl'])

export const IMPORT_COPY = {
  skp:
    'Un .skp seul ne suffit pas. Dans SketchUp : Fichier → Exporter → Modèle 3D → COLLADA (.dae), puis mettez le .dae ET le .skp dans un même zip : Roomia récupère les textures dans le .skp.',
  skpHeavy: ' Les gros fichiers sont acceptés en COLLADA (.dae) ou GLB : Roomia les prépare automatiquement.',
  cad: 'Les fichiers CAO (DWG/DXF) et les formats 3DS/KMZ/WRL ne sont pas supportés. Exportez DAE ou FBX depuis SketchUp.',
  unknown:
    'Format non reconnu. Exportez COLLADA (.dae) avec son dossier d’images dans un .zip, ou GLB, FBX, OBJ.',
  tooBig: (bytes: number) =>
    `Fichier trop lourd (${formatMb(bytes)}) pour ce format. Exportez votre scène en COLLADA (.dae) ou GLB : Roomia prépare automatiquement les gros fichiers, sans rien supprimer.`,
  tooHeavyMesh:
    'Le modèle a trop de triangles pour ce format. Exportez votre scène en COLLADA (.dae) ou GLB : Roomia prépare automatiquement les gros fichiers.',
  missingTextures: (count: number) =>
    `${count} texture${count > 1 ? 's' : ''} introuvable${count > 1 ? 's' : ''} : ces surfaces s’affichent en gris. Envoyez le .dae avec son dossier d’images dans un .zip.`,
  stl: 'STL n’a pas de matériaux — la pièce sera grise.',
  loadFail: 'Impossible de lire ce fichier 3D. Réexportez en COLLADA (.dae) depuis SketchUp.',
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} Mo`
}

export function fileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i >= 0 ? base.slice(i + 1).toLowerCase() : ''
}

export type InspectOk = {
  ok: true
  format: LoadableRoomFormat
  defaultZUp: boolean
  warning: string | null
}

export type InspectFail = {
  ok: false
  code: 'skp' | 'cad' | 'unknown' | 'too_big'
  message: string
}

export function inspectRoomFile(file: { name: string; size: number }): InspectOk | InspectFail {
  const ext = fileExtension(file.name)

  if (ext === 'skp') {
    return {
      ok: false,
      code: 'skp',
      message: IMPORT_COPY.skp + (file.size > MAX_IMPORT_BYTES ? IMPORT_COPY.skpHeavy : ''),
    }
  }

  if (CAD_REJECT.has(ext)) {
    return { ok: false, code: 'cad', message: IMPORT_COPY.cad }
  }

  if (!LOADABLE_ROOM_FORMATS.has(ext)) {
    return { ok: false, code: 'unknown', message: IMPORT_COPY.unknown }
  }

  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, code: 'too_big', message: IMPORT_COPY.tooBig(file.size) }
  }

  const format = ext as LoadableRoomFormat
  const defaultZUp = format === 'fbx' || format === 'obj' || format === 'stl'
  return {
    ok: true,
    format,
    defaultZUp,
    warning: format === 'stl' ? IMPORT_COPY.stl : null,
  }
}
