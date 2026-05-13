import type { Metadata } from 'next'
import MotionBowl from './MotionBowl'

export const metadata: Metadata = {
  title: 'Singing Bowl · Motion',
  description: 'Rotate the phone to make the bowl sing.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Singing Bowl · Motion',
    description: 'Rotate the phone to make the bowl sing.',
    images: [],
  },
  twitter: {
    card: 'summary',
    images: [],
  },
}

export default function Page() {
  return <MotionBowl />
}
