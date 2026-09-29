# Refactor audit — before

Phase 1 of `.claude/work/REFACTOR_PROMPT.md`. Written from the source as it
stood on 27 Sept 2026, before any refactor edit (a copy of that source is
the baseline the refactor was diffed against). Paths are relative to
`game/src/`.

## Baseline

| Command | Result |
| --- | --- |
| `npm run check` | pass: `router ok`, `ffa ok (143 checks)`, `tdm ok (163 checks)` |
| `npm run lint` | pass, 1 warning (`screens/Drawer.tsx:24` exhaustive-deps, pre-existing) |
| `npx tsc -b` | clean |
| `npm run build` | pass, one 4.0 MB JS chunk (size warning, pre-existing) |
| browser (:3000) | TDM on the Scrapyard: 8 machines, preMatch → active, bots fight; 30 s driven through `window.tick` |

~13.8k lines of TypeScript. No P0 defects were found: nothing crashes,
leaks per match, or breaks a rule. The problems are structural — they decide
how expensive the next vehicle, map, mode, loadout slot or network player
will be.

## Current architecture

```
main.tsx → App.tsx (screen state: loading → menu → garage → map-select → game)
             │  weapon: WeaponSpec   pick: { mode, map }
             ▼
game/GameCanvas.tsx (React)  ── imports ../hud/Hud, ../screens/{Drawer,Menu,Results,SettingsPanel}
   useEffect: physicsReady → renderer → scene/camera/sky/sun → arena (cached here)
              → prepareSounds → createMatch → composer → settings watcher
              → compileAsync → mountRenderer(frame) → window.match/camera/tick
   frame(): arena.update → match.frame → followShadow → hud.update → composer.render
             ▼
game/match.ts  createMatch()  (838 lines, one closure)
   world, effects, input, chase camera, combatants (physics car + model + brain),
   mode set-up (ffa | tdm branches), pickups view, audio voices, muzzle light,
   combat (hitscan, rockets, blast, damage, wrecks), fixed step, crash
   detection, aim assist, sight checks, turret laying, ambient effects,
   sound, per-frame interpolation, rules glue, feed/callouts, respawns,
   restart / pause / dispose, HUD-facing state
             ▼
ffa/rules.ts, tdm/rules.ts (pure) · scoring.ts (pure) · ai.ts · combat.ts
vehicle/{vehicle,parts,drive}.ts · arena/* · materials/* · effects · audio
```

Fixed step: `PHYSICS_STEP = 1/60`, accumulator in `match.frame`, frame dt
clamped to 0.1 s, render interpolation between the last two steps.

## Match runtime responsibilities (`match.ts`)

| Responsibility | Kind | Where it should live |
| --- | --- | --- |
| world, combatants, stepping, driving, firing | simulation | simulation |
| hitscan, rockets, blast, damage, wrecks, crash detection | simulation | simulation |
| respawn placement (`pickSpawn` + `sees`), outcome | simulation + mode | simulation / mode adapter |
| roster: seats, teams, starts per mode (`mode === 'tdm'` ×6) | mode | mode adapter |
| rules creation, plan hooks, timing, outcome per mode | mode | mode adapter |
| event → feed lines, callouts, announcer sounds | presentation | feed |
| models, paint, charred wrecks, turret laying, wheels, interpolation | presentation | match view |
| effects, sounds, camera shake, muzzle light, feedback pulses | presentation | match view |
| keyboard/mouse → player controls, aim + lock-on, sight of rivals | local player | pilot (control source) |
| player-view phase, pause, restart, dispose, the frame | orchestration | match |

Everything the local player sees is decided inside the simulation's own
functions (`c === player` in `fire`, `launch`, `damage`, `destroy`, `crash`,
`step`, `comeBack`), so the simulation cannot run without a local viewpoint.

## Top architectural problems

