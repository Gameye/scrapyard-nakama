# Team Deathmatch — balance report

Final QA and balance pass over the new TDM, 2026-09-26. The pre-release QA
and polish pass that followed is at the end ("Pre-release QA pass"); its
status supersedes the first pass's. Rules
`src/game/tdm/`, statistics `src/game/scoring.ts`, wiring
`src/game/match.ts`; values `TDM` in `src/game/tdm/config.ts`
(TDM_BALANCING.md). Result: **no tuning change** — every measured system is in
range; the open questions are feel (human playtest) and the cross-mode bot
difficulty.

Statuses: **BALANCED** (measured, in range), **NEEDS PLAYTEST** (only a person
can judge it), **NEEDS TUNING** (measured problem), **BLOCKED**.

## Checks performed

| Check | Result |
|---|---|
| `npm run check` | router ok · ffa ok (143) · tdm ok (160) |
| `npx tsc -b` | clean |
| `npm run lint` | only the pre-existing `Drawer.tsx` warning |
| `npm run build` | ok (the > 500 kB chunk warning predates this work) |
| Browser QA, dev build :3000 | TDM end to end (countdown, HUD, feed, death board, auto-respawn, SHIELD, firing ends protection, final minute, forced overtime, results, MVP, Play again); FFA and Training re-checked; no console errors |
| TDM metrics | 66 full matches through `match.frame()` at the fixed 60 Hz step, `work/tdm/tdm-metrics.js` |
| FFA regression | 20 full FFA matches with `work/ffa/ffa-metrics.js`, against FFA_BALANCE_REPORT.md |

Player seat, three ways: **even** (40 matches) — the bots' brain and gun, no
aim assist, so eight equal machines; **human** (16) — the bots' brain with
the garage Minigun and the camera's lock-on assist, a strong player; **idle**
(10) — no input, so Blue plays 3 v 4 with a parked car. "human" bounds a
competent player; it isn't one.

## Correctness (all 66 matches)

| Contract | Measured |
|---|---|
| Team score = its members' kills | every match |
| Wait fixed at death by elapsed (5 / 10 / 15 / 20 s, overtime 5 s) | 0 mismatches over ~5,400 deaths |
| Automatic, on time, once | ≤ 1 step late (16.7 ms), never early; death → respawn strictly alternates (0 breaks) |
| No friendly targeting, no targeting of protected machines | 0 samples of either |
| Protection never used to attack | 0 damage dealt by a protected machine (firing ends it first); 0 machines wrecked while protected |
| Overtime ends on the next kill | every overtime; longest 12.5 s; the 5:00 safety cap never approached (0 draws) |

## Measurements — even (40 matches)

### Match

| | |
|---|---|
| length | 10:00.4 average, overtime included |
| result | Blue 22 · Red 18 · draws 0 (a 55 / 45 split is within the noise of 40 matches) |
| overtime | 3 / 40 (7.5 %), 4.8 s average, 12.5 s longest |
| kills | 86.5 a match (FFA: 87.6); team 43.2; winner 45.5, loser 41.0; margin 4.6 |
| leader held on | at 3:00 29 / 37, at 5:00 31 / 37, at 8:00 34 / 39 |
| close late | 16 / 40 matches within 2 kills at 8:00; net swing in the last two minutes 2.6 kills |

### Respawn by phase

| Elapsed at death | Wait | Kills / min | Average life | Downtime |
|---|---|---|---|---|
| 0:00–3:00 | 5 s | 10.2 | 35.5 s | 10.6 % |
| 3:00–5:00 | 10 s | 9.2 | 43.0 s | 19.2 % |
| 5:00–8:00 | 15 s | 7.7 | 46.4 s | 24.2 % |
| 8:00–10:00 | 20 s | 7.1 | 47.4 s | 29.6 % |

Downtime: machine-time spent waiting. Same shape as FFA (10 → 31 %).

### Spawns (3,362 respawns)

| | |
|---|---|
| nearest enemy at the chosen start | 119.7 m median; none under 50 m (so none under the 30 m ramming range) |
| enemies within 120 m of it | 0.9 average |
| where | own half, perimeter 72.1 % · own base 27.4 % · enemy half 0.5 % |
| died within 5 s / 8 s of respawning | 0 / 0 |
| two quick deaths in a row | 0 |
| hull absorbed by protection | 0.2 a match |

