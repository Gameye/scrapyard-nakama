# Web site, accounts and /play — implementation plan

Scope: turn `www/` (a fresh Next.js scaffold) into the game's public site:
a landing page, docs/wiki, login / register / logout, account management and
a Play button. It also covers serving the game's Vite build at `/play`, with
the player already signed in. Nakama is the only account system: the site and
the game both sign in against it. A testing/staging server runs only Nakama
(+ Postgres) and Next.js. Out of scope: multiplayer netcode (its own plan, per
the development order in CLAUDE.md), password reset and email verification
(these need a Go module and a mail provider), and payments, stores, inventory,
progression and admin tools.

Status: built and checked locally (27 Sept 2026); see WWW_IMPLEMENTATION_LOG.md.
D4 was taken as recommended (guests). Still open: git init, the first push,
and a first real run of CI and deploy (§9).

Build order: 0 → 1 → 2 → 5 → 3 → 4 → 6 → 7 → 8 → 9. The step numbers follow
the original request; 3 and 4 need 5 first.

## 0. Where things stand (verified 27 Sept 2026)

| Piece | State |
|---|---|
| `nakama/` | Podman 6.1.2 + podman-compose 1.6.0: `cd nakama && podman compose up -d`. Postgres 16 + Nakama 3.30.0, both `healthy`; `GET :7350/healthcheck` → `{}`, console on `:7351` (admin / password). Images are fully qualified in `compose.yml` (`docker.io/...`): Podman won't resolve short names without an interactive prompt. Ports: 5432 Postgres (clashes with any other local Postgres on that port), 7349 gRPC, 7350 HTTP API + socket, 7351 console. |
| Sessions | Session token 2 h (`token_expiry_sec: 7200`). Refresh token 30 days (`refresh_token_expiry_sec: 2592000`, added). Without it the default refresh token lasts 1 h, less than the token itself, so every login died after 2 h. |
| Smoke test | `node scripts/nakama-smoke.mjs` covers guest sign-in, register, wrong password refused, account update + read, login + refresh, socket + `match_create`, logout revokes, and cleanup. It passes, and exits 1 on the first failure (checked with a wrong server key). `NAKAMA_URL` / `NAKAMA_SERVER_KEY` point it at a server. |
| Insecure defaults | Nakama warns at boot about `console.username`, `console.password`, `console.signing_key`, `socket.server_key`, `session.encryption_key`, `session.refresh_encryption_key` and `runtime.http_key`. Fine locally; replace them all on any server (§9). |
| `www/` | create-next-app scaffold: Next 16.3.6, React 19.2.8, Tailwind 4, App Router, `npm run dev` on :8000. "Hello World" page, Geist fonts, `public/logo.png` (1536×1024), `public/logo1.png` (1983×793). Next 16 is not the Next.js of older docs: read `www/node_modules/next/dist/docs/` before writing code (`middleware` is now `proxy`, request APIs are async, Turbopack is the default). |
| `game/` | `npm run build` ≈ 3 s (warm), `dist/` 5.3 MB (one JS chunk, CSS, `bg/`, `maps/`). Absolute public paths in code: `loading.ts:63`, `Loading.tsx:58`, `maps.ts:18-19`. Main menu Exit has no action. No Nakama code. |
| Repo | Not a git repo yet. `.github/workflows/{ci,ds,gp}.yml`, `scripts/{build,run,deploy,backup}.sh`, `Makefile`, `README.md`, `CHANGELOG.md` and `.gitignore` are empty stubs or intent comments. |

### Nakama behaviour the forms rely on (measured against the local server)

