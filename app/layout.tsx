import type { Metadata, Viewport } from 'next';
import { DM_Serif_Display, Outfit } from 'next/font/google';
import './globals.css';

const serif = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--serif',
  display: 'swap'
});

const sans = Outfit({
  subsets: ['latin'],
  variable: '--sans',
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Singing Bowl',
  description:
    'A chakra-tuned singing bowl: trace the rim to sing, tap the centre to strike.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0c0e14',
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
