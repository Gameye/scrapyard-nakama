# Free For All — implementation log

Newest last. Keep entries short.

## 2026-09-26 — audit and plan

- No git repo: a copy of `src/` before this work is kept outside the repo for diffing.
- Baseline: `npx tsc -b` clean; `npm run lint` 1 pre-existing warning (`Drawer.tsx` hook deps); `node src/game/ai.check.ts` ok.
- No test runner, event bus, store, item system or config module exists. Chosen: pure rules module with an event queue drained by the match step; assert-style `ffa.check.ts` run by plain node (Node 26 strips types) — hence `.ts` extensions on imports inside `src/game/ffa/` (rules, items, config, check).
- `MatchPhase` is the player's view (playing/paused/destroyed/victory/defeat); FFA phases live in the rules. Kept both.
- Match time was advanced per rendered frame; moved into the fixed step so all timers share one clock.
- Found: a rocket in flight still damaged (and could kill) after its shooter died. FFA now requires a live attacker; other modes unchanged.
- Found: after victory/defeat the world keeps stepping, so in-flight rockets could still score in TDM. FFA refuses damage once complete; TDM left as is (out of scope).

## 2026-09-26 — implementation

Decisions:

- Combatants are the participants: the rules take them structurally (`Participant`: name, alive, health, position, weapon, stats). `kills`/`deaths` moved into `Combatant.stats` for every mode; FFA fills in the rest. No second identity record.
- Kill/death accounting in FFA goes only through `rules.kill()`; other modes keep the two increments in `destroy()`.
- Player respawn in FFA: first built as a Respawn button unlocking when the wait ends plus a 3 s auto grace; replaced after review (see below).
- Overtime ends at the first kill after which one machine alone leads — so a non-tied machine's first kill can never win, and "most kills wins" holds even if someone catches up during overtime.
- Waits carried into overtime are cut to 5 s from its start (only ever sooner). Documented as the one exception to "the death's phase decides the wait".
- Timed effects store only an expiry on the match clock; strengths come from config at use (never stack, never mutate `DRIVE`/weapon specs). Speed boost enters `driveCar(..., boost)` for that step only.
- Protection and Armor: the stronger reduction applies, never both.
- Health/Repair/Ammo are only picked up when useful; boosts always.
- Item spots = arena nav nodes validated at match start with a Rapier ball query (no solid within 1.8 m) and ≥ 25 m from starts; City yields enough for 8-item waves 30 m apart.
- Hot zones are `Arena.zones` (City: 11 named areas); bots patrol zone spots.
- Bot perception: items within 75 m (same radius the minimap shows the player); hot zone known to all (it's announced).
- Pickup meshes are pooled and exist (parked out of sight) when the scene compiles, so the first wave doesn't compile shaders mid-fight.
- Seed per match (`match.ffa.seed`, shown in the F3 overlay) for reproducing a layout.

Bugs found and fixed:

- Duplicate kill accepted: `pending → destroyed` (needed for cancelling at match end) let `kill()` re-kill a wreck. `kill()` now requires `alive`/`protected`. Caught by the self-check.
- TypeScript kept `ffa.phase` narrowed across `complete()` calls, flagging a later `=== 'complete'` check; replaced with an `over()` call.
- oxlint treated a function named `use` as a React hook; renamed `apply`.
- `useRespawnReady` set state synchronously in an effect (lint); moved to the interval and cleanup.
- Hot-zone patrol: a bot reaching its spot hovered there until the 10 s rotation; it now moves on (`bots.arrive`).
- HUD: effect seconds and respawn countdown rendered "7.7S" / "2 S" under `uppercase`; fixed copy/casing.
- Hot-zone light posts too faint to read; brightened.
- Review cleanup: dropped the standings change-counter (the HUD's writes already skip unchanged values) and the now-unused `match.standings()`.
- HUD: a long feed line widened the top-right column (it sizes to its widest child and centres everything), shifting the minimap and clock left. The zone line and feed now sit out of flow, anchored to the column's right edge, and grow leftward; verified the minimap rect is unchanged with a 3-tag line.

## 2026-09-26 — validation

- `npm run check`: router ok, ffa ok (119 checks). `npx tsc -b` clean. `npm run lint`: only the pre-existing `Drawer.tsx` warning. `npm run build` ok (the >500 kB chunk warning predates this work: Rapier's inlined WASM).
- Browser QA at :3000 (dev build, simulation fast-forwarded with `match.frame`):
  - A: 8 cars, 3-2-1 hold then GO, 10:00 countdown, bots fight (kills/assists/revenge in the feed), leaderboard + leader line update per kill.
  - B: player killed at 4:09.7 elapsed → 10 s wait; Respawn disabled and inert before, enabled with "Ready · back in 3" after; click → protected respawn at a far start; auto-respawn after the grace also seen.
  - C/D: hot zone at 1:30 with a drop; waves at 2:00/4:00 ("Supply drop · 8 pickups"); items expire/are collected; bots collected 20 of 33 items in one full match.
  - E/F: player chain → "Double kill", "Triple kill · Killing spree"; bots' feed shows Revenge / Shutdown tags.
  - G: forced two-way tie at 9:59.6 → OVERTIME banner, "Overtime" clock, carried waits ≤ 5 s; two more machines caught up, nobody broke it → Draw, tied four share 1st, player "Defeat · 8th of 8".
  - H: FINAL MINUTE banner + red clock at 1:00, red pulse at 0:30, countdown digits in the last 10 s (tick cue wired; audio not judged by ear).
  - I: SHIELD chip 2 s after respawn; damage reduced (checks).
  - J: Play again → pre-match, zero stats, no items/zone/feed/events/effects, new seed.
  - K: Training (Scrapyard) and Team Deathmatch (City) unchanged: HUD, kill line, bot respawns, clocks.
  - Speed boost measured: 103 km/h vs 80 km/h after 4 s flat out; the following un-boosted run matched the first.
  - Pause: 2 s paused → 0 s of match clock. Full 10-minute match: 68 kills = 68 deaths. No console errors.

## 2026-09-26 — review feedback

- Death screen had Respawn / Exit to garage buttons although the player is still in the match. Now: the player is back in on time exactly like the bots (`manual` option, `respawn.grace`, the ready poll and disabled menu options deleted); the FFA death screen is a notice with only "Back in N" and an "Esc Pause" hint, clicks and keys pass through; the mouse stays captured through the death, so control resumes at once; Esc pauses from the death screen and Resume returns to it without replaying the "destroyed" stinger. Training and TDM keep their manual Respawn menu.

- Tab behaved like Esc by accident: with nothing focusable in play, Tab moved focus to the browser UI, which drops the pointer lock, which pauses. Now holding Tab (in play or while down, any mode) shows a scoreboard and its default is blocked; in menus Tab still moves focus. Board lives in the HUD (rendered once, rows written only while open); GameCanvas holds the Tab state (changes on key events only), hides the Destroyed notice while it's up, and closes it on keyup/blur. Verified in the browser for FFA (columns, crown, dimmed wreck, own row) and TDM (crews split and ranked, crew score).

- FFA death screen now shows the scoreboard too: the HUD board appears by itself while the player is down, headed "Your machine is scrap · Destroyed · Wrecked by X" and "Back in N", with an "Esc Pause" hint; it goes when they're back in. The separate notice, its React countdown timer and MatchMenu's button-less mode were deleted. TDM/Training Destroyed menus unchanged (re-checked in the browser).

## 2026-09-26 — QA and balance pass

- Audit: the code matches the spec; no bug found in the rules, wiring, HUD or results.
- Validation: `npm run check` ok (router; ffa 119 → 143 checks), `npx tsc -b` clean, `npm run lint` only the old `Drawer.tsx` warning, `npm run build` ok (the old chunk-size warning).
- Runtime: 123 full matches through `match.frame` with a console probe (`work/ffa/ffa-metrics.js`), the player seat driven even / human / idle / defensive / aggressive; UI checked in real time (Tab board, death screen, pause while down, final minute, overtime, draw, results, Play again); Training and TDM re-run end to end. Numbers in FFA_BALANCE_REPORT.md.
- Decision: no tuning value changed. Every system measured in range; the 20 s late wait costs 31 % downtime in the last two minutes but lives stay ~45 s and the arena stays live, so it waits for human playtests.
- Decision: a bot-level player with the garage Minigun wins every match (27 kills to 14). That is weapon data shared with Training and TDM, not an FFA system; flagged, not changed.
- Checks added (none removed or loosened): the spec's boundary deaths (2:59, 3:01, 4:59, 5:01, 7:59, 8:01), its overtime examples, the streak ladder, multi-kill titles, protection with armor, Ammo on a full magazine, the Repair cap, two machines back in the same step.
- Probe pitfall: `elapsed()` holds at 10:00 through overtime, so order events by `ffa.now`.

## 2026-09-26 — shared HUD changes from the TDM pre-release QA

- The scoreboard / death board (shared with TDM) no longer hides the start of
  long feed lines: it stays centred but moves left as far as needed to keep
  clear of the feed (work/tdm/TDM_IMPLEMENTATION_LOG.md). No overlap at 1280 px
  wide and up; below ~1180 px it pins to the left edge.
- The final-10-seconds countdown digits draw above the board (z-10), so they
  stay visible while the player is down.
- No FFA rule, value or timing changed; `ffa.check.ts` 143 / 143.

## Open / limitations

- Pickup and spawn "occupied" checks are 2D (a car airborne over an item still takes it).
- Item beams are visible from anywhere with a line of sight; only the minimap and bots are limited to 75 m.
- Spawn line-of-sight ignores other cars (static world only).
- The HUD stays visible (dimmed) behind the results menu, as with the other menus.
- TDM keeps its pre-existing post-match rocket scoring (out of FFA scope).
- A draw ends as `defeat` (`MatchPhase` has no draw) and plays the defeat sting; the Results screen says Draw. Shared with TDM.
- Networking not started: the rules module is DOM/Three/Rapier-free and event-driven so it can sit behind a Nakama match handler later.
