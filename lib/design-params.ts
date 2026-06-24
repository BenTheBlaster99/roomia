/** Shared query params for a completed design session */
export interface DesignParams {
  room: string
  style: string
  budget: string
  width: string
  length: string
  height: string
}

const DEFAULT_HEIGHT = '2.8'

export function parseDesignParams(
  params: Record<string, string | undefined>,
): DesignParams {
  return {
    room: params.room ?? '',
    style: params.style ?? '',
    budget: params.budget ?? '',
    width: params.width ?? '',
    length: params.length ?? '',
    height: params.height ?? DEFAULT_HEIGHT,
  }
}

export function buildDesignQueryString(p: DesignParams): string {
  return new URLSearchParams({
    room: p.room,
    style: p.style,
    budget: p.budget,
    width: p.width,
    length: p.length,
    height: p.height,
  }).toString()
}

export function buildDesignPath(basePath: string, p: DesignParams): string {
  return `${basePath}?${buildDesignQueryString(p)}`
}

export { DEFAULT_HEIGHT }
