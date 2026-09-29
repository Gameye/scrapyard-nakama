import type { APIRoute } from 'astro'
import { absolute } from '@/lib/seo'

// Everything may be crawled; the sitemap says what is worth it.
export const GET: APIRoute = () => new Response(`User-Agent: *\nAllow: /\n\nSitemap: ${absolute('/sitemap.xml')}\n`)
