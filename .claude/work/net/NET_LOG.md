# Online play — log

What was done, phase by phase, why, what deviated, and the numbers. The
design is `NET_PLAN.md`; the owner's steps are `NET_RUNBOOK.md`.

Every phase is done. The final report is the last section.

| Phase | Commit | State |
|---|---|---|
| 0 Audit | Plan online play | done |
| 1 Arenas headless | Build the arenas headless for the game server | done |
| 2 Protocol and server | Run matches on an authoritative game server | done |
| 3 Browser online | Play online matches against the game server | done |
| 4 Prediction | Predict the local car and reconcile it with the server | done |
| 5 Interpolation, lag compensation | Interpolate other machines and lag-compensate hitscan | done |
| 6 Deployment | Deploy the game server next to Nakama | done |
| 7 Docs, copy | Document online play; Say online play is here on the site | done |

---

## Phase 0 — audit

Read the files in the prompt's §2, plus `input.ts`, `feed.ts`, `scoring.ts`,
`hud/Hud.tsx`, `screens/*`, `nakama/`, `deploy/`, `scripts/` and the workflows.
Wrote `NET_PLAN.md`.

The baseline on a fresh `npm ci` in `game/`: `tsc -b` clean, `lint` 0 errors
(one existing warning in `Drawer.tsx`), and all six checks pass:

- `router ok`
- `bots ok (21 checks)`
- `ffa ok (143)`
- `tdm ok (163)`
- `simulation ok (28)`
- `loading ok (23)`

A throwaway spike, kept in the session scratchpad and not committed, bundled
the arena builders with `vite build --ssr`, a canvas shim and the library's
bake skipped. Measured on this container (Intel Xeon 2.1 GHz, 4 vCPU,
Node 22.22.2):

| Arena | Build | Colliders | Spawns | Bases | Zones | Nav nodes |
|---|---|---|---|---|---|---|
| Scrapyard | 1204 ms | 503 box, 309 cylinder, 1 hull | 16 | 4 + 4 | 9 | 60 |
| City | 1356 ms | 371 box, 241 cylinder | 16 | 4 + 4 | 11 | 72 |

Step time, 8 Normal bots, 60 s of play each:

| Arena, mode | Average | p99 | Max |
|---|---|---|---|
| Scrapyard TDM | 0.339 ms | 1.139 ms | 7.94 ms |
| Scrapyard FFA | 0.272 ms | 0.690 ms | 2.50 ms |
| City TDM | 0.283 ms | 0.853 ms | 3.80 ms |
| City FFA | 0.319 ms | 0.845 ms | 2.92 ms |

API facts, measured:

- Rapier ray casts don't see a moved kinematic body until `world.step()` (plan F5).
- Node's WebSocket sends a custom Origin (plan F7).

Deviations recorded in `NET_PLAN.md` §11.

`.claude/work/` is gitignored; `.claude/work/net` is force-added (`git add -f`)
so the plan survives the session. The owner decides whether it stays in git.

---

## Phase 1 — the arenas, headless

What changed:

- `materials/library.ts` gets the headless switch. With no `window`, `standard()` returns a `MeshStandardMaterial` with the same parameters and no maps. In the browser `window` exists, so the bake path runs exactly as before; the owner confirms the look by eye.
- `server/headless.ts` is the canvas shim: a Proxy context that takes every call. `measureText` returns `{ width: 0 }`, and `getImageData`/`createImageData` return zeros of the requested size.
- `src/game/arena/digest.ts` adds `arenaDigest()`: FNV-1a over colliders, starts, bases, zones and nav, in millimetres. It is pure, with `.ts` imports. Practice shows it in F3 as `ARENA <digest>`.
- `server/arenas.ts` adds `arenaData(id)`. It builds once per process, disposes the geometries, and returns a fresh object with the gameplay fields only, because `update()`/`paintMap()` close over the scenery.
- New config: `vite.server.config.ts` (SSR build: `publicDir: false`, `ssr.noExternal: true`, a `package.json` with `"type": "module"` emitted into `dist-server/`) and `tsconfig.server.json` (Node + DOM, `vite/client` types; referenced from `tsconfig.json`). `vite.server.config.ts` joins `tsconfig.node.json`.
- New scripts: `server:build` and `server:check`. `check` now ends with `server:check`.
- `server/arena.check.ts`, bundled and run with `--expose-gc`.

Measured (this container):

| Map | Build | Colliders | Starts | Bases | Zones | Nav | Digest | Heap |
|---|---|---|---|---|---|---|---|---|
| scrapyard | 1181 ms | 813 (503 box, 309 cylinder, 1 hull) | 16 | 4+4 | 9 | 60 nodes, 80 links | `b0ce6b61` | 42 MB with a full build alive, 22 MB after stripping (20 MB before) |
| city | 1410 ms | 612 (371 box, 241 cylinder) | 16 | 4+4 | 11 | 72 nodes, 88 links | `9896c223` | 73 MB with a full build alive, 43 MB after stripping |

What stays in the heap after stripping is mostly module-level caches (shared geometries and materials), made once. The colliders and nav are small.

`arena ok (62 checks)`. It asserts:

- at least 8 starts;
- two bases of at least 4;
- at least one zone;
- a connected nav graph;
- nothing left in `root`;
- every start (spawns and bases), with a razor's two collision shells, clear of static colliders (Rapier `intersectionWithShape`);
- the same digest on a second, independent build.

The other six checks are unchanged and pass.

Not verified here: the browser's F3 digest equals the ones above (runbook step 5).

---

## Phase 2 — the protocol and the authoritative server

### What changed

**The mode seam** (NET_PLAN §3):

- `ModeRules.events: unknown[]` (the array both rules already had).
- `MatchMode.share()` and `mirror(state)` in `ffa/mode.ts` and `tdm/mode.ts`.
- `scoring.ts` keeps its feud table in place (`feuds`; `reset()` zero-fills it), and the FFA rules hold it as data, so a mirror answers `nemesisOf()`.
- Every existing check still asserts exactly what it did and passes, with the same bot kill rates.

**The shared roster** is `src/game/roster.ts`: `recruits(kind, arena, seed, skill, player?)`, `BOT_NAMES` (with an eighth name, Sawtooth, for seat 0 online) and `botName(seat)`. `ai.ts` gains `botGun(spec, skill)`, the scaling `armBot` already did. Practice seats through `recruits` with its player in seat 0: the same draws in the same order.

**`src/net/protocol.ts`**:

- `PROTOCOL = 1`, `RATE`, `REWIND`, `LIMITS`.
- Message types; `carRow`/`readCar`, `meRow`/`readMe`, `statsRow`/`readStats`, `inputMessage`.
- `parseClient(raw, bytes)`.
- The pure rules `clampAim`, `clampView`, `acceptSeq`.
- `weaponId` names a scaled bot gun by its registry id.
- It loads under plain node.

**`src/net/protocol.check.ts`** (plain node) covers:

- round trips within their rounding (position 5 mm, rotation 1e-4, velocity 5 mm/s, aim 5 mm, hull 0.05, speed derived within 0.02 m/s);
- clamping, coercion and refusals (Infinity, null, wrong shapes, bad seqs, oversize, unknown types);
- unknown fields left behind, and unknown loadout ids replaced by the defaults;
- the aim, view and seq rules.

**The server** (`game/server/`):

- `auth.ts`: `verifyToken` (HS256 only, `timingSafeEqual`, `exp`), `playerName`, and `mintToken` for the checks.
- `recorder.ts`: SimEvents and rules events to wire events. Rocket segments are joined per snapshot by exact position match.
- `room.ts`: one match (see the plan).
- `lobby.ts`: rooms by (mode, map), one seat per uid, `MAX_ROOMS`, grace.
- `server.ts`: the door, the connections, the loop.
- `main.ts`: environment settings; every arena built before listening.

**Build**: `ws` is the new dependency, with `@types/ws` for development. `bufferutil`/`utf-8-validate` are marked external: Rolldown turns ws's guarded `require` into a `createRequire` call inside ws's own try/catch, so the bundle runs without them.

**npm scripts**:

- `server`: build, then run on :7360.
- `server:check`: arena and server checks.
- `check`: now also runs `protocol.check` and `server:check`.

**The state message** goes out when `{next, rules, stats}` serialises differently from the last one sent. That is checked every 12 steps and on the snapshot after any rules event; a joining player always gets one straight after `welcome`.

### The checks

`protocol ok (46 checks)`; `server ok (76 checks)`, 27 s. The server check covers:

- **The door**:
  - the right origin upgrades (101); another origin or none gets 403; another path gets 404;
  - no hello in time is told `bad-request` and closed;
  - a forged signature, an expired token, a malformed token and `alg: none` each get `auth`;
  - an older protocol gets `version`; an unknown arena gets `bad-request`; input before hello closes the socket.
- **Joining**:
  - two players share a room in different seats; the second goes to the side with fewer players (seat 4);
  - the digest in `welcome` equals the server's `arenaDigest`;
  - the line-up length is the mode's, the humans are flagged, bots hold six seats;
  - `st` follows `welcome`, and the others get `ro`;
  - another mode and map means another room.
- **Authority**: throttle and fire are held through the countdown. After GO, A's throttle drives A (over 5 m in the snapshots), B stays put, acks rise, and rounds fire.
- **Stale input**: A stops sending and is neutral within 400 ms (the rule is 250 ms, plus a step). No more rounds.
- **Combat**:
  - A and B are placed on a 20–45 m stretch of road (bots parked). A's inputs fire at B; B hears ≥ 10 `hu`, then `wr`; the snapshots show the wreck.
  - The state scores it: TDM score +1, kills and deaths in the stats, the raw `kill` rules event delivered.
  - B respawns whole (`sp`, full hull).
- **Forgery**:
  - health/position/damage/kill/stats fields change nothing;
  - Infinity and null are refused whole;
  - an aim 10 km away is clamped to range + 5 m;
  - an old or repeated seq is dropped;
  - toggling fire every message fires no faster than 12 rounds/s;
  - over 4 KB closes the socket (1009);
  - one unknown message is survived, ten close the socket;
  - a flood of 2000 inputs strikes out and closes, and the room's step time stays within bounds of its baseline.
- **Seats**:
  - A leaves: the seat gets a brain, keeps A's stats and its bot name, and the others hear of it;
  - C joins on the side with fewer players; the brain goes, C's rocket pod goes on at full damage;
  - the same uid twice: the first gets `replaced`.
