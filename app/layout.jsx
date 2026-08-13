import { Familjen_Grotesk, JetBrains_Mono, Anek_Devanagari } from 'next/font/google'
import './globals.css'

const grotesk = Familjen_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-grotesk',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
})

// The Latin display face has no Devanagari glyphs at all, so the title used to
// fall through to whatever the device happened to have. This pins it.
const devanagari = Anek_Devanagari({
  subsets: ['devanagari'],
  weight: ['500', '700', '800'],
  variable: '--font-devanagari',
})

export const metadata = {
  title: 'Prit Radio — always on',
  description:
    'An always-on radio that plays the Prit playlist straight through. Press play, let it run.',
  applicationName: 'Prit Radio',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
  // iOS ignores the web app manifest and reads these instead.
  appleWebApp: {
    capable: true,
    title: 'Prit Radio',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport = {
  themeColor: '#171210',
}

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${jetbrains.variable} ${devanagari.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
