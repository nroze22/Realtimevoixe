import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Realtime Voice • Live church translation',
  description:
    'Live AI translation of church services into any language. Built on OpenAI Realtime + LiveKit.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0c0d11',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