### Kills, assists, combat score

| | |
|---|---|
| kills by rank in a match | 15.1 · 13.3 · 12.4 · 11.2 · 10.5 · 9.4 · 8.2 · 6.5 |
| kills per seat (0 = player seat) | 10.6 · 10.7 · 11.2 · 11.1 · 10.5 · 10.7 · 10.7 · 11.1 |
| deaths per seat | 10.4 · 10.7 · 10.4 · 11.4 · 11.0 · 11.0 · 10.6 · 11.1 |
| assists per seat | 10.7 · 10.2 · 9.5 · 10.3 · 9.7 · 9.6 · 8.9 · 10.0 |
| combat score per seat | 2,317 · 2,335 · 2,325 · 2,383 · 2,255 · 2,286 · 2,232 · 2,375 |
| top scorer's share of its team's kills | 32.4 % (an even share is 25 %) |
| best bot in a match | 14.9 kills average, 19 at most |
| assists per kill | 0.9 |

### MVP

| | |
|---|---|
| on the winning team | 77.5 % |
| the top killer | 72.5 % |
| average kill rank | 1.5 |
| player seat | 7 / 40 |
| margin over second | 181 combat score |

### Team AI (bot samples every 0.25 s)

| Why a bot held its target | Share |
|---|---|
| it was shooting the bot (grudge) | 49.5 % |
| it was attacking a nearby teammate | 26.3 % |
| low hull | 10.2 % |
| isolated | 9.7 % |
| nearest | 4.3 % |

No target (heading for a fight) 18.8 % of bot time. Stances: attack 61.8 %,
support 30.4 %, flank 5.3 %, defend (regroup) 2.5 %.

| Team | Nearest teammate (median) | Time isolated (> 35 m) |
|---|---|---|
| Blue | 22.5 m | 37.8 % |
| Red | 27.5 m | 39.5 % |

44.1 % of deaths happen isolated, against ~39 % of the time: being alone
costs.

### Comeback

| | |
|---|---|
| team-time spent 4+ kills behind | 20.2 % |
| kill rate while behind | × 0.8 of average (no rubber band) |
| matches where a team fell 4+ behind | 40 / 40 |
| ...and that team still won | 10 |

### Feedback

Killing spree 8.3 a match, Rampage 0.5, Unstoppable < 0.1; shutdowns 8.0;
revenge on 46.2 % of kills (FFA: 36 %).

## Measurements — human and idle

| | human (16) | idle (10) |
|---|---|---|
| result | Blue 16 · Red 0 | Blue 0 · Red 10 |
| margin | 20.3 | 17.9 |
| player seat | 25.7 kills, 7.6 deaths, 12.7 assists, 4,965 score | 0 kills, 6.5 deaths |
| MVP | the player, 16 / 16 | Red, 10 / 10 |
| losing team 4+ behind | 44 % of the time; kill rate × 0.6; never recovered | 42 %; × 0.6; never recovered |
| spawns | 120.4 m median; none under 50 m; 0 quick deaths; enemy half 1.9 % | 125.2 m; none under 50 m; 0 quick deaths; enemy half 4.7 % |
| late phase (human) | 6.3 kills / min, 26.4 % downtime | — |

Even one team dominating doesn't produce spawn camping: the beaten team's
respawns stay 120 m+ from the enemy and nobody died on arrival. When a half
is overrun (idle), respawns flip to the other half a little more often (4.7 %).

## FFA regression (20 matches, even)

| | now | FFA report |
|---|---|---|
| kills a match | 86.6 | 87.6 |
| winner / 2nd / last | 15.4 / 13.4 / 6.3 | 15.0 / 13.3 / 6.8 |
| overtime | 4 / 20, 0 draws | 9 / 50 |
| kills / min by phase | 10.0 · 8.5 · 8.1 · 7.2 | 9.9 · 9.0 · 8.2 · 7.4 |
| downtime by phase | 10.4 · 17.7 · 25.4 · 30.0 % | 10 · 19 · 26 · 31 % |
| wait mismatches, alternation, stale death screen | 0 · 0 · 0 | 0 · 0 · 0 |
| spawns: nearest median, under 50 m, deaths ≤ 8 s | 114.7 m · 0.1 % · 0 | 117 m · < 0.1 % · 0 |
| equal player: kills, deaths, place | 10.9 · 10.5 · 4.5 | 10.9 · 10.6 · 4.6 |
| items spawned / collected | 37.1 / 23.0 | 37 / 23.1 |
| hot zone: time, kills, density | 13.9 % · 23.8 % · × 1.6 | 14 % · 25 % · × 1.6 |
| revenge share, assists per kill | 36.8 % · 0.51 | 36 % · 0.51 |

