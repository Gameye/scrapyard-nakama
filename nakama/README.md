# Scrapyard - Game Server

Nakama 3.30.0 on Postgres 16, run with Podman (podman-compose). The site (`www/`) and the game (`game/`) sign in against it from the browser; see `.claude/work/www/WWW_IMPLEMENTATION_PLAN.md`.

## Local

```sh
podman compose up -d           # from nakama/
node ../scripts/nakama-smoke.mjs
```

- API and realtime socket: `http://127.0.0.1:7350` (server key `defaultkey`)
- Console: `http://127.0.0.1:7351` (admin / password)
- gRPC: `:7349`, Postgres: `:5432` (clashes with any other Postgres on that port)
- Stop: `podman compose down` (the database volume stays; `down -v` wipes it)

The smoke test signs in a guest and an email account, reads and updates the account, refreshes the session, opens the realtime socket, creates a match and joins the online count, logs out, then deletes both accounts. It exits 1 on the first failure.

## Configuration

`data/config.yml`: session token 2 h, refresh token 30 days. Images in `compose.yml` are fully qualified (`docker.io/...`): Podman won't resolve short names without a prompt.

Nakama warns at boot about its insecure defaults (console user, password and signing key, server key, session encryption keys, runtime HTTP key). They are fine here; a server passes its own through `deploy/compose.yml` from `deploy/.env`.

Go modules: source in `modules-src/`, built with `heroiclabs/nakama-pluginbuilder:3.30.0`; only the `.so` goes into `data/modules/`.

Lua modules load from `data/modules/` as they are. `stats.lua`: `join_online`, which the game calls over its socket so it counts as online until the socket closes, and `get_stats` (email accounts, players online) for the site's footer, called with the runtime HTTP key (`defaulthttpkey` here).
