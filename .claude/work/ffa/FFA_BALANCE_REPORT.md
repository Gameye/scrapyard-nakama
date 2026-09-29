# Free For All — balance report

Second pass (QA, balance, robustness) over the finished FFA, 2026-09-26. Rules
`src/game/ffa/`, wiring `src/game/match.ts`, bots `src/game/ai.ts`; values `FFA`
in `src/game/ffa/config.ts` (FFA_BALANCING.md). Result: no gameplay value or
rule changed; the checks grew to cover the spec's exact cases.

## Observed

### Method

- **Audit**: rules, items, config, pickups view, match wiring, bots, HUD,
  minimap, results screen and every FFA doc, read against the code. The code
  matches FFA_GAMEPLAY_SPEC.md.
- **Automated**: `npm run check`, `npx tsc -b`, `npm run lint`, `npm run build`,
  before and after.
- **Runtime**: dev build at :3000, The City. 123 full matches played in the
  live page through `match.frame()` at the game's fixed 60 Hz step (the
  simulation the player gets, fast-forwarded: ~7 s a match), plus real-time
  sessions and screenshots for the UI.
- **Instrumentation**: `work/ffa/ffa-metrics.js`, a console probe that wraps
  the live rules (`damage`, `kill`, `respawned`, `tick`) and samples state
  each step. No game code, no logging.

The player seat was driven five ways:

| Scenario | Matches | Player |
|---|---|---|
| even | 50 (+3 checking the probe) | the bots' brain and gun (`BOT_MINIGUN`), no aim assist: eight equal machines |
| human | 20 | the bots' brain with the garage Minigun and the camera's lock-on assist |
| idle | 10 | no input: parked wherever it spawns |
| defensive | 10 (+10 re-run) | even, but hunts nobody; only hits back |
| aggressive | 10 (+10 re-run) | even, but hunts twice as far |

"human" is a bot that drives and aims like a bot but carries the player's gun
and aim assist; it bounds a competent player, it isn't one. A first human
batch aimed along the car's heading (a probe bug) and was thrown away.

### Behaviour verified

| Contract | How |
|---|---|
| Wait fixed at death by elapsed phase (5 / 10 / 15 / 20 s, overtime 5 s) | check at 2:50, 2:59, 2:59.98, 3:01, 3:10, 4:50, 4:59, 5:01, 5:10, 7:50, 7:59, 8:01, 8:10; runtime: all ~2,600 deaths of 30 matches waited exactly their phase's value, deaths at 2:59.7, 3:01.6, 4:59.5, 5:01.6, 7:59.7, 8:00.1 among them |
| A wait carried into overtime is cut to ≤ 5 s after it starts | check; the spec's one documented exception (only ever sooner) |
| Automatic respawn, no menu | runtime: board headed "Your machine is scrap · Destroyed · Wrecked by X", "Back in N", Esc hint, no buttons; back in on time with no input |
| Back in on time, once | ≤ 1 step late (16.7 ms), never early; death → respawn strictly alternates (0 breaks); 7 same-step respawns, all on different starts |
| No stale death screen | 0 samples of a live player on the death screen, or a dead one not waiting |
| Pause while down | Esc → Paused (Resume · Settings · Exit to garage), wait frozen (8.05 s for 2 s), Esc → back to the death screen, then in on time |
| Spawn protection | 2 s, damage × 0.2, the stronger of protection and armor, cleared by death, the end and a restart (checks); SHIELD chip 2.0 s (runtime) |
| Speed boost | flat test: top speed 98 → 127 km/h (+30 %); 0–6 s run identical before the boost and after it expired; full lock for 1.5 s: 79° at 90 km/h unboosted, 65° at 118 km/h boosted, no roll, side slip < 1 m/s |
| Items | TTL, one collector, Health/Repair need damage, Ammo a magazine short, caps (checks); none left after the end or Play again (runtime) |
| Match end | 15 s after completion: statistics and feed unchanged, no items, zone, effects, protection or pending respawn; bots stopped, not firing |
| Restart (Play again) | pre-match, zero statistics, no items / zone / feed / effects / nemesis, everyone alive on the grid |
| Final minute | banner and red clock at 1:00, pulse at 0:30, fading digits from 0:10 above the road |
| Overtime | "Overtime · First kill wins" banner, amber clock labelled Overtime, feed line; a 60 s stand-off ends in a draw with the tied sharing 1st |
| Tab scoreboard | 8 rows, #, machine, K D A, streak, damage, score; own row highlighted; crown on the sole leader; clock kept; no pause; release restores the HUD; a real Tab keeps focus in the page |
| Results | Victory / Defeat / Draw, "Nth of 8", kills, deaths, assists, damage, score, best streak, K/D, multi-kills, revenge, items, damage taken, nemesis; standings by kills even when score disagrees (15 kills / 2,392 above 14 / 2,601) |