FFA is unchanged within the noise of 20 matches, as the untouched 143 checks
already showed for the rules.

## The final QA questions

| # | Question | Answer | Status |
|---|---|---|---|
| 1 | Does TDM feel different from FFA? | Structurally yes: team score, spawns on the team's half (27 % bases), a quarter of bot targeting spent defending teammates, flanks, overtime 7.5 % (FFA 18 %) and decided in seconds. The feel needs a person. | NEEDS PLAYTEST |
| 2 | Is teamwork visible? | Bots: 26 % of targeting is a teammate's attacker, support stance 30 %, isolated machines die more. Whether a player notices it is a playtest question. | BALANCED · NEEDS PLAYTEST |
| 3 | Respawn too fast or too slow? | 5 s early: lives 35 s, no spawn deaths. 20 s late: 30 % downtime, 5.6 of 8 machines live, 7.1 kills / min. As in FFA. | NEEDS PLAYTEST (20 s by hand) |
| 4 | Late-game tension from progressive respawn? | 16 / 40 matches within 2 kills at 8:00; the 8:00 leader still lost 5 / 39. | BALANCED · NEEDS PLAYTEST |
| 5 | Can a team spawn-camp the other? | 5,365 respawns: none within 50 m of an enemy, none died within 8 s, including matches won by 18–20 kills. | BALANCED |
| 6 | Does dynamic spawning prevent obvious camping? | Yes (above); 72 % of respawns use the own half's perimeter, 27 % the base; the base is abandoned when it is camped (checked) and used again when it isn't. | BALANCED |
| 7 | Team kills distributed reasonably? | Per seat 10.5–11.2; top scorer 32 % of its team's kills. | BALANCED |
| 8 | Can one bot dominate without explanation? | Best bot 14.9 kills on average, 19 at most; no seat is systematically ahead. | BALANCED |
| 9 | Can a losing team recover through behaviour, not buffs? | 10 of 40 teams that fell 4+ behind won; while behind they kill at × 0.8 (no rubber band); no machine number changes (checked). | BALANCED · NEEDS PLAYTEST |
| 10 | Does MVP represent contribution? | 72.5 % the top killer, 77.5 % on the winning team; the rest won it on assists and damage. | BALANCED |
| 11 | Can a losing-team player be MVP? | Yes: 22.5 % of MVPs (even), covered by a check with a zero-kill MVP; the player seat was MVP 7 / 40. | BALANCED |
| 12 | Does the scoreboard communicate the match? | Team headers with kills, both rosters, the team score in the header line; verified on screen. | NEEDS PLAYTEST |
| 13 | Does overtime feel fair? | Both teams back for it (waits cut to ≤ 5 s), the next kill wins, 4.8 s average. Short and sudden by design. | NEEDS PLAYTEST |
| 14 | Is ten minutes right? | Margin 4.6 kills; leaders at 3:00 hold 78 %, at 8:00 87 %; matches stay close late. | NEEDS PLAYTEST |
| 15 | Hidden advantages for the human? | None in the rules: same waits (0 mismatches for the player seat), same spawn scoring, bots treat the player like any machine; the even player seat scores like every other. The visible edge is weapon data and aim assist (Problem 1). | BALANCED (rules) · NEEDS TUNING (difficulty, cross-mode) |
| 16 | Still BBMV, not a generic shooter? | The vehicle model is untouched: mass, collisions, shoves; flanks and positioning drive the bots. Ramming is positional only (no ram damage in any mode). | NEEDS PLAYTEST |

## Problems

1. **A strong player carries Blue every time.** human: 16 / 16, margin 20,
   25.7 kills. The gap is the garage Minigun (4 damage, 0.012 spread) and the
   aim assist against `BOT_MINIGUN` (1.6, 0.05), shared with Training and FFA
   (FFA_BALANCE_REPORT.md Problem 2). TDM's rules neither widen it nor hide
   it. Out of this feature's scope: a difficulty setting or bot gun tuning is
   a cross-mode change. **NEEDS TUNING** (separate feature).
