/**
 * Roomia's mark in the app (16 Nov redesign). THE place for the real logo: when the architect's final mark exists, save it as
 * public/brand/roomia-mark.svg and set LOGO to '/brand/roomia-mark.svg'; it then shows before the wordmark everywhere in the app.
 * Until then the wordmark alone: ROOMIA. in Archivo 900 extra-wide, the full stop in gold.
 */
const LOGO: string | null = null

export default function BrandMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {LOGO && <img src={LOGO} alt="" width={size * 1.6} height={size * 1.6} />}
      <span className="ui-wordmark" style={{ fontSize: size }}>
        Roomia<span>.</span>
      </span>
    </span>
  )
}
