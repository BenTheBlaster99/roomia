import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Roomia Pro — Tableau de bord',
  description: 'Tableau de bord Pro — aperçu, Drive, et restyle d’une pièce.',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
