#!/bin/sh
# Builds the Gameye plugin into nakama/data/modules/gameye.so with the plugin
# builder of the Nakama release that loads it (a plugin built with any other
# version won't load). Docker or Podman: CONTAINER=podman to choose.
#
# Until github.com/Gameye/nakama-fleetmanager v0.1.0 is published, go.mod
# points at a checkout beside this repo; FLEETMANAGER_DIR to use another one.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
fleetmanager=$(cd "${FLEETMANAGER_DIR:-$repo/../nakama-fleetmanager}" && pwd)
nakama_version=3.41.0
container=${CONTAINER:-$(command -v podman >/dev/null 2>&1 && echo podman || echo docker)}

# The replace in go.mod is ../../../nakama-fleetmanager: mount both checkouts
# side by side so it resolves inside the builder too.
"$container" run --rm \
  -v "$repo:/build/scrapyard-nakama" \
  -v "$fleetmanager:/build/nakama-fleetmanager:ro" \
  -w /build/scrapyard-nakama/nakama/modules-src \
  -e CGO_ENABLED=1 \
  --entrypoint sh \
  "docker.io/heroiclabs/nakama-pluginbuilder:$nakama_version" \
  -ec 'go mod vendor && go build --trimpath --mod=vendor --buildmode=plugin -o ../data/modules/gameye.so . && rm -rf vendor'

echo "built nakama/data/modules/gameye.so for Nakama $nakama_version"
