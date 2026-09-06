import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Catalogue — Roomia',
  description: 'Pièces 2D des magasins partenaires Roomia.',
}

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return children
}
