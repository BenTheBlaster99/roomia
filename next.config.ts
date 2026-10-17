import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  // Dev mode refuses requests from other addresses; testers reach the dev server through a Cloudflare tunnel.
  allowedDevOrigins: ['*.trycloudflare.com', '*.coconutstudio.io'],
  serverExternalPackages: ['sharp'],
  // Scene routes build a path from the project root, and the file tracer follows it.
  // That packs the scene folder and the compiler binaries into every server function.
  // The upload then dies at "Deploying outputs" once a function passes 250 MB.
  outputFileTracingExcludes: {
    '/*': [
      './.scenes/**',
      './public/models/**',
      './d5-tests/**',
      './store Hotelia Space/**',
      './node_modules/@next/swc-*/**',
      './node_modules/@swc/core*/**',
      './node_modules/@esbuild/**',
      './node_modules/typescript/**',
    ],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.pinimg.com' },
      { protocol: 'https', hostname: 'pmsotwinvccacownpnpp.supabase.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'png.pngtree.com' },
      { protocol: 'https', hostname: 'cdn.itsoverflowing.com' },
      { protocol: 'https', hostname: 'florgeous.com' },
      { protocol: 'https', hostname: 'cdn.prod.website-files.com' },
      { protocol: 'https', hostname: 'www.thespruce.com' },
      { protocol: 'https', hostname: 'hips.hearstapps.com' },
      { protocol: 'https', hostname: 'media.abiinteriors.com' },
      { protocol: 'https', hostname: 'miro.medium.com' },
      { protocol: 'https', hostname: 'naryafoto.com' },
      { protocol: 'https', hostname: 'interiordesign.net' },
      { protocol: 'https', hostname: 'images.too-much-time.com' },
      { protocol: 'https', hostname: 'preview.redd.it' },
      { protocol: 'https', hostname: 'static.wixstatic.com' },
      { protocol: 'https', hostname: 'cdn.home-designing.com' },
      { protocol: 'https', hostname: 'skyryedesign.com' },
      { protocol: 'https', hostname: 'nordichomeworx.com' },
    ],
  },
}

export default withNextIntl(nextConfig)
