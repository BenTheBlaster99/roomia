/** Where demo requests from the landing page go. */
export const WHATSAPP_NUMBER = '213779816076'
export const WHATSAPP_DISPLAY = '+213 779 81 60 76'

/** The Studio runs on Roomia's own PC (Blender), behind this address, not on Vercel. */
export const STUDIO_URL = 'https://studio.room-ia.com/studio'

export const whatsappLink = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`

export const DEMO_ROLES = [
  'Promoteur immobilier',
  'Bureau d’architecture',
  'Architecte d’intérieur',
  'Cuisiniste',
  'Designer indépendant',
  'Autre',
] as const
