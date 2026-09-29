// The guide's pages in reading order: the routes, the sidebar, the
// next/previous links and the sitemap all come from this list. `id` is the
// page's file in src/content/guide.
export const GUIDE = [
  { id: 'index', href: '/docs', title: 'Overview' },
  { id: 'how-to-play', href: '/docs/how-to-play', title: 'How to play' },
  { id: 'controls', href: '/docs/controls', title: 'Controls' },
  { id: 'modes', href: '/docs/modes', title: 'Modes' },
  { id: 'arenas', href: '/docs/arenas', title: 'Arenas' },
  { id: 'garage', href: '/docs/garage', title: 'The garage' },
  { id: 'faq', href: '/docs/faq', title: 'FAQ' },
]

export type GuidePage = (typeof GUIDE)[number]
