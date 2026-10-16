# Public Gameye demo: Nakama on a shared Ubuntu host

How https://scrapyard.gameye.com runs. Quick play only: every match is its own
Gameye sandbox session (the game server image, `GAMEYE_API_IMAGE_VERSION`), in
the player's nearest of eu-central-1, us-east-1 and ap-southeast-1;
this host runs Nakama with the Gameye plugin, its own Postgres, and the static
play page. The relay is the Worker in [`edge/`](../../edge/wrangler.jsonc), at
`scrapyard-relay.gameye.com` on the Gameye Cloudflare account.

| Name | Points at | Serves |
|---|---|---|
| `scrapyard.gameye.com` | the host (A record, DNS only) | the page, a Gameye-mode build of `game/` |
| `scrapyard-api.gameye.com` | the host (A record, DNS only) | Nakama's API and socket (127.0.0.1:7350) |
| `scrapyard-relay.gameye.com` | Worker custom domain | the relay |

The host is shared with the gameye-rooms matchmaker, which owns its Caddy:
`/etc/caddy/Caddyfile` imports `/etc/caddy/sites.d/*.caddy` (rooms-matchmaker
provision.sh keeps that directory). Reload Caddy, never restart it (a restart
drops the matchmaker's WebSockets). Postgres here is a container of its own,
apart from the matchmaker's cluster and its backups.

## Files

| File | Goes to |
|---|---|
| `scrapyard.network`, `scrapyard-postgres.container`, `scrapyard-nakama.container` | `/etc/containers/systemd/` (Podman Quadlet: `systemctl daemon-reload` makes the services) |
| `scrapyard.caddy` | `/etc/caddy/sites.d/` |

Secrets live only on the host, root-only (0600), never in this repository:

- `/etc/scrapyard/postgres.env`: `POSTGRES_DB`, `POSTGRES_PASSWORD`
- `/etc/scrapyard/nakama.env`: `NAKAMA_DATABASE_ADDRESS` (Postgres at its fixed
  address, `10.89.0.10:5432`), Nakama's own keys (`NAKAMA_SERVER_KEY`,
  `NAKAMA_ENCRYPTION_KEY`, `NAKAMA_REFRESH_ENCRYPTION_KEY`, console user,
  password and signing key, `NAKAMA_HTTP_KEY`), `RELAY_SECRET`, `RELAY_URL`,
  and the plugin's `GAMEYE_API_*` keys (GAMEYE.md, The plugin's runtime.env),
  `GAMEYE_API_REGIONS=eu-central-1,us-east-1,ap-southeast-1` among them.

The network has DNS off and Postgres a fixed address because the host's ufw
drops containers' queries to Podman's resolver on the bridge; with DNS off
the containers use the host's upstream resolvers.

## Update

Nakama (plugin or Lua changed): on the host,

```sh
cd /opt/scrapyard/src && sudo git fetch -q && sudo git checkout -q <commit>
sudo podman build -f nakama/Dockerfile -t localhost/scrapyard-nakama-backend:sha-<short> .
# set Image= in /etc/containers/systemd/scrapyard-nakama.container to the new tag
sudo systemctl daemon-reload && sudo systemctl restart scrapyard-nakama
```

The page (from a checkout whose `game/` builds the same id as the game server
image in `GAMEYE_API_IMAGE_VERSION`; otherwise the server says "Game updated"):

```sh
cd game && VITE_MATCHMAKER=gameye VITE_NAKAMA_HOST=scrapyard-api.gameye.com \
  VITE_NAKAMA_PORT=443 VITE_NAKAMA_SSL=true VITE_NAKAMA_KEY=<NAKAMA_SERVER_KEY> \
  VITE_GAMEYE_RELAY=https://scrapyard-relay.gameye.com \
  npx vite build --outDir /tmp/scrapyard-site --emptyOutDir
# copy /tmp/scrapyard-site to /srv/scrapyard/site on the host (readable by caddy)
```

`NAKAMA_SERVER_KEY` is the client key: it ships in the page by design.

A new game server image: push it, register the tag in Gameye (it must exist in
every region in `GAMEYE_API_REGIONS`: `scripts/gameye-up.sh` with
`GAMEYE_REGIONS` waits for all of them), set
`GAMEYE_API_IMAGE_VERSION` in `nakama.env`, restart Nakama, and rebuild the
page from the same commit.