| Call | Result |
|---|---|
| register: `authenticateEmail(email, pw, create=true, username)`, new email | 200, `created: true` |
| register, email exists + right password | 200, `created` absent (false): a silent login |
| register, email exists + wrong password | 401 `Invalid credentials.` |
| register, username taken | 409 `Username is already in use.` |
| register, password under 8 characters | 400 `Password must be at least 8 characters long.` |
| register, malformed email | 400 `Invalid email address format.` |
| login: `authenticateEmail(..., create=false)`, unknown email | 404 `User account not found.` |
| login, wrong password | 401 `Invalid credentials.` |
| `updateAccount` with a taken username | **400** `Username is already in use.` (not 409) |
| `sessionRefresh` after a username change | the new token carries the new username (`usn` claim) |
| `linkEmail` with the same email + a new password | 200: the password changes (the old one → 401). This is "change password". |
| `deleteAccount` (`DELETE /v2/account`) | 200; a client call, no server RPC needed |
| `sessionLogout(session, token, refresh)` | 200; that refresh token is revoked (401 afterwards) |
| CORS | `Access-Control-Allow-Origin: *`, allows `Authorization, Content-Type`: browsers can call Nakama directly |

`@heroiclabs/nakama-js` 2.8.0 (latest) has all of these: `new Client(serverkey, host, port, useSSL, timeout, autoRefreshSession)`, `authenticateEmail`, `authenticateDevice`, `getAccount`, `updateAccount`, `linkEmail`, `sessionRefresh`, `sessionLogout`, `deleteAccount`, `Session.restore(token, refreshToken)`, `session.isexpired(t)`.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Nakama is the only account system.** Email + password through `authenticateEmail`; guests through `authenticateDevice`. No second user database, no Next auth library. | The game needs a Nakama session for the realtime socket anyway; one identity, nothing to sync. |
| D2 | **Browsers talk to Nakama directly** with `@heroiclabs/nakama-js` 2.8.0, in www and in the game. No Next API routes in between. | The server key is public by design (it ships in every client), and Nakama allows cross-origin calls. A proxy would add a hop and hide nothing. |
| D3 | **One session, shared through `localStorage`.** Key `scrapyard.session` = `{ token, refresh_token, guest? }`, next to the game's `scrapyard.settings`. The site and the game share it because `/play` is on the same origin. | If the Next server read cookies, those pages would render per request instead of being static, and the game needs the token in JavaScript for the socket either way. Consequence: the Next server never knows who is signed in, so anything that depends on it (the header's account menu, the `/account` guard) is a client component. |
| D4 | **Guests** (OPEN, recommended): `/play` without a session signs in as a guest (device ID in `scrapyard.device`, `guest: true` in the session). Play needs no form. Register creates a fresh email account; moving a guest onto it (`linkEmail`) waits until guests own something worth keeping (stats, progression: out of scope). | Instant play from the landing page, and the two-player MVP test needs no sign-up. Alternative: `/play` sends signed-out players to `/login?next=/play`. |
| D5 | **Where Nakama lives:** locally `127.0.0.1:7350` (http/ws); on servers its own subdomain with TLS (`api.<domain>`, port 443, wss). | An https page can't open `ws://`. nakama-js takes a host, port and SSL flag but no path prefix, so Nakama can't sit under a path of the site's own origin. |
| D6 | **Config at build time:** `NEXT_PUBLIC_NAKAMA_HOST/PORT/SSL/KEY` (www), `VITE_NAKAMA_HOST/PORT/SSL/KEY` (game); one build per environment. `.env.example` committed in both, `.env.local` ignored. | Both frameworks inline these at build time. Upgrade path: a runtime `/config.json` once one image must serve both staging and prod. |
| D7 | **The game stays its own Vite app**, built with `--base=/play/` and copied into `www/public/play/` (gitignored). It is not turned into a Next page. | Folding it into Next would mix two build systems and gain nothing. The game's React only drives menus; the render loop stays outside React either way. |
| D8 | **Docs/wiki are MDX files in the repo** (`@next/mdx`), one route per page under `app/docs/`. No CMS, and no search until there are ~15 pages. | Edited with the code and reviewed in pull requests; static pages. |
| D9 | **The look is the game's:** dark only, Fraunces (display) + Manrope (sans) through `next/font/google`, the game's palette (`#f2ece0` text, `#12161f` panels, red-500 accents), and the menu's diamond + red bar for navigation. | Site and game read as one product. |
| D10 | **Scope change.** Root CLAUDE.md says no accounts in this phase. This plan brings in login, register, logout, profile and delete; still no payments, stores, inventory, progression or admin. | Step 0 writes this into CLAUDE.md. |

## 2. Site map