| # | Priority | Problem | Evidence |
| --- | --- | --- | --- |
| 1 | P1 | `match.ts` mixes simulation, presentation, mode glue and the local player in one closure | table above; 838 lines, 21 imports |
| 2 | P1 | Mode conditionals in the engine: a third mode edits `match.ts` in ~12 places | `mode === 'tdm'` in roster/starts, `ffa ? … : tdm ? …` for plan, timing, speed factor, outcome, titles, feed colours, restart |
| 3 | P1 | Simulation tied to a local player and to bots | `c === player` branches; aim assist and sight checks loop `bots`; HUD markers index `bots` |
| 4 | P1 | One global vehicle: `DRIVE` read directly by the driving code, the match (mass, top speed) and the garage | `vehicle/drive.ts`, `match.ts:447,426,593`, `Garage.tsx:37-38` |
| 5 | P1 | Physics imports the visual model for its layout | `vehicle/drive.ts` imports `WHEELS`, `WHEEL_RADIUS` from `vehicle/vehicle.ts` |
| 6 | P1 | Loadout is a `WeaponSpec` object threaded App → GameCanvas → match; bots' spec and the garage share it | `App.tsx:14`, `GameCanvas.tsx:23`, `match.ts:94` |
| 7 | P1 | A React component owns the runtime set-up and lives in `game/`, importing screens | `game/GameCanvas.tsx` imports `../hud/Hud`, `../screens/*` |
| 8 | P2 | Dependency cycles and inversions | `ai.ts → match.ts` (Combatant) while `match.ts → ai.ts`; `maps.ts → match.ts` (Mode); `Garage → match` (`MAX_HEALTH`); `tdm.check.ts → match.ts` |
| 9 | P2 | HUD reaches into physics | `hud/Hud.tsx` imports `wheelsOnGround` from `vehicle/drive` and reads `match.world` |
| 10 | P2 | View handles and HUD flags on the gameplay entity | `Combatant.model/wheels/turret/gun/paint`, `Combatant.seen` |
| 11 | P2 | Mode vocabulary duplicated in the UI | `MODE_NAMES` in `Hud.tsx` and `Results.tsx`; mode cards hard-coded in `MapSelect.tsx` |
| 12 | P2 | Damage, wrecks and respawns through the real simulation are untested | checks cover rules, scoring and the router only |
| 13 | P3 | Arena cache in a React module; `window.match` keeps a disposed match alive; the cached arena keeps the old scene as parent | `GameCanvas.tsx:20,106` |
| 14 | P3 | Gameplay randomness uses `Math.random` | bot aim/bursts/roam (`ai.ts`), spread (`combat.ts`), wreck throw (`match.ts:425`), FFA seed (`match.ts:786`, recorded) |
| 15 | P3 | Small per-shot allocations | `whizPast` clones twice per bot round |

Dangerous coupling, in order: (1) the simulation deciding presentation
inline — any networked or headless run has to fork `match.ts`; (2) mode
branches spread through the runtime; (3) the global `DRIVE`.

## State ownership (before)

| State | Owner | Mirrors |
| --- | --- | --- |
| match phase (rules clock, preMatch → complete) | `ffa/rules.ts` / `tdm/rules.ts` | HUD clock, banner |
| player-view phase (playing, paused, destroyed, victory, defeat) | `match.ts` `state.phase` | React `phase` state (via `onPhase`, only for menus) |
| health, alive, deadFor | `Combatant` (match) | HUD bars, markers |
| stats (kills, deaths, …) | mode rules (write) on `Combatant.stats` | HUD, results |
| vehicle pose, velocity | Rapier body → copied to `Combatant.position/rotation/velocity` after each step | model transforms (interpolated) |
| weapon ammo, cooldown, reload | `Combatant.weapon` (`combat.ts` `pullTrigger`) | HUD weapon panel |
| lives, protection, respawn times, effects | `rules.contenders[]` | HUD chips, scoreboard |
| items, hot zone | `ffa/rules.ts` | `ffa/pickups.ts` meshes, minimap |
| camera | `camera.ts` chase closure | HUD compass (`view.yaw`) |
| feed, callouts, feedback pulses | `match.ts` | HUD |
| settings | `settings.ts` (localStorage) | read live by camera, HUD, audio, renderer |
| audio voices | `match.ts` (engines, loops), `audio.ts` (context, buses) | — |

No gameplay fact lives in React state or in meshes. The one duplicate is by
design: pose in Rapier and in `Combatant` (read back once per step).

## Resource ownership (before)

| Resource | Created | Released |
| --- | --- | --- |
| WebGL renderer, context | `renderer.ts` (session) | never (one per session) |
| animation loop | `mountRenderer` (GameCanvas, VehiclePreviewCanvas) | its teardown |
| Rapier world, bodies, colliders | `createMatch` | `match.dispose` → `world.free()` |
| arena meshes, colliders | `MAPS[id].build()`, cached in `GameCanvas.tsx` | never (session cache, deterministic) |
| vehicle geometries | `buildVehicle` per combatant | `match.dispose` → `disposeGeometries` |
| materials, baked textures | `materials/library.ts` | never (session) |
| effects pools, blast light | `createEffects` | `effects.dispose` |
| pickups geometries | `createPickups` | `pickups.dispose` |
| composer, render targets | `createComposer` | `disposeComposer` |
| sun shadow map | `addSunsetLighting` | `sun.dispose()` |
| input listeners, pointer lock | `createInput` | `input.dispose` |
| audio loops (engines, spin, skid, wind, fires) | `createMatch` | `match.dispose` |
| settings listener | GameCanvas | its release |
| `window.match/camera/tick` (dev) | GameCanvas | never |

StrictMode double mounting is handled (`disposed` flag across the awaits).

## React / runtime boundary

React renders screens and the HUD markup once; the renderer's animation loop
drives the match and the HUD writes the DOM itself — correct, and kept. The
problem is placement: the runtime's whole set-up and teardown is inside a
React effect in `game/GameCanvas.tsx`, and `game/` imports `screens/` and
`hud/`, so nothing under `game/` can be used without React.

## FFA / TDM boundaries

