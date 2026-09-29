# BBMV

<p align="center">
  <img src=".github/assets/gameplay.gif" width="480" alt="Scrapyard gameplay: a war rig with a roof minigun fighting through the streets of The City in Team Deathmatch" />
</p>

**Scrapyard** — multiplayer car combat in the browser. Armoured cars, a roof minigun or a rocket
pod, team deathmatch and free for all in a walled scrapyard or a burning city: practice against
bots, or online matches found by matchmaking.

- **Game** (`game/`): React + Three.js + Rapier, TypeScript, Vite. The same simulation runs in
  the browser and on the authoritative game server (`game/server/`, Node + WebSocket), with
  client prediction, interpolation and lag-compensated hits.
- **Accounts** (`nakama/`): [Nakama](https://heroiclabs.com/nakama/) on Postgres, run with
  Podman — email accounts and guests.
- **Site** (`www/`): Astro, static — home page, the guide, log in / register / account; serves
  the game at `/play`.
- **Server** (`deploy/`): Caddy, the game server, Nakama and Postgres in one compose file.

## Run it locally

Needs Node 24+ and Podman (with `podman compose`).

```sh
(cd game && npm ci) && (cd www && npm ci)
cp game/.env.example game/.env.local
cp www/.env.example www/.env
scripts/run.sh
```

`scripts/run.sh` starts Nakama (Podman), the game server on `:7360`, the game's dev server on
`:3000` and the site on `:8000`. The site serves the last game build at `/play`: run
`scripts/build.sh` once to make one. Ctrl-C stops the three servers; `cd nakama && podman
compose down` stops Nakama.

The `.env.example` files point at the local Nakama with its default keys; those are fine
locally and refused by the deploy.

## Checks

```sh
cd game && npm run lint && npm run build && npm run check   # check: simulation, rules, bots, protocol, a real server over sockets
cd www && npm run lint && npm run check && npm run build
node scripts/nakama-smoke.mjs                              # against the running Nakama
```

CI (`.github/workflows/ci.yml`) runs the same on every pull request.

## Deploy

`.github/workflows/deploy.yml` builds and rolls a staging server after CI passes on `main`,
with no stored credentials (GitHub OIDC → GCP Workload Identity Federation → OS Login over
IAP). Its header lists the repository variables and secrets it needs; the server keeps its own
settings in `deploy/.env` (`deploy/.env.example`).

## License

MIT — see `LICENSE`.