- **Lifecycle**: the buzzer is forced (`Object.assign(rules, { now })`). The result arrives in the state with `next`; after the results window (2 s in the check, 15 s by default) comes `go` with the room's new seed. Everyone is whole on their starts, the rules are back at `preMatch`, and the stats are zero.
- **Empty rooms** close after the grace period (1.5 s in the check, 30 s by default). No minted token appears in any log line.
- **Same simulation**: a bots-only room with seed 1234, `mode.share()` called every 12 steps as for players, ends 30 s of fighting exactly where the bare simulation does. Checked for ffa on scrapyard and tdm on city.
- **Budget**: see below.

The check runs its server with `hello: 1000`, `grace: 1500` and `results: 2` to keep it short. Production defaults are 5 s, 30 s and 15 s.

### Measurements (this container, Xeon 2.1 GHz)

Budget check: FFA, 2 players (driving, turning, firing at the nearest machine) and 6 bots, 30 s after the countdown:

| Arena | Down per player (avg / worst second) | Snapshot (avg / max) | Up | Room step (avg / p99 / max) |
|---|---|---|---|---|
| scrapyard | 24.6 KB/s / 32.3 KB | 757 B / 1021 B | 4.9 KB/s | 0.250 / 0.645 / 1.69 ms |
| city | 26.7 KB/s / 31.9 KB | 775 B / 1125 B | 5.0 KB/s | 0.216 / 0.523 / 1.83 ms |

Budget: 48 KB/s down, 1.5 KB snapshots, 6 KB/s up. JSON stays; no binary format needed. Room step time here is `sim.step` alone.

Capacity (`server/load.ts`: the whole room step, including input parsing and serialising for every player, no sockets):

| Load | All rooms, one step (avg / p99 / max) | One core at 60 Hz | Resident | Down per player |
|---|---|---|---|---|
| 8 rooms × 4 players | 2.54 / 5.43 / 24.1 ms | 15 % (1.9 % a room) | 362 MB | 23.6 KB/s |
| 12 rooms × 8 players | 2.29 / 4.29 / 12.9 ms | 14 % (1.1 % a room) | 494 MB | 23.3 KB/s |

Humans are cheaper than the bots they replace (no route planning or ray-cast feelers). So `MAX_ROOMS` defaults to 12: about 96 players, ~15 % of a core, ~0.5 GB, and ~18 Mbit/s of egress. The e2-medium's shared vCPUs will be slower than this container. The real VM needs verification (runbook).

### Deviations

- `err` has `idle`.
- `/health` also reports the protocol version.
- The door's limits (per-address sockets, hello deadline) are options with production defaults, so the check can shorten them.

---

## Phase 3 — play online in the browser (no prediction yet)

### What changed

- **`src/net/connection.ts`**:
  - `gameServerUrl()`: `VITE_GAME_SERVER`; else, in dev, `ws(s)://<page host>:7360/match`; else the same origin's `/match`.
  - `openSocket(url, origin?)`.
  - `join(socket, hello)`: hello; waits for `welcome` or a refusal (5 s); then an inbox the match drains, a ping every 2 s (RTT), `bye` on close.
  - `NetError` and `REASONS`: the player-facing texts.
  - It runs in Node too (the checks).
- **`src/net/client.ts`** (DOM-free):
  - `seatOnline(welcome, arena, scene?)`: a local world; the line-up from the welcome on the mode's own seats; every body kinematic; the local adapter from `MODES`.
  - `createNetClient(...)`:
    - `receive(now)` applies snapshots (hull, alive; the other machines' controls, aim and steer; the player's weapon, stuck and recovery timers from `me`), state (`mode.mirror`, stats) and roster (name, gun, `refit`);
    - it plays events into any `SimEvents`, and pushes rules events into `rules.events` followed by `mode.report(feed)`;
    - `place(now)` draws each machine between the last two snapshots, and runs the rules clock forward from the snapshot's, capped at 100 ms, never backwards until `go`;
    - `step(dt, control)` sends one input and places every body where it is drawn, then `world.step()`.
  - After more than 1 s without taking messages (a hidden tab), `receive` catches up: effects are dropped, wrecks and respawns shown as they stand, rules events all kept.
- **`src/game/match.ts`** is split:
  - `playMatch(parts, source)`: the player's side, shared (pilot, fixed steps, phase, results, debug, lifecycle);
  - `createMatch`: practice, whose source is the local simulation.
  - Practice keeps its order of calls step for step (sim step → report → elapsed → beep → phase checks; restart: seed → `sim.restart` → `mode.restart` → `view.restart` → `feed.clear`).
  - `MatchPhase` gains `lost`.
  - The Match gains `online`, `lost` and `nextIn()`; `seed` is a getter.
- **`src/game/online.ts`**: the online match. Its source is the net client:
  - `drives: looking`, because the server holds the grid;
  - no pause and no restart;
  - `go` → `restarted()`; a closed link → `lose(reason)`;
  - F3 `ROOM` and `NET` lines.
- **`simulation.ts`** exports `bodyOwner(combatants)` and uses it. `view.ts` builds each car through `build(c)` and gains `refit(c)` (a seat changed guns).
- **UI**:
  - MapSelect's **Classic** is enabled ("Online Match · Normal Bots"); the picker is labelled "Practice bots"; Enter still starts Practice.
  - `App` carries `online`.
  - The runtime's online loading: Signing in → Connecting to the game server → Joining a match (with the digest check) → Setting up → Compiling shaders.
  - Failures show the reason, with **Retry** (Enter) and Back to garage (Esc).
  - The online menu is **Match menu**, with "The match goes on without a pause": Back to the match, Settings, Leave match (confirm: "A bot takes your machine over.").
  - Online results: "Next match in N s" and Back to garage.
  - **Connection lost**: an overlay with the reason and Back to garage.
- `session.ts` exports `freshSession()`: the stored session, refreshed near expiry, else a guest.
- **`server/client.check.ts`** (bundled, part of `server:check`).

### The client check (`client ok (26 checks)`)

Headless clients join a real server through `connection.ts` and `client.ts` and play:

- the digest matches;
- the line-up is seated as welcomed, with the player in its seat and every body kinematic;
- the rules mirror the countdown, and GO is announced through the feed;
- throttle moves the machine in both pages;
- one input a step, in order, acked (≥ 60 in 1.5 s);
- the mirrored clock only runs forward, within 0.2 s of the server's;
- a sight line cast in the page's own world meets the other machine where it is drawn;
- a duel, with both pages seeing it:
  - the victim's page is shown ≥ 10 hurts, then the wreck, on its own combatant objects;
  - the shooter's page shows its own rounds striking;
  - each feed tells the kill its own way ("kill x > you" / "kill you > y");
  - score and stats are mirrored; the victim is pending, then respawns whole;
- a third player takes a seat with the other gun: the name changes, the gun changes, `refit` is called. They leave: the seat goes back to a bot;
- a hidden tab: while the page takes nothing, it is wrecked. The first `receive` back shows the wreck once, plays none of the rounds in between, and has the machines where they are now;
- the buzzer: the result is mirrored and the countdown shown; `go` brings the room's new seed, `preMatch`, a reset clock and cleared stats;
- the server stops: `net.lost` says why.

It passed six runs in a row. One earlier run failed: after a player left, seat 1 got its bot brain back and fired during the catch-up window, and the check blamed the catch-up. The check now looks only at the first `receive` back.

### Not verified here

The browser itself: drawing, input, menus, audio, pointer lock, the loading and failure screens. See `NET_RUNBOOK.md` step 6.

### Deviations

- Online, **Esc opens a "Match menu"** with a way back to the match (Back to the match). The prompt listed Settings and Leave match; a menu needs a way back too.
- The **loading failure screen gets Retry for practice too**. It's the same screen, and retrying is harmless.
- **Pointer lock after the automatic next match**: the browser only grants a lock on a click, so the player clicks back in, as after the results in practice.

---

## Phase 4 — prediction and reconciliation

### What changed

- **`src/net/prediction.ts`** (plain-node imports):
  - a 256-step input history;
  - `drive(seq, input, held, boost)` (`driveCar` with `WRECKED` when held, then `rightIfUpended`) and `settled(seq)` records the pose after the world steps;
  - `reconcile(ack, server, me, hard)`: compares the server's car after input `ack` with the history; beyond **0.25 m, 3° or 1 m/s** it takes the server's state (translation, rotation, linear and angular velocity, `steer`, `upended`) and drives the later inputs again, a `world.step()` each;
  - `forget()`.
  - The tolerances are the starting values; nothing needed tuning once the latency simulator was fixed (below).
- **`src/net/client.ts`**:
  - The player's body stays dynamic and is driven each local step before the world steps.
  - A snapshot applies its events first, then reconciles, so `sp`/`rc`/`go` for the player snap hard (no easing).
  - Corrections are eased out on screen: a decaying position and rotation offset, a third left after 35 ms and gone in ~100 ms. The body is never moved for looks. `last` is shifted with the correction, so the view's interpolation doesn't jump.
  - While the player's machine is a wreck, it is kinematic and shown as the server has it; back to dynamic on respawn.
  - The predicted controls are rounded to the wire's hundredths, exactly as the server reads them.
- **The hold**: the page sends raw controls through the countdown, and the server holds everyone, so a player starts at GO like a bot. The prediction holds a step when the step that will use its input is at or before GO. The server's rules read the phase as a step starts, and the clock ticks at its end: the GO step is found by adding up 1/60 the way the rules do (181 for a 3 s countdown), and the snapshot clock is counted in steps.
- **F3 `CORR`**: corrections, and the last and largest error.
- **Server**:
  - `me` already carried angular velocity, steer and upended.
  - Humans count `repeats` (the queue ran dry) and `drops` (it overflowed); the `left` log line reports both.
  - `jitter` / `NET_JITTER_MS`: ± on top of `lag`, delivered strictly in order.
  - `arenaFor` (lobby, room): test yards for the checks.
- **`server/browser.ts`** holds the headless page and its frame loop, shared by `client.check` and `netplay.check`. The loop runs fixed steps out of elapsed time (an accumulator), as the page does.
- **`server/netplay.check.ts`**, bundled, in `server:check`.

### What the checks showed along the way

1. **The GO step was off by one.** The first version held a step by the clock at the *end* of its step, while the server holds by the phase at the *start*. So the page set off one step early. Once speed made one step exceed 0.25 m (~2 s after GO), a correction followed. Fixed by counting steps as above.
2. **The latency simulator was reordering messages**, the largest effect. Each message had its own `setTimeout`, and Node fires timers of different lengths that fall due together in no set order. So the server got input N+1 before N, dropped N as out of order (correctly), and the prediction was a step off: 2–4 corrections per 10 s, errors to 1 m.
   - The trace showed it: an input sent later was handled first.
   - Fixed with one FIFO and one timer per direction. The dev knob `NET_LAG_MS` uses the same code.
   - Since then, the page's prediction is exact to the wire's rounding (8 mm) whenever the network delivers on time. Real networks (TCP) never reorder.
