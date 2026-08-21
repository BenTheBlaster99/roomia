export type StudioQuery = {
  preset?: string
  create?: string
  saved?: string
  style?: string
  room?: string
  width?: string
  length?: string
  height?: string
}

export function firstSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
