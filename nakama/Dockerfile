# syntax=docker/dockerfile:1
# Nakama with Scrapyard's runtime baked in (KTD10): the Gameye plugin
# (modules-src/, built here in the plugin builder of the same Nakama release:
# a plugin built with any other won't load), the Lua modules and config.yml,
# all in /nakama/data. Run it without a bind mount on /nakama/data: a mount
# would hide them. Published as ghcr.io/<owner>/scrapyard-nakama-backend:
# sha-<commit> next to the game server image of the same commit.
#
# Build from the repo root (the plugin's Go modules, github.com/Gameye/
# nakama-fleetmanager v0.1.0 among them, are downloaded in the plugin stage):
#   docker build -f nakama/Dockerfile -t scrapyard-nakama-backend .
# (podman build takes the same flags.)
#
# At run time (docker-entrypoint.sh): NAKAMA_DATABASE_ADDRESS (required;
# migrations run first), the plugin's runtime.env keys as environment
# variables or in a second config file named by NAKAMA_CONFIG_EXTRA, and any
# further Nakama flags as the command.

ARG NAKAMA_VERSION=3.41.0

FROM docker.io/heroiclabs/nakama-pluginbuilder:${NAKAMA_VERSION} AS plugin
WORKDIR /build/scrapyard-nakama/nakama/modules-src
COPY nakama/modules-src/ ./
ENV CGO_ENABLED=1
# as modules-src/build.sh builds it
RUN go mod vendor && go build --trimpath --mod=vendor --buildmode=plugin -o /out/gameye.so .

FROM docker.io/heroiclabs/nakama:${NAKAMA_VERSION}
COPY nakama/data/config.yml /nakama/data/config.yml
COPY nakama/data/modules/*.lua /nakama/data/modules/
COPY --from=plugin /out/gameye.so /nakama/data/modules/gameye.so
COPY --chmod=755 nakama/docker-entrypoint.sh /usr/local/bin/scrapyard-nakama
# gRPC, the client API and socket, the console
EXPOSE 7349 7350 7351
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 CMD ["/nakama/nakama", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/scrapyard-nakama"]
