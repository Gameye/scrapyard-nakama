# Refactor report

The engineering refactor asked for in `.claude/work/REFACTOR_PROMPT.md`,
done on 27 Sept 2026. The audit it started from is
[REFACTOR_AUDIT.md](REFACTOR_AUDIT.md); the result is described in
[ARCHITECTURE.md](ARCHITECTURE.md), [GAME_LOOP.md](GAME_LOOP.md),
[MODULE_BOUNDARIES.md](MODULE_BOUNDARIES.md) and
[STATE_OWNERSHIP.md](STATE_OWNERSHIP.md). No gameplay value, rule, visual,
sound or UI design changed. Paths under `game/src/`.

## What changed, and why

1. **`match.ts` split by responsibility** (838 → 219 lines). The simulation
   (`game/simulation.ts`) now holds the machines, the fixed step, combat,
   wrecks and respawns, and knows nothing of meshes, sound, the camera, the
   DOM or which machine is the local player; it reports what happens through
   `SimEvents`. The presentation (`game/view.ts`) builds and moves the
   models, plays effects and sound, runs the chase camera and the HUD
   pulses. The local player became a control source (`game/pilot.ts`), like
   the bots' brains. The feed and announcer are `game/feed.ts`. `match.ts`
   keeps composition, the frame, the player-view phase and the lifecycle.
   *Why:* the simulation had the local player's feedback inline in its
   combat code (`c === player` in seven functions), so nothing could run it
   without a screen, and a network player had nowhere to plug in.
2. **Mode boundary.** `game/mode.ts` names the contract the runtime already
   used informally (`rules = ffa ?? tdm`) plus the few integration points;
   `ffa/mode.ts` and `tdm/mode.ts` implement it (seats, respawn starts, bot
   plan, speed factor, shots fired, outcome, event reporting, scenery, debug
   lines); `game/modes.ts` registers them with their arena-screen cards.
   *Why:* about twelve `mode === …` / `ffa ? … : tdm ? …` branches in the
   runtime; a third mode would have edited all of them. The rules files are
   untouched.
3. **Runtime out of React.** The session set-up (scene, lighting, arena,
   composer, settings, loop, dev globals) moved from the `GameCanvas` effect
   into `game/runtime.ts` (`startGame`); `GameCanvas.tsx` moved to
   `screens/` and only starts/disposes it; the garage turntable became
   `game/turntable.ts`. *Why:* `game/` imported `screens/` and `hud/`, and
   the runtime could not exist without a React effect.
4. **Content registries by id.** `WEAPONS` (`combat.ts`) and `VEHICLES`
   (`vehicle/vehicles.ts`) are records keyed by id; `MODELS`
   (`vehicle/vehicle.ts`) maps a vehicle id to its model. Driving reads each
   car's own `Handling` and `Chassis` instead of the global `DRIVE`; the gun
   mount, barrel and armour came out of `match.ts` into the vehicle spec.
   *Why:* one global vehicle, and physics importing the visual model for its
   wheel layout.
5. **Loadout.** `game/loadout.ts`: `{ vehicle, weapon }` as ids, held by
   `App`, edited by the garage, resolved by the match. *Why:* the selection
   was a `WeaponSpec` object; ids can be saved or sent, and more slots are
   more fields.
6. **Decoupling fixes.** `ai.ts` declares the `Agent` it needs (was
   importing `Combatant` from `match.ts`: the only import cycle); `maps.ts`,
   `MapSelect`, `Results`, `Hud` stopped importing `match.ts` for types or
   values they didn't need; the HUD no longer calls into physics (`debug()`
   comes from the match and the mode); mode names come from the registry
   (were duplicated in `Hud.tsx` and `Results.tsx`); the arena cache moved
   to `maps.ts` (`loadArena`).
7. **Resource hygiene.** Teardown clears the scene (the cached arena and sky
   dome no longer keep the old scene alive) and removes the dev globals it
   set; the pointer relock goes through the match (`match.lock()`) instead
   of the screen reaching for the renderer's canvas; `whizPast` stopped
   allocating per round.
8. **Checks.** `game/simulation.check.ts`: both real modes through the real
   simulation in node — pre-match hold, hitscan damage, wrecks, team and FFA
   scoring, feed reporting, respawn on a rules-picked start, rocket blast,
   the result, restart, and the weapon/vehicle numbers. Added to
   `npm run check`.
9. **Seeded randomness.** Each match draws one seed (`match.seed`, in the
   F3 overlay; a restart draws a new one). The simulation's stream (bot aim
   wobble, bursts, roaming, weapon spread, the throw of a wreck) and the FFA
   rules' stream (items, zones) come from it; `think`, `scatterAim` and
   `castRound` take the stream instead of calling `Math.random`. Only the
   seed pick and presentation (particles, sound pitch, camera shake) stay on
   `Math.random`. *Why:* same seed + same controls = same match — a
   bots-only match replays bit for bit, the base for replays, bug repros and
   client prediction; the prompt's "controlled RNG where determinism
   matters".
