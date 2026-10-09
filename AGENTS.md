<!-- BEGIN:global-rules -->

# Scrapyard

## Project

**Scrapyard** — browser-based multiplayer 3D vehicular-combat game. Long-term vision: arcade vehicles, guns/missiles/rockets/mines, destructible vehicles, ramps/buildings/hazards, pickups, AI opponents, 4-8+ online players.

**Current scope is a vertical slice only.** MVP target: 1 procedural arena, 2 procedural vehicles, arcade movement + physics/collision, 1 machine gun, 1 rocket weapon, hit detection, HP/damage/destruction/respawn, basic HUD, online matches (Classic or Custom lobbies) on the game server (players signed in through Nakama), chat in those matches (Nakama's realtime chat: everyone, team, whispers). Two browser windows join the same match, drive, shoot, damage/destroy each other, respawn.

Do NOT build payments, stores, inventory, progression, subscriptions, admin systems, or other business/backend features in this phase. Accounts stop at Nakama sign-in: register, log in, log out, guests (device auth, deleted 3 days after they're made), username and display name, password change, account delete (`www/`). Online matches are kept on the game server for fair-play review (a record per match, a replay per room, `MATCH_DIR`); sending them to Nakama (match history, leaderboards) waits for the next phase. Nakama is the control plane, never the gameplay: `.claude/work/nakama-mm/PLAN.md`.

## Repo layout

```
game/     React + Vite + TypeScript client (menus, garage + loadout, mode + arena select, matches — team deathmatch, free for all — on Rapier physics: practice vs bots, Classic online (matchmaking), or Custom lobbies)
          game/server: the authoritative game server (Node, the client's own simulation and modes; match records, fair-play signals and replays; bundled by vite.server.config.ts into game/dist-server/, gitignored)
nakama/   Nakama 3.41 compose setup (postgres + heroiclabs/nakama image), run with Podman; Lua modules: stats.lua (online count, site stats), guests.lua (guests deleted 3 days after they're made, nightly from scripts/backup.sh), chat.lua (the match chat's rules); Go plugin in modules-src/ (Gameye matches: fleet manager, matchmaker hook, gameye_solo_match), built into data/modules/gameye.so by modules-src/build.sh
www/      Astro 7 static site (dev on :8000): landing, the guide (MDX), log in / register / account on Nakama (React islands); serves the game build at /play. Plan and log: .claude/work/www/
deploy/   the server: compose.yml (Caddy + game server + Nakama + Postgres; the game server's match records and replays on a named volume), Caddyfile (the static site from site/current, /match -> the game server, /api/stats -> Nakama), .env.example
scripts/  build.sh (game for /play -> www/public/play -> www/dist, precompressed by precompress.mjs; the game server -> game/dist-server), run.sh (local), deploy.sh (server: switch the site's release, and the game server's when its bundle isn't the one running or with --server — rollbacks too; refuses Nakama's default session key, or a refresh key equal to it) + backup.sh (nightly on the server: Nakama's database and the match records into backups/, then the guests older than 3 days deleted), nakama-smoke.mjs, match-smoke.mjs, chat-smoke.mjs (the match chat's rules on a running Nakama), guests-smoke.mjs (the guest cleanup; local only: it backdates its accounts with psql); arena-parity.mjs + browser-match.mjs (headless Chromium through the globally installed Playwright — not a dependency, not in CI: the arenas' digests in a browser; two pages in one online match)
Gameye:   Dockerfile (the game server image: gameye-main, one match per container) and nakama/Dockerfile (Nakama with the plugin, the Lua modules and config.yml baked in), published with the site bundle from one commit as sha-<commit> by .github/workflows/release.yml (ci.yml's checks first); compose.gameye.yml + scripts/gameye-up.sh (Gameye mode on a developer's machine with their own token, .env.gameye.example: sets up their Gameye application and tag, Nakama, the relay and the page; --dry-run prints the API calls and commands; upstream's GCP deploy.yml is off here)
```

No monorepo tooling. `game/`, `www/` and `nakama/` are independent; the root package.json only holds the Gameye relay (`edge/`) and its tests.

## Instruction files and guides

Rules live in the `AGENTS.md` files; each `CLAUDE.md` only imports the `AGENTS.md` beside it. Put a rule in the narrowest `AGENTS.md` that covers every place it applies, never in a `CLAUDE.md`.

Read a folder's `AGENTS.md` before working on its files. Before writing in a language, read its guide's `README.md` in `.claude/codes/`, then the guide files that README lists for the task.

| Working in | Read | Guides in `.claude/codes/` |
|---|---|---|
| `game/` (client `src/`, server `server/`) | `game/AGENTS.md` | `ts/` for `.ts`, `.tsx`; `tw/` for class names and `game/src/index.css` |
| `www/` | `www/AGENTS.md` | `ts/` for `.ts`, `.tsx`, `.mts`, `.astro`; `tw/` for class names and `www/src/styles/*.css` |
| `nakama/` | `nakama/AGENTS.md` | `sql/` for SQL in `nakama/data/modules/*.lua` |
| `deploy/`, `scripts/`, `.github/` | this file | none |

`ts/` and `tw/` are generic. Where a project's `AGENTS.md` departs from a guide, the project wins. They are pulled from `aasumitro/workspace` and gitignored: if one is missing, say so, follow the project rules, and don't recreate it. `sql/` is written for this repo and tracked in git.

## Dev servers

**Never run `npm run dev` / start a Vite dev server.** The game already runs live at `:3000` — assume it's always up. Use `npx tsc -b` (in `game/`) to typecheck and existing browser tabs against `:3000` to verify changes.

The site's dev server on `:8000` is usually up too (`/api/stats` proxied to Nakama); `scripts/build.sh` puts the game build into `www/public/play` (gitignored) so `/play` works there.

## Contracts between projects

- One contract joins site and game: the Nakama session in localStorage `scrapyard.session` = `{ token, refresh_token, guest? }` (same origin once the game is at /play), written by `www/src/lib/nakama/` (`storage.ts` the key, `stored.ts` the format) and `game/src/net/session.ts` — change both together.
- The cookie banner's answer joins them too: localStorage `scrapyard.consent` = `'granted' | 'denied'`, written only by the site's banner (`www/src/lib/consent.ts`), read by `game/src/analytics.ts` (Google Analytics loads only on `'granted'`; the game never asks) — change both together.
- Nakama is who the player is: accounts, guests, sessions (the game server checks its session tokens itself, with Nakama's key), the online count and the site's stats, and the match chat.
- The match chat joins game server, game and Nakama: the game server names each room's and team's chat channel (`sy-` and 24 hex digits, `game/server/room.ts`) and tells only that room's (team's) seats in the welcome; the page joins them (`game/src/net/chat.ts`); `nakama/data/modules/chat.lua` lets rooms in only by that pattern and holds the message rules (200 characters, 8 in 10 s) that the page's `CHAT_LIMIT` repeats — change them together.
- Every fact in the site's home copy and guide comes from the game's code (configs, registries, patch notes): change the game first, then the copy.
- Nakama address at build time: `PUBLIC_NAKAMA_*` (www) and `VITE_NAKAMA_*` (game), see the `.env.example` files.
- Gameye matches join four parts: the Nakama plugin (`nakama/modules-src/`, the reference for every format here: `tokens.go`, `match.go`), the page, the relay (`edge/`) and the game server in its Gameye container. This entry is the only place these formats are written down; change them here first, then in all four.
  - **Queue:** the page's matchmaker ticket carries the string properties `mode=gameye` and `build=<the page's build id>` and the query `+properties.mode:gameye +properties.build:<that id>` (2–8 players: only pages of one build share a match); the plugin's `MatchmakerMatched` hook takes only matches whose every ticket has it and leaves the rest to Nakama. After 12 s alone the page removes its ticket and calls the RPC `gameye_solo_match` with no payload (a fresh call), which answers `{"status":"starting"}`: a session is on its way for this player, or a new one starts now (an earlier match is never handed back; the player's stored one is dropped). When the page's socket comes back mid-search after that call and its persistent list has no match, it calls the RPC again with the payload `{"resume":true}`, which answers `{"status":"starting"}` (on its way, or nothing held: a new session starts) or `{"status":"matched","match":<the gameye_match content>}`, once, while the caller's tokens are good. The plugin's matchmaker hook puts no player in a second session: one whose session is on its way or whose tokens are still good is left out of the match (and a match left with nobody starts nothing). Each match is one Gameye session; its id is the `sid` below.
  - **`gameye_match`** (notification code 7300, persistent): `{ host, port, session_id, relay_url, relay_token, seat_token, exp }`, one per player, `seat_token` that player's own. The page opens `<relay_url>/match?token=<relay_token>` (retrying while the container comes up) and sends `seat_token` in its hello as `seat`. `host` and `port` are for logs: the relay takes the address from the relay token only, never from the page. After a socket reconnect the page lists its persistent `gameye_match` notifications, skips those past `exp`, and deletes the one it uses.
  - **`gameye_failed`** (code 7301, not persistent): `{ reason }`, one of `timeout` (no session within 20 s), `no_capacity` (Gameye 420, after two retries), `quota_exceeded` (402), `misconfigured` (401, 403, 404: token, scope, application, tag or region), `unavailable` (5xx, after two retries), `error` (anything else, including a session its players couldn't be told about, which is stopped). The page shows it and offers to try again.
  - **The match's end:** one match per session. After its results the game server tells every page `{"t":"err","code":"closing","text":"The match is over"}` and closes with the protocol's closing code (4006; other ends say why in their own words: `ENDINGS` in `game/server/gameye-server.ts`). A page whose link ends once the match's result is in keeps the results up (`game/src/game/linkEnd.ts`; Classic too), and a Gameye build's results offer Play again (a new search) and Exit; a link that ends before the result is Connection lost.
  - **Tokens:** `v1.<payload>.<signature>`. `payload` is unpadded base64url of a JSON object; `signature` is unpadded base64url of HMAC-SHA256 over the ASCII text `v1.<payload>`, keyed with the secret string's UTF-8 bytes as they are (not decoded). Relay token, signed with `RELAY_SECRET`: `{"t":"relay","sid":<session id>,"host":<IPv4>,"port":<host port>,"exp":<unix s>}`. Seat token, signed with the match's `SEAT_SECRET`: `{"t":"seat","sid":<session id>,"uid":<Nakama user id>,"exp":<unix s>}`. `exp` is issue + 120 s; a token is good while now ≤ `exp`. A verifier refuses tokens over 1024 characters, compares signatures in constant time, and checks `t`; the game server also checks `sid` against its `GAMEYE_SESSION_ID`.
  - **Secrets and env:** `RELAY_SECRET` (at least 32 bytes) is the only secret the plugin (Nakama `runtime.env`) and the relay (a Worker secret) share. `SEAT_SECRET` is new for each match, 32 random bytes as base64url, and reaches only that match's container, as env. Gameye itself sets `GAMEYE_SESSION_ID` (and `GAMEYE_HOST`) in every container. No container gets `RELAY_SECRET` or any Nakama key; the relay never gets a seat secret. Neither secrets nor tokens are ever logged. The plugin's other `runtime.env` keys: `nakama/AGENTS.md`.

## Engineering principles

1. Avoid unnecessary dependencies, premature abstraction, and premature optimization.
2. Small cohesive modules, strict TypeScript.

The game's own principles: `game/AGENTS.md`.

## Development order (do not implement all at once)

React app -> Three.js scene -> procedural arena -> procedural vehicle -> Rapier physics -> vehicle movement -> third-person camera -> weapons -> combat -> HP/destruction/respawn -> Nakama connection -> two-player match -> authoritative multiplayer -> prediction/reconciliation -> interpolation -> polish. (Done up to interpolation and lag compensation: `.claude/work/net/NET_LOG.md`.)

<!-- END:global-rules -->
