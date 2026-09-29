#!/bin/sh
# On the server: dump Nakama's database to backups/, keep the newest 14.
# Nightly from cron:  0 3 * * * ~/scrapyard/scripts/backup.sh
# Restore (from repo root): gunzip -c <file> | podman compose -f "$(pwd)/deploy/compose.yml" exec -T postgres psql -U postgres nakama
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/nakama-$(date +%Y%m%d-%H%M%S).sql.gz"
# -f needs an absolute path: podman-compose mis-resolves a relative one and fails with FileNotFoundError
podman compose -f "$(pwd)/deploy/compose.yml" exec -T postgres pg_dump -U postgres nakama | gzip > "$file"
ls -1t backups/nakama-*.sql.gz | tail -n +15 | xargs -r rm --
echo "$file"
