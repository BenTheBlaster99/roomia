import type { Metadata, Viewport } from 'next'
import { Syne, Figtree, Playfair_Display } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'

const display = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const body = Figtree({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const serif = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Roomia — Concevez votre intérieur',
  description:
    "Configurateur d'intérieur pour l'Algérie — générez avec l'IA, modélisez en 3D, et achetez le look.",
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-body)]">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
