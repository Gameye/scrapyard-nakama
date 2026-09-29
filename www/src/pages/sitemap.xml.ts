import type { APIRoute } from 'astro'
import { GUIDE } from '@/lib/guide'
import { absolute } from '@/lib/seo'

// The pages worth finding: home and the guide. Sign-in and account pages are
// noindex, and /play is the game itself.
const PAGES = [{ path: '/', changefreq: 'weekly', priority: 1 }, ...GUIDE.map(({ href }) => ({ path: href, changefreq: 'monthly', priority: 0.7 }))]

export const GET: APIRoute = () => {
  const urls = PAGES.map(
    ({ path, changefreq, priority }) => `<url>\n<loc>${absolute(path)}</loc>\n<changefreq>${changefreq}</changefreq>\n<priority>${priority}</priority>\n</url>\n`,
  )
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('')}</urlset>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } })
}
