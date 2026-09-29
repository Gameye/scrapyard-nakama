# Changelog

Changes to the repository: the game server, accounts, the site, deploy and tooling. What
players see in each game version is in the game's own patch notes,
`game/src/screens/PatchNotesPanel.tsx` (shown on the main menu); a version here names the game
version it shipped with.

## Unreleased

## 0.10.0 — 2026-09-29

First public commit. Earlier history (0.1.0–0.9.0) was developed in a private repository and
is summarized here.

### Game (`game/`)

- React + Three.js + Rapier client: two arenas (the Scrapyard, the City), Team Deathmatch and
  Free for All, the garage loadout (Minigun or Rocket Pod), bots at three difficulties with
  cover, ambushes and stuck recovery, HUD, scoreboard, results, settings, patch notes.
- One simulation for practice and online: deterministic from the match seed, runs headless.
- Self-checks under plain node (`npm run check`): bots, both modes' rules, the simulation,
  loading, the wire protocol, matchmaking.

### Online play (`game/server/`)

- Authoritative game server (Node + `ws`): runs every online match with the client's own
  simulation, modes and bots; validates every input and owns every outcome.
- Client prediction and reconciliation for the local car, interpolation for the others,
  hitscan rewound on the server up to 200 ms.
- Classic matchmaking: tickets per mode, groups as the oldest waits (8, then 4+, then 2+), a
  ready check, a room per match, backfill into bots' seats; searches survive a reload or a
  dropped connection.
- The door: allowed origins, Nakama-signed sessions checked by the server, size and rate
  limits, a build id in the hello (pages of another build are refused), pages that stop
  reading are dropped.
- Bundled checks (`npm run server:check`): the arenas' digests, a real server over real
  sockets, headless pages through `net/`, netplay at 50–150 ms each way and over a rough link.

### Accounts (`nakama/`)

- Nakama 3.30.0 on Postgres 16, run with Podman: email accounts and device guests, sessions
  of 2 h with 30-day refresh tokens.
- `stats.lua`: the online count (`join_online` over the game's socket) and `get_stats` for the
  site.
- `scripts/nakama-smoke.mjs`: sign-in, account, refresh, socket, match, logout against a
  running Nakama.

### Site (`www/`)

- Astro 7, static: home page with live player counts and a gameplay video, the guide (MDX),
  log in / register / account (React islands on Nakama); serves the game at `/play`.
- SEO: per-page title, description and canonical link; sitemap, robots, social cards.

### Deploy and CI

- `deploy/`: Caddy (TLS, security headers, the site, `/match` to the game server,
  `/api/stats` to Nakama), the game server, Nakama and Postgres in one compose file; secrets
  in the server's `deploy/.env`.
- `scripts/deploy.sh`: switches the site's release, and the game server's with it; rolls back
  both; refuses Nakama's default keys. `scripts/backup.sh` dumps Nakama's database nightly
  (cron), keeping the newest 14.
- CI on every pull request and push to `main`: lint, build and checks for `game/` and `www/`.
- Deploy after CI passes on `main`, with no stored credentials: GitHub OIDC → GCP Workload
  Identity Federation → OS Login over IAP, a pinned host key; smoke tests of the site, Nakama
  and an online match afterwards. Deploy identifiers are secrets, so public logs mask them.

### Repository

- MIT license, security policy, README.
- Agent instructions in `AGENTS.md` files (each `CLAUDE.md` imports its own), design notes and
  logs in `.claude/work/`, a SQL guide for Nakama's database in `.claude/codes/sql/`.
