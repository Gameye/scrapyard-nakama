import { SITE } from './site'

export interface PageMeta {
  title?: string // absent: the site title (the home page)
  description: string
  path?: string // canonical path, e.g. '/docs/modes'; absent: none (the 404 page)
  index?: boolean // false: kept out of search results (sign-in, account, 404)
}

// An absolute URL on the site; the home page without a trailing slash, as
// the sitemap and the canonical links name it.
export const absolute = (path: string) => new URL(path, import.meta.env.SITE).href.replace(/\/$/, '')

// What the head says about a page (components/head/Seo.astro writes it out).
export function seo({ title, description, path, index = true }: PageMeta) {
  return {
    title: title ? `${title} · ${SITE.name}` : SITE.title,
    description,
    canonical: path === undefined ? undefined : absolute(path),
    image: absolute(SITE.card.url),
    index,
  }
}