10. **Docs.** This folder; CLAUDE.md's code map and commands; the balance
   probes (`.claude/work/{ffa,tdm}/*-metrics.js`) follow the new
   `window.match` shape (`match.mode.rules`, `match.mode.tactics`,
   `match.chase`, `match.others`) and no longer splice the player into a
   bots list (the simulation thinks for any machine with a brain).

## Architecture before

One closure (`createMatch`) owned the world, combatants, weapons, rockets,
mode set-up, AI glue, effects, audio, camera, aim assist, HUD state, feed
and lifecycle; the React screen owned the rest of the session. See the
audit.

## Architecture after

```
screens/GameCanvas ─ startGame (runtime.ts) ─ createMatch (match.ts)
                                                 ├ simulation.ts ── MatchMode ── ffa/mode.ts · tdm/mode.ts ── pure rules
                                                 ├ view.ts        (implements SimEvents)
                                                 ├ pilot.ts       (local control source)
                                                 └ feed.ts        (implements Feed)
```

## Module responsibilities / state ownership

See [MODULE_BOUNDARIES.md](MODULE_BOUNDARIES.md) and
[STATE_OWNERSHIP.md](STATE_OWNERSHIP.md). In short: gameplay facts are
owned by the simulation's combatants (hull, pose read back from Rapier,
weapon, controls) and the mode's rules (clock, lives, scores, items);
everything the player sees or hears is owned by the view, pilot and feed;
React owns screens only.

## FFA boundary

