import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Roomia Staff — Magasins',
  description: 'Back-office Jack / Sarah : magasins partenaires et pièces 2D.',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
