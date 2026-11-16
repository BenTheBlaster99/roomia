import './app.css'

// The app's look (16 Nov redesign): white overall, petrol blue for actions, gold for what is special (app/studio/app.css,
// tokens in app/globals.css). Scoped to /studio: the public site has its own pages on the same tokens.
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <div className="studio-theme">{children}</div>
}
