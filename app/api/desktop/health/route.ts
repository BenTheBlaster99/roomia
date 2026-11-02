// Roomia Desktop waits for this before it shows the Studio (desktop/main.js).
export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true, desktop: process.env.ROOMIA_DESKTOP === '1' })
}
