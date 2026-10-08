# syntax=docker/dockerfile:1
# The game server as Gameye runs it: one match per container
# (game/server/gameye-main.ts), for the players the Nakama plugin matched
# into the session. Published as ghcr.io/<owner>/scrapyard-nakama:sha-<commit>
# by .github/workflows/release.yml; the page built from the same commit
# carries the same build id (game/build-id.ts), so only that page gets a seat.
#   docker build --platform linux/amd64 -t scrapyard-nakama .
# The image holds no secret: Gameye sets GAMEYE_SESSION_ID, the plugin
# SEAT_SECRET, per session (root AGENTS.md, Contracts).

FROM node:24-alpine AS build
WORKDIR /build/game
COPY game/package.json game/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY game/ ./
# the bundle main.js and gameye-main.js run, without the bundled self-checks and the load tool
RUN npm run server:build && rm -f dist-server/*.check.js dist-server/load.js

FROM node:24-alpine
# The pages that may connect. The relay passes the page's own Origin on, so
# this is the play site's origin, and localhost for a developer's own page
# (scripts/gameye-up.sh). Seats still take a seat token for this session.
ARG ALLOWED_ORIGINS=https://scrapyard.gameye.com,http://localhost:*,http://127.0.0.1:*
WORKDIR /app
# TRUST_PROXY: always behind the relay (each player's address from
# CF-Connecting-IP), and strict: pages from Vite's dev server are refused.
ENV NODE_ENV=production PORT=7360 TRUST_PROXY=1 ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
# root-owned: the server only reads its bundle
COPY --from=build /build/game/dist-server/ ./dist-server/
COPY LICENSE ./
USER node
EXPOSE 7360/tcp
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
ENTRYPOINT ["node", "dist-server/gameye-main.js"]
