import type { Metadata } from 'next'
import BreathBowl from './BreathBowl'

export const metadata: Metadata = {
  title: 'Singing Bowl · Breath',
  description: 'Hum, sing, or blow into the mic to make the bowl ring.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Singing Bowl · Breath',
    description: 'Hum, sing, or blow into the mic to make the bowl ring.',
    images: [],
  },
  twitter: {
    card: 'summary',
    images: [],
  },
}

export default function Page() {
  return <BreathBowl />
}