2. **Revenge is on almost half the kills** (46 %; FFA 36 %): with four
   enemies, whoever you wreck has often wrecked you. Feedback and +25 only;
   the feed shows at most two tags. Readability → **NEEDS PLAYTEST**. Kept
   (FFA semantics, as the design asks).
3. **Spawn protection rarely matters**: starts are chosen 120 m from enemies,
   so it absorbed ~0.2 hull a match and never saved or helped anyone. Kept as
   insurance for the rare close start.
4. **Flank and regroup are infrequent** (5 % and 2.5 % of bot time); support
   is common (30 %). The variation is there without dominating. Kept.
5. **An idle teammate attracts regrouping**: in idle runs, isolated Blue bots
   behind by 4+ sometimes regroup toward the parked player. Correct by the
   rule (nearest teammate); only an AFK player causes it. Kept.
6. **Draw plays the defeat sting** (only possible through the overtime safety
   cap, never measured): `MatchPhase` has no draw; the Results screen says
   Draw. Shared with FFA; not changed.

## Tuning changes

None. Every value in TDM_BALANCING.md was kept: each system measured in range
(above), and the only measured problem (1) is outside TDM.

## Values intentionally preserved

| Value | Evidence |
|---|---|
| 10:00, no kill limit | margin 4.6, close at 8:00 in 40 % of matches, leaders overturned late |
| respawn 5 / 10 / 15 / 20 s, overtime 5 s | lives 35–47 s, no spawn deaths, late downtime 30 % with the arena live |
| protection 2 s, × 0.2, ends on firing | never exploited (0 damage while protected); rarely needed |
| spawn scoring | 120 m median, 0 under 50 m, 0 spawn deaths, own half 99.5 % (even) |
| assist 20 hull / 10 s, streaks, multi-kill 7 s, score table | 0.9 assists a kill; MVP 72.5 % top killer — contribution beyond kills counts without overturning kills |
| team AI biases | defend 26 %, finish 10 %, isolated 10 %; no friendly or protected targeting |
| comeback weights | recovery 25 % of the time without a rubber band (× 0.8 kill rate) |
| overtime safety cap 5:00 | longest overtime 12.5 s |

## Human playtest list

- Whether teamwork reads as teamwork (bots coming to help, flanks).
- The 20 s waits in the last two minutes.
- Overtime: sudden, a few seconds — exciting or abrupt?
- Readability: team score, momentum line, feed colours and tags (revenge
  frequency), death board, results.
- Ramming as a positional tool without damage.
- Difficulty against bots with the garage weapon (Problem 1).

## Final assessment

The TDM rules do what the spec says, including its boundary and edge cases,
over 66 full matches with no stale state, missed or duplicate respawn, spawn
death, friendly targeting or score mismatch. Two even teams split the wins,
matches stay close late, spawns can't be camped, MVP rewards contribution
and can go to the losing side, and a team behind recovers only by playing
better. FFA is unchanged.

**Status: BALANCED** for the TDM rules, spawns, scoring and team AI as
measured. **NEEDS PLAYTEST** for feel (items above). **NEEDS TUNING** for bot
difficulty against a strong human — a cross-mode question outside this
feature. Nothing BLOCKED.


---

# Pre-release QA pass

Second pass, 2026-09-26, after the implementation (TDM_QA_PROMPT.md): find the
remaining real problems, fix only justified ones, validate, decide release
readiness. Rules, values and the spec's baseline were treated as the source of
truth; nothing was changed without evidence.

## Method

- **Read**: `tdm/` (rules, tactics, config, types, check), `scoring.ts`,
  `ffa/` rules, `match.ts` (combat, rockets, aim assist in `aimFromCamera`,
  respawn glue), `ai.ts`, `combat.ts` (weapons), `camera.ts`,
  `vehicle/drive.ts` and `physics.ts` (collision), HUD, results, map select;
  every file under `work/tdm/` and the FFA spec, balancing, report and log.
