#!/bin/sh
# On the server, from anywhere: switch the site to a release and keep the rest up.
# CI uploads each build: the site to site/incoming/, the game server's bundle to
# server/incoming/. A new release keeps both as hard-linked snapshots,
# site/releases/<name>/ and server/releases/<name>/ (unchanged files take no
# space). site/current (what Caddy serves) points at the site's; the switch is
# one rename: no restarts, no request sees half a site.
# server/current points at the release the game server runs. Its container
# reads it when it starts, so switching it takes a restart (live online matches
# drop). It's switched with --server, on the first deploy, and whenever the
# release's bundle isn't the one running, so a page never meets a game server
# of another build (it would be told to reload, again and again).
#   --nakama  Nakama (with the Postgres it depends on) restarts too and re-reads nakama/data (live matches drop)
#   --server  the game server switches to this release and restarts, even with the same bundle
#   --all     every service is recreated: deploy/compose.yml or the Caddyfile changed
# Rollback: run it again with an earlier release (ls ~/scrapyard/site/releases).
# The game server goes back with it when that release's bundle differs from the
# one running; the output says so. A release no game server was kept for (one
# older than this rule) leaves the game server as it is, with a warning, and
# refuses --server: server/incoming holds the newest upload, not that release.
#   scripts/deploy.sh <release> [--nakama] [--server] [--all]     (CI names releases by commit)
set -eu
cd "$(dirname "$0")/.."
release=${1:?usage: deploy.sh <release> [--nakama] [--server] [--all]}
shift
nakama=
server=
all=
for flag in "$@"; do
  case $flag in
    --nakama) nakama=1 ;;
    --server) server=1 ;;
    --all) all=1 ;;
    *) echo "deploy.sh: unknown flag $flag" >&2 && exit 2 ;;
  esac
done

# Keeps $1/incoming (site or server) as release $release.
keep() {
  [ -d "$1/incoming" ] || { echo "deploy.sh: no $1/releases/$release and nothing in $1/incoming" >&2; exit 2; }
  mkdir -p "$1/releases"
  cp -al "$1/incoming" "$1/releases/$release" # hard links: unchanged files take no space
  touch "$1/releases/$release" # -a kept incoming's time: this is the newest release, whether or not it's switched to
  echo "$1: release $release, from $1/incoming"
}

# Points $1/current at release $release.
point() {
  touch "$1/releases/$release" # the newest, so the pruning below keeps it
  ln -sfn "releases/$release" "$1/current.next"
  mv -T "$1/current.next" "$1/current"
}

# The game server takes Nakama's session tokens as they are, signed with NAKAMA_ENCRYPTION_KEY. Nakama's
# refresh tokens carry the same claims, so with the refresh key the same as that one a 30-day refresh
# token would pass for a session; and Nakama's default key lets anyone sign one. Nothing rolls with either.
[ -f deploy/.env ] || { echo "deploy.sh: no deploy/.env" >&2; exit 2; }
setting() { sed -n "s/^$1=//p" deploy/.env | tail -n 1 | sed "s/^[\"']//; s/[\"']\$//"; }
session_key=$(setting NAKAMA_ENCRYPTION_KEY)
if [ -z "$session_key" ] || [ "$session_key" = defaultencryptionkey ]; then
  echo "deploy.sh: NAKAMA_ENCRYPTION_KEY in deploy/.env is unset or Nakama's default" >&2
  exit 2
fi
if [ "$session_key" = "$(setting NAKAMA_REFRESH_ENCRYPTION_KEY)" ]; then
  echo "deploy.sh: NAKAMA_REFRESH_ENCRYPTION_KEY must differ from NAKAMA_ENCRYPTION_KEY in deploy/.env" >&2
  exit 2
fi

# A release not kept yet is new: CI has just uploaded it to site/incoming and server/incoming.
# One kept from before is a rollback, and server/incoming holds the newest upload, not that release.
if [ -d "site/releases/$release" ]; then new=; else new=1; fi
if [ -n "$server" ] && [ ! -d "server/releases/$release" ] && { [ -z "$new" ] || [ ! -d server/incoming ]; }; then
  echo "deploy.sh: --server, but no game server was kept for release $release, and server/incoming isn't it" >&2
  exit 2
fi

if [ -n "$new" ]; then keep site; else echo "site: back to release $release"; fi
point site
if [ -n "$new" ] && [ -d server/incoming ]; then keep server; fi

# The game server: switched to this release, and restarted below, with --server, on the first
# deploy, or when this release's bundle isn't the one running.
running=$(readlink server/current 2>/dev/null || true) # releases/<name>
if [ -d "server/releases/$release" ]; then
  if [ -n "$server" ] || [ -z "$running" ]; then
    server=1
  elif ! diff -rq "server/releases/$release" "server/$running" >/dev/null 2>&1; then
    echo "server: release $release's game server isn't the one running ($running): switching to it and restarting it (live online matches drop)"
    server=1
  else
    echo "server: release $release's game server is the one running ($running): left as it is"
  fi
  if [ -n "$server" ]; then
    point server
    echo "server: now runs release $release"
  fi
elif [ -n "$running" ]; then
  echo "deploy.sh: no game server was kept for release $release: it stays on $running, and pages of release $release will be told to reload" >&2
fi

cd deploy
if [ -n "$all" ]; then
  # --remove-orphans: containers of services the compose file no longer has go too
  podman compose up -d --force-recreate --remove-orphans
else
  if [ -n "$nakama" ]; then podman compose up -d --no-deps --force-recreate nakama; fi
  if [ -n "$server" ]; then podman compose up -d --no-deps --force-recreate game; fi
  podman compose start # whatever is stopped (a reboot, a crash) comes back as it was; `up` would recreate it all
fi
podman compose ps

# keep the five newest releases of each for rollback, and whichever one current points at; images no container uses go
for kept in site server; do
  [ -d "../$kept/releases" ] || continue
  running=$(readlink "../$kept/current" 2>/dev/null || true)
  ls -1dt "../$kept/releases"/*/ | tail -n +6 | while read -r old; do
    [ "${old%/}" = "../$kept/$running" ] || rm -rf -- "$old"
  done
done
podman image prune -af >/dev/null 2>&1 || true
