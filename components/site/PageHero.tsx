import type { ReactNode } from 'react'

/** The deep-blue band that opens every page of the site except the landing: an eyebrow, the title, a lead and optional actions. */
export default function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lead?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="site-hero">
      <div className="site-wrap">
        {eyebrow && <p className="site-eyebrow">{eyebrow}</p>}
        <h1 className="site-h1">{title}</h1>
        {lead && <p className="site-lead">{lead}</p>}
        {children && <div className="site-hero-actions">{children}</div>}
      </div>
    </section>
  )
}