- **Agent-driven browser session** (dev build, :3000) — *not a human
  playtest*: synthetic keyboard and mouse input, the bots' brain in the player
  seat where a state had to be reached, frames stepped by hand while the
  window was in the background; screenshots and DOM measurements at every
  step of the flow below. It shows what is on screen and whether input works;
  it cannot say how the game feels.
- **Controlled physics test** for ramming in the live world.
- **Simulation**: 98 TDM matches with the extended probe (`tdm-metrics.js`):
  50 *even*, 16 *gun* (garage Minigun, the brain's own aim), 16 *assist* (bot
  gun aimed through the lock-on assist), 16 *human* (both); and 8 FFA *human*
  matches. The first 50-match *even* run was discarded: a probe bug (below)
  handicapped the player seat.

## The flow, step by step

| Step | Observed | Verdict |
|---|---|---|
| 1 Enter TDM | map card "4 vs 4 · 10 min · most kills wins", blurb | ok |
| 2 Countdown | 3 · 2 · 1 digits, clock held at 10:00, nobody moves | ok |
| 3 First engagement | GO callout; allies marked blue, enemies red; lock-on and range readout on hostiles only | ok |
| 4 First death | wreck, 1.4 s, then the board: "Wrecked · by Hexbolt · Respawning in N", team headers, K D A streak damage score | ok — **but long feed lines were hidden under the board** (fixed) |
| 5 Respawn | back on time at a start on the own half, camera snapped, SHIELD chip; W / D respond at once (48 km/h after 1 s, view turning) | ok |
| 6 Mid-match | feed in team colours, assists and tags, momentum line | **"Leading by n" drawn in red, the enemy's colour** (fixed) |
| 7–8 Lead, trailing | top-left team score updates each kill | ok (after the colour fix) |
| 9 Late combat | final-minute banner, feed line, red clock | ok |
| 10 Death at 20 s | "Respawning in 18 … 1", scoreboard up throughout | ok — **countdown digits hidden behind the board in the last 10 s** (fixed) |
| 11–12 Tie, overtime | forced 30 : 30 on the last step: banner "Overtime · First kill wins", amber clock labelled Overtime counting up, feed line, a 20 s wait cut to 5.0 s | ok |
| 13 Final kill | the next kill (4.98 s in) ended it | ok |
| 14–15 Results, MVP | "Victory · Overtime · 31 : 30", MVP card, rosters with Winner and crown | ok |
| 16 Play again | pre-match, 0 : 0, zero statistics, empty feed | ok |

No loss of control, no stuck input after death or respawn, no console
errors. Camera: snaps behind the car on respawn; holds its heading on a
tumbling wreck.

## Problems fixed

| Problem | Root cause | Change | Test |
|---|---|---|---|
| Death / Tab board hid the start of long feed lines — the killer's name — while the player is down (57–70 px at 1369 px wide) | the board is centred and 780 px wide; feed lines grow leftward from the right edge (the earlier FFA minimap fix) and reach ~24rem in | the board stays centred but moves left only as far as needed: `left: clamp(half + 1rem, 100% − half − 24rem, 50%)` | measured with the two longest possible lines: no overlap at 1920, 1440, 1369, 1280 px; below ~1180 px the board pins to the left edge (1024 px: 128 px overlap, was 234) |
| Countdown digits hidden behind the board in the last 10 s | the digits (15vh) sit where the board's top edge is, earlier in the DOM | `z-10` on the digits | digit drawn over the board's empty top centre |
| "Leading by n" drawn in red | one fixed colour for FFA's lead line; in TDM red means Red team | `data-tone`: blue ahead, red behind, neutral tied | three states checked on screen |
| An MVP with a score of 0 possible | tie-break by line-up when every score is 0 | no MVP unless combat score > 0 | new check |

The first two are shared with FFA (same board and feed); FFA rules, values
and timing are untouched (143 checks).

## 20-second late respawn

