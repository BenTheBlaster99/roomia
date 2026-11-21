/**
 * Two points that stand close and see each other make the same picture twice (21 Nov: the F5's kitchen had two, about 1 m apart, and
 * nobody noticed). The points editor flags such pairs; it never removes a point, the person decides. A pair of SketchUp scenes is the
 * architect's own choice and is not flagged.
 */
export interface AlikePoint {
  key: string
  kind: 'view' | 'auto'
  level: number
  /** where the point stands on its level's plan, in pixels */
  x: number
  y: number
  /** moved or made by the person: the placement knows nothing about it */
  changed: boolean
  /** the points within 3 m this one sees directly (the placement's ray casts); absent when unknown */
  sees?: string[]
}

export interface AlikeLevel {
  index: number
  width: number
  height: number
  /** what the plan shows, in metres: [x min, y min, x max, y max] */
  frame: [number, number, number, number]
}

/** Closer than this (metres) and in sight: alike. */
export const ALIKE_METRES = 1.5

export function alikePairs<T extends AlikePoint>(points: T[], levels: AlikeLevel[], metres = ALIKE_METRES): { a: T; b: T }[] {
  const out: { a: T; b: T }[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]
      const b = points[j]
      if (a.level !== b.level || (a.kind === 'view' && b.kind === 'view')) continue
      const L = levels.find(l => l.index === a.level)
      if (!L) continue
      const [x0, y0, x1, y1] = L.frame
      const apart = Math.hypot(((a.x - b.x) * (x1 - x0)) / L.width, ((a.y - b.y) * (y1 - y0)) / L.height)
      if (apart >= metres) continue
      // the placement knows the walls: with its answer for both points, a wall between them clears the pair; a point the person
      // made or moved has no answer, so the distance alone counts
      const known = !a.changed && !b.changed && a.sees && b.sees
      if (known && !a.sees!.includes(b.key) && !b.sees!.includes(a.key)) continue
      out.push({ a, b })
    }
  }
  return out
}
