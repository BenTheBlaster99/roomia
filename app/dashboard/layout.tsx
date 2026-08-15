import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Roomia Pro — Tableau de bord',
  description: 'Espace de travail agence — uploads, générations empilées, compositeur Pro.',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