| | even (50) |
|---|---|
| deaths 8:00–10:00 | 13.7 a match (1.7 per machine) |
| match time left at a late death | 59.5 s average |
| waits > 10 s / > 15 s (all deaths) | 43.3 % / 16.0 % |
| late deaths back only after the buzzer (died after 9:40) | 17.6 % |
| died again within 30 s of respawning | 40.2 % (0–3 min) · 35.3 % · 35.0 % · **28.9 %** (8–10 min) |
| next kill to the team that just lost a machine | 48.1 % · 48.1 % · 46.7 % · **42.8 %** (8–10 min) |
| machines dead > 20 s / > 30 s of the final minute | 58.0 % / 9.3 % (max 40 s: two deaths) |
| player seat dead in the final minute | 17.0 s average |
| kills / min, downtime by phase | 10.3 → 8.9 → 7.7 → 6.8; 10.8 → 18.5 → 24.0 → 28.5 % |

- Late deaths matter: a death costs a third of the final minute, and the team
  that loses a machine scores the next kill 43 % of the time (48 % early).
- They don't cascade: re-deaths right after a respawn are *rarer* late
  (29 %) than early (40 %); leads still change hands late.
- One death can't remove a player from most of the final minute (20 s at
  most); two deaths can (up to 40 s, 9 % of machines).
- **Decision: keep 20 s.** It does what the design asks. Whether 20 s *feels*
  too long for a person is the open question; if playtests say so, the
  smallest change is 20 → 15 s for 8:00–10:00 (final-minute downtime at most
  30 s, typically ~15 s), traded against less late tension. **NEEDS
  PLAYTEST.**

## Teamwork

| | even (50) |
|---|---|
| hits on a machine answered by a teammate turning on the attacker | 88.6 % (91.2 % with a teammate nearby) |
| ...already on that enemy (within 0.25 s) | 85.9 % |
| ...otherwise, response time | 1.9 s median, 6.2 s at the 90th percentile |
| target reasons | grudge 48.1 · defend 26.0 · finish 10.8 · isolated 10.5 · nearest 4.4 % |
| stances | attack 61.8 · support 30.2 · flank 5.6 · defend 2.4 % |
| 3+ bots of a team on one enemy | 32.2 % of samples (focus fire) |
| 3 teammates within 12 m (stacking) | 8.9 % |
| bots idle (no target, < 2 m/s) | 4.6 % of bot time |
| switch away from a close, visible, damaged target | 14.5 % of switches, 86 % of them to answer whoever is shooting the bot (priority 1) |
| nearest teammate | 22.5 m median; isolated (> 35 m) 39 % of the time; 43 % of deaths happen isolated |

- "Enemy attacks Grinder → Rustjaw helps" happens: nine in ten attacks on a
  machine have a teammate on the attacker, mostly because teams already fight
  together; when not, help turns up in ~2 s.
- "Enemy group → one bot flanks, others keep pressure": flank stance 5.6 %,
  with the rest attacking — present, not dominant.
- Not excessive: stacking 9 %, idle 5 %. Focus fire is common (32 %) — the
  point of the defend and finish priorities — and the kill distribution stays
  even (per seat 9.2–11.7).
- Abandoned fights are the grudge rule working (answer the shooter first).
- Perceptibility (does a person notice allies helping?) needs a human.
  **BALANCED (bots) · NEEDS PLAYTEST (perception).**

## Team identity

A player can tell TDM from FFA from the screen alone: blue allies (markers,
minimap, cobalt liveries) fighting alongside, the team score as the largest
numbers, a feed in two colours, allies turning on your attackers, respawns on
your own half (99 % own half: 26.6 % base, 72.8 % perimeter), a team that
falls behind regrouping. What would make it feel like "FFA with two teams" —
bots hunting alone — is limited: bots keep a teammate within 22 m (median)
and 91 % of attacks draw a teammate. No change.

## Spawns

| | even (50) |
|---|---|
| respawns | 4,164 |
| nearest enemy at the start | 119.1 m median; none under 50 m; 14.6 % over 150 m |
| nearest teammate at the start | 87.8 m median |
| where | own-half perimeter 72.8 % · own base 26.6 % · enemy half 0.6 % |
| same start as the machine's previous respawn | 15.7 % |
| starts in use per team | 13–15 of 24; busiest 17 % |
| respawn → first shot fired or taken | 8.7 s median |
| died within 5 s / 8 s | 0 / 0 |

Safe *and* useful: back in the fight ~9 s after respawning, never next to an
enemy, spread over a dozen starts (hard to predict or farm), on the own half.
Respawns start ~90 m from the nearest teammate, but the team is rejoined in
the time it takes to reach the fight. No tuning.

## Spawn protection

