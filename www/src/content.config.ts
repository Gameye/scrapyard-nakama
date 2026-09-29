import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

// The guide's pages (src/content/guide/*.mdx): index.mdx is /docs, the rest
// /docs/<name>. The reading order lives in src/lib/guide.ts.
const guide = defineCollection({
  loader: glob({ pattern: '*.mdx', base: './src/content/guide' }),
  schema: z.object({
    title: z.string(), // the page's <title>, before " · Scrapyard"
    description: z.string(), // meta description and social cards
  }),
})

export const collections = { guide }
