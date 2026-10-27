import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { pageUser } from '@/lib/page-session'
import { isSceneId, readMeta } from '@/lib/scene-store'
import FacesClient from './FacesClient'
import './faces.css'

export const metadata: Metadata = { title: 'Revue des faces · Roomia' }

/** Review of the photo-quality faces: should each face go to the AI, and was the AI result good enough. */
export default async function FacesPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  await pageUser(`/studio/tour/${id}/faces`)
  if (!isSceneId(id)) notFound()
  const meta = await readMeta(id)
  if (!meta || meta.status !== 'ready') notFound()
  return <FacesClient sceneId={id} title={meta.fileName.replace(/\.(glb|dae|zip)$/i, '')} />
}
