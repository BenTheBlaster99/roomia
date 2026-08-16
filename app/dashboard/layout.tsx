import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Roomia Pro',
  description: 'Drive + restyle photoréaliste pour architectes et designers.',
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children
}
