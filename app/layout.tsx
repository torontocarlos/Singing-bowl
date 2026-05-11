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
  title: 'Birthday Bowl',
  description: 'Eight glowing candle-bowls tuned to a full octave. Tap to ring.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1a0738',
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
