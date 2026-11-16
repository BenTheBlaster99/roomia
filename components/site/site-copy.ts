import { whatsappLink } from '@/lib/contact'

/** The words of the shared navbar and footer, in both locales. The landing itself is written in French only. */
export const SITE_COPY = {
  fr: {
    home: 'Accueil',
    contact: 'Contact',
    demo: 'Demander une démo',
    demoShort: 'Démo',
    menuOpen: 'Ouvrir le menu',
    menuClose: 'Fermer le menu',
    mainNav: 'Navigation principale',
    language: 'Langue',
    tagline: 'Rendus réalistes à partir de vos modèles 3D, pour les architectes et les promoteurs en Algérie.',
    onHome: 'Sur la page d’accueil',
    reach: 'Nous joindre',
    whatsapp: 'WhatsApp',
    email: 'E-mail',
    rights: '© 2026 Roomia · Algérie',
    sections: {
      temps: 'Le temps gagné',
      resultats: 'Résultats',
      etapes: 'Comment ça marche',
      'pour-qui': 'Pour qui',
      offres: 'Offres',
      questions: 'Questions',
    },
  },
  en: {
    home: 'Home',
    contact: 'Contact',
    demo: 'Book a demo',
    demoShort: 'Demo',
    menuOpen: 'Open the menu',
    menuClose: 'Close the menu',
    mainNav: 'Main navigation',
    language: 'Language',
    tagline: 'Realistic renders from your 3D models, for architects and developers in Algeria.',
    onHome: 'On the home page',
    reach: 'Reach us',
    whatsapp: 'WhatsApp',
    email: 'Email',
    rights: '© 2026 Roomia · Algeria',
    sections: {
      temps: 'Time saved',
      resultats: 'Results',
      etapes: 'How it works',
      'pour-qui': 'Who it’s for',
      offres: 'Offers',
      questions: 'Questions',
    },
  },
} as const

export type SiteLocale = keyof typeof SITE_COPY
export const siteCopy = (locale: string) => SITE_COPY[locale === 'en' ? 'en' : 'fr']

/** The landing's sections, in page order. The navbar shows the ones marked `nav`; the footer shows all of them. */
export const HOME_SECTIONS = [
  { id: 'temps', nav: false },
  { id: 'resultats', nav: true },
  { id: 'etapes', nav: true },
  { id: 'pour-qui', nav: true },
  { id: 'offres', nav: true },
  { id: 'questions', nav: false },
] as const

/** The demo button opens a WhatsApp conversation (the Studio is not online; a demo starts with a message). */
export const DEMO_WHATSAPP = whatsappLink('Bonjour, je souhaite une démo de Roomia Render.')

export const CONTACT_EMAIL = 'contact@room-ia.com'