## Measurements

Even scenario (50 matches) unless noted. Per match unless noted.

### Match flow

| | |
|---|---|
| length | 10:04 average, overtime included |
| overtime | 9 / 50 (18 %), all decided by a kill, 21.5 s average |
| kills | 87.6 a match, 8.7 a minute; every death credited |
| winner / 2nd / last | 15.0 / 13.3 / 6.8 kills; winning margin 1.8 |
| equal player | 10.9 kills, 10.6 deaths, average place 4.6, 5 wins in 50 (fair share 6.25) |
| assists | 44.7 (0.51 per kill); damage per kill 107 |

### Respawn by phase

| Elapsed at death | Wait | Kills / min | Average life | Median life | Downtime |
|---|---|---|---|---|---|
| 0:00–3:00 | 5 s | 9.9 | 36 s | 33 s | 10 % |
| 3:00–5:00 | 10 s | 9.0 | 45 s | 39 s | 19 % |
| 5:00–8:00 | 15 s | 8.2 | 44 s | 37 s | 26 % |
| 8:00–10:00 | 20 s | 7.4 | 46 s | 39 s | 31 % |
| overtime | 5 s | 9.6 | 39 s | 37 s | — |

Downtime: machine-time spent waiting (20 % overall; 11.4 s average wait,
42 s average life).

### Spawns

- ~10,400 respawns: nearest live rival at the chosen start 117 m median; a
  rival within 50 m in under 0.1 % (none of the last 1,880; closest 52 m);
  16 of 4,271 (even) in the hot zone.
- Deaths within 8 s of spawning: 0 in every scenario but human (0.3 %, after
  protection ended). Deaths while protected: 0. Back-to-back spawn deaths: 0.
- Protected machines dealt no damage; protection absorbed ~0.1 hull a match.
- Idle player: 4.2 deaths a match, 98 s average life, none within 15 s of a
  spawn; starts 76–165 m from the nearest rival.

### Items

| Item | Rarity | Spawned | Collected | Expired |
|---|---|---|---|---|
| Health | Common | 6.8 | 4.5 | 2.3 |
| Repair | Common | 7.2 | 4.5 | 2.7 |
| Ammo | Common | 7.2 | 2.3 | 4.8 |
| Speed boost | Rare | 6.3 | 4.7 | 1.5 |
| Armor | Rare | 6.4 | 4.5 | 1.8 |
| Damage boost | Epic | 3.0 | 2.5 | 0.5 |
| all | | 37 | 23.1 (62 %) | 13.5 |

- Rarity: 57 % common, 34 % rare, 8 % epic (9 % over all 80 matches). 41 % of
  items land in the hot zone and roll its table: 0.41 × 15 % + 0.59 × 5 % ≈ 9 %.
- Taken 21 s after landing on average.
- The equal player takes 13 % of pickups and 10.5 % of damage boosts (fair
  share 12.5 %).

### Effects

| Effect | Pickups | Measured |
|---|---|---|
| Damage boost | 2.4 | 0.36 kills a pickup; kill rate × 1.6 while active; 40 hull dealt a window; 6 % of holders die during it; the boost's extra damage is 0.3 % of all damage |
| Armor | 4.3 | 11 hull prevented a pickup (48 a match); death rate × 0.24 while active |
| Speed boost | 4.7 | 7.7 of 8 s used a pickup |
| Repair | 4.5 | 5.9 of 6 s used a pickup |
| Health | 4.5 | |

Human player: 0.55 damage boosts a match, 0.9 kills each (10 of its 546 kills).

### Hot zone

| | even | human |
|---|---|---|
| machine-time inside | 14 % | 14 % |
| kills inside (after 1:30) | 25 % | 26 % |
| kills per machine-second, inside vs outside | × 1.6 | × 1.8 |
| pickups inside | 43 % | 41 % |
| zone time with no target | 13 % | 11 % |

### Comeback

| | even | human |
|---|---|---|
| machines trailing at some point | 6.2 of 8 | 7 of 8 |
| alive time spent trailing | 31 % | 67 % |
| kill rate while trailing | × 1.05 | × 0.82 |
| pickups by trailing machines | 34 % | 74 % |

Trailing machines get slightly more than their time's share of pickups, and
no extra kills.

### Feedback