```text
/                     Home (landing)                  static
/docs                 Docs index                      static (MDX)
/docs/how-to-play     join, drive, shoot, wreck, respawn
/docs/controls        every key (from the game's Settings → Controls)
/docs/modes           Team Deathmatch, Free for All
/docs/arenas          Scrapyard, The City
/docs/garage          vehicles and weapons
/docs/faq             browser support, guests vs accounts, what is stored
/login                Login                           static shell, client form
/register             Register                        static shell, client form
/account              Account                         static shell, client-guarded
/play                 the game (public/play)          static files via a rewrite
```

Logout is an action in the header's account menu, not a page.

## 3. `www/` layout

```text
www/
  app/
    layout.tsx               fonts, metadata, <SiteHeader/>, <SiteFooter/>, dark theme
    page.tsx                 Home
    not-found.tsx
    (auth)/layout.tsx        route group: centred card over the backdrop
    (auth)/login/page.tsx
    (auth)/register/page.tsx
    account/page.tsx
    docs/layout.tsx          sidebar (one const list = nav order) + prose column + prev/next
    docs/page.mdx
    docs/<topic>/page.mdx
    icon.svg, opengraph-image.jpg
  components/
    SiteHeader.tsx           server: logo, nav (Docs, Play), <AccountSlot/>
    AccountSlot.tsx          client: Login / Register, or name menu (Account, Logout)
    PlayLink.tsx             a plain <a href="/play">, not next/link: /play is not an app route
    forms/                   client forms: Login, Register, Profile, Password, DeleteAccount
  lib/nakama.ts              the only place www touches Nakama (step 5)
  lib/nakama.check.ts        node assert check for the pure parts (error text, refresh rule)
  mdx-components.tsx         required by @next/mdx with the App Router
  next.config.ts             output standalone, MDX page extensions, /play rewrite + headers
  public/play/               the game build (gitignored)
  public/images/             hero and arena art copied from game/public (never linked into /play)
  .env.example
```

## 4. Steps

### Step 0: housekeeping

1. `git init`, first commit, push to GitHub (CI needs a repo).
2. Root `.gitignore`: `node_modules/`, `dist/`, `.next/`, `www/public/play/`, `.env*` with `!.env.example`, `.DS_Store`.
3. CLAUDE.md: repo layout (`www/`, `scripts/`), the scope change (D10), www commands (`npm run dev` on :8000, `npm run build`, `npm run lint`), the session contract (D3), Podman for Nakama.
4. `nakama/README.md`: `podman compose up -d`, `node ../scripts/nakama-smoke.mjs`, console login, a port clash with any other local Postgres on :5432.
5. `Makefile` is empty: delete it, or add targets that call `scripts/*`. The scripts are enough.

Done when `git status` is clean and CLAUDE.md describes the repo as it is.

### Step 1: Home (the landing page)

Route `/`, fully static: nothing on it reads the session on the server.