In 50 matches: no enemy came within 30 m of a machine during its protection,
9 hits landed on protected machines (0.2 hull absorbed a match), none was
wrecked while protected, protected machines dealt no damage. Bots fire only
hitscan rounds, so no rocket can arrive at a fresh spawn from a bot; the
player's rockets could, and would meet protection. It rarely activates
because spawn selection works; it costs nothing and covers the rare close
start. **Keep.**

## Overtime

Natural overtime in 3 of 50 matches (6 %), 12.7 s average, 20 s longest, no
draw; forced 30 : 30 walked through end to end (table above). Both teams are
back for it (waits cut to 5 s), the clock counts up, the first kill ends it.
Short and decisive — tension is a feel question. **Keep; NEEDS PLAYTEST.**
The 5:00 cap stays an engineering safeguard (it guarantees termination, e.g.
stuck bots or an idle player), not the intended length — it was never
reached.

## MVP

| Scenario | Evidence |
|---|---|
| winning-team MVP | 74 % of matches |
| losing-team MVP | 26 % (and a check with a zero-kill losing-team MVP) |
| top killer not MVP | 32 % |
| top damage dealer is MVP | 38 % (checked) |
| high-assist MVP | 22 % top-assist MVPs; a check where four assists beat two kills |
| none of those (all-rounder) | 5 / 50 |
| ties | deterministic tie-break, checked |
| very low participation | an idle player was never MVP; all-zero now gives no MVP (fixed) |
| joined late / incomplete statistics | cannot happen: fixed local roster, no join in progress; to revisit with online play |

Never obviously wrong in the samples; combat score rewards contribution
beyond kills without overturning them. **BALANCED.**

## Revenge

- Tracking: `unanswered[k][v]` counts kills k made on v since v last killed
  k; a kill on someone who has an unanswered kill on you is revenge. It never
  expires (as in FFA).
- 45.2 % of kills; the kill answered is 58.7 s old at the median (50.9 %
  within a minute); 5.2 % of all combat score; with every tag, 59 % of kill
  lines carry one (at most two shown).
- With four enemies you meet the same machines over and over, so half your
  kills land on someone who wrecked you — the mechanic behaves as designed.
  Its score weight is small.
- **Keep.** If the REVENGE callout reads as noise in playtests, the smallest
  change is a time window (e.g. 60 s) in `scoring.ts`, for both modes.

## Ramming

Controlled tests at ~76 km/h (bot AI paused, one target):

| Hit | Result 1 s later |
|---|---|
| T-bone on a parked car | shoved 4.9 m sideways, still sliding at 15 km/h; the rammer down to 14 km/h |
| rear-quarter hit | the target spun ~83° and slid 5.6 m; the rammer kept 58 km/h |
| side hit on a car escaping at 34 km/h | knocked ~60° off its line |

Collisions are solid and immediate (1,400 kg bodies, low restitution): a ram
stops, spins or redirects a car — it interrupts escapes and opens firing
angles. Not ghost-like. **Keep positional ramming.** Ram damage would be a
separate cross-mode combat feature (it would change FFA and Training too).
The feel of a ram needs a human.

## Human vs bot difficulty

| Player seat (16 matches each; even 50) | Gun | Aim | Blue wins | Player K / D |
|---|---|---|---|---|
| even | bot (`BOT_MINIGUN`) | the brain's | 29 / 50 | 10.2 / 10.7 |
| assist | bot | camera + lock-on | 5 / 16 | 9.8 / 10.4 |
| gun | garage Minigun | the brain's | 16 / 16 | 27.5 / 8.1 |
| human | garage Minigun | camera + lock-on | 16 / 16 | 25.3 / 8.3 |
| FFA human (8) | garage Minigun | camera + lock-on | 8 / 8 wins | 28.0 / 9.6 (next best 14) |

The weapon data alone decides it; the aim assist adds nothing measurable.
Not TDM-specific (FFA is the same), so it is **not fixed in TDM** — see the
follow-up below.

### Shared Combat Difficulty — Follow-up

- **Observed**: a player seat with the garage Minigun out-kills every bot
  ~3 : 1 and wins every match, in TDM (16 / 16, twice) and FFA (8 / 8; 20 / 20
  in the FFA report). With the bots' gun it is exactly a bot.
