# Free For All — implementation plan

Scope: turn the existing local FFA (player + 7 bots, The City) into a 10-minute
score-based deathmatch with overtime, backoff respawns, spawn safety, combat
statistics, items, hot zones, comeback weighting, bot awareness, HUD and a
results screen. No networking (Nakama comes later).

## 1. Architecture found (audit)

| Area | Where | Notes |
|---|---|---|
| Entry / screens | `src/App.tsx`, `src/screens/*` | menu → garage → map select → `GameCanvas`; no router, no store |
| Gameplay screen | `src/game/GameCanvas.tsx` | builds scene + composer, owns the rAF loop via `mountRenderer`; React re-renders only on `MatchPhase` changes; `MatchMenu` = pause / destroyed / victory / defeat overlays |
| Match | `src/game/match.ts` | `createMatch()` closure: Rapier world, combatants, weapons, rockets, effects, chase camera, audio. Fixed 60 Hz `step()` via accumulator in `frame()`; `MatchPhase` = `playing / paused / destroyed / victory / defeat` (the *player's* view of the match) |
| Participant | `Combatant` in `match.ts` | name, team (FFA: own team each), health, alive, deadFor, kills, deaths, weapon, control, brain, pose |
| Damage / death | `match.ts` `damage()` / `destroy()` | hitscan via `castRound`, rockets flown per step, blast falloff; one death per life (`alive` guard) |
| Weapons | `src/game/combat.ts` | data specs, magazine + reload, `pullTrigger()` per step |
| Vehicle physics | `src/game/vehicle/drive.ts` | `DRIVE` tuning, `driveCar()` per step |
| Bots | `src/game/ai.ts` | `think()` per step: grudge 6 s → nearest rival ≤ 70 m, nav-graph routes, burst fire ≤ 55 m, circle / stand-off, roam |
| Spawns | `arena.spawns` (City: 16 perimeter-road starts), `spawnFor()` = farthest from live rivals, skipping occupied |
| Map | `src/game/arena/city.ts` | street grid, nav graph (`arena.nav`), colliders, blocks with landmarks |
| HUD | `src/hud/Hud.tsx`, `src/hud/minimap.ts` | rendered once; `update()` writes DOM every frame (only changed values) |
| Timer | `state.elapsed` += frame dt while playing | display only; FFA/TDM time limit read it |
| Audio / VFX | `src/game/audio.ts` + `sounds.ts` (synthesized cues), `src/game/effects.ts` (pooled particles) |
| Items / pickups | none | — |
| Event bus / store | none | `onPhase` callback + `feedback` pulses read by the HUD |
| RNG | `src/game/rng.ts` `createRng(seed)` (mulberry32) |
| Tests | none; `node src/game/ai.check.ts` assert-style self-check |

FFA today: 8 machines, kill limit 12, 8-minute limit, bots respawn after 4 s,
the player respawns by hand, one-line kill message, leader line in the HUD.

## 2. Reuse (no parallel systems)

- Fixed step in `match.ts` is the simulation clock: the FFA rules tick inside `step()`.
- `damage()` / `destroy()` stay the only combat entry points; FFA hooks into them.
- `Combatant` stays the participant record (the FFA rules take combatants as `Participant`s structurally — no second identity).
- `ai.ts` targeting, routing, firing untouched; two optional hooks added.
- `arena.spawns` for starts, `arena.nav.nodes` for item spots, `createRng` for seeded randomness.
- HUD imperative update pattern, `MatchMenu`, `playSound` cue table, `materials` library for pickup visuals.

## 3. Changes

New (`src/game/ffa/`, pure TS except `pickups.ts`):

| File | Role |
|---|---|
| `config.ts` | `FFA` tuning object: every FFA number |
| `rules.ts` | `createFreeForAll()`: match state machine + clock, participant life cycle, respawn schedule, spawn scoring + camp benching, kills/assists/damage/score/streaks/multi-kills/revenge/nemesis, effects, standings, result, event queue, bot target value |
| `items.ts` | item catalogue + rarity, weighted picks, waves, TTL, pickup, hot-zone rotation, comeback weighting, bot errands (item/zone awareness) |
| `pickups.ts` | Three.js view: pooled pickup meshes + hot-zone ring (render only) |
| `ffa.check.ts` | assert-style self-check (`node src/game/ffa/ffa.check.ts`) |

Modified:

| File | Change |
|---|---|
| `match.ts` | stats object on combatants; FFA wiring (damage modifiers, kill hand-off, scheduled respawns, pickups, speed factor, pre-match hold, results, feed/callouts); `elapsed` moved into the fixed step |
| `vehicle/drive.ts` | `driveCar(..., boost = 1)` scales engine pull and top speed without touching `DRIVE` |
| `ai.ts` | optional `Plan` hooks: target value (skip protected, leader bias) and errands (items, hot zone) |
| `arena/arena.ts`, `arena/city.ts` | `Arena.zones` (named hot-zone areas) |
| `hud/Hud.tsx`, `hud/minimap.ts` | timer states, leaderboard, feed, callouts, pickups, effect chips, hot zone, banners, markers, minimap zone/items |
| `GameCanvas.tsx` | gated FFA respawn with countdown, results screen |
| `audio.ts`, `sounds.ts` | cues: `pickup`, `announce`, `tick` |
| `screens/MapSelect.tsx`, `PatchNotesPanel.tsx` | FFA copy |

## 4. Data

- `Stats` (per combatant, all modes; FFA fills every field): kills, deaths, assists, damageDealt, damageTaken, combatScore, streak, bestStreak, multiKills, bestMulti, revengeKills, nemesisDeaths, itemsCollected.
- Rules-side record per participant: `life`, `respawnAt`, `protectedUntil`, `spawnedAt`, `spawn`, per-life `hits` (damage + last hit time per rival), multi-kill chain, `effects` (expiry per timed effect).
- `unanswered[k][v]` matrix for revenge / nemesis.
- Items: `{ id, type, rarity, x, z, spot, born, expires, state, hot }`.
- Events: discriminated union drained by `match.ts` each step.

## 5. State transitions

See FFA_STATE_MACHINE.md. Guarded tables in `rules.ts` (`PHASES`, `LIVES`): an
illegal move is refused (returns false) — that refusal is also what makes kill,
death and respawn handling idempotent.

## 6. Order

0. Audit + these docs.
1. Match foundation: clock, phases, stats, kill/death, winner, final minute, overtime → checks.
2. Respawn: phase delays, spawn scoring, protection, camp benching → checks.
3. Combat stats: attribution, assists, score, streaks, multi-kills, revenge/nemesis → checks.
4. Items: catalogue, rarity, waves, TTL, pickup, effects, cleanup → checks.
5. Hot zone + comeback → checks.
6. Bots: plan hooks, errands, target value → checks.
7. Wiring + HUD + pickups view + audio.
8. Results screen.
9. Integration: typecheck, lint, checks, build, browser QA, self-review.

Dependencies: 2–6 build on 1; 7 needs 1–6; 8 needs 1 and 3.

## 7. Testing

Automated: `ffa.check.ts` drives the pure rules with plain participants, a
seeded RNG and fixed steps (see FFA_TEST_PLAN.md). Runtime: the dev build
exposes `window.match` (with `match.ffa`) and `window.tick`; scenarios run in
the live tab at `:3000`.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Posthumous rocket kills credit a dead machine | FFA damage requires a live attacker |
| Two kills in one step (overtime) | kills are processed in step order; the first deciding kill completes the match, later ones are refused |
| Pending 20 s respawns strand tied leaders in overtime | waits are cut to 5 s from overtime start |
| New materials compiling mid-match (hitch at the first wave) | pickup meshes exist (parked out of sight) when the scene is compiled |
| Bots all rushing one item | errands are per bot and re-evaluated; losing a race just re-plans |
| Breaking training / TDM | FFA code runs only when `mode === 'ffa'`; shared changes are defaults-preserving (`boost = 1`, optional AI plan, optional minimap extras) |

## 9. Compatibility

- Training and TDM keep their rules, respawns, HUD and menus. Shared changes:
  `c.kills` → `c.stats.kills` (same numbers), match time advanced per fixed step
  instead of per frame (same rate, no drift).
- Rules module has no DOM/Three/Rapier imports, so it can move behind a Nakama
  match handler later: feed it damage/kill/position inputs, send its events and
  standings as snapshots.
