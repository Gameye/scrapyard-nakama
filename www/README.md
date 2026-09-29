# Scrapyard — the site

The public site: home page, the guide, log in / register / account on Nakama.
Astro 7, built to static files in `dist/`; on the server Caddy serves them
(`deploy/Caddyfile`), with the game's own build inside at `/play`.

```sh
npm run dev     # :8000; /api/stats goes to the local Nakama, /play to the last game build
npm run build   # astro check, then dist/ (the repo's scripts/build.sh adds the game and .br/.gz copies)
npm run lint
npm run check   # the session rules and the forms' error texts, under plain node
```

## Where things are

```
src/pages/          one file per URL: index, docs/[...slug] (the whole guide), login, register, account, 404, sitemap.xml, robots.txt
src/layouts/        Base (head, skip link), Site (header + footer around a page)
src/components/     head/ (SEO tags, fonts, analytics), site/ (header, footer, player counts), home/, guide/
src/islands/        React, hydrated in the browser: the log in, register and account forms only
src/content/guide/  the guide's pages, MDX; src/lib/guide.ts lists and orders them
src/lib/            site facts, SEO, the Nakama session (storage, format, refresh), player counts
src/styles/         Tailwind theme, fonts, utilities, the guide's typography
```

Rules the code keeps:

- One job per file, under 100 lines (the MDX content is exempt).
- JavaScript only where a page needs it. The header's name and the player
  counts are small scripts; React loads only on the three form pages.
- The session in `localStorage` (`scrapyard.session`) is shared with the game
  at `/play`: change `src/lib/nakama/` and `game/src/net/session.ts` together.
- Every fact in the copy comes from the game's code: change the game first.

Build-time settings are in `.env.example`.
