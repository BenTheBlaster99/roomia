// Roomia Desktop waits for this before it shows the Studio (desktop/main.js). It also tells the Studio's pages which
// graphics card renders here, for the notices before a heavy render (app/studio/components/DesktopRenderNotice.tsx).
export const dynamic = 'force-dynamic'

export function GET() {
  const desktop = process.env.ROOMIA_DESKTOP === '1'
  return Response.json({
    ok: true,
    desktop,
    ...(desktop
      ? {
          version: process.env.ROOMIA_APP_VERSION ?? '',
          engine: {
            backend: process.env.ROOMIA_GPU_BACKEND ?? '',
            profile: process.env.ROOMIA_RENDER_PROFILE ?? '',
            gpu: process.env.ROOMIA_GPU_NAME ?? '',
            vramMb: Number(process.env.ROOMIA_GPU_VRAM_MB ?? 0),
            ramMb: Number(process.env.ROOMIA_RAM_MB ?? 0),
          },
        }
      : {}),
  })
}
