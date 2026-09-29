# Web site, accounts and /play — implementation log

Plan: `WWW_IMPLEMENTATION_PLAN.md`. Built on 27 Sept 2026 in one pass, in the plan's build order.

## Decisions taken while building

- **D4 (guests) taken as recommended.** `/play` without a session signs in as a guest (device ID in `scrapyard.device`); the menu offers "Create an account". Register creates a fresh email account; guests aren't linked onto it yet.
- **The game signs in after the menu shows, not as a STARTUP task.** Practice needs no server; the menu says "Playing as <name>", "Guest" or "Offline".
- **Account page.** Log out lives on `/account`, not in a header menu. The header shows the username and links to the account. No dropdown means no focus trap to get wrong.
- **MDX.** `remark-gfm` added for tables. Every `<kbd>` is styled globally in `globals.css`, because the MDX component map only covers elements that come from Markdown syntax, not JSX written in the file.
- **Images.** Brand assets are generated once from `www/public/logo*.png`, with luminance turned into alpha in the game's ink colour: `assets/wordmark.png`, `assets/emblem.png`. The Open Graph card is `public/og.jpg` (menu key art + wordmark, 1200×630). Icons are `app/icon.png` and `app/apple-icon.png`. The game's favicon (`game/public/favicon.png`) replaces the Vite and Next defaults. The originals in `www/public/` are untouched.
- **Metadata.** `lib/site.ts` `pageMetadata()` states the whole Open Graph block on every page, because Next merges metadata shallowly. Canonical links, the sitemap and the card URLs use `SITE_URL`. `/login`, `/register` and `/account` are `noindex, follow` and left out of the sitemap. The home page carries JSON-LD (`WebSite` + `VideoGame`, `playMode: SinglePlayer` until online play exists).
- **Copy.** Every number and name on the site comes from the game's code: `combat.ts`, `vehicle/vehicles.ts`, `modes.ts`, `maps.ts`, the `ffa/` and `tdm/` configs, arena zone names and the patch notes. Claims checked against the code and corrected:
  - Rams do no damage (crashes are only a view event), so a line about ramming was removed.
  - The map previews are in-game renders.
  - Unverifiable tips and a "report a bug" answer with nowhere to report were dropped.
- **Contrast.** Small explanatory text uses neutral-400, not neutral-500.
- **Container image.** `www/Containerfile` builds from the repo root. The build context is filtered by `.dockerignore`, the name both Podman and Docker read. The runtime files are owned by `node`, because the image optimizer writes `.next/cache`.

## Checks run

| Check | Result |
|---|---|
| `www`: `npm run build` | 16 routes, all static (○) |
| `www`: `npm run lint`, `npm run check` | clean; `nakama.check: ok` |
| `game`: `npx tsc -b`, `npm run check` | clean; router, ffa (143), tdm (163), simulation (28), loading (23) ok |
| `game`: `npm run lint` | only the old `Drawer.tsx` exhaustive-deps warning |
| `scripts/nakama-smoke.mjs` | passes before and after the run |
| Standalone server (`scripts/build.sh`, `node .next/standalone/server.js`) | `/play` 200 html, `/play/` 308 → `/play`, `/play/assets/*` `immutable`, `bg/` and `maps/` `max-age=0`; the game bundle addresses `/play/bg/…` and `/play/maps/…` |
| SEO tags | title and template, description, canonical, `og:*`, `twitter:card`, JSON-LD, robots.txt, sitemap.xml (home + 7 guide pages); one `h1` per page; every `img` has alt |
| 360 px wide | no horizontal overflow on `/`, `/docs/*`, `/login`, `/register`, `/account` |
| Container | `podman build -f www/Containerfile .` then run on :8200: pages, `/play`, image optimizer, no errors in the log |
| `deploy/compose.yml` | `podman compose config` with dummy values interpolates every secret |

The first container build failed once: `@rolldown/binding-linux-arm64-musl` was missing after `npm ci`. It didn't reproduce on a clean rebuild or in a separate `npm ci` in the same image; the binding is in the lockfile. The likely cause is a transient fetch of an optional dependency, which npm skips with only a warning. If CI ever hits it, retry the build.

## End to end (27 Sept 2026, local)

Nakama under Podman, the standalone site on :8100, Chrome. Test account `e2e_487884` / `e2e-487884@example.test`, created and deleted during the run; its password never left the session.