3. **A de-jitter "refill" rule was tried and dropped.** The server would wait for 2 or 3 queued inputs after running dry. It measured no better once the simulator was right, cost latency, and made each starvation cost up to three repeated steps. The server does what the prompt says: repeat the last input when the queue is dry, drop the oldest past 6.
4. **Physics determinism, verified in isolation.** The same car and inputs give bit-identical trajectories in a world whose other cars are dynamic, kinematic, or absent. Taking the wire-quantized state drifts 1–2 mm over 6 s.

### The netplay check (`netplay ok (18 checks)`)

At 50, 100 and 150 ms each way, ±10 ms jitter, on flat test yards with the bots parked:

| Each way | Grid (throttle held through the countdown) | 20 s scripted drive (straight, left turn, handbrake slide, reverse; twice) | Rocket shove | Wall hit at speed |
|---|---|---|---|---|
| 50 ms | drift 0.048 m, 1 correction | 0 corrections, max error 0.008 m, 0 late inputs | 1 correction, settled at once (0 ms span) | 0 corrections |
| 100 ms | drift 0.101 m, 1 correction | 0 corrections, max error 0.008 m, 0 late inputs | 1 correction, 0 ms | 0 corrections |
| 150 ms | drift 0.174 m, 1 correction | 0 corrections, max error 0.008 m, 0 late inputs | 1 correction, 0 ms | 0 corrections |

- In other runs of the whole suite, the drive sometimes had **one** late input (the server repeated the one before) and then **one** correction of 0.25–0.32 m, about one step's travel at that speed. That is still under 1 correction per 10 s. The prompt's target (< 1 correction per 10 s, max error < 0.5 m) held in every run after the fixes.
- The check asserts what is actually true of the design, so a slower CI runner can't make it flaky:
  - every correction in the drive is explained by a late input;
  - with no late inputs, the error stays under 5 cm.
- The one grid correction is the car settling onto its springs at the moment of joining a room that was just created, while the input queue settles too. It's under 0.15 m, and drift stays under 0.25 m.
- The wall is in the page's world as well, so hitting it is predicted exactly.

### Deviations

- The drive is the prompt's script run **twice (20 s)**, so a rate per 10 s means something.
- The hold check allows the one settle correction (explained above).
- The netplay check needs rooms on test yards: the server, lobby and room take an optional `arenaFor` / `arena`. Production never sets it.

---

## Phase 5 — remote interpolation and lag compensation

### What changed

- **`src/net/snapshots.ts`** (plain-node imports): a second of snapshots.
  - The server's tick is reckoned from arrival times: the least-delayed arrival of the last second, eased, and jumped straight to after a long gap.
  - The others are drawn at that tick minus `DELAY` (4 ticks, two snapshot intervals, 67 ms). The drawing tick never runs backwards.
  - Positions, velocity, aim, steer and throttle are lerped, rotations slerped.
  - Past the newest snapshot a machine carries on at its speed for at most 250 ms, then holds.
  - Two snapshots more than 10 m apart are a teleport (a respawn, a recovery, a new match): the earlier pose is drawn until the later tick, never a slide across the map. The check found this: the first version drew a car gliding 150 m in one interval.
  - It counts how often it had to extrapolate.
- **`src/net/connection.ts`** stamps each message with its arrival time (`performance.now()` in `onmessage`), so the reckoning isn't blurred by frame timing.
- **`src/net/client.ts`**:
  - The others' pose, hull, alive flag, controls, aim and steer come from the buffer at the drawn tick, so everything drawn of them belongs to one moment.
  - The player's own wreck is drawn at the newest snapshot.
  - Events wait until the drawing reaches their tick. Rules events, `go`, and every event involving the player (a round they fire or take, their hits, wrecks, crashes, respawns) play on arrival.
  - The player's own tracers and rocket flashes start from their gun where it's drawn: the predicted car is ahead of the server's.
  - Inputs carry the drawn tick, rounded, as `w`.
  - After a hidden tab, the catch-up shows wrecks as the *newest* snapshot has them, and drops the waiting events.
- **Remote wheels**: each local step, a remote car's vehicle controller gets its steering and `updateVehicle(dt)` on its kinematic body. The wheels spin, steer and ride their suspension with no change to `view.ts`. The client check asserts a moving remote car's wheel turns (> 1 rad), and the numbers stay finite.
- **Server, `server/rewind.ts`**: the last 60 ticks of every machine's pose, and `cast(shooter, muzzle, tick, shot, random)`:
  - the round is spread as `castRound` spreads it (the same three draws);
  - it is cast against the static arena (Rapier, `EXCLUDE_DYNAMIC`) and against every other machine's two chassis boxes at that tick (ray against an oriented box);
  - the nearest hit wins, and a machine struck is named by its first collider.
- **`simulation.ts`**: an optional `castRound` hook, unset in practice, so the bit-exact checks can't change.
- **`room.ts`**: records poses after every step. A person's round is rewound to their clamped `w` when it's older than the present; bots cast as before. `flags.compensate` lets the check compare with compensation off.

### Measurements (`netplay ok (27 checks)`, stable over three runs)

A target crosses 30 m in front of a stationary shooter at 27 m/s. The shooter aims one round at it as drawn, the step it passes straight ahead.

| Round trip | Drawn behind the server | Drawn pose vs the server's at that tick | Drawn past the newest snapshot | One round aimed where it's drawn |
|---|---|---|---|---|
| 150 ms (75 each way ±10) | 141 ms | 0.002 m average, 0.005 m worst | 0.0–0.1 % of the time | **hit** with compensation, **miss** without |
| 300 ms (150 each way ±10) | 216 ms | 0.002 m average, 0.005 m worst | 0.0 % | miss with compensation, miss without |

- **A forged `w`** 50 ticks (830 ms) old, aimed where the target was then, is held to 12 ticks: no hit on the ghost.
- **The drawn-pose bound** is 0.5 m, one tick's travel at top speed. One run, with `DELAY` briefly at 4, saw 0.39 m while extrapolating; typical is 5 mm.
- **Why 300 ms misses even with compensation.** The rewind a shot needs is the round trip, plus the drawing delay, plus a queued step: ~0.4 s at 150 ms each way. The server gives back 200 ms at most (D8, §6), so the round lands ~5 m behind a car at 27 m/s. Beyond ~100 ms each way, players have to lead fast crossers a little. It's a known limit, kept deliberately: a longer rewind lets high-latency shots land on cars that already reached cover.

### Deviations

- **`DELAY` is two snapshot intervals (67 ms), not about three (100 ms).** With three, the rewind a 150 ms round trip needs is ~270 ms. The 200 ms cap then leaves the round ~1.8 m behind a car's centre, against a hull half-length of 2.2 m: a coin flip in the check. Two intervals leaves ~0.8 m (a clean hit). It cost almost no extrapolation: 0.0–0.1 % of samples with ±10 ms jitter.
- **`w` is the drawn tick rounded, not floored.** Flooring aimed the rewind up to a tick older than what was on screen.
- **Rounds are rewound against every other machine**, friendlies too: they stop rounds today (plan §11).

---

## Phase 6 — deployment

### What changed

- **`deploy/compose.yml`** gains a `game` service:
  - `docker.io/library/node:24-alpine`, running `node /srv/server/main.js` as the image's `node` user;
  - `PORT=7360`, `NAKAMA_ENCRYPTION_KEY` (the same value Nakama gets), `ALLOWED_ORIGINS=https://${SITE_DOMAIN}`, `MAX_ROOMS=${MAX_ROOMS:-12}`, `TRUST_PROXY=1`;
  - `../server/current:/srv/server:ro`, `restart: unless-stopped`, a busybox `wget` healthcheck on `/health`, no published ports.
  - `MAX_ROOMS` needs no line in `.env.example`: it has a default, and `deploy/.env` can set it if needed.
- **`deploy/Caddyfile`**: `handle /match { reverse_proxy game:7360 }` in the site block, ahead of the static files. The socket is on the site's own origin, over wss on its certificate, with no CORS; upgrades pass through `reverse_proxy`.
- **`scripts/build.sh`** also runs `npm run server:build`.
- **`scripts/deploy.sh`**:
  - The site and the game server switch releases through one `switch` function: `<kind>/releases/<sha>`, then `<kind>/current`, hard-linked from `<kind>/incoming`.
  - `--server` switches the server release and recreates only `game`; the header says live online matches drop.
  - The first deploy makes a server release even without `--server`, because the container can't start without one.
  - It keeps five releases of each. A rollback was the same `<sha>`, plus `--server` to take the game server back too. That was broken (see "Rollback, second review" at the end): a server release existed only for deploys that changed the bundle, so `--server` on a rollback snapshotted the newest bundle under the old name.
- **`.github/workflows/deploy.yml`**:
  - rsyncs `game/dist-server/` to `server/incoming/`, without the bundled checks (`*.check.js`, `load.js`);
  - passes `--server` when rsync itemises a changed file, the way `--nakama` is found;
  - the smoke step runs `scripts/match-smoke.mjs`, up to five tries while `game` restarts.
- **`scripts/match-smoke.mjs`**: a Nakama guest connects to `<SITE_URL>/match` with the site's Origin and says hello. The protocol version is read from `game/src/net/protocol.ts`, so the script can't drift. It expects a `welcome` within 5 s (8 seats, flagged human, a digest), says `bye`, and deletes the guest. `SITE_URL`, `NAKAMA_URL`, `NAKAMA_SERVER_KEY`.
- **`scripts/run.sh`** also starts `npm run server`.
- **www dev**: `astro.config.ts` proxies `/match` to `GAME_SERVER_URL` (default `ws://127.0.0.1:7360`, `ws: true`), next to `/api/stats`; `www/.env.example` documents it.
- **`game/.env.example`** documents `VITE_GAME_SERVER` (optional) and its defaults.

### Verified here

- `sh -n` on the three scripts.
- `compose.yml` and `deploy.yml` parse as YAML.
- `deploy.sh` in a throwaway tree with a stub `podman`:
  - a first deploy (no `--server`) makes the server release and recreates `game`;
  - a site-only deploy leaves the server release alone;
  - `--server` switches it;
  - a rollback to an earlier `<sha> --server` restores both. (The test deployed a server change each time; the second review found the case it missed.)
  - In the test, files were replaced as rsync replaces them: a new file, renamed in.
