<!-- BEGIN:agent-rules -->

# nakama/ — accounts and sessions

Nakama 3.30.0 on Postgres 16 (`nakama/`, run with Podman):
- `podman compose up -d` — starts postgres + nakama (console on `:7351` admin/password, client API + socket on `:7350`, gRPC `:7349`, Postgres `:5432`); images are fully qualified (`docker.io/...`) because Podman won't resolve short names without a prompt
- `node scripts/nakama-smoke.mjs` (from the repo root) — smoke test against the running Nakama: guest + email sign-in, account, refresh, socket + match, logout; deletes what it creates; `NAKAMA_URL` / `NAKAMA_CLIENT_KEY` for a server
- Sessions: token 2 h, refresh token 30 days (`data/config.yml`)
- Runtime modules: Lua loads from `data/modules/` as is (`stats.lua`: `join_online`, `get_stats`). Go source goes in `modules-src/`, built with `heroiclabs/nakama-pluginbuilder:3.30.0` (the runtime image's version); only the built `.so` goes into `data/modules/`.

More (ports, `stats.lua`, the boot warnings): `README.md`.

## Database

Every table is Nakama's own, created and upgraded by `nakama migrate up` (the container's first step in `compose.yml`): this repo has no schema, migrations or `.sql` files. Read Nakama's tables with SQL; change them only through the `nk` API. The only query today is the cached, read-only count in `data/modules/stats.lua`. How to write one: `.claude/codes/sql/`.

<!-- END:agent-rules -->