1. **Header** (every page): logo → `/`; nav: Docs, Play; right: `AccountSlot`. While the session is unknown (SSR, hydration), `AccountSlot` shows a fixed-width placeholder so the header doesn't jump. Signed out: Log in / Register. Signed in: the name (display name, else username; "Guest" for guests) opening a menu with Account and Log out.
2. **Hero**: logo, "Scrapyard — Car Battle", a one-line pitch, primary **Play** (`/play`), secondary **How to play** (`/docs/how-to-play`). Backdrop: the menu art copied from `game/public/bg/menu.jpg` to `public/images/`, with the game's left-to-right dark gradient for contrast.
3. **Modes**: Team Deathmatch (4 vs 4, 10 min, most wrecks wins, overtime) and Free for All (8 machines, 10 min, pickups, hot zones). Numbers from `game/src/game/{tdm,ffa}/config.ts`, with the source file named in a comment.
4. **Arenas**: Scrapyard and The City, with previews copied from `game/public/maps/`.
5. **Controls at a glance**: W A S D, mouse aim, LMB fire, Space handbrake, Tab scoreboard (from `SettingsPanel.tsx` `CONTROLS`).
6. **Closing call to action**: Play, and Create account for signed-out visitors.
7. **Footer**: version, © line.
8. **Metadata**: title "Scrapyard — Car Battle", description, `app/opengraph-image.jpg`, `app/icon.svg` (the game's favicon).

Done when `next build` lists `/` as static (○); it works at 360 px wide with no horizontal scroll; Play lands in the game; the header doesn't shift on load.

### Step 2: Docs / wiki

1. `npm i @next/mdx @mdx-js/loader @mdx-js/react @types/mdx`; wrap the config in `createMDX()`, `pageExtensions: ['ts', 'tsx', 'md', 'mdx']`. Under Turbopack (the default in 16), remark/rehype plugins can only be named by string; none are needed at first.
2. `mdx-components.tsx` at the www root (required): styles for h1–h3, p, a, lists, tables, code and kbd. No typography plugin; about 20 lines of classes.
3. `app/docs/layout.tsx`: sidebar from one `const` list `{ href, title }[]` (nav order in one place), current page highlighted, prev/next at the bottom.
4. Pages, as listed in §2. Content comes from the game: rules from `ffa/`, `tdm/` configs and docs in `.claude/work/{ffa,tdm}/`, controls from `SettingsPanel.tsx`, vehicles from `vehicle/vehicles.ts`, weapons from `combat.ts`. FAQ covers browser support (WebGL + WebAssembly, hardware acceleration), guest vs account, and what is stored (email, username, display name).

ponytail: the numbers are copied by hand, and each page names its source file; generate them from the configs if they start to drift.

Done when every docs route is static, the sidebar marks the current page, and an unknown `/docs/x` gives the 404 page.

### Step 5: connect to Nakama (`www/lib/nakama.ts`)

Imported only by client components (it also evaluates during SSR: the `Client` constructor touches no browser API; storage is read only inside functions).

```ts
export const nakama = new Client(KEY, HOST, PORT, SSL)        // NEXT_PUBLIC_NAKAMA_* (D6)
export async function getSession(): Promise<Session | null>   // restore from storage; refresh when < 5 min are left
                                                              // and save; null (and storage cleared) when missing or the refresh fails
export function saveSession(session: Session, guest = false)  // write scrapyard.session, then dispatch 'scrapyard:session'
export function clearSession()                                // remove it, dispatch 'scrapyard:session'
export function useSession(): Session | null | undefined      // useSyncExternalStore; undefined during SSR/hydration
export async function errorText(e: unknown): Promise<string>  // Nakama error → a sentence for forms (table in §0)
```

- `useSyncExternalStore`: subscribe to `storage` (other tabs) and `scrapyard:session` (this tab). The snapshot is the raw stored string (a primitive, so it stays stable between renders); parse it with `Session.restore` in `useMemo`. The server snapshot is `undefined`.
- Every storage read and write is wrapped in try/catch (private windows can throw). Failing storage behaves as signed out; it never crashes.
- nakama-js rejects with the fetch `Response`: `errorText` reads `status` and `(await res.json()).message`; a network failure → "Can't reach the game server."
- Actions call `getSession()` right before a Nakama call; UI that only shows the name reads `useSession()` (the name is in the token: `session.username`).
- `lib/nakama.check.ts` runs under plain node like the game's checks: the error texts for each row of §0, and the refresh rule (refresh when fewer than 5 minutes are left, never after the refresh token expired).
- `.env.local`: `NEXT_PUBLIC_NAKAMA_HOST=127.0.0.1`, `NEXT_PUBLIC_NAKAMA_PORT=7350`, `NEXT_PUBLIC_NAKAMA_SSL=false`, `NEXT_PUBLIC_NAKAMA_KEY=defaultkey`.

ponytail: the game keeps its own copy of the session code (step 6); both files name the other and the contract (D3). Extract a shared package if a third client appears.

Done when the check passes; from :8000 a session written by a sign-in survives a reload, refreshes when forced near expiry, and a sign-out in one tab signs out the other.

### Step 3: auth (login, register, logout)

Both forms: labels, `aria-describedby` errors, the submit button disabled while pending, a show-password toggle, errors inline under the field they concern. `?next=` is honoured only when it starts with `/` and not `//` (no open redirect); the default is `/`.

**Register** (`/register`)

1. Fields: username (3–20 characters: letters, digits, underscore), email, password (8 or more). `autocomplete`: `username`, `email`, `new-password`.
2. The username rule is ours and checked in the browser only; Nakama doesn't enforce it (a Go `BeforeAuthenticateEmail` hook will, later).
3. Submit: `authenticateEmail(email, password, true, username)`.
4. Outcomes:
   - `created: true` → `saveSession`, go to `next`.
   - `created` false → the email already had an account and the password matched: sign in anyway and say so ("You already had an account — you're signed in").
   - 401 → "This email is already registered. Log in instead." (on create, 401 only happens for an existing email).
   - 409 → "That username is taken." (on the username field).
   - 400 → Nakama's message (password length, email format).
5. A guest session in storage is simply replaced (D4); the guest account stays behind unused.

**Login** (`/login`)

1. Email + password, `autocomplete` `email` / `current-password`; `authenticateEmail(email, password, false)`.
2. 401 and 404 → one message: "Wrong email or password." (don't reveal which emails exist).
3. A visitor who is already signed in (not a guest) goes straight to `next` or `/account`.

**Logout** (header menu)

`sessionLogout(session, token, refresh_token)`, then `clearSession()` and go to `/`. If the call fails (offline, already expired), clear locally anyway.

Done when every row of §0's table gives the intended message; password managers offer to save; the whole flow works with the keyboard only; a reload keeps the session; logging out in one tab updates the other.

### Step 4: account management (`/account`)

Guard (client): `useSession()` undefined → skeleton; null → `router.replace('/login?next=/account')`; guest → a card: "Playing as a guest — create an account" (Register / Log in).

Data: `getAccount(session)`: username, display name, email, created date.

1. **Profile**: username + display name → `updateAccount({ username, display_name })`. 400 "Username is already in use." → field error. After a username change, `sessionRefresh` + `saveSession`: the new token carries the new name (measured), so the header and the game show it.
2. **Password**: current + new (8 or more). Check the current one with `authenticateEmail(email, current, false)` (401 → "Current password is wrong"), then `linkEmail(session, { email, password: new })`, which sets the new password (measured). Other signed-in devices stay signed in; say so under the button.
3. **Delete account**: type the username to confirm → `deleteAccount(session)` → `clearSession()` → `/`.
4. Not in this step: changing email (it needs verification to be safe), avatar upload, password reset (§10).

Done when each action reports success or failure inline; after deletion, logging in gives "Wrong email or password"; a username change shows up in the header without a reload.

### Step 6: game changes (`game/`)

1. **Base path**: `npm run build -- --base=/play/` in `scripts/build.sh` (npm appends it to `vite build`); the dev server at :3000 stays at `/`. The four absolute public paths (`loading.ts:63`, `Loading.tsx:58`, `maps.ts:18-19`) become `import.meta.env.BASE_URL + 'bg/menu.jpg'` and so on. Vite already rewrites `index.html`'s favicon.
2. **Session**: add `@heroiclabs/nakama-js` 2.8.0 and `src/net/session.ts`, the same contract as www (D3) with `VITE_NAKAMA_*` (D6). Restore → refresh if near expiry → save. Without a session: guest `authenticateDevice` with the ID from `scrapyard.device` (created once with `crypto.randomUUID()`) (D4), or go to `/login?next=/play` if D4 is declined.
3. **Not a STARTUP task.** Practice against bots needs no server, and `loading.ts` stops the menu at the first failed task. Sign in once the main menu shows (first use, as `loading.ts` intends for everything outside STARTUP); the menu shows "Signed in as <name>", "Guest", or "Offline". Online play (later) requires a session and says so.
4. **Main menu**: the name next to the version chip, with a link to `/account` (signed in) or `/register` (guest). Exit → `location.assign('/')` (the site; in standalone dev it just reloads the game).
5. **Two tabs share one session** (D3): for two-player tests, use an incognito window or a second browser profile.
6. Not here: match join, inputs, snapshots: that is the multiplayer plan.

Done when `npm run check`, `npx tsc -b` and `npm run lint` pass; at :3000 the game signs in as a guest (the user appears in the Nakama console); with Nakama stopped, practice still starts and the menu says Offline.

### Step 7: the game at `/play`

1. `scripts/build.sh`:

   ```sh
   set -eu
   cd "$(dirname "$0")/.."
   (cd game && npm ci && npm run build -- --base=/play/)
   rm -rf www/public/play && cp -R game/dist www/public/play
   (cd www && npm ci && npm run build)
   ```

2. `www/next.config.ts` (next to the MDX settings):

   ```ts
   output: 'standalone',
   async rewrites() {
     return [{ source: '/play', destination: '/play/index.html' }]
   },
   async headers() {
     return [{ source: '/play/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
   },
   ```

   - Next serves `public/` files, but not a folder's `index.html`: hence the rewrite (array-form rewrites run after the filesystem check). `/play/` redirects to `/play` (`trailingSlash` is false), then rewrites.
   - `public/` files default to `Cache-Control: public, max-age=0`. The game's hashed files under `/play/assets/` can be cached for good; `bg/` and `maps/` aren't hashed and keep the default.
   - A standalone build doesn't copy `public/` or `.next/static`; the image build does (§9).
3. Every link into the game is a plain `<a href="/play">`: a full page load.

Done when `curl -sI localhost:8000/play` gives 200 `text/html`; `/play/assets/index-*.js` gives 200 with the immutable header; `/play/bg/menu.jpg` gives 200; the game runs at `/play` with no 404s in the console.

### Step 8: everything connected (local, end to end)

1. `cd nakama && podman compose up -d && node ../scripts/nakama-smoke.mjs`
2. `scripts/build.sh`
3. `cd www && cp -R public .next/standalone/ && cp -R .next/static .next/standalone/.next/ && PORT=8000 node .next/standalone/server.js`

Then, in a normal window:

- [ ] Home loads; the header offers Log in / Register.
- [ ] Register → the header shows the name; `/account` shows the account.
- [ ] Play → the game at `/play` shows the same name without a second sign-in; the Nakama console lists that user's session.
- [ ] Exit → home, still signed in.
- [ ] Change the display name on `/account` → the game's menu shows it after a reload.
- [ ] Log out → the header offers Log in; `/play` plays as a guest (or redirects to login, per D4).
- [ ] An incognito window at `/play` gets a different guest.
- [ ] Nakama stopped → site pages still render, forms say "Can't reach the game server", practice still plays.

Record the run (date, what failed, what was fixed) in `WWW_IMPLEMENTATION_LOG.md`.

### Step 9: server and pipeline

**Server** (testing/staging): Podman + podman-compose, one `deploy/compose.yml`:

```text
caddy     publishes 80/443       <domain> → www:3000, api.<domain> → nakama:7350 (HTTP + WebSocket)
www       ghcr.io/<owner>/scrapyard-www:<sha>, internal :3000
nakama    docker.io/heroiclabs/nakama:3.30.0 + nakama/data/config.yml; secrets as flags from the server's .env
postgres  no published port; named volume; nightly pg_dump (scripts/backup.sh)
```

- Console 7351 bound to `127.0.0.1` (reach it through an SSH tunnel); gRPC 7349 and Postgres not published.
- Caddy gets certificates by itself once DNS points at the server; a bare IP needs `tls internal` or an sslip.io name.
- Rootless Podman can't bind 80/443 unless `net.ipv4.ip_unprivileged_port_start=80` is set.
- Secrets live in the server's `.env` and in GitHub secrets, never in the repo: `NAKAMA_SERVER_KEY`, the session and refresh encryption keys, console user/password/signing key, runtime HTTP key, Postgres password. The server key is also baked into both client builds (D2, D6), so it must not be `defaultkey` there.

**Pipeline.** The proposed flow was: game changed (or both) → test, build game, copy into `www/public/play`, build Next, push the source to the server, run; only www changed → test, build Next, push. Its shape is right: the server runs only Nakama + Next, and the game ships inside Next. Three changes:

1. **One path; always build both.** `www/public/play` is build output (gitignored), so a www-only build has no game in it and its deploy would drop `/play`. The game builds in seconds, so splitting saves nothing. If path filters are wanted, use them only to skip the game's checks.
2. **Ship an image, not source.** CI builds one image (the game built with `--base=/play/` into `www/public/play`, then `next build` standalone), tags it with the commit SHA and pushes it to GHCR. The server only pulls and restarts: no `npm install` or build on the server, the same bytes on every server, rollback = the previous tag.
3. **Nakama deploys on its own path filter**: only when `nakama/` changes (`config.yml` now; Go modules later, built with `heroiclabs/nakama-pluginbuilder:3.30.0`). Restarting Nakama drops live sockets and matches; don't do it on every www change.

```text
ci.yml   pull_request + push
         game: npm ci · npm run lint · npx tsc -b · npm run check   (Node 24+: the checks run .ts directly)
         www:  npm ci · npm run lint · npm run build                (next build typechecks)
ds.yml   push to main → staging (tags v* → prod, later)
         image: game (VITE_NAKAMA_* = staging) → www/public/play → next build (NEXT_PUBLIC_NAKAMA_* = staging) → ghcr.io/…:<sha>
         deploy: ssh → podman compose pull www && podman compose up -d www
         nakama/ changed → sync nakama/data → podman compose up -d nakama
         smoke: curl -f https://<domain>/ and /play; NAKAMA_URL=https://api.<domain> node scripts/nakama-smoke.mjs
gp.yml   drop: GitHub Pages can't run Next's server or Nakama
```

Image (`www/Containerfile`, built from the repo root):

```dockerfile
FROM node:24-alpine AS build
WORKDIR /src
COPY game/package*.json game/
COPY www/package*.json www/
RUN cd game && npm ci && cd ../www && npm ci
COPY game game
COPY www www
ARG VITE_NAKAMA_HOST VITE_NAKAMA_PORT VITE_NAKAMA_SSL VITE_NAKAMA_KEY
ARG NEXT_PUBLIC_NAKAMA_HOST NEXT_PUBLIC_NAKAMA_PORT NEXT_PUBLIC_NAKAMA_SSL NEXT_PUBLIC_NAKAMA_KEY
RUN cd game && npm run build -- --base=/play/ && rm -rf ../www/public/play && cp -R dist ../www/public/play
RUN cd www && npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/www/.next/standalone ./
COPY --from=build /src/www/.next/static ./.next/static
COPY --from=build /src/www/public ./public
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

Scripts: `build.sh` (step 7); `run.sh` (local: `podman compose up -d` in `nakama/`, game dev on :3000, www dev on :8000); `deploy.sh` (on the server: pull, up, smoke); `backup.sh` (`podman exec` Postgres `pg_dump | gzip` into dated files, keep the last N).

Done when a merge to main puts the new image on staging, the smoke steps pass, and rolling back to the previous tag works.

## 10. Later (not in this plan)

- Password reset and email verification: Go module RPCs (`nakama/modules-src/`, pluginbuilder) plus a mail provider.
- A server-side username rule: Go `BeforeAuthenticateEmail` / `BeforeUpdateAccount` hooks.
- Moving a guest onto a new account (`linkEmail`) once guests own stats or progression.
- Google / Steam / Discord sign-in (Nakama built-ins).
- Multiplayer: match join, inputs, snapshots and an authoritative match handler (the base of anti-cheat: the server decides hits and damage, per CLAUDE.md). This gets its own plan.
- Runtime config (`/config.json`) for build once, deploy many.
- Docs search; a changelog page fed from one source shared with the game's patch notes (root `CHANGELOG.md`).

## 11. Checklist

- [x] 0 housekeeping: .gitignore, CLAUDE.md, nakama README (git init: the owner's call, not done)
- [x] 1 Home
- [x] 2 Docs / wiki
- [x] 5 `lib/nakama.ts` + check
- [x] 3 Login, register, logout
- [x] 4 Account
- [x] 6 Game: base path, session, menu name, Exit
- [x] 7 `/play` inside Next
- [x] 8 End to end, logged
- [ ] 9 Server compose, image, ci.yml, ds.yml written; the image built and ran locally. Not yet run on GitHub or a server.