| | even | human |
|---|---|---|
| Killing spree / Rampage / Unstoppable / Godlike | 5.2 / 0.3 / 0 / 0 | 8.7 / 1.7 / 0.4 / 0 |
| Double / Triple / Quad / Overkill | 7.8 / 0.5 / 0 / 0 | 12 / 2 / 0.55 / 0.1 |
| Revenge | 31.7 (36 % of kills; ~4 for the player) | 32 |
| Nemesis | 6.5 | 9.6 |
| Shutdown | 5.1 | 8.5 |

### Bots

| | even | human |
|---|---|---|
| bots holding the sole leader as target, vs an even share of live rivals | 24.8 % vs 18.2 % (× 1.36) | 21.6 % vs 18.6 % (× 1.17) |
| 3+ bots heading for one item | 2.0 % of item samples, at most 5; 80 % of those are Health / Repair | 2.5 %, at most 4 |
| low-hull bots detouring to heal while holding a target | 114 bot-seconds (~3 % of bot time) | 132 |
| the sole leader's share of deaths | 11 % | — |

### Play styles (even gun unless noted)

| Style | Kills | Deaths | Items | Place | Wins |
|---|---|---|---|---|---|
| even | 10.9 | 10.6 | 3.0 | 4.6 | 5 / 50 |
| aggressive | 11.8 | 10.6 | 2.4 | 4.5 | 2 / 10 |
| defensive | 6.7 | 8.8 | 7.5 | 7.1 | 0 / 10 |
| idle | 0 | 4.2 | 0 | 8 | 0 / 10 |
| human (garage gun) | 27.3 | 8.9 | 4.8 | 1.0 | 20 / 20 |

Overtime over all 123 matches: 25; 24 settled by a kill, 1 draw (13 / 13 / 13
for 60 s).

## Problems

1. **Late deaths cost a third of the late game.** 8:00–10:00: 31 % downtime
   (10 % early), 7.4 kills a minute (9.9 early). Lives stay ~45 s and 5.5 of 8
   machines are live on average, so the arena doesn't empty. This is the
   design ("each death costs more as the clock runs down"). Risk: a human
   sitting out 20 s twice in the last two minutes. Keep; first value to
   revisit after human playtests.
2. **A player with the garage gun wins every match.** Human scenario: 27.3
   kills to the best bot's 13.8, 20 / 20 wins, never overtime. The gap is
   weapon data (`BOT_MINIGUN` 1.6 damage, 0.05 spread vs the Minigun's 4 and
   0.012) plus the aim assist, shared with Training and TDM. FFA systems
   neither widen it (damage boost: +0.9 kills a pickup; streaks score only)
   nor rubber-band it (leader picked × 1.17; trailing bots kill at × 0.82).
   Out of scope here: a cross-mode difficulty question.
3. **Ammo is the weakest pickup.** 32 % collected; every other type 63–82 %.
   Magazines refill themselves, so Ammo only matters mid-burst, and a full
   magazine passes it over. By design (a common, taken only when useful). Keep.
4. **Revenge is common.** 36 % of kills (any unanswered kill counts); about
   four REVENGE callouts a match for the player. Feedback and +25 score only.
   Keep.
5. **Overtime in about one even match in five** (18 %; 0 % with a dominant
   player). Short (21.5 s average) and nearly always settled by a kill. Keep.
6. **Spawn protection rarely matters.** Starts are picked 50 m+ from every
   rival, so protection absorbed ~0.1 hull a match and was never used to
   attack; no one died within 8 s of spawning (0.3 % against the human
   player). Re-entry is safe but not free: the wait and the drive in from the
   perimeter are the price. Keep as insurance for the rare close start.
7. **Draw plays the defeat sting.** `MatchPhase` has no draw, so a draw ends as
   'defeat' and plays 'destroyed'; the Results screen does say Draw. Sound
   only, shared with TDM: not changed.
8. **Lead line with a tie on top** names one of the tied ("HEXBOLT +14" while
   three share 14). It is the spec's gap-to-first; not changed.
9. **The checks missed the spec's exact cases** (2:59 / 3:01 / 4:59 / 5:01 /
   7:59 / 8:01, the three overtime examples, the streak ladder past 3, titles
   past Triple, protection with armor, Ammo on a full magazine, the Repair cap,
   two machines back in the same step). All held; now checked.
10. **Docs path.** CLAUDE.md placed the FFA docs under `work/ffa/`; they
    live in `work/ffa/`. Fixed.

Bot watch list, measured:

