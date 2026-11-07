import { timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { importInbox } from '@/lib/desktop-inbox'
import { desktopMode } from '@/lib/desktop-projects'

export const runtime = 'nodejs'
export const maxDuration = 300

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * POST { dir } — Roomia Desktop's own window process hands over a model the SketchUp extension sent (desktop/main.js).
 * Only it knows the token: a web page can't make this server import files from the PC.
 */
export async function POST(req: NextRequest) {
  const token = process.env.ROOMIA_INBOX_TOKEN ?? ''
  if (!desktopMode() || !token || !sameToken(req.headers.get('x-roomia-inbox') ?? '', token)) {
    return Response.json({ detail: 'Introuvable' }, { status: 404 })
  }
  const body = (await req.json().catch(() => null)) as { dir?: unknown } | null
  try {
    return Response.json(await importInbox(String(body?.dir ?? '')))
  } catch (err) {
    console.error('inbox import failed', err)
    return Response.json({ detail: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
