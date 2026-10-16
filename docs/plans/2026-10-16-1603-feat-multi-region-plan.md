---
title: Scrapyard on Gameye in three regions - Plan
type: feat
date: 2026-10-16
execution: code
---

# Scrapyard on Gameye in three regions - Plan

**Repo:** `scrapyard-nakama` (this repo), plus the public demo on the OVH box (`deploy/gameye-ovh/`). No Fleet Manager change is needed: v0.2.0 (in use since 057406f) already places a session by player latency.

## Goal

A player's match starts in the Gameye region nearest them: `eu-central-1`, `us-east-1` or `ap-southeast-1`. Players are only matched with players whose nearest region is the same, so nobody gets a match on another continent. If any part of this is missing or fails, the match still starts, in `eu-central-1`, as it does today.

**Stop conditions:**
- Stop and report if the sandbox's `trial` node pool has no capacity in `us-east-1` or `ap-southeast-1` (U1). The region list shows both, but nothing has ever run there for this application.
- Stop and report if a session started in a new region can't be reached through the relay (U1).

## What exists today

- The plugin calls `Create` with no latencies (`nakama/modules-src/match.go:232`), so Fleet Manager v0.2.0 falls back to `GAMEYE_API_REGION`.
- The Gameye application is created with `regions: [GAMEYE_REGION]` (`scripts/gameye-up.sh:196`), and the script waits for the tag in that one region.
- The page's ticket carries `mode` and `build` only (`game/src/net/gameye-queue.ts:95`).
- Sandbox regions (`GET /region`, 2026-10-16): eu-central-1, eu-west-1, us-east-1, us-east-2, us-west-1, us-west-2, ap-southeast-1, ap-southeast-2, ap-northeast-1, sa-east-1, me-central-1. `GET /available-location/scrapyard-nakama` lists eu-central-1 only, since the application covers only that region.

## Key decisions

**KTD1. Location from the relay Worker, signed.** Gameye's `/available-location` returns ICMP ping addresses, and a browser can't send ICMP. Instead, the relay Worker, which runs on Cloudflare, gets a `GET /geo` route. It returns a token signed with `RELAY_SECRET` in the existing `v1.` token format: `{"t":"geo","lat":<deg>,"lon":<deg>,"exp":<unix s>}`, using `request.cf.latitude`/`longitude`, valid for 10 minutes. The plugin already holds `RELAY_SECRET` and the token code (`tokens.go`), so it can verify the location without trusting the page. A player can't pull a match to their region by sending made-up numbers.
- Rejected: real round-trip times. These would need an HTTP endpoint in each region, and Gameye's nodes aren't where an AWS endpoint would be (eu-central-1 served us from OVH, 51.75.147.21).
- Rejected: GeoIP in the plugin. Nakama sits behind Caddy with no Cloudflare in front of it, and a GeoIP database needs a licence.

**KTD2. The plugin estimates latency per region and lets the Fleet Manager choose.** The plugin has one table: where each enabled region's servers are, measured in U1: eu-central-1 Frankfurt (OVH, 50.1155, 8.6842), us-east-1 Warrenton, Virginia (OVH, 38.7135, -77.7953), ap-southeast-1 Singapore (G-Core, 1.3371, 103.8946). Estimated round trip in ms = great-circle km / 86 + 33, a least-squares fit to U1's pings from Fort Worth (46, 144 and 206 ms; the fit is within 16 ms of each). Only the order between regions decides the match, not the exact number. For each matched player, the plugin turns the verified token into one `FleetUserLatencies` entry per region and passes them to `Create`. v0.2.0 then picks the region with the lowest worst-case latency. A player with a missing, expired or invalid token reports nothing, so `Create` falls back to `GAMEYE_API_REGION`, which is safe. Using v0.2.0's own rule keeps the reference game showing the feature customers would use.

**KTD3. Matching stays within a region.** The plugin answers a new RPC, `gameye_region` (payload `{"geo":<token>}`, reply `{"region":<id>}`), with the player's nearest enabled region. The page adds the string properties `region=<id>` and `geo=<token>` to its ticket, and `+properties.region:<id>` to its query. Players in different regions never share a match, and after 12 s alone they get bots (the solo RPC, unchanged), in their own region.
- Alternative, not chosen: a soft region preference plus a latency ceiling. It finds more human matches when traffic is thin, but it needs Nakama's reverse-query matching checked, and it can still produce ~200 ms matches. Revisit if the queues are too thin.

**KTD4. One region list, in config.** Plugin `runtime.env`: `GAMEYE_API_REGIONS` (comma list, optional; default is `GAMEYE_API_REGION` alone). `GAMEYE_API_REGION` stays required and is the fallback. `gameye-up.sh`: `GAMEYE_REGIONS` (default `GAMEYE_REGION`). It puts every region in the application and waits for the tag in each one. The plugin refuses to start if a listed region has no entry in its location table.