- [x] Register → `/account` (`?next` default), header shows the username; the session is stored without the guest flag.
- [x] Set the display name → "Saved."
- [x] `/play` → the game's menu reads "Playing as E2E Driver": the site's login carried into the game.
- [x] Exit in the game → site home, still signed in.
- [x] Log out on `/account` → home, header "Log in", session cleared.
- [x] `/play` signed out → "Playing as Guest · Create an account"; the session is marked guest, the device ID is kept; `/account` shows the guest card.
- [x] Log in with the wrong password → "Wrong email or password."; right password with `?next=/account` → `/account`, guest session replaced.
- [x] Change password: wrong current one → "Your current password is wrong."; right one → "Password changed.", fields cleared.
- [x] Delete account (typing the username enables the button) → home, signed out; logging in again → "Wrong email or password."
- [x] Nakama stopped → login form says "Can't reach the game server…", the game's menu says "Offline"; restarted → smoke test passes.

Not run: an incognito second window (it needs a real second profile), and anything on a real server or GitHub (no repo yet).

## Left for later

- `git init` and the first push (needs the owner). CI (`ci.yml`) and deploy (`ds.yml`) are written but have never run. The deploy needs repository variables and secrets and a prepared server; see the header of `ds.yml` and `deploy/.env.example`.
- The guest accounts made while testing stay in the local database (they're harmless).
- `Makefile` is still empty; the scripts cover everything.

## Home page as one scene (27 Sept 2026, later)

The owner asked for a single full-screen home page. Its content is a headline, one line of copy and **Play now**, over a looping gameplay video. The garage, modes, arenas, controls and footer sections are gone from home, and so are the logo image and the How to play button. The header is laid over the video. Every other page moved into the `app/(site)/` route group, which keeps the header and footer. The 404 page brings both itself.

- **Video.** `public/video/hero-v1.webm` (AV1, 844 KB) and `hero-v1.mp4` (H.264 High@4.0, 1.1 MB): 10 s, 960×540, 24 fps, no audio, a seamless loop.
  - Both `<source>`s carry `media="(min-width: 768px)"`, so phones download neither and get the still.
  - `prefers-reduced-motion` hides the video (the still stays).
  - `/video/*` is cached for good, so a new cut gets a new name (`hero-v2`…).
- **Still.** `assets/hero-poster.jpg` is the loop's first frame at 1280×720. It paints first and is the LCP image, served as AVIF (45 KB at 1920 w). Next now serves AVIF first for every image (`images.formats`).
- **Structured data.** The home JSON-LD gives the game a `trailer` (`VideoObject`: the MP4, the still, 10 s).
- **Heading.** The home `h1` is now text: "Car combat in your browser".

### How the loop was cut (to redo it)

1. **Receiver.** Run a small node server on `127.0.0.1:9123` that writes each POSTed body to a file named by `?name=`. It must answer CORS and send `Access-Control-Allow-Private-Network: true`.
2. **Start a match.** Open the game dev build (`:3000`, it has `window.tick`) and start Team Deathmatch in The City.
3. **Drive and capture, in the page console.** The block below also mutes the game first and puts the volume back after. The warm-up takes 3 s, the capture 30 s.

   ```js
   const { createBrain } = await import('/src/game/ai.ts')
   match.player.brain = createBrain(7) // the simulation drives the player like a bot; the chase camera follows
   requestAnimationFrame = () => 0 // stop the live loop; frames come from tick() only
   // per frame: t += 1000 / 30; tick(t); ctx.drawImage(webglCanvas, 16:9 centre crop -> 1280×720 OffscreenCanvas);
   // convertToBlob jpeg 0.92; POST it
   ```

4. **Cut a 10 s loop.** Take the source frames 30–360. The last second crossfades into the first, so the end meets the start:

   ```sh
   ffmpeg -framerate 30 -start_number 30 -i f%05d.jpg -frames:v 330 -filter_complex "[0]split[a][b];[a]trim=start=1:end=11,setpts=PTS-STARTPTS[main];[b]trim=start=0:end=1,setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=1:offset=9,format=yuv420p[v]" -map "[v]" -c:v libx264 -crf 14 loop-master.mp4
   ```

5. **Encode for the web.**

   ```sh
   ffmpeg -i loop-master.mp4 -vf "fps=24,scale=960:-2:flags=lanczos" -c:v libsvtav1 -preset 4 -crf 48 -g 240 -pix_fmt yuv420p -an hero-vN.webm
   ffmpeg -i loop-master.mp4 -vf "fps=24,scale=960:-2:flags=lanczos" -c:v libx264 -preset veryslow -crf 31 -profile:v high -level 4.0 -pix_fmt yuv420p -movflags +faststart -an hero-vN.mp4
   ffmpeg -i loop-master.mp4 -frames:v 1 -q:v 3 hero-poster.jpg
   ```

   Other settings tried on the same clip:

   | Encode | Size |
   |---|---|
   | AV1 720p30, crf 40 | 2.6 MB |
   | AV1 720p30, crf 46 | 1.7 MB |
   | AV1 540p24, crf 44 | 1.1 MB |
   | H.264 720p30, crf 30 | 2.2 MB |
   | H.264 540p24, crf 29 | 1.4 MB |

   The AV1 `type` codecs string (`av01.0.04M.08`, level 3.0) comes from ffprobe; it lets browsers without AV1 skip to the MP4.

## Astro port (28 Sept 2026)

The owner asked to replace Next.js with the latest Astro, to keep the look, the SEO and Google Analytics exactly, and to write it as small single-purpose files (under 100 lines each; the MDX is exempt). Why: the server is an e2-medium and should carry hundreds to thousands of players, so the site became static files that Caddy serves. No Node process runs for the site any more.

- **Stack.** Astro 7.3 (static output, `build.format: 'file'`, `trailingSlash: 'never'`), `@astrojs/mdx` with remark-gfm, `@astrojs/react` for the forms, Tailwind 4 via `@tailwindcss/vite`. TypeScript stays on 6.0 because `@astrojs/check` and typescript-eslint don't support 7 yet.
- **URLs.** They are unchanged. `/docs/modes` is `dist/docs/modes.html`. Caddy maps it with `try_files {path} {path}.html {path}/index.html`, and redirects `/x/` to `/x` (308), as Next did.
- **Fonts.** These are self-hosted from `@fontsource-variable`: Fraunces `opsz` + `opsz-italic` (the same files next/font served) and Manrope `wght`. The fallback faces use the metrics next/font generated. The three Latin files are preloaded, as before. Astro's font API was not used because it can't keep Fraunces' optical-size axis.
- **Images.** Screenshots and the home still are `<Picture>` in AVIF and WebP. They have the same blur-up placeholder next/image drew: `lib/blur.ts` makes it with sharp at build time.
- **JavaScript only where needed.** The header's name (`components/site/AccountSlot.astro`, which reads the token claims in `lib/nakama/claims.ts`) and the player counts (`PlayerCount.astro`, `lib/stats.ts`) are small scripts with no React and no Nakama client. React and nakama-js load only on `/login`, `/register` and `/account`. Home and guide pages ship about 1 KB of script, down from about 200 KB.
- **Session code** is split by what loads it:
  - `storage.ts`: the key and change events
  - `stored.ts`: the format, parsed with nakama-js
  - `session.ts`: save, clear, refresh
  - `claims.ts`: the header's quick read
  `nakama.check.mts` requires `claims.ts` and `parse()` to agree.
- **Guide.** The guide is a content collection. `lib/guide.ts` drives routes, sidebar, pager and sitemap. The Markdown's look is `styles/guide.css`, in the components layer. Heading ids come from Astro's slugger; every existing anchor is unchanged.
- **Player counts.** Polling pauses while the tab is hidden. `get_stats` now caches its answer for 30 s in Nakama's local cache, so the database is asked at most twice a minute however many pages are open. `/api/stats` is a Caddy route that adds the HTTP key server-side: GET only, that one RPC.
- **Deploy.** CI builds the game and the site, precompresses text files (`scripts/precompress.mjs`: brotli 11 + gzip 9; the game bundle drops from 4.35 MB to 1.13 MB), and rsyncs `www/dist/` to `~/scrapyard/site/incoming/`. `scripts/deploy.sh <sha>` snapshots it as a release (hard links) and switches `site/current` in one rename. The GHCR image, the `www` container and `www/Containerfile` are gone. Hashed paths (`/_astro/*`, `/play/assets/*`, `/video/*`) are `immutable`; everything else is `no-cache` with ETags.

### Checks run

| Check | Result |
|---|---|
| `astro check`, `eslint`, `nakama.check.mts` | 0 errors, clean, ok |
| Head tags vs the live Next pages (all 12) | identical. The only exception is the 404: it now also has og/twitter tags, and robots `noindex, follow` instead of `noindex` |
| sitemap.xml, robots.txt | byte-identical |
| JSON-LD | identical except `thumbnailUrl` (the still's new path) |
| Layout vs live, 1440 px and 500 px | every heading, paragraph, list item, table cell, image and link at the same position and size on home, all 7 guide pages, 404, login |
| Forms' server-rendered markup | identical to Next's (bar the shared `text-link` class) |
| Caddy (podman, the real Caddyfile) | pages 200 with br; `/docs/` → `/docs` 308; unknown paths 404 with the site's page; `/play` 200; cache headers as above; 304 on revalidation; `/api/stats` 200, POST 404 |
| `get_stats` cache | a deleted account is still counted for up to 30 s, then not |
| Header name and player chip | name shown from a stored session; chip shows "3 playing now ◆ 1.2K registered" with the green light for mocked counts |

