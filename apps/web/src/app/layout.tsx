import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ToastProvider } from '@/components/toast';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Realtime Voice · Live church translation',
    template: '%s · Realtime Voice',
  },
  description:
    'Live AI translation for worship services. Your sermon, instantly, in every language — on your congregation\'s phones or your existing headset system.',
  manifest: '/manifest.webmanifest',
  applicationName: 'Realtime Voice',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Realtime Voice · Live church translation',
    description:
      'Live AI translation for worship services. Your sermon, instantly, in every language.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Realtime Voice',
    description: 'Live AI translation for worship services.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0b0f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