Both rule sets are pure, event-driven, deterministic and checked — the best
part of the codebase; they stay as they are. They already share one runtime
shape (`phase`, `now`, `events`, `contenders`, `tick`, `damage`, `kill`,
`respawnDue`, `pickSpawn`, `respawned`, `remaining`), which `match.ts` uses
as an informal contract (`rules = ffa ?? tdm`). What is missing is a named
contract for the few mode-specific integration points (roster, respawn
starts, bot plan, speed factor, shots fired, outcome, restart, per-frame
view, event reporting) so the runtime stops branching on the mode.

## Vehicle architecture

`vehicle/vehicle.ts` builds the one war rig (Razor), `parts.ts` its parts,
`drive.ts` the ray-cast car. Driving is one algorithm fed by one global
`DRIVE`; hull shells and inertia are hard-coded in `createCar`; the gun mount
and barrel are constants in `match.ts`; armour is `MAX_HEALTH` in
`match.ts`; the garage copy is hard-coded in `Garage.tsx`. A second vehicle
today means editing `drive.ts`, `match.ts` and `Garage.tsx`.

## Map architecture

`maps.ts` is already a registry (`MAPS: Record<MapId, MapInfo>`) and each
arena builder returns the `Arena` contract (spawns, bases, zones, colliders,
nav graph, emitters, minimap floor, `update`). A new map is a builder plus a
registry line. Issues: `maps.ts` imports `Mode` from `match.ts`, and the
arena cache lives in the React screen.

## Loadout extension point

`App` holds a `WeaponSpec`; the garage cycles `WEAPONS`; `createMatch` arms
the player with it and builds the turret from `spec.model`; the HUD reads
`player.weapon`. There is no loadout type, no ids, and the vehicle is not
part of the selection.

## Future multiplayer boundary

What already works in its favour: pure rules with events, fixed step,
controls as plain data (`Control`) written before each step, bots as an
optional `brain`. What blocks it: the simulation's local-player branches,
presentation calls inside combat, bots assumed to be "everyone but the
player", and composition hard-wired to player + bots.

## Architecture decision (phase 2)

Keep: fixed step and interpolation, FFA/TDM rules and checks, `scoring.ts`,
`ai.ts` behaviour, arena builders, materials, effects, audio, settings, HUD
markup and its direct DOM writes, React screen state in `App.tsx`.

Change, in this order (each step builds, lints and checks green before the
next):

1. **Content registries and ids** — `WEAPONS` keyed by `WeaponId`;
   `vehicle/vehicles.ts` (`VEHICLES`: handling, chassis, turret mount,
   armour, garage copy); `drive.ts` reads the car's own handling and chassis;
   `vehicle.ts` reads its layout from the spec; `loadout.ts`
   (`Loadout = { vehicle, weapon }`, plain ids).
2. **AI decoupled** — `ai.ts` declares the `Agent` it needs instead of
   importing `Combatant`.
3. **Mode boundary** — `mode.ts` (contract), `modes.ts` (registry with the
   mode cards), `ffa/mode.ts` and `tdm/mode.ts` (adapters: roster, rules,
   plan, outcome, event reporting); `feed.ts` (feed lines and callouts the
   adapters report into).
4. **Split the match** — `simulation.ts` (player-agnostic step and combat,
   reporting through `SimEvents`), `view.ts` (models, effects, sound,
   camera; implements `SimEvents`), `pilot.ts` (local control source);
   `match.ts` keeps composition, the frame, the player-view phase and the
   lifecycle.
5. **Runtime out of React** — `runtime.ts` (scene, lighting, composer,
   settings, loop, dev globals); `GameCanvas.tsx` moves to `screens/`; the
   garage turntable becomes `game/turntable.ts`; the arena cache moves to
   `maps.ts`.
6. **Checks** — a headless `simulation.check.ts` runs both real modes
   through the simulation in node (damage, wrecks, scoring, respawns,
   outcome, content sanity).
7. **Docs** — `ARCHITECTURE.md`, `GAME_LOOP.md`, `MODULE_BOUNDARIES.md`,
   `STATE_OWNERSHIP.md`, `REFACTOR_REPORT.md`; CLAUDE.md code map.

Not doing, on purpose: an ECS, a global event bus, a HUD view-model layer
(the HUD has one consumer and writes the DOM directly; a model layer would
add a per-frame object without a second reader), a map-builder interface
(the function registry is clearer), a networking layer, seeded AI
randomness (no reproducibility requirement yet; noted as debt), deleting the
legacy generators (CLAUDE.md keeps them as reference).

## Migration risks

- Event and sound order inside a step — mitigated: `SimEvents` hooks are
  called at the same points the inline code ran.
- Rule-method monkey patching by the dev probes (`*-metrics.js`) — the
  runtime keeps calling `mode.rules.<method>(…)` through the object, never
  a detached copy.
- HUD judder if it read un-interpolated poses — it keeps reading the
  interpolated models.
- Physics drift from re-plumbed tuning — same numbers, same call order,
  same body creation order.
