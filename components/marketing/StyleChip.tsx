import { Link } from '@/i18n/navigation'
import { isStyleId, STYLE_VISUALS, type StyleId } from '@/lib/style-details'

export {
  FEATURED_STYLE_IDS,
  STYLE_IDS,
  type StyleId,
} from '@/lib/style-details'

export function StyleChip({ id, label }: { id: StyleId | string; label: string }) {
  const hero = isStyleId(id) ? STYLE_VISUALS[id].photos[0] : undefined

  return (
    <Link href={`/styles/${id}`} className="rm-style-chip">
      {hero ? (
        <span className="rm-style-chip-photo">
          <img src={hero.src} alt="" referrerPolicy="no-referrer" loading="lazy" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="rm-style-chip-arrow" aria-hidden>
        →
      </span>
    </Link>
  )
}
