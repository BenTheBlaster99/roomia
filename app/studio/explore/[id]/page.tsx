import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { pageUser } from '@/lib/page-session'
import { isSceneId, readMeta } from '@/lib/scene-store'
import ExploreClient from './ExploreClient'
import '../../tour/[id]/tour.css'
import './explore.css'

export const metadata: Metadata = { title: 'Visite libre · Roomia' }

/** Roomia Explorer (31 Oct, first prototype): walk freely through the scene's own 3D model, desktop only. */
export default async function ExplorePage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  await pageUser(`/studio/explore/${id}`)
  if (!isSceneId(id)) notFound()
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') notFound()
  return <ExploreClient sceneId={id} title={meta.fileName.replace(/\.(glb|dae|zip)$/i, '')} />
}
