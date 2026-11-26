/**
 * The one place the Roomia mark is drawn on the website (navbar and footer).
 *
 * Today it is the "ROOMIA." wordmark: Archivo 900 at width 125, capitals, the full stop in gold.
 * The architect is drawing the real logo (an "R" whose leg becomes a roof with a small window). When the file
 * exists, put it at public/brand/roomia-logo.svg and set LOGO_SRC below: the mark is then shown before the
 * wordmark everywhere on the site, at the wordmark's height. Do not redraw or approximate the mark here.
 */
const LOGO_SRC: string | null = '/brand/roomia-mark.png' // 25 Nov: the logo, a PNG until a vector file exists

export default function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`site-wordmark ${className}`}>
      {LOGO_SRC && (
        // eslint-disable-next-line @next/next/no-img-element -- an SVG logo at text height, no optimisation needed
        <img className="site-wordmark-logo" src={LOGO_SRC} alt="" aria-hidden="true" />
      )}
      <span className="site-wordmark-text">
        ROOMIA<span className="site-wordmark-dot">.</span>
      </span>
    </span>
  )
}
