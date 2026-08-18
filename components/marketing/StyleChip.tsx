import { Link } from '@/i18n/navigation'
import type { StyleId } from '@/lib/style-details'

export {
  FEATURED_STYLE_IDS,
  STYLE_IDS,
  type StyleId,
} from '@/lib/style-details'

export function StyleChip({ id, label }: { id: StyleId | string; label: string }) {
  return (
    <Link href={`/styles/${id}`} className="rm-style-chip">
      <span>{label}</span>
      <span className="rm-style-chip-arrow" aria-hidden>
        →
      </span>
    </Link>
  )
}
