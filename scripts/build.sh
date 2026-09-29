#!/bin/sh
# Build the game for the /play path, drop it into the site, build the site;
# and the game server (game/dist-server: one directory, run with plain node).
# www/dist is then the whole public site: static files, with .br and .gz
# copies next to the text ones. The server's Caddy serves it (deploy/Caddyfile).
# Dependencies must be installed first (npm ci in game/ and www/; CI does it).
# Nakama addresses come from game/.env* and www/.env*, or the environment
# (see the .env.example files).
set -eu
cd "$(dirname "$0")/.."

(cd game && npm run build -- --base=/play/)
(cd game && npm run server:build)
rm -rf www/public/play
cp -R game/dist www/public/play
(cd www && npm run build)
node scripts/precompress.mjs www/dist
echo "built: www/dist, game/dist-server"
