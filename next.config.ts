import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
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
