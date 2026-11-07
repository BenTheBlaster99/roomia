import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { desktopMode } from '@/lib/desktop-projects'
import ProjectsClient from './ProjectsClient'

export const metadata: Metadata = { title: 'Mes projets · Roomia' }

/** Roomia Desktop's start page: the projects on this PC. */
export default async function ProjectsPage() {
  await connection()
  if (!desktopMode()) notFound()
  return <ProjectsClient />
}