**KTD5. The match shows its region.** The plugin works out the region it expects, with the same minimax over its own estimates, and adds `region` to the `gameye_match` content. This changes the four-part contract, so AGENTS.md "Gameye matches" is updated first, then the plugin, the page, the relay (nothing to change there) and the game server (nothing to change there). The page shows "Server: Singapore" and so on on the match screen. If the expected region ever differs from the actual one, it is a display slip only: the session's address is still what the player connects to.

## U1 results (2026-10-16)

- The sandbox application `scrapyard-nakama` now lists eu-central-1, us-east-1 and ap-southeast-1 (PUT /application, Andrew's OK). The tag `sha-c3368e4d…` reached both new regions within 49 s. `/available-location` lists all three; it showed ap-southeast-1 only a few minutes after the tag arrived.
- In each region, one session started (TTL 5 min) and was stopped. A player reached the container through the relay Worker (local `wrangler dev`, the same code as the public relay) and got a welcome: eu-central-1 at 5.9 s, us-east-1 at 8.9 s, ap-southeast-1 at 7.5 s.
- Servers: eu-central-1 51.75.147.21 (OVH Frankfurt), us-east-1 51.81.48.94 (OVH Warrenton, VA), ap-southeast-1 91.243.81.45 (G-Core Singapore). Ping from Fort Worth (min / avg): 144 / 159, 46 / 48 and 206 / 210 ms.
- No warm pool is set: each probe session got its `SEAT_SECRET`, or the game server would not have welcomed the seat.
- The relay refuses a socket without an allowed `Origin` (403), so test clients must send the page's origin.

## Units

**U1. Prove the two regions (no code). Done 2026-10-16, see U1 results.** Add us-east-1 and ap-southeast-1 to the sandbox application, then wait for tag `sha-c3368e4d…` in each. Start one session per region with `session:start` (TTL 5 min), connect through the public relay with a hand-signed relay token, and stop the session. Record each region's ping addresses (`/available-location`) and where they sit, to set the KTD2 table. Calibrate the formula against `ping` from the Mac (Fort Worth) to each address. Turn off any warm pool in the new regions. This changes the shared sandbox application, so it needs Andrew's OK before it starts.

**U2. Relay `/geo` route** (`edge/worker.js` + tests): GET only, `cache-control: no-store`, CORS for the page's origins. Return 503 when Cloudflare has no coordinates; the page then queues with no region and gets eu-central-1.

**U3. Plugin: regions, estimates, RPC, latencies** (`nakama/modules-src/`): a `regions.go` with the table, the estimate and the nearest-region choice; `GAMEYE_API_REGIONS` parsing and validation; verifying `t:"geo"` tokens in `tokens.go`; the `gameye_region` RPC; latencies built in `matched` and in `soloMatch` (payload gains an optional `geo`); `region` in the `gameye_match` content. Tests: token checks (bad signature, expired, over-long, wrong `t`), the estimate per region, the region choice for mixed and missing tokens, the fallback with no latencies, and region names in the env that are listed twice or unknown.

**U4. Page** (`game/src/net/`): fetch `/geo` once per search, call `gameye_region`, add the ticket properties and query term, send `geo` with the solo RPC, and show the region from `gameye_match`. Region ids contain `-`, so the query term goes through the existing `term()` quoting, as the build id does. Any failure means no region: the plain query (`mode` + `build`), so the matchmaker and the page still work. Update `gameye-match.check.ts` and the queue tests.

**U5. Local and ops** (`scripts/gameye-up.sh`, `compose.gameye.yml`, `.env.gameye.example`, GAMEYE.md, `deploy/gameye-ovh/README.md`): `GAMEYE_REGIONS` across the application, the tag wait and the plugin env; document the limits (location by IP, the estimates are estimates, players are split by region).

**U6. Public demo:** rebuild Nakama on the box, add `GAMEYE_API_REGIONS=eu-central-1,us-east-1,ap-southeast-1` to `/etc/scrapyard/nakama.env`, rebuild the page from the same commit, and redeploy the relay. Smoke tests: one match per region, using a hand-made geo token for each city (signed on the box with `RELAY_SECRET`, never printed), plus a real browser match from the Mac, which should land in us-east-1.

## Verification

- `go test` (plugin), the relay tests, and `npx tsc -b` plus the page checks.
- Local Gameye mode: a match from each of the three faked locations lands in that region (session region read back with `GET /session/{id}`).
- Public: the U6 smoke tests; the existing match tests still pass with no geo token (eu-central-1).

## Costs and risks

- **Spend:** each match is still one 0.5 CPU session with a 30-minute TTL. Three regions don't change the cost per match, but there is still no spend cap (the known limit).
- **Thin queues:** splitting players by region means fewer human matches and more bot matches (KTD3).
- **Location by IP:** VPNs and mobile carriers can put a player on the wrong continent. That player then gets that region's latency, but is still matched consistently.
- **The trial pool may have no nodes in a new region:** U1 finds out before any code is written.

## Decided

- The location table follows where Gameye's servers are (U1), not the AWS region names.
- The public demo turns on all three regions at once (Andrew, 2026-10-16).
