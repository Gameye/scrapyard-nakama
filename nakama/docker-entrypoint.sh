#!/bin/sh
# The Nakama image's entrypoint (nakama/Dockerfile): migrations, then Nakama
# on the baked config.yml, with the database and the Gameye plugin's
# runtime.env from the environment.
#   NAKAMA_DATABASE_ADDRESS  required: user:password@host:port/database
#   NAKAMA_CONFIG_EXTRA      optional: a second config file (a mounted secret), read after
#                            config.yml; it may hold runtime.env and the server's keys
#   GAMEYE_API_TOKEN, GAMEYE_API_IMAGE, GAMEYE_API_IMAGE_VERSION, GAMEYE_API_REGION,
#   RELAY_SECRET, RELAY_URL, and optionally GAMEYE_API_URL, GAMEYE_API_TTL,
#   GAMEYE_API_PORT: each one set is passed as --runtime.env (nakama/AGENTS.md)
# Any arguments are further Nakama flags (the server's keys, for example).
# Values are never printed. The flags are visible to processes inside this
# container; on a shared host prefer NAKAMA_CONFIG_EXTRA.
set -eu

db=${NAKAMA_DATABASE_ADDRESS:?set NAKAMA_DATABASE_ADDRESS, e.g. postgres:password@postgres:5432/nakama}

/nakama/nakama migrate up --database.address "$db"

for key in GAMEYE_API_URL GAMEYE_API_TOKEN GAMEYE_API_IMAGE GAMEYE_API_IMAGE_VERSION GAMEYE_API_REGION GAMEYE_API_TTL GAMEYE_API_PORT RELAY_SECRET RELAY_URL; do
  eval "value=\${$key:-}"
  if [ -n "$value" ]; then set -- --runtime.env "$key=$value" "$@"; fi
done
set -- --database.address "$db" "$@"
if [ -n "${NAKAMA_CONFIG_EXTRA:-}" ]; then set -- --config "$NAKAMA_CONFIG_EXTRA" "$@"; fi
exec /nakama/nakama --config /nakama/data/config.yml "$@"
