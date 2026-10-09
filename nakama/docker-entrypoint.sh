#!/bin/sh
# The Nakama image's entrypoint (nakama/Dockerfile): migrations, then Nakama
# on the baked config.yml, with the database, the server's keys and the
# Gameye plugin's runtime.env from the environment.
#   NAKAMA_DATABASE_ADDRESS  required: user:password@host:port/database
#   NAKAMA_ENCRYPTION_KEY, NAKAMA_REFRESH_ENCRYPTION_KEY
#                            required: the session and refresh token keys, not
#                            Nakama's defaults and not equal to each other
#   NAKAMA_SERVER_KEY, NAKAMA_CONSOLE_USERNAME, NAKAMA_CONSOLE_PASSWORD,
#   NAKAMA_CONSOLE_SIGNING_KEY, NAKAMA_HTTP_KEY
#                            the client key, the console's login and signing
#                            key, the runtime HTTP key: each one set is passed on
#                            (deploy/compose.yml passes the same flags)
#   NAKAMA_CONFIG_EXTRA      optional: a second config file (a mounted secret), read after
#                            config.yml; it may hold runtime.env and the server's keys,
#                            and then the session keys aren't required here
#   SCRAPYARD_DEV_DEFAULT_KEYS=1
#                            local development only (compose.gameye.yml): start on
#                            Nakama's default keys
#   GAMEYE_API_TOKEN, GAMEYE_API_IMAGE, GAMEYE_API_IMAGE_VERSION, GAMEYE_API_REGION,
#   RELAY_SECRET, RELAY_URL, and optionally GAMEYE_API_URL, GAMEYE_API_TTL,
#   GAMEYE_API_PORT: each one set is passed as --runtime.env (nakama/AGENTS.md)
# Any arguments are further Nakama flags.
# Values are never printed. The flags are visible to processes inside this
# container; on a shared host prefer NAKAMA_CONFIG_EXTRA.
set -eu

refuse() {
  echo "scrapyard-nakama: $1" >&2
  echo "scrapyard-nakama: set NAKAMA_ENCRYPTION_KEY and NAKAMA_REFRESH_ENCRYPTION_KEY, or NAKAMA_CONFIG_EXTRA; SCRAPYARD_DEV_DEFAULT_KEYS=1 only on your own machine" >&2
  exit 2
}

# The game server takes Nakama's session tokens as they are: with Nakama's default key anyone can sign
# one, and with the refresh key equal to the session key a 30-day refresh token passes for a session
# (scripts/deploy.sh refuses the same).
if [ -z "${NAKAMA_CONFIG_EXTRA:-}" ] && [ "${SCRAPYARD_DEV_DEFAULT_KEYS:-}" != 1 ]; then
  session_key=${NAKAMA_ENCRYPTION_KEY:-}
  refresh_key=${NAKAMA_REFRESH_ENCRYPTION_KEY:-}
  if [ -z "$session_key" ] || [ "$session_key" = defaultencryptionkey ]; then
    refuse "NAKAMA_ENCRYPTION_KEY is unset or Nakama's default"
  fi
  if [ -z "$refresh_key" ] || [ "$refresh_key" = defaultrefreshencryptionkey ]; then
    refuse "NAKAMA_REFRESH_ENCRYPTION_KEY is unset or Nakama's default"
  fi
  if [ "$session_key" = "$refresh_key" ]; then
    refuse "NAKAMA_REFRESH_ENCRYPTION_KEY must differ from NAKAMA_ENCRYPTION_KEY"
  fi
fi

db=${NAKAMA_DATABASE_ADDRESS:?set NAKAMA_DATABASE_ADDRESS, e.g. postgres:password@postgres:5432/nakama}

/nakama/nakama migrate up --database.address "$db"

for key in GAMEYE_API_URL GAMEYE_API_TOKEN GAMEYE_API_IMAGE GAMEYE_API_IMAGE_VERSION GAMEYE_API_REGION GAMEYE_API_TTL GAMEYE_API_PORT RELAY_SECRET RELAY_URL; do
  eval "value=\${$key:-}"
  if [ -n "$value" ]; then set -- --runtime.env "$key=$value" "$@"; fi
done
for pair in \
  NAKAMA_SERVER_KEY:socket.server_key \
  NAKAMA_ENCRYPTION_KEY:session.encryption_key \
  NAKAMA_REFRESH_ENCRYPTION_KEY:session.refresh_encryption_key \
  NAKAMA_CONSOLE_USERNAME:console.username \
  NAKAMA_CONSOLE_PASSWORD:console.password \
  NAKAMA_CONSOLE_SIGNING_KEY:console.signing_key \
  NAKAMA_HTTP_KEY:runtime.http_key; do
  key=${pair%%:*}
  eval "value=\${$key:-}"
  if [ -n "$value" ]; then set -- "--${pair#*:}" "$value" "$@"; fi
done
set -- --database.address "$db" "$@"
if [ -n "${NAKAMA_CONFIG_EXTRA:-}" ]; then set -- --config "$NAKAMA_CONFIG_EXTRA" "$@"; fi
exec /nakama/nakama --config /nakama/data/config.yml "$@"
