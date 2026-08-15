'use client'

import { DashboardProvider } from './components/DashboardProvider'
import AuthGate from './components/AuthGate'
import DashboardShell from './components/DashboardShell'

export default function DashboardPage() {
  return (
    <DashboardProvider>
      <AuthGate>
        <DashboardShell />
      </AuthGate>
    </DashboardProvider>
  )
}
