// The Studio's own look (11 Nov makeover, "Graphite"): a dark neutral ground so renders and 360° stand out, brass accent as in
// the tour. Scoped to /studio: the public site keeps its light green palette (app/globals.css :root).
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <div className="studio-theme">{children}</div>
}
