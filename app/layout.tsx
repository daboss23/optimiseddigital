import type { Metadata, Viewport } from 'next'
import './globals.css'
import { GlossTracker } from '@/components/reactor/GlossTracker'

export const metadata: Metadata = {
  title: 'TPB Creative Reactor — Engineered For Performance',
  description:
    'Creative Intelligence Command Center for The Professional Builder. Engineered For Performance.',
  // Installed to a phone home screen, the command center should open chromeless
  // and dark rather than in a white-barred browser shell.
  appleWebApp: {
    capable: true,
    title: 'TPB Reactor',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `cover` lets the layout run under the notch and home indicator; the shell
  // pays that back with env(safe-area-inset-*) padding so nothing is occluded.
  viewportFit: 'cover',
  // Matches --bg-base, so the iOS status bar and Android chrome blend into the
  // page instead of banding against it.
  themeColor: '#080b1a',
  // Pinch-zoom stays available — capping it would fail WCAG 1.4.4.
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Orbitron is the display face and only ever renders at semibold,
            bold, or black — the 400/500/800 cuts were downloaded and never
            drawn. Trimming them is pure payload off the critical path, which
            is where a phone on cellular feels it. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Orbitron:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased text-[#e6edf6]">
        {/* Liquid-glass environment — moving neon aurora behind translucent glass */}
        <div className="reactor-aurora" aria-hidden="true">
          <span className="aurora-blob aurora-blob--cyan" />
          <span className="aurora-blob aurora-blob--violet" />
          <span className="aurora-blob aurora-blob--magenta" />
          <span className="aurora-blob aurora-blob--azure" />
        </div>
        <div className="reactor-bg" aria-hidden="true" />
        <div className="reactor-nodes" aria-hidden="true" />
        <GlossTracker />
        {children}
      </body>
    </html>
  )
}