- **Reproduction**: `tdm-metrics.js` → `autopilot('gun')` or `'human'`,
  `play({ matches: 16 })`; FFA: `ffa-metrics.js` → `autopilot('human')`.
- **Affected modes**: Training, Free for All, Team Deathmatch.
- **Cause**: `BOT_MINIGUN` (`match.ts`: 1.6 damage, 0.05 spread) against the
  garage Minigun (`combat.ts`: 4 damage, 0.012 spread) — 2.5 × the damage per
  round and a quarter of the spread; bots also fire in bursts and lead with
  lag (`AI.aimRate`, `aimScatter`). Aim assist is not a factor (*assist*
  row). The autopilot has bot-level positioning plus the stronger gun, so it
  bounds a strong player; how far a real person falls short is unknown.
- **Possible solutions** (all cross-mode): a difficulty setting scaling
  `BOT_MINIGUN` and bot aim; bots on the garage weapons with difficulty in aim
  and reaction only (closest to future online play); keep the hero
  asymmetry in Training only.
- **Why not in TDM**: it is shared weapon data; a TDM-only change would hide
  it and make TDM inconsistent with FFA, and the right strength depends on
  human playtests.

## Human-only advantages (audit)

| Area | Finding |
|---|---|
| respawn timing | same rules and path; 0 schedule mismatches for the player seat |
| spawn location | same `pickSpawn` scoring |
| target selection / acquisition | bots value the player like any machine; the player gets HUD markers and a minimap of every machine (bots share team knowledge too) |
| aim assist | player only, by design (lock-on in a small window); measured effect ≈ 0 |
| weapon availability | garage choice vs `BOT_MINIGUN` — the difficulty lever above |
| reload | same magazine and reload rules (`pullTrigger`) |
| health restoration | full hull on respawn for everyone; nothing else heals |
| spawn protection | same for all; firing ends it for all (bots hold fire 3 s after a respawn, so they keep theirs) |
| camera / input | player only, no gameplay effect beyond aiming |
| collision | the same car body and mass for every machine |
| AI reaction | bots retarget every 0.5 s and lag their aim — a deliberate difficulty setting |

No hidden advantage; the two deliberate ones (weapon, assist) are documented.

## Simulation after the fixes

| | first pass (40 even) | now (50 even) |
|---|---|---|
| Blue / Red wins | 22 / 18 | 29 / 21 (team kills 42.8 / 42.7) |
| kills a match | 86.5 | 85.6 |
| margin | 4.6 | 5.1 |
| overtime | 3 / 40, 4.8 s | 3 / 50, 12.7 s |
| per-seat kills | 10.5–11.2 | 9.2–11.7 |
| assists per kill | 0.9 | 1.0 |
| MVP on winning team / top killer | 77.5 % / 72.5 % | 74 % / 68 % |
| comeback: teams 4+ behind that won | 10 / 40 | 20 / 50 |
| respawn waits exact, alternation | yes, 0 | yes, 0 |
| spawns: median nearest, under 50 m, died ≤ 8 s | 119.7 m, 0, 0 | 119.1 m, 0, 0 |
| friendly / protected targeting | 0 / 0 | 0 / 0 |
| target reasons (grudge / defend / finish / isolated / nearest) | 49.5 / 26.3 / 10.2 / 9.7 / 4.3 % | 48.1 / 26.0 / 10.8 / 10.5 / 4.4 % |

The Blue / Red splits (22 / 18, then 29 / 21; 51 / 39 over both) are within
the noise of these sample sizes, and the teams' kill averages are equal.
Nothing tuned toward 50 / 50.

## Pre-release status

| Area | Status |
|---|---|
| rules, respawn, overtime, scoring, MVP | BALANCED |
| spawns, spawn protection | BALANCED |
| team AI | BALANCED · NEEDS PLAYTEST (perception) |
| HUD, feed, board, results | fixed; NEEDS PLAYTEST (readability) |
| 20 s late respawn, overtime tension, ramming feel | NEEDS PLAYTEST |
| bot difficulty vs a strong player | NEEDS TUNING — shared combat, outside TDM |

**Release status: READY FOR HUMAN PLAYTEST.** No TDM-specific blocker is
known; the rules are stable and measured healthy; the remaining questions are
human feel and the documented shared difficulty follow-up.
