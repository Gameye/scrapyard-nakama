#!/bin/sh
# Local development: Nakama (Podman), the game server on :7360 (online
# matches), the game's dev server on :3000 and the site's on :8000. The site
# serves the last game build at /play (scripts/build.sh) and passes /match on
# to the game server; the game's own dev server is for working on the game.
# Ctrl-C stops the three servers; Nakama keeps running (cd nakama && podman
# compose down to stop it).
set -eu
cd "$(dirname "$0")/.."
(cd nakama && podman compose up -d)
trap 'kill 0' INT TERM
(cd game && npm run server) &
(cd game && npm run dev) &
(cd www && npm run dev) &
wait
