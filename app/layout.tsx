import type { Metadata, Viewport } from 'next'
import { Archivo, Hanken_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import './globals.css'

// The brand's four families (16 Nov redesign, the landing's set made global): Archivo with its width axis for titles and the
// ROOMIA. wordmark, Hanken Grotesk for text and interface, Instrument Serif italic for one emphasised word, JetBrains Mono for labels.
const display = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display', display: 'swap' })
const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-body', display: 'swap' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-label', display: 'swap' })

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
    <html lang={locale} className={`${display.variable} ${body.variable} ${serif.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-[family-name:var(--font-body)]">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