| | Verdict |
|---|---|
| A · all bots converge on one pickup | no: 3+ on one item in 2 % of samples, mostly damaged bots going for the same Health, which turns into a fight |
| B · bots follow the leader excessively | no: × 1.36 (even), × 1.17 (dominant player) |
| C · bots abandon combat for items | only below 40 % hull, only for Health / Repair, still firing: ~3 % of bot time |
| D · bots take every valuable pickup first | no: an equal player takes its share (13 % of pickups, 10.5 % of damage boosts); its minimap shows what bots sense, and the beams show more |
| E · trailing bots unnaturally aggressive | no: × 1.05 kill rate (even), × 0.82 (vs a dominant player) |
| F · bots camp the hot zone without fighting | no: 13 % of zone time without a target; kills per machine-second × 1.6 inside |

## Changes

- **No gameplay change**: no value, rule, UI, bot or respawn change. Every
  system measured in range (below).
- `src/game/ffa/ffa.check.ts`: 24 checks added (119 → 143), none removed or
  loosened: the six spec boundary deaths; the three overtime examples; streak
  milestones 3 / 5 / 7 / 10 once each over a ten-kill streak; multi-kill titles
  to Overkill; protection with armor (stronger wins, a death clears both, the
  next life takes full damage after its protection); a full magazine leaves
  Ammo; Repair stops at a full hull; two machines due in the same step take
  different starts.
- `work/ffa/ffa-metrics.js`: the probe behind these numbers (dev console only).
- Docs: this report; FFA_TEST_PLAN.md; FFA_IMPLEMENTATION_LOG.md; the docs
  path in CLAUDE.md. FFA_BALANCING.md unchanged (no value changed).

## Values Intentionally Preserved

| Value | Evidence |
|---|---|
| Respawn 5 / 10 / 15 / 20 s, overtime 5 s | 5 s: lives 36 s, no spawn deaths, so no kill cycling. 20 s: 31 % downtime, lives unchanged, arena live. The rise does its job |
| Protection 2 s, × 0.2 | never exploited, rarely needed |
| Spawn scoring and camp benching | 117 m median, no spawn deaths; benching never needed at runtime (checked) |
| Rarity 70 / 25 / 5, hot zone 40 / 45 / 15 | ~3 epics a match (8–9 %), 2.4 of them taken |
| Damage boost × 1.5, 10 s, Epic | 0.36 kills a pickup (0.9 for a dominant player), 0.3 % of all damage: no snowball |
| Armor −35 %, 12 s | 11 hull a pickup; worth more to whoever fights in it |
| Speed boost × 1.3, 8 s | +30 % top speed, still controllable, base restored |
| Health +40 / Repair 10 hull/s for 6 s | both ~4.5 pickups a match: burst vs 60 over time, neither redundant |
| Ammo +1 magazine, only when short | weakest item by design |
| Waves at 2:00 then every 2:00, 6 + 2 hot, TTL 45–60 s, 16 live | 37 a match, 62 % taken, 21 s to pickup |
| Hot zone from 1:30, 2:00 each, × 3 spots, 1 drop | × 1.6–1.8 encounter density, 13 % idle time |
| Comeback: 4 kills, × 1.75, +0.5 | opportunity without power: pickups a little above time share, kill rate flat |
| Bots: leader bias 15 m, trailing × 1.15, heal below 40 %, 60 % zone interest | A–F in range |
| Streaks 3 / 5 / 7 / 10, multi-kill 7 s, nemesis 3, assist 20 hull / 10 s, score table | callouts neither rare nor spammy |
| Overtime 60 s | 21.5 s average, 1 draw in 25 |

## Remaining Risks

- **No human playtest in this pass.** Everything above is bots and a
  bot-driven player seat. Still to judge by hand: the 20 s late waits, the
  speed boost in narrow streets, callout readability, item contention between
  a person and bots.
- **Difficulty** (Problem 2): a competent player will likely win most matches.
- **One arena.** Every City start is on the perimeter road; an arena with
  central starts would test protection and camp benching for real.
- Known and unchanged: pickup reach and "occupied" are 2D; item beams show
  past the 75 m bots sense; spawn sight lines ignore cars; draw sting
  (Problem 7).

## Final Assessment

The FFA rules do what the spec says, including every boundary and edge case
the prompt listed, and hold up over 123 full matches with no stale state,
duplicate respawn, spawn death or leak between matches. The systems balance
against each other: no item dominates, streaks and revenge stay feedback,
the hot zone concentrates fights (× 1.6), the comeback gives opportunity
without power, and bots stay imperfect without dog-piling the leader.

**Status: BALANCED** for the FFA rules and systems as measured. Not a claim
about bot difficulty against a skilled player (Problem 2) or about the feel of
the 20 s late waits, which need human playtests.