`ffa/rules.ts`, `items.ts`, `config.ts`, `ffa.check.ts` unchanged.
`ffa/mode.ts` seats eight machines on their own teams, builds the item
spots (a physics query), hands the bots `targetValue`/`errand`, reports
`kill`, `death`, `nemesis`, `item`, `wave`, `zone`, `phase` to the feed,
and decides the result (sole leader's team, or a draw). `pickups.ts` stays
the view; the registry hands it to the adapter, so the adapter runs
headless.

## TDM boundary

`tdm/rules.ts`, `types.ts`, `config.ts`, `tactics.ts` unchanged
(`tdm.check.ts` now imports `Agent` from `ai.ts` instead of `Combatant` from
`match.ts`). `tdm/mode.ts` seats four a side from the arena's bases, builds
the respawn starts (both bases + the spawns) and homes, wires the tactics
into the plan, forwards `fired` (protection ends on firing), reports
`kill`, `death`, `finalMinute`, `phase`, and decides the result.

## Vehicle architecture

A vehicle is a `VEHICLES` entry (handling, chassis, turret mount, armour,
garage copy) plus a `MODELS` builder. `drive.ts` is one driving model for
all; the simulation, view and garage read the spec by id. Only the Razor
exists; the garage shows `loadout.vehicle` (a vehicle pager is UI work for
the second vehicle).

## Map architecture

Unchanged in shape — `MAPS` registry of builders returning the `Arena`
contract — with the session cache now beside the registry (`loadArena`).
Mode requirements stay where they are enforced: `tdm/mode.ts` throws for an
arena without bases, as before.

## Loadout architecture

`Loadout = { vehicle, weapon }` flows Garage → App → GameCanvas →
`startGame` → `createMatch`, which resolves the ids. A `super` slot is a
field here, a pager in the garage, a second weapon state armed in
`createMatch`, a control bit the pilot sets, a trigger in the simulation's
step and a HUD panel — no change to the rules, physics, runtime lifecycle
or navigation.

## Multiplayer readiness

Not implemented, no placeholder code. What exists: a simulation that runs
without presentation (proved in node), controls as plain data written by
interchangeable control sources, bots as "machines with a brain" rather
than "everyone but the player", presentation fed only by `SimEvents` and
state reads, and a loadout of ids. Where the authoritative copy runs
(Nakama's JavaScript runtime is not node; Rapier needs WebAssembly) is an
open decision — see ARCHITECTURE.md.

## Files

Added: `game/runtime.ts`, `game/simulation.ts`, `game/simulation.check.ts`,
`game/view.ts`, `game/pilot.ts`, `game/feed.ts`, `game/mode.ts`,
`game/modes.ts`, `game/loadout.ts`, `game/turntable.ts`,
`game/ffa/mode.ts`, `game/tdm/mode.ts`, `game/vehicle/vehicles.ts`.

Moved: `game/GameCanvas.tsx` → `screens/GameCanvas.tsx` (now 248 lines, was
319).

Removed: `game/VehiclePreviewCanvas.tsx` (→ `game/turntable.ts` + a small
component in `Garage.tsx`).

Reduced: `game/match.ts` 838 → 219; `screens/MapSelect.tsx` 160 → 138
(cards from the registry); `hud/Hud.tsx` 709 → 697.

Kept on purpose: `game/VehicleGenerator.ts`, `game/ArenaGenerator.ts`,
`game/proceduralTexture.ts` — unused, but CLAUDE.md keeps them as reference
until the user retires them.

Whole client: 13,794 → 14,646 lines (the simulation check is 198 of the
difference; the rest is the contracts, the vehicle data and comments).

## Validation

| | Result |
| --- | --- |
| `npm run check` | pass — `router ok`, `ffa ok (143 checks)`, `tdm ok (163 checks)`, `simulation ok (28 checks)` |
| mutation tests of the new check | fails as it should with scoring removed from wrecks ("the wreck is reported and fed as a kill"), with respawns removed ("back in after the wait, whole"), and with one `Math.random` put back into the bots' aim ("the same seed replays the same match, to the last bit") |
| `npx tsc -b` | clean |
| `npm run lint` | pass; the one warning is the pre-existing `screens/Drawer.tsx:24` exhaustive-deps |
| `npm run build` | pass; bundle 3,996 → 4,000 kB (the > 500 kB chunk warning predates this) |
| import cycles (type imports included) | 1 → 0 |
| browser, dev build :3000 | menu → garage (weapon swap rebuilds the turret on the turntable) → arena select → TDM and FFA on the Scrapyard: countdown hold, HUD (scores, board, clock, minimap, markers, feed, weapon panel, F3 overlay), bots fight, the player wrecked → death board with killer and wait → respawn, pause freezes the clock, resume, forced buzzer → results (TDM MVP and rosters; FFA placing and crown), Play again resets everything, rocket pods (blast shove and damage), exit to garage disposes the match and clears `window.match`; no console errors |
| TDM regression (probe, 10 even matches, The City) | kills a match 85.5 (report 85.6); per-seat kills 9.3–11.5 (9.2–11.7); assists per kill 1.0 (1.0); MVP on winning team / top killer 80 % / 70 % (74 % / 68 %); spawn nearest median 118.6 m, none under 50 m |
| FFA regression (probe, 20 even matches, The City) | kills a match 86.2 ± 1.8 (reports 87.6, 86.6); winner / 2nd / last 14.8 / 13.1 / 6.5 (15.0 / 13.3 / 6.8); overtime 7 / 20 (9 / 50, 4 / 20); kills a minute by phase 9.5 · 8.5 · 8.3 · 7.2 (9.9 · 9.0 · 8.2 · 7.4); downtime 9.9 · 17.7 · 25.9 · 29.8 % (10 · 19 · 26 · 31 %); items spawned / collected 37.0 / 23.7 (37 / 23.1); spawn nearest median 115.5 m, none under 50 m; wait mismatches, alternation errors, stale death screens 0 · 0 · 0; equal player 11.4 kills, 10.2 deaths, place 4.3 (10.9 · 10.6 · 4.6) |
| FFA again after seeding (probe, 10 even matches, The City) | kills a match 85.3 ± 1.7; winner / 2nd / last 14.6 / 12.7 / 6.5; kills a minute by phase 9.9 · 8.5 · 8.0 · 7.4; downtime 10.3 · 17.7 · 24.9 · 30.8 %; items 37.0 / 24.5; spawn median 116.7 m; overtime 0 / 10; 0 · 0 · 0 respawn anomalies — the seeded streams play like `Math.random` did |

The probes play whole matches through `match.frame()` with the player seat
on the bots' brain and gun ("even"), so they exercise the new simulation,
modes, pilot hand-off and restart end to end; all three land on the numbers
the balance reports recorded before the refactor.

The live graphics switch was exercised through `updateSettings` (quality
low → medium → high, resolution 50 %, then the saved settings restored), not
by clicking the drawer; a fresh load through to a match logged no console
errors. Not checked: audio by ear (the browser ran as a background tab),
window resizing.

## Remaining technical debt

- A match with a human in it replays only with the same input per step;
  nothing records input yet. Rapier is bit-exact on one build; across
  browsers and machines it would need its cross-platform deterministic
  build before lockstep or server reconciliation relies on it.
- The HUD and results screen still branch on `match.mode.kind` for their
  mode panels — UI integration by design; a HUD view model was not added
  (one consumer).
- The view reads wheel contacts and suspension straight from the Rapier
  controller (dust, tyre squeal, wheel poses) — a presentation adapter
  reading the physics engine, acceptable today; a networked client without
  local physics would need them in the pose data.
- The practice roster (bot names, `BOT_MINIGUN`, `BOT_VEHICLE`) lives in
  `match.ts`; a server-provided roster replaces it there.
- `screens/Drawer.tsx` lint warning; the 4 MB single chunk.
- The balance probes rely on internals (`window.match` shape) by nature.

## Recommended next steps

1. Decide where the authoritative simulation runs for Nakama (node sidecar
   vs. server-side port) before writing any networking.
2. A second vehicle, to exercise `VEHICLES`/`MODELS` and add the garage's
   vehicle pager.
