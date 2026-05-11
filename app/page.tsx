import type { Metadata } from 'next'
import Bowl from './Bowl'

export const metadata: Metadata = {
  title: 'Singing Bowl',
  description: 'Trace the rim of the bowl to make it sing.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Singing Bowl',
    description: 'Trace the rim of the bowl to make it sing.',
    images: [],
  },
  twitter: {
    card: 'summary',
    images: [],
  },
}

export default function Page() {
  return <Bowl />
}
