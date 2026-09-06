import { formatDA } from '@/lib/format-da'
import type { CatalogItem } from './catalog-data'

export default function ProductCard({ item, href }: { item: CatalogItem; href: string }) {
  return (
    <a
      href={href}
      className="block overflow-hidden rounded-xl border border-[var(--rm-text)]/8 bg-white shadow-[0_10px_28px_-22px_rgba(20,32,28,0.55)] transition hover:border-[var(--rm-primary)]/25"
    >
      <div className="flex aspect-[5/4] items-center justify-center bg-[linear-gradient(180deg,#eef3ef_0%,#e3ebe6_100%)] p-3">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="h-full w-full rounded-lg bg-[var(--rm-secondary)]" />
        )}
      </div>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--rm-ink)]">{item.name}</p>
          {item.category ? <p className="truncate text-[11px] text-[var(--rm-muted)]">{item.category}</p> : null}
        </div>
        <p className="shrink-0 text-right text-sm font-bold text-[var(--rm-primary)]">{formatDA(item.price)}</p>
      </div>
    </a>
  )
}
