import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { pageUser } from '@/lib/page-session'
import { isSceneId, readMeta } from '@/lib/scene-store'
import TourClient from './TourClient'
import './tour.css'

export const metadata: Metadata = { title: 'Visite · Roomia' }

/** The virtual tour of a scene: its photos with arrows between them, a 360° view of each, and the plan. */
export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  if (!isSceneId(id)) notFound()
  const meta = await readMeta(id)
  // a tour published from Roomia Desktop is for the architect's clients: no account needed to view it
  if (!meta?.published) await pageUser(`/studio/tour/${id}`)
  if (!meta || meta.status !== 'ready') notFound()
  return <TourClient sceneId={id} title={meta.fileName.replace(/\.(glb|dae|zip)$/i, '')} published={!!meta.published} />
}