- `scripts/build.sh` runs whole: the game at `/play`, the server bundle, the site, precompression.
- The deployable subset of `dist-server` (`main.js`, `package.json`, `chunks/`, 4.5 MB), copied outside the repo with no `node_modules` anywhere, starts and answers `/health`.
- `scripts/match-smoke.mjs` against the real server bundle, with a stand-in Nakama that mints tokens with Nakama's default key: `ok  seated in room …, seat 0 of 8, arena b0ce6b61`, direct and through `localhost`. The server logged `joined`/`left` with the user id and the guest name, and no token.
- `www`: `lint`, `check` and `build` pass with the proxy change.

### Not verified here (no Podman, no Caddy, no rsync in this container)

`podman compose config`, `caddy validate`, the real upload, and the real VM. See `NET_RUNBOOK.md` steps 8 and 9.

---

## Phase 7 — docs, copy, report

### What changed

- `CLAUDE.md`:
  - scope, repo layout, commands (the game server's build, run, checks, load tool), the check list, the technology stack;
  - the code map (`online.ts`, `roster.ts`, `arena/digest.ts`, `src/net/*`, `game/server/*`);
  - authority (the game server owns outcomes, Nakama owns identity), the networking model, and the development order.
- `AGENTS.md`: its global-rules block held the body of `CLAUDE.md`, word for word, until the second review reverted it to `main`'s stub (`# TODO`). It isn't a copy of `CLAUDE.md`.
- `NET_PLAN.md` is the design as built. It covers the final protocol, the 67 ms interpolation delay, event scheduling, the rewind, the FIFO latency link and the full deviations list (§11).
- `NET_ARCHITECTURE.md`, new: the section for `.claude/work/arch/ARCHITECTURE.md` in place of "Future multiplayer (Nakama)". That file isn't in this checkout, so the owner merges it.
- Patch notes 0.8.0 (`PatchNotesPanel.tsx`), every line from the code:
  - Classic on the Arena screen; up to eight machines, with Normal bots in the empty seats; the side with fewer people in Team Deathmatch;
  - names (username, or Guest and four characters); the garage gun;
  - server-decided outcomes; prediction, interpolation, and Minigun rounds judged up to 200 ms back;
  - the next match after 15 s; the Match menu; the connection-lost screen and Retry; the F3 lines.
- `game/package-lock.json` is back to the base lockfile plus `ws` and `@types/ws`. This container's npm 10 had dropped the `libc` fields from every native optional package when Phase 2 added `ws`. npm 10 and npm 11 both accept the rebuilt file (`npm ci --dry-run`), and npm 11 removes nothing from it. It's its own commit.
- The site's copy (`www/`) is the last commit, on its own. The owner can hold it back until the browser test passes.

---

# Final report

## Summary

An online match, end to end:

1. On the Arena screen the player picks a mode and an arena, then **Classic**.
2. The page signs in: the site's stored Nakama session, refreshed, or else a guest by device ID.
3. It opens a WebSocket to `/match` (on the site through Caddy; `ws://<host>:7360/match` in development). It says hello with the session token, the build id, the mode, the arena and the garage loadout.
4. The game server checks the page's protocol and build id against its own; a page of another build is told "Game updated — reload the page". It checks the token's HS256 signature with Nakama's key, without calling Nakama. It seats the player in a room for that mode and arena: the first that has a bot's seat free and isn't showing results, or a new one. The seat's bot keeps driving until the page's first input.
5. A room is the practice match's own code, headless: the arena built in Node, `createSimulation`, the mode's rules and Normal bots in every seat nobody holds. It steps at 60 Hz, and every input a person sends is only controls, an aim point and the tick they see.
6. The `welcome` carries the line-up and the arena's digest, and the page refuses a digest that differs from its own build.
7. From then on, at 30 Hz, the page gets the machines and what happened: shots, hits, wrecks, respawns and the rules' events. When the rules' state changes, it gets that too.
8. The page mirrors the match into the same `Match` the HUD reads in practice. It predicts its own car, draws the others 67 ms in the past, and plays the server's events through the same view and feed.
9. The server rewinds each person's hitscan to what they saw, up to 200 ms, onto the life each machine lives now. It keeps each person's input queue short, and cuts off a page that stops reading.
10. When the mode calls the result, everyone stands down. Fifteen seconds later the room starts its next match with a fresh seed.
11. A player who leaves hands the seat back to a bot, and an empty room closes after 30 s.
12. The deploy runs the server as a `game` container behind Caddy at `/match`, and won't roll with a weak or shared session key. After each deploy, a smoke test seats a guest on every arena and holds each to `game/server/digests.json`.

Nothing on the client decides an outcome.

## Decisions and deviations

The decisions D1–D8 were taken as given:

| # | Decision | Why |
|---|---|---|
| D1 | A Node game server runs `simulation.ts`, the modes and the bots; Nakama keeps identity | One implementation. Nakama's JS runtime has no WebAssembly, so Rapier can't run there, and a Go port would be a second copy that drifts. |
| D2 | `ws`, JSON with quantized integers | Measured at about half the byte budget (below), so no binary format is needed. |
| D3 | Nakama's HS256 session token, verified locally | No call to Nakama per join. Guests play as "Guest" plus the uid's last four characters. One seat per uid. |
| D4 | `game/server/`, `src/net/`, a Vite SSR build to `dist-server/` | The server bundles the browser's modules unchanged: the same code, one package. |
| D5 | The real arenas headless, with digest parity | The builders run unchanged under a canvas shim, and a mismatch is refused, not played. |
| D6 | 60 Hz simulation, 30 Hz snapshots, an input queue (repeat when dry, drop the oldest past 6, neutral after 250 ms) | As specified. |
| D7 | Rooms by (mode, map); takeover and leave; 15 s of results, then the next match; 30 s empty, then disposed | As specified. |
| D8 | Predict the local car, interpolate the others, rewind hitscan up to 200 ms, never rockets | As specified, but the interpolation delay is 67 ms (deviation 9). |

Deviations (`NET_PLAN.md` §11), each with its reason:

1. **Remote bodies are placed at their drawn poses, not their latest server poses.** Rapier's queries only see a moved body after `world.step()`, and the aim must hit what is drawn for lag compensation to agree.
2. **`view.place` needs no per-machine alpha.** Remote machines have `last = position = drawn pose`.
3. **An `idle` error code.** 60 s without input frees the seat, and the player is told why.
4. **A missing Origin is refused.** Browsers always send one. The smoke test sends the site's.
5. **The input rules are pure helpers in `protocol.ts`, and mode and map are checked in the lobby.** `protocol.ts` runs under plain node, while the registries need the bundler.
6. **Rewind tests every other machine, friendlies too.** Friendlies stop rounds in practice.
7. **FFA's feud table is shared data.** The mirror answers `nemesisOf()`.
8. **An eighth bot name, Sawtooth.** Seat 0 needs one in a room. Practice's seats 1–7 keep theirs.
9. **The interpolation delay is 67 ms, not about 100.** Each tick of it spends the 200 ms rewind budget: at 100 ms a 150 ms round trip hit only by luck, at 67 ms it hits cleanly. `w` is rounded, not floored.
10. **The latency simulator is one FIFO per direction, with `NET_JITTER_MS`.** Per-message timers reordered messages, and that caused most of Phase 4's first corrections.
11. **No input refill rule.** It was tried and dropped: no gain once the simulator was right, and it cost latency.
12. **"Match menu" online, with Back to the match.** A menu needs a way back. Practice's loading failure gets Retry too: same screen, harmless.
13. **The netplay drive runs 20 s, and the grid hold may take one correction.** Twenty seconds makes a per-10-s rate meaningful. The one correction was a car settling in a new room; it's gone since C. The hold is measured until 0.3 s before GO, since the page sets off at its own GO, a trip ahead of the server.
14. **`arenaFor`, a test seam.** The netplay check plays on flat test yards. Production never sets it.
15. **The lockfile fix is its own commit.** Phase 2's npm 10 had dropped the `libc` fields, which is unrelated churn.

After the pull request's review, one commit each (the "After review" section below has the measurements):

16. **A page that stops reading is cut off** once 512 KB wait for it past the kernel's buffers: logged `slow`, terminated, its seat back to a bot (A).
17. **The build id in the hello, `PROTOCOL` 2** (B). A hash of `src/`, `server/` and the lockfile, the same in both bundles of a commit. The server lets in only its own build, plus `dev` pages unless it's strict (production).
18. **A new player's seat stays the bot's until their first input** (C). The page takes the server's word whole until its first input is used.
19. **A rewound round hits only the life a machine lives now** (D). A wreck then, or a machine that has died since, stops it and takes nothing.
20. **The input queue drains standing delay** (E). Measured first: a stall's burst left it 4–5 deep for good.
21. **The session key is guarded, and the arenas have expected digests** (F): `main.ts` with `TRUST_PROXY`, `deploy.sh`, `game/server/digests.json`.
22. **The hello's vehicle is ignored online, and a check says so** (G).
23. **The browser, checked in headless Chromium** (H): `scripts/arena-parity.mjs`, `scripts/browser-match.mjs`.
24. **Two netplay check fixes the gate surfaced.** Late and dropped inputs count from the countdown's last second, and the grid hold is bounded apart from the page's lead at GO. Both were traced before changing a line.

Not done:
- rejoining your old seat after a drop (the prompt's stretch goal);
- the garage's vehicle online (G).

## Files

Added:

- `game/server/main.ts`: environment, arenas built up front, signals
- `game/server/server.ts`: http `/health`, ws `/match`, the door's limits, one fixed-step loop, JSON logs, the latency link
- `game/server/auth.ts`: HS256 session tokens (verify; mint for the checks), player names
- `game/server/lobby.ts`: rooms by (mode, map), one seat per uid, `MAX_ROOMS`, disposal of empty rooms
- `game/server/room.ts`: one match; seats, input queues, snapshots, state, takeover and leave, results, then the next match
- `game/server/recorder.ts`: `SimEvents` and rules events as wire events
- `game/server/rewind.ts`: pose history and the rewound hitscan cast
- `game/server/arenas.ts`: arenas built headless, stripped to gameplay data, cached
- `game/server/headless.ts`: the canvas shim for the arena builders
- `game/server/browser.ts`: a headless page for the checks
- `game/server/load.ts`: the capacity tool
- `game/server/arena.check.ts`, `server.check.ts`, `client.check.ts`, `netplay.check.ts`: the bundled checks
- `game/src/net/protocol.ts`: messages, wire numbers, `parseClient`, the input rules
- `game/src/net/protocol.check.ts`: the protocol's check (plain node)
- `game/src/net/connection.ts`: the socket, hello and welcome, ping, reasons in the player's words
- `game/src/net/client.ts`: the page's mirror of a server match
- `game/src/net/prediction.ts`: the player's car ahead of the server, reconciled
- `game/src/net/snapshots.ts`: the snapshot buffer, the server clock, interpolation
- `game/src/game/online.ts`: an online match through `playMatch`
- `game/src/game/roster.ts`: the shared line-up (practice and rooms)
- `game/src/game/arena/digest.ts`: the arena fingerprint
- `game/vite.server.config.ts`, `game/tsconfig.server.json`: the server build and its typecheck
- `scripts/match-smoke.mjs`: a guest takes a seat on every arena of the deployed server, each held to its expected digest
- `game/build-id.ts`: the build id both bundles carry
- `game/server/digests.json`: each arena's expected digest
- `scripts/arena-parity.mjs`: the arenas' digests in headless Chromium
- `scripts/browser-match.mjs`: two pages in one online match in headless Chromium
- `.claude/work/net/NET_PLAN.md`, `NET_LOG.md`, `NET_RUNBOOK.md`, `NET_ARCHITECTURE.md`: design, log, runbook, architecture section (force-added: `.claude/work/` is gitignored)

Changed:

- `game/src/game/match.ts`: the player's side (`playMatch`) split from the source of steps; `lost`, `online`, `nextIn()`
- `game/src/game/simulation.ts`: `bodyOwner()`; an optional `castRound` hook (unset in practice)
- `game/src/game/mode.ts`: `ModeRules.events`; `MatchMode.share()` / `mirror()`
- `game/src/game/ffa/mode.ts`, `tdm/mode.ts`: `share` / `mirror`
- `game/src/game/ffa/rules.ts`, `scoring.ts`: the feud table held as data, reset in place
- `game/src/game/ai.ts`: `botGun()`, the scaling `armBot` did
- `game/src/game/materials/library.ts`: no GPU bake without `window`
- `game/src/game/runtime.ts`: the online loading steps (sign in, connect, join with the digest check)
- `game/src/game/view.ts`: `build(c)`, `refit(c)`
- `game/src/net/session.ts`: `freshSession()`
- `game/src/screens/GameCanvas.tsx`: failure reasons with Retry, the Match menu, Connection lost
- `game/src/screens/Results.tsx`: "Next match in N s"
- `game/src/screens/MapSelect.tsx`: Classic enabled
- `game/src/App.tsx`: carries `online`
- `game/src/screens/PatchNotesPanel.tsx`: 0.8.0
- `game/package.json`, `package-lock.json`: `ws`, `@types/ws`; `server`, `server:build`, `server:check`; `check` runs the new checks
- `game/tsconfig.json`, `tsconfig.node.json`, `tsconfig.server.json`, `.gitignore`, `.env.example`: the server build, `dist-server/`, `VITE_GAME_SERVER`
- `game/vite.config.ts`: the build id as `__BUILD__` (`dev` from the dev server)
- `deploy/.env.example`: why the refresh key must differ
- `deploy/compose.yml`: the `game` service
- `deploy/Caddyfile`: `/match` to the game server
- `scripts/deploy.sh`: server releases, `--server`; refuses a missing, default or shared session key
- `scripts/build.sh`, `scripts/run.sh`: build and run the server
- `.github/workflows/deploy.yml`: upload the server bundle, `--server` on change, the match smoke test
- `www/astro.config.ts`, `www/.env.example`: the dev proxy for `/match`
- `CLAUDE.md`: documented (`AGENTS.md` is `main`'s, unchanged)
- `www/src/content/guide/*.mdx`, `www/src/pages/index.astro`: the site's copy (its own commit, `ff2c4a7`)

## Measurements

This container: Intel Xeon 2.1 GHz, 4 vCPU, Node 22.22.2.

| What | Scrapyard | The City |
|---|---|---|
| Arena build (headless) | 1181 ms | 1410 ms |
| Colliders | 813 | 612 |
| Digest | `b0ce6b61` | `9896c223` |
| Room step, `sim.step`, 2 players + 6 bots (avg / p99) | 0.25 / 0.65 ms | 0.22 / 0.52 ms |
| Down per player (avg / worst second) | 24.6 / 32.3 KB/s | 26.7 / 31.9 KB/s |
| Snapshot (avg / max) | 757 / 1021 B | 775 / 1125 B |
| Up per player | 4.9 KB/s | 5.0 KB/s |

Budget: 48 KB/s down, 1.5 KB snapshots, 6 KB/s up.

Prediction (flat test yard, ±10 ms jitter):

| Each way | Grid hold | 20 s drive | Rocket shove | Wall hit |
|---|---|---|---|---|
| 50 ms | 0.000 m moved while held (0.01–0.03 m out by GO, the page's own start), 0 corrections | 0 corrections, max error 0.008 m | 0–1 correction, settled at once | 0 corrections |
| 100 ms | 0.000 m (0.06–0.12 m by GO), 0 | 0, 0.008 m | 0–1, at once | 0 |
| 150 ms | 0.000 m (0.12–0.20 m by GO), 0 | 0, 0.008 m | 0–1, at once | 0 |

The grid rows are after C (the seat's bot until the first input). Before it, each latency had one "settle" correction and a drift of 0.03–0.20 m that was really the page's lead at GO. In some runs one late input (the server repeated the one before) caused one drive correction of 0.25–0.32 m. That is under the target of one per 10 s, with max error under 0.5 m.

Interpolation and lag compensation (a target crossing at 27 m/s, 30 m out):

| Round trip | Drawn behind the server | Drawn pose error (avg / worst) | Extrapolated | One round aimed where drawn |
|---|---|---|---|---|
| 150 ms | 141 ms | 2 / 5 mm | 0.0–0.1 % | hit with compensation, miss without |
| 300 ms | 216 ms | 2 / 5 mm | 0.0 % | miss both ways (past the 200 ms cap) |
| forged `w` 830 ms old | clamped to 200 ms | | | no hit on the ghost |

Capacity (`load.ts`: the whole room step with every player's parsing and serialising, no sockets):

| Load | One core at 60 Hz | Resident | Down per player |
|---|---|---|---|
| 8 rooms × 4 players | 15 % | 362 MB | 23.6 KB/s |
| 12 rooms × 8 players (the `MAX_ROOMS` default) | 14 % | 494 MB | 23.3 KB/s |

At the default that is about 96 players, ~18 Mbit/s out. The e2-medium's shared vCPUs will be slower. [medium confidence it fits: the measurement is this container's, and the VM needs checking]

After review (details in "After review" below):

| What | Measured |
|---|---|
| A page that stops reading (A) | Cut off 9.7–9.8 s after it stopped reading: Unix socket, 64 KB mark in the check. Over loopback TCP the kernel took 4.03 MB first (84 s at 48 KB/s), so in production expect minutes, and never over 512 KB of the server's memory. |
| A seat taken mid-match, no input for 8 s (C) | The bot drove it 23 m and fired. A page that loaded for 2.5 s took over 0.01 m from the server's car, with 0 corrections. |
| Input queue, 75 ms each way ±10 with a 150 ms stall every 5 s (E) | Depth p50 4 without the drain, 1–2 with it. Back to 1 within 577–1001 ms of a burst. The crossing shot away from a stall: miss without, hit with. Cost: 72 repeats against 44 per 30 s at the stalls. No cost without stalls (0 / 0 / 0). |
| Arenas in headless Chromium 141 on SwiftShader WebGL2 (H) | `b0ce6b61`, 813 colliders, 14.3–14.9 s; `9896c223`, 612 colliders, 21.0–21.1 s. The server's, exactly. |
| Two pages in headless Chromium (H) | Both in the match 35–39 s after opening, one room, 2 people. W held 12 s: 8.2 m on the other page's screen (0.0 m idle). The seat went back to a bot on leaving. 0–1 frames a second on the CPU renderer. |

## Checks

`npm run check` in `game/`, all passing, 4 min 18 s here (the reviewer's run on `ff2c4a7`: 3 min 29 s; the new sections run over real sockets and links):

| Check | What it proves | Result |
|---|---|---|
| `ai.check.ts` | the bots' router | `router ok` |
| `bots.check.ts` | bots at every difficulty (unchanged) | `bots ok (21 checks)` |
| `ffa.check.ts` | free-for-all rules (unchanged) | `ffa ok (143 checks)` |
| `tdm.check.ts` | team deathmatch rules and team AI (unchanged) | `tdm ok (163 checks)` |
| `simulation.check.ts` | both modes through the simulation; a match replayed bit for bit from its seed, so practice is unchanged | `simulation ok (28 checks)` |
| `loading.check.ts` | the loading runner | `loading ok (23 checks)` |
| `protocol.check.ts` | round trips within their rounding; every refusal, clamp and coercion; unknown fields and ids; the aim, view and seq rules; the hello's build (kept, or `''` when missing or odd; `dev` under plain node) | `protocol ok (52 checks)` |
| `server/arena.check.ts` | both arenas headless: starts clear, bases, zones, a connected nav graph, nothing left in `root`, the same digest on a second build, and the one `digests.json` expects | `arena ok (64 checks)` |
| `server/server.check.ts` | A real server over real sockets. **The door:** origin, path, hello deadline; forged, expired and `alg: none` tokens; version; another build, and no build; `dev` pages on a local and on a strict server. Seats and rooms. Authority through the countdown. Stale input. A duel scored. Forged fields, oversize, rate, strikes, flood. **Seats:** the bot drives a new seat until the first input; takeover and leave; replaced. The next match. Empty rooms closed. No token in the logs. **A page that stops reading:** cut off, its seat back to a bot. A room is the bare simulation, bit for bit. **The handover in a room stepped by hand:** it drives and fires; idle a minute after joining. **Rewound rounds and a machine's past life.** The vehicle tripwire. The byte budget. | `server ok (92 checks)` |
| `server/client.check.ts` | headless pages through `net/`: digest, seating, the mirrored countdown and clock, inputs acked, sight lines hit what's drawn, a duel seen from both sides, takeover with a gun change, a page that loads slowly taking over where the bot left the car, remote wheels turning, a hidden tab's catch-up, the next match, a lost connection | `client ok (29 checks)` |
| `server/netplay.check.ts` | 50/100/150 ms each way: prediction held on the grid and setting off at GO, driving (late and dropped inputs counted from the countdown's last second), shoved and against a wall; the drawn poses; lag-compensated hits at 150 ms and the cap at 300 ms; a forged view clamped; a rough link with stalls: the queue drained, and a shot away from a stall hits | `netplay ok (33 checks)` |

Also: `npx tsc -b` clean (it covers `server/`); `npm run lint` 0 errors (the one existing warning in `Drawer.tsx`); `npm run build` passes; in `www/`, `lint`, `check` and `build` pass.

Outside `npm run check`, run here:
- `node scripts/arena-parity.mjs`: both digests match in Chromium; a wrong expected one exits 1.
- `node scripts/browser-match.mjs`: 4 of 4 checks pass.
- `scripts/match-smoke.mjs` against the server bundle and a stand-in Nakama: both arenas as expected. It fails on a drifted digest, and on a checkout of another build.
- `deploy.sh`'s key checks in a throwaway tree.

## Not verified here

Verified here since the review, in headless Chromium 141 (SwiftShader WebGL2), no longer the owner's:
- **Arena parity in Chromium**: `b0ce6b61` (813 colliders) and `9896c223` (612), the server's exactly.
- **Two pages in one online match**: Play → Classic, one room, a driven car seen on the other page, the seat back to a bot on leaving, screenshots with the F3 overlay.

Still the owner's (`NET_RUNBOOK.md`):
- **How it feels, on a real GPU** (steps 6, 7): prediction and interpolation at 60 ms each way; menus, audio, pointer lock. SwiftShader drew 0–1 frames a second, which says nothing about feel.
- **Firefox and Safari digests** (step 5). [medium confidence they agree: the builders' randomness is integer mulberry32, so only float-driven branches could differ]
- **The practice look**: the material library's headless switch only runs without `window`, but the owner confirms by eye.
- **The deploy** (steps 8, 9): `podman compose config`, `caddy validate`, `deploy/.env` with distinct keys, the first real deploy with `--server`, the CI smoke test, two devices on the real site.
- **`load.js` on the VM**, to set `MAX_ROOMS`.
- **A running Nakama's refresh token.** The claims were read in Nakama 3.30.0's source; none ran here.

## Known limits

- **Aim help** (aimbots, triggerbots). The game has a legitimate lock-on, and the server can't tell perfect aim from a script.
- **Wallhacks.** Every page gets every machine's position; interest management is future work.
- **Token revocation.** A logout isn't seen for the rest of the token's life (2 h).
- **Floods** beyond the per-address cap and the message limits are infrastructure's job.
- **Seat stats are inherited.** A person who takes a bot's seat mid-match takes its stats too (D7).
- **Hitscan past 200 ms.** Beyond ~100 ms each way, fast crossers need a little lead: the rewind stops at 200 ms, on purpose, so late shots don't land on cars already in cover.
- **One process** runs every room: a slow room delays the rest (the catch-up cap and `MAX_ROOMS` bound it). There's one region.
- **Dropped players can't rejoin their seat**; they join the room again as a newcomer.
- **Stalls cost repeats.** The queue drain keeps a person's inputs fresh, so the next stall's gap is felt as repeated inputs (and a correction) rather than absorbed by a queue left deep (E).
- **The garage's vehicle isn't used online**: every seat is the roster's machine. A check fails the day `VEHICLES` gains a second one (G).

## Next steps, in order

1. On a real GPU, runbook steps 5–7: two browsers, feel at 60 ms each way, Firefox and Safari digests. If they fail, revert the site-copy commit `ff2c4a7` ("Say online play is here on the site"), which is on its own for that reason.
2. Runbook step 8 with `deploy/.env` holding two different Nakama keys. Merge and deploy with `--server` (the first deploy makes the release anyway), then step 9.
3. Measure the real VM and set `MAX_ROOMS` from it: `npm run server:build` there, then `node dist-server/load.js` (the deploy uploads the server without the load tool).
4. Merge `NET_ARCHITECTURE.md` into `.claude/work/arch/ARCHITECTURE.md`, and decide whether `.claude/work/net` stays in git.
5. Rejoin a dropped seat (the lobby remembers uid → room for 60 s).
6. Seat people in their garage vehicle when a second vehicle lands (the tripwire says when).
7. Reset the stats of a seat a person takes over, if playtests say inheriting them feels wrong.
8. Interest management (the wallhack defence), then local tracers for the player's own shots (weapon prediction).

# After review

A separate session reviewed the pull request. It found three things to fix before merge (A–C) and four small ones (D–G), and asked for browser verification (H). One commit each, in that order, on top of the site-copy commit (`ff2c4a7`), which stays where it is.

The reviewer had already re-run the whole gate on `ff2c4a7`, all green in 3 min 29 s:
- `npx tsc -b` clean; lint 0 errors;
- router, bots 21, ffa 143, tdm 163, simulation 28, loading 23, protocol 46, arena 62, server 76, client 27, netplay 27.

They also found:
- the `server:build` bundle byte-identical across two builds;
- the arena digests identical in headless Chromium 141 (SwiftShader WebGL2, so the GPU bake runs): `scrapyard b0ce6b61` (813 colliders), `city 9896c223` (612).

My report said this container has no browser. That was wrong: Chromium (Playwright's chromium-1194) and Playwright 1.56 are installed.

## A — a cap on what waits for a page that stopped reading

**The problem.** `send()` never looked at `ws.bufferedAmount`. A page that keeps sending inputs, so it never goes idle, but stops reading had every snapshot buffered for it without end: about 25 KB/s a socket, up to 8 sockets an address, one process for every room.

**The fix** (`server/server.ts`):
- Every write checks `ws.bufferedAmount`. Past `BACKLOG` = 512 KB (about 20 s of snapshots), the server logs `slow` (uid, ip, KB waiting, seconds connected) and calls `ws.terminate()`.
- It terminates rather than `fail()`s, because telling the page why would queue more bytes. The socket's close runs the usual leave: a bot takes the seat back.
- The mark is a server option (`backlog`), like the door's other limits, so the check can lower it.

**No lower mark for skipping snapshots.** Snapshots carry the events: `wr`, `sp`, the rules' `ru`, and `go`, the next match. A page that missed a `go` would never restart its mirror. Skipping them safely means holding each player's events back and sending them later, which is per-player state and serialising for a page the kernel already buffers for. A briefly stalled page gets its backlog in a burst once the link recovers, and the snapshot buffer copes: its clock jumps to the newest arrival.

**Measured.**
- **Kernel buffers first.** On loopback TCP, a paused `ws` reader took 4.03 MB before `bufferedAmount` rose: 84 s at 48 KB/s. `/proc/net/tcp` put it in the server's own send queue (1.75 MB after 40 s, still growing toward `tcp_wmem`'s 4 MB), while the paused reader's receive queue stayed at 117 KB. Node has no API to cap a TCP socket's buffers, so a check over TCP would take minutes.
- **The check** runs a second server on a Unix socket, whose kernel buffer (~200 KB) doesn't grow. The mark there is 64 KB. A `ws` client joins with a watcher page in the same room, pauses its net socket and keeps sending inputs at 60 Hz. It was cut off **9.7–9.8 s** after it stopped reading, with 64 KB waiting past the kernel's.
- **In production** the kernel's share comes first: the game server's send buffer, then Caddy's socket to the player, each able to grow to ~4 MB here. So a stalled player is dropped after roughly 3–6 minutes at 25 KB/s, and never holds more than 512 KB of the server's own memory. [medium confidence on the minutes: each kernel's autotuning decides it; the 512 KB bound is the code's]

**Check** (`server.check.ts`, 3 new):
- the slow page is cut off and logged with its uid and address;
- a bot takes its seat back and the others hear the `ro`;
- the room plays on for the watcher.

`server ok (79 checks)`; the section adds ~10 s.

## B — the build id: an old tab is told to reload

**The problem.** The hello checked `PROTOCOL`, which is bumped by hand and only for message shapes, and the welcome checked the arena. Anything else both bundles share could differ between a tab left open for hours and a freshly deployed server, with nothing refused: `drive.ts` and vehicle handling, `PHYSICS_STEP`, a gun's numbers, a mode's `share()`. So could a forgotten `PROTOCOL` bump. The deploy also switches the site before it restarts the game server. The likely results: corrections on every snapshot, or `mirror()` reading a missing field and throwing inside `receive()`, which stops the frame loop.

**The fix.**
- **`game/build-id.ts`** hashes, with sha256, the relative path and contents of every file under `src/` and `server/` (`*.check.ts` aside), plus `package-lock.json`. The id is the first 12 hex digits.
  - `server/` is in it, beyond the reviewer's `src/` and lockfile, because the server's half of the wire (`recorder.ts`, `room.ts`) lives there.
  - The checks aren't in it: they ship in neither bundle, and a check-only change shouldn't restart the server or reload every tab.
  - It takes ~8 ms here.
- **Both Vite configs** put it in as `__BUILD__`. The dev server (`command === 'serve'`) says `'dev'`.
- **`protocol.ts`** exports `BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev'`, so the protocol check still runs under plain node.
- **The hello carries `build`, and `PROTOCOL` is 2.** A missing or odd `build` parses as `''`, not a refusal, so a PROTOCOL-1 tab hears `version` rather than a strike and a timeout.
- **The rule.** The server lets a page in when its build equals the server's own. A `'dev'` page also gets in, unless the server is strict: `strict` is on when `TRUST_PROXY` is set, which is production behind Caddy. Otherwise it gets `err version`, "Game updated — reload the page", before the token is checked. So the local loop (`:3000` plus `npm run server`) keeps working, while production lets in only its own build.
- **`scripts/match-smoke.mjs`** imports `build-id.ts` (Node 24 in the deploy job runs `.ts` directly) and says hello with the checkout's id, the same the deployed bundles were built with.
- **`/health`** and the `listening` log line report the build and whether the server is strict.

**Verified.**
- The page bundle (`dist/assets/index-*.js`) and the server's chunk carry the same id, and no `__BUILD__` is left in either.
- Two `server:build`s are still byte-identical (11 files, sha256), so the deploy's rsync still sends `--server` only on real changes.
- **Deploy order.** With the id in `dist-server/`, any change under `src/`, `server/` or the lockfile changes the server bundle, so the deploy restarts the game server whenever the id changes. Between the site switch and the restart (seconds), a fresh page meets the old server and is told to reload. That's accepted: it used to play on mismatched code instead.

**Checks.**
- `protocol ok (52 checks)`, 6 new: a hello carries its build; no build, a number, `''` or 65 characters all parse as `''`; `BUILD` is `dev` under plain node.
- `server ok (83 checks)`, 4 new: another build and no build are each told to reload with the right text; a `dev` page plays on the local (not strict) server; a strict server refuses a `dev` page and lets in its own build.

**The gate also caught a flaw in the netplay check.** The first full run on B failed: `150 ms: every correction in 20 s of driving came from an input the network delivered too late (1 corrections, 0 late)`. Nothing in B touches prediction, so I traced it before re-running anything.
- Four plain runs, and three under four CPU-bound loops, didn't reproduce it.
- It isn't the grid's settle correction spilling over: that one lands ~2.5 s before GO, 8 of 8 times.
- A deliberate 50 ms stall of the whole process, 0.2 s before GO, reproduced it. The server repeated an input on the grid (repeats 1–2 → 3 before the drive window opened), then a 0.25 m correction came ~1.1 s into the drive with 0 repeats counted in the window.
- **The cause.** A late input in the countdown's last round trip moves which input the server uses on which step. The page decides where GO falls from snapshots a round trip old, so it sets off a step early. The repeat was real; the check counted it outside the window.
- **The fix, in the check only.** It counts late and dropped inputs from the countdown's last second (a repeat before that is seen by the page in time) and names drops as a cause too.
- With the stall provoked, 4 of 4 runs then pass, each drive correction matched by 2–3 late inputs. `netplay ok (27 checks)`: same count, same assertions, the late inputs counted from a second earlier.

## C — the bot keeps the wheel until the page's first input

**The problem.** Loading runs "Joining a match" before "Setting up the match" and "Compiling shaders". From the welcome on, `room.join` had removed the bot's brain, and with no input yet `drive()` set neutral controls. So the machine coasted and sat there while bots shot it. Mid-match joins are the lobby's normal case, so a player on a slow GPU could arrive damaged or already wrecked.

**The fix, server side** (`server/room.ts`):
- `join` puts the person's name on the machine, and their gun as a bot's copy (`botGun`, scaled like every Normal bot's). It leaves the brain in place.
- `drive()` does nothing for that seat until the first input comes off its queue (`human.last === null`); the simulation's bot drives.
- At the first input, `takeWheel` clears the brain and fits the gun at full rating, keeping the bot's ammo, reload and cooldown. The controls are the person's from that step.
- The welcome and `ro` are unchanged: they already named the person and the gun (the same gun id).
- The simulation's `castRound` hook rewinds only a seat whose person has taken the wheel. Otherwise the bot's rounds would have been rewound to the tick of the join.
- `IDLE` still counts from the join (`heardAt`), so a page that never sends anything is let go after a minute. The seat was the bot's all along.

**The client**: taking the server's word while `ack < 0`.
- Without this, the page would take the first snapshot whole and then ignore every later one until the server had used an input.
- Loading takes seconds, so the page would start from where the bot had the car at the welcome, then correct across the whole distance the bot drove.
- Now, while the server hasn't used an input (`ack < 0`), `client.ts` takes every snapshot whole, like a respawn: no easing, the inputs sent so far replayed on top. The player takes over wherever the bot left the car.
- A side effect: the grid's one "settle" correction, the car settling on its springs as it joins a new room, is gone at every latency (1 → 0). It was this same ignored interval.

**Measured.**
- server.check, a room stepped by hand, deterministic: a seat taken 10 s into a match, with no input for 8 s. The bot drove it **23 m** and fired.
- client.check, a page that "loaded" for 2.5 s mid-match (no frames, no inputs). The bot held the seat; in that room the other bots are parked, so it drove only 1.4–1.5 m. One second after the page's first frame, its car was **0.01 m** from the server's, after **0 corrections** (3 of 3 runs).
- netplay, grid hold: 0 corrections at 50, 100 and 150 ms (before: 1 each). The grid check still allows one, for a late input in the countdown's last moments.

**Checks.**
- `server ok (88 checks)`, 5 new:
  - the newcomer section: bot still at the wheel with a bot's copy of the gun; the first input takes it, full gun;
  - the room section: drives and fires under the newcomer's name; the first input hands over the controls; nobody let go within the minute; the silent one let go a minute after joining.
- `client ok (29 checks)`, 2 new: the bot keeps the seat while the page loads; the page drives on from where the bot left the car.

**The netplay grid check measured the wrong thing, and C made that visible.** With C, the grid "drift" at 150 ms read 0.202 m in 2 of 8 runs, against a 0.25 m bound; before C it had reached 0.174. The values came in whole frames (0.124 / 0.148 / 0.174 / 0.202 m), which is a car accelerating. Sampled separately:
- Until 0.3 s before GO, the page's car moved **0.000 m** (7 of 7 runs).
- All of the "drift" was the page setting off at its own GO. That is correct: the page is a one-way trip ahead of the server, and the check polls for the server's GO every 50 ms, so it saw GO late.

The check now bounds the two apart, both per latency:
- the hold, tighter than before: under 1 cm until 0.3 s before GO;
- the start: under 0.5 m by the time the server's GO is seen. A page a second early would be metres out.

It measured 0.000 m on the grid, and 0.034 / 0.064 / 0.148 m by GO at 50 / 100 / 150 ms. `netplay ok (30 checks)`: 3 new, none removed.

## D — a rewound round and a machine's past life

**The problem.** The rewind recorded poses only. Take a round aimed at a machine as the shooter drew it, up to 200 ms back, when that machine has since been wrecked and respawned. The round hit the old pose, and `damage()` then landed on the live, respawned machine at its spawn. Start protection cuts 80 %, but the 20 % got through, along with a hurt event, damage attribution and assist credit. A wreck at that tick was also named as the victim; its damage was ignored, but it was still named.

**The fix** (`server/rewind.ts`):
- Each recorded tick also stores each machine's life: its deaths so far, counted as `alive` goes false between records, or −1 for a wreck.
- A struck machine is named only if its life at the rewound tick is the one it lives now, and it's alive now.
- Otherwise its boxes still stop the round, which strikes something static (the arena's first fixed collider). The page sees sparks where the round stopped, and nobody takes a hit.

**Check** (`server.check.ts`, 3 new). A room stepped by hand, the hunter and a foe on 20–35 m of open road. The foe's life is set by hand inside the rewind's reach, and every round goes through the room's real rewind path, with its view 2–4 ticks back. Up to five tries each, since the gun's spread can miss:
- **The control.** The foe alive throughout: a rewound round hits and deals damage.
- **Died since.** Wrecked, then back 60 m away, all within the rewind's reach: the round aimed where it stood is stopped there, names no one, and its hull is unchanged.
- **A wreck at that tick.** Stopped, naming no one.

With the old victim rule put back, the check fails on "died and come back since", so it guards the fix. `server ok (91 checks)`.

## E — the input queue's depth: measured, then drained

**The claim, from reading the code.** A late arrival makes the server repeat without consuming, so each spike leaves the queue one deeper, up to `QUEUE` = 6. Nothing drains it while the page keeps pace, and every queued step ages `view` against the 200 ms rewind. The reviewer asked for measurement first.

**Instruments.**
- Each person's queue depth after every step (inputs still waiting once the step took its own) goes into a histogram. `left` logs its p50, p95 and max next to repeats and drops (`queueDepth` in `room.ts`).
- The latency simulator gains a `stall` option: every *n* ms both directions stop for a while, then deliver what they held, in order. It's for the checks only; no environment variable.

**Measured before any change** (netplay's scripted drive, 30 s on the open yard, 75 ms each way; repeats / drops / corrections over the 30 s; then two crossing shots with compensation):

| Link | Depth p50 / p95 / max | Repeats / drops / corrections | Crossing shots |
|---|---|---|---|
| ±10 ms | 2 / 3 / 3 | 1 / 0 / 1 | miss, hit |
| ±40 ms | 2 / 4 / 5 | 0 / 0 / 0 | hit, hit |
| ±10 ms, a 150 ms stall every 5 s | **4 / 5 / 5**, 2 or more for 29 of 30 s | 44–45 / 41–42 / 21–22 | miss, miss (two runs) |
| ±40 ms, a 150 ms stall every 5 s | 2–3 / 4–5 / 5 | 53–54 / 53 / 32 | miss, hit (two runs) |

- **The ratchet is real on a steady link with stalls.** After the first stall the queue stood 4–5 deep for the rest of the run, and the lag-compensated shot missed.
- **Heavy jitter drains itself.** Its underruns empty the queue, so there's no ratchet there.
- **Even a plain ±10 ms link held two.** Whatever depth the start left, it kept.

**Drain rules tried** (the same four links):

| Rule | ±10 ms | ±40 ms | ±10 ms, stalls | ±40 ms, stalls |
|---|---|---|---|---|
| none | p50 2; 1 / 0 / 1 | 0 / 0 / 0 | p50 4; 44 / 41 / 21 | 54 / 53 / 32 |
| 2 or more for 30 steps: drop one a step until 1 (the reviewer's example) | p50 1; 0 / 0 / 0 | **9 / 9 / 8** | p50 1; 73 / 73 / 39 | 65 / 65 / 33 |
| window minimum, down to 0 | p50 1; **23 / 22 / 10** | 6 / 6 / 4 | p50 1; 91 / 92 / 48 | 66 / 66 / 36 |
| **window minimum, keep 1** (chosen) | p50 1; **0 / 0 / 0**; hit, hit | **0 / 0 / 0**; hit, hit | p50 1; 72 / 72 / 38 | 54 / 55 / 32 |

- The first rule can't tell standing delay from depth that's absorbing jitter. On a ±40 ms link it took inputs the link needed, and each came back as an underrun: repeats equal drops.
- **The rule chosen** (`room.ts`, `DRAIN` = 30 steps): if the queue never had fewer than *m* ≥ 2 inputs waiting through the whole window, the oldest *m* − 1 go at the window's end. That's standing delay, not jitter, and they go at once: one correction rather than a trickle. A queue that ran down to one or none is left alone.
- It costs nothing where there's no standing depth (0 / 0 / 0 on both jitter-only links). Where stalls come, it trades a deep queue, which would also have absorbed the next stall, for more repeats at that stall: 44 → 72 repeats and 21 → 38 corrections per 30 s. That's the price of keeping an input's wait short. [medium confidence it's the right side of the trade for players: it's the side the rewind needs; a person has to feel it]

**The check** (`netplay.check.ts`, "rough link", 3 new). 75 ms each way ±10 with a 150 ms stall every 5 s; 20 s of driving, then two crossing shots.
- **The queue doesn't stand deep:** depth p50 ≤ 2 (it stood at 4 without the drain).
- **After every burst** (4 or more waiting), it's back to 1 or none within 1.25 s, measured each page step: 577–1001 ms over 6 runs.
- **Every crossing shot fired at least 500 ms after a stall began hits**, and at least one was fired so.
  - The first shot lands 205–259 ms into a stall's cycle, when the page is still drawing the target from stale snapshots. It missed every time, drain or not, as any shot there may.
  - The second, ~1.3 s in, hit every time with the drain. It missed with the drain switched off.
- With the drain switched off, the check fails: p50 4, back to 1 after 4.9 s, and the clear shot misses.
- `netplay ok (33 checks)`. The section adds ~40 s.

## F — deploy hardening

**The key's silent default.** `server/main.ts` fell back to `'defaultencryptionkey'`. Now, with `TRUST_PROXY` set (production), it exits 1 with a JSON line (`not starting`) if the key is unset or Nakama's default. It exits before it builds an arena, and it still falls back locally. This guards runs outside compose; compose's `:?` already catches an unset key. Run here: no key → exit 1; the default → exit 1; a real key → listening, `strict: true`.

**The refresh key.**
- **Verified from Nakama's source, not a running Nakama.** Nothing ran here: no Docker daemon, no Podman. In a sparse clone, `server/api_authenticate.go` at tag v3.30.0 (the version both compose files pin) and at master (`e920249`, 2026-09-22): `generateToken` and `generateRefreshToken` both call `generateTokenWithExpiry`, HS256 over the same `SessionTokenClaims` (`tid`, `uid`, `usn`, `vrs`, `exp`, `iat`). Only the key differs: `session.encryption_key` against `refresh_encryption_key`. So with the two keys equal, the game server's `verifyToken` would take a 30-day refresh token as a session. [high confidence: read in the pinned version's source]
- **`scripts/deploy.sh`** now reads `deploy/.env` first, and refuses to switch anything if:
  - the file is missing;
  - `NAKAMA_ENCRYPTION_KEY` is empty or Nakama's default;
  - `NAKAMA_REFRESH_ENCRYPTION_KEY` equals it (surrounding quotes ignored).
- **`deploy/.env.example`** says why above the two keys.
- **Run in a throwaway tree with a stub `podman`:** missing file, equal keys, equal keys with one quoted, the default key and an empty key each exit 2 with their reason, and no release is made. Distinct keys roll as before.

**Expected digests: `game/server/digests.json`**, `{ "scrapyard": "b0ce6b61", "city": "9896c223" }`. One source for three checks:
- `server/arena.check.ts` asserts each arena's digest equals its entry (an arena changed on purpose changes it there too);
- `scripts/match-smoke.mjs` now takes a seat on every arena in the file and compares the server's welcome digest;
- `scripts/arena-parity.mjs` (H) holds the browser to it.

The file sits under `server/`, so it's part of the build id: a digest change is a new build.

**The smoke test, run here** against the real server bundle and a stand-in Nakama that signs guest tokens with Nakama's default key:
- both arenas seated, `as expected`, guest deleted;
- the server logged `joined`/`left` with user ids, the new queue stats, and no token.
- Two failures, each caught where it should be:
  - `digests.json` edited but the server not rebuilt: refused `version`. The file is part of the build id, so B caught it first.
  - The server rebuilt from the edited checkout: scrapyard passes, then `AssertionError … the server's city is the one game/server/digests.json expects`, actual `9896c223`, expected `deadbeef`.

`arena ok (64 checks)`.

## G — the hello's vehicle, made explicit

`parseClient` checks the hello's vehicle against `VEHICLES`, then `room.join` drops it: the person gets their gun on the roster's machine. That's harmless while `VEHICLES` has one entry (`razor`). The MVP calls for two, though, and the day a second lands, online players would silently drive the bot's car. The vehicle swap isn't built. Instead:
- a comment at `room.join` says so;
- NET_PLAN gains §12 "Not done", with this and the seat rejoin;
- a `server.check` tripwire asserts `VEHICLES` has exactly one entry and every seated machine is `BOT_VEHICLE`. It fails with what to do the day a second vehicle is added.

`server ok (92 checks)`.

## H — browser verification in this container

This container does have a browser: Playwright 1.56.1, installed globally, with its Chromium 141.0.7390.37 (`/opt/pw-browsers`). Neither is a dependency of the game, and neither is in CI; both scripts load the global install. No dev server is started: each builds with Vite's `build()` API and serves the files with a small `node:http` server.

**`scripts/arena-parity.mjs`**:
- builds a tiny page that runs the game's own `MAPS[id].build()`, after `initPhysics()`, and `arenaDigest()`;
- opens it in headless Chromium (`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`: WebGL2 through ANGLE on SwiftShader, so the material library's GPU bake runs);
- compares each digest with `game/server/digests.json`, and exits 1 on a mismatch.

Run here:

| Arena | Digest | Colliders | Built in |
|---|---|---|---|
| Scrapyard | `b0ce6b61` | 813 | 14.3–14.9 s |
| The City | `9896c223` | 612 | 21.0–21.1 s |

The renderer reported "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) …), SwiftShader driver)". The digests and collider counts are the Node server's exactly, the reviewer's numbers too. With a wrong expected digest the script exits 1. [high confidence for Chromium; Firefox and Safari still need the owner, runbook step 5]

**`scripts/browser-match.mjs`**, two pages in one online match:
- **The setup.**
  - The game is built by Vite's API, development mode with `NODE_ENV=development`: Vite's build otherwise stays production and `window.match` isn't exposed. `VITE_GAME_SERVER` points at the test server.
  - The game server is `dist-server/main.js`, freshly built: the same build id. It runs with a test key and the static site's origin.
  - Each page is its own browser context, so its own storage and its own guest.
  - Nakama is answered by the pages' `page.route('**/v2/**')`: device sign-in, refresh and account, with tokens signed as Nakama signs them (HS256, `uid`/`usn`/`exp`, the test key) and a fresh uid per page.
  - Settings preset to low quality, half resolution, F3 on.
- **The flow:** Play → Classic in both pages, the default mode and arena (Team Deathmatch, Scrapyard).
- **Final run** (157 s in all):
  - both pages in the match 35–39 s after opening, past the loading overlay;
  - `ROOM 65eebb`, seats 0 and 4, `2 people` on both pages;
  - page a held W for 12 s: on b's screen a's car drove **8.2 m**, against 0.0 m in 5 s with no key. Respawn jumps (20 m or more between 1 s samples) are left out: there were none;
  - a's page closed: b's page counts 1 person and a's seat is the bot "Hexbolt" again (was "Guest 383e");
  - the server logged two `joined`, one `left` (queue p95 0), and none of the minted tokens.
- **How slow it was:** 0–1 frames a second. The page's match clock ran at 5 % of real time; its inputs reached the server in bursts with gaps past the 250 ms stale limit, so the car moved in spurts. The prediction corrected 329 times, up to 11.1 m.
  - That's SwiftShader drawing a city on the CPU for two pages at once. It says nothing about prediction or interpolation on a real GPU, so runbook step 7 (feel at 60 ms) stays unverified. [high confidence these frame rates are the software renderer's: SwiftShader rasterizes on the CPU, and the F3 overlay read 0–1 FPS; no real GPU was tried here]
- **The first run measured wrong.** It counted a's car 148 m on in 12 s, which was a wreck and a respawn: the car had sat idle under fire. The measure now sums only 1 s steps under 20 m between two alive samples, against an idle baseline.
- **Screenshots**, each with the F3 overlay (`ROOM`, `NET`, `CORR`, `ARENA b0ce6b61`): `a-joined.png`, `b-joined.png`, `a-driven.png`, `b-sees-a-driven.png`, `b-after-a-left.png`. They went to the session's scratchpad, not the repository; the script prints where they go (`SHOTS` sets it).

---

# Rollback, second review

## `deploy.sh`: the game server's releases

**The problem.** `server/releases/<sha>` existed only for deploys that changed the game server's bundle, but CI refreshes `server/incoming` on every deploy. Two things broke:
- **Rolling back with `--server`.** `deploy.sh <old-sha> --server`, with no `server/releases/<old-sha>`, snapshotted `server/incoming` (the newest bundle) under the old name.
- **Rolling back the site alone** across a game change left a newer game server. With the build id (B), every page of the older build is then told "Game updated — reload the page", forever.

**The fix** (`scripts/deploy.sh`):
- **A new release** (no `site/releases/<sha>` yet, so CI has just uploaded it) keeps both uploads: `site/incoming` and `server/incoming` as hard-linked snapshots (`cp -al`), each touched as the newest release.
  - `-a` had carried `incoming`'s own time over, so a snapshot that isn't switched to would have looked old and been pruned first. The test below caught that.
- **The game server** (`server/current`, then a restart) switches:
  - with `--server`;
  - on the first deploy;
  - whenever the release's kept bundle differs from the one running (`diff -rq`), and the output says so.
- **Rollbacks.** A rollback switches the game server back when its bundle differs. When the bundle is the one already running, the game server is left alone, and `server/current` keeps pointing at the release actually mounted.
- **A release no game server was kept for** (older than this change):
  - `--server` is refused before anything switches: `server/incoming` holds the newest upload, not that release;
  - without `--server`, the site switches and a warning says the game server stays, and that pages of that release will be told to reload.
- **Pruning** keeps the five newest releases of each kind, and always the one `current` points at. The running game server's release isn't deleted from under its container while newer site-only releases pile up.

**A departure from the brief ("restart only with `--server` or on first deploy").** A new release also restarts the game server when its bundle differs from the running one. The case: right after a rollback, `server/incoming` still holds the newest bundle, so the next CI deploy's rsync itemizes nothing and sends no `--server`. Its site would then run against the rolled-back game server: the same "reload forever". In the normal flow, with no rollback in between, CI's `--server` and the content check agree, so nothing changes there.

**Tested** in a throwaway tree with a stub `podman`, uploads written as rsync writes them (a new file, renamed in: the kept releases' hard links keep the old one). `server/current` after each step:

| Step | Game server | `server/current` |
|---|---|---|
| deploy A `--server` (bundle v1) | switched, restarted | `releases/A` (v1) |
| deploy B (site only) | kept, "the one running": left | `releases/A` (v1) |
| deploy C `--server` (bundle v2) | switched, restarted | `releases/C` (v2) |
| roll back to B | "isn't the one running": switched, restarted | `releases/B` (v1) |
| roll back to A | A's bundle is the one running (B's): left | `releases/B` (v1) |
| deploy D (site only; CI sends no `--server` since incoming already held v2) | "isn't the one running": switched, restarted | `releases/D` (v2) |
| `OLD --server` (a site release with no game server kept) | refused, exit 2, nothing switched | `releases/D` |
| `OLD` | site switched; warning, game server stays | `releases/D` |
| D again, then five site-only releases E–I | left each time | `releases/D` |

After the last step, `server/releases` holds D E F G H I (the five newest, plus the running D) and `site/releases` holds E F G H I.

## `held()`: no negative timeouts

The latency simulator's two `setTimeout`s (`server/server.ts`, `held()`) are now given `Math.max(0, …)`. The time left is read after the deadline was checked, so it can come out a hair below zero. Node 24, which CI runs, warns about that: `TimeoutNegativeWarning: -0.00012506828034020145 is a negative number` (once in a netplay run here). Node 22 says nothing. Run under Node 24.21, fetched with `npx node@24`: 1 warning before the change, 0 after, `netplay ok (33 checks)` both times.
