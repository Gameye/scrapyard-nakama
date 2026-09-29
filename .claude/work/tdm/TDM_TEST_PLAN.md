# Team Deathmatch — test plan

## Automated

`node src/game/tdm/tdm.check.ts` (also `npm run check`, with the router and
the free-for-all checks) — 163 checks. Pure rules and tactics on plain
members laid out like the City (both bases and the 16 perimeter starts, a
28 m road grid for errands), fixed 1/64 s steps (exact in binary, so phase
boundaries land on a step) plus one run at the game's 1/60 s; assert-style,
throws on the first failure. `ai.ts`'s `pickTarget` is checked on plain
combatants.

| Area | Checks |
|---|---|
| Match lifecycle | starts in pre-match; no damage and no clock before GO (checked one step before); active at GO with an event; the clock counts down; the final minute is announced at 01:00, once; the team with more kills wins at 00:00, exactly at ten minutes; no damage after the end; at 1/60 s the clock expires within a step of 10:00; no kill limit (40 kills, still active); statistics carry through the match |
| Overtime | a tie at 00:00 (and 0 : 0) goes to overtime; score and statistics kept; still fighting; a wait carried in is cut to 5 s; an overtime death waits 5 s; an uncredited death leaves it running; the first credited kill wins, for either team; the end cancels pending respawns; nothing scores after the deciding kill; the safety cap ends a stalled overtime as a draw (not a step earlier) |
| Team score | a kill scores for the killer's team; the event names the team; duplicate kill refused; no damage between teammates or to yourself; a teammate "kill", a death with nobody or yourself to credit, and a kill by a wreck all score nothing; a wreck does no damage; team score equals the sum of its members' kills; assists and damage never reach it; combat score and kills are separate measures |
| Respawn | 5 / 10 / 15 / 20 s for deaths at 02:50, 02:59, 02:59.98, 03:01, 04:50, 04:59, 05:01, 07:50, 07:59, 08:01, 09:50 — the player's seat and a bot dying in the same step wait exactly alike; the wait holds across the phase boundary; nobody back before the wait ends; player and bots of both teams back the moment it ends; a live machine can't respawn; respawns once, protected; two machines back in the same step take different starts |
| Spawn protection | damage × 0.2; enemy bots don't target a protected machine; wears off after 2 s (full damage, a target again); firing ends it at once; firing unprotected changes nothing; bots lose it by firing too; a protected machine can still be wrecked |
| Spawn selection | with the enemy at home, the own base; enemies camping the base → elsewhere, ≥ 60 m from them, on the own half; once they leave, the base again; same battlefield → same start; away from an enemy cluster; a start in enemy line of sight loses to one out of it; mirrored starts tie to the lower index; never within ramming range while another start is clear; every start dangerous still gives one; a teammate nearby makes a start better; each team leans to its own half; a start near a fresh wreck is avoided, and the pressure fades after 20 s |
| Assists | a big contributor gets one, the killer and a scratch (< 20) don't; every big contributor gets one, once; damage older than 10 s gives none; damage doesn't carry across a respawn; assists never reach the team score |
| Streaks, multi-kills, revenge | double kill inside 7 s; the chain resets after the window; killing spree at three; a streak is no damage buff; death resets the streak, the best is kept; ending a spree is a shutdown; combat score formula; revenge on your killer; every milestone once, in order, over ten kills; multi-kill titles to Overkill |
| MVP | a losing-team machine with no kills can be MVP (assists + damage); the top damage dealer is MVP while the top killer is not; a high-assist machine (4 assists, no kills) beats two kills; MVP is the top of the combat-score order; tie-breaks: more kills, more assists, fewer deaths, line-up order; team score never moves it; combat score comes first; nobody scored anything → no MVP |
| Team AI | teammates and wrecks are never targets; a healthy enemy in its group is valued at its distance; an enemy attacking a nearby teammate counts 45 m nearer, a low-hull one 30 m, an isolated one 15 m; at equal distance defend > finish > isolated > nearest; a teammate out of support range pulls no help; the threat lapses after 3 s; comeback weighting only from 4 kills behind (the enemy top scorer 20 m nearer, isolated × 1.5), never for the leading team, and no machine numbers change |
| Errands, stances | nobody in range → the most valuable enemy, on a road node; a target in a group, far → an urgent flank point (firing on the way), teammates split round both sides; a lone target → straight at it; going for a teammate's attacker → support; close in → no flank; behind and alone → regroup with the nearest teammate; behind but with the team, or level → hunt |
| `ai.ts pickTarget` | the nearest enemy, never a closer teammate; whoever is shooting it first; a protected attacker skipped even with a grudge; wrecks and protected machines → no target; the plan's value reorders targets |
| Restart, determinism | restart clears clock, states, score, statistics, lives, attribution, MVP, overtime; the same inputs give the same score, MVP, spawns and statistics |

Also: `node src/game/ai.check.ts`, `node src/game/ffa/ffa.check.ts` (143,
unchanged), `npx tsc -b`, `npm run lint`, `npm run build`.

Balance: `work/tdm/tdm-metrics.js`, loaded into the dev console of a TDM
match, plays whole matches and summarises them (numbers and method in
TDM_BALANCE_REPORT.md).

## Manual QA (browser, dev build at :3000)

Start: Play → Team Deathmatch → The City. Console: `match` (state),
`match.tdm` (rules), `match.tactics` (team AI), `tick(ms)` (one frame by
hand). Fast-forward the real simulation (each call = 0.1 s = 6 physics
steps), then render one frame for the HUD:

```js
let t = performance.now() + 1e6
const run = (s) => { for (let i = 0; i < s * 10; i++) match.frame((t += 100)); tick((t += 16)) }
run(60)
```

The rAF loop keeps stepping in real time between console calls; do
timing-sensitive steps inside one call.

| Scenario | Steps | Expect |
|---|---|---|
| A match start | start a match | map card "4 vs 4 · 10 min · most kills wins"; 3-2-1, GO; nobody moves before GO; clock 10:00 until GO |
| B team score | play / `run(90)` | BLUE n : m RED top left, "Leading by / Tied / Trailing by"; feed lines with names in team colours and tags |
| C death | let the player be wrecked | scoreboard as the death screen: "Wrecked · by X", "Respawning in N", Blue n : m Red in the header, team headers with kills, K D A streak damage score; no buttons; mouse stays captured |
| D respawn | wait | back in on time at a start away from enemies, SHIELD chip 2 s |
| E firing ends protection | fire right after respawning | SHIELD chip gone, full damage |
| F Tab | hold Tab alive and down | board with both teams; releasing restores the HUD; no pause, no focus jump |
| G final minute | run to 1:00 | banner, feed line, red clock; pulse at 0:30; digits in the last 10 s |
| H overtime | tie at 00:00 (force: `match.tdm.score` equal just before) | "Overtime · First kill wins", amber clock labelled Overtime counting up, waits ≤ 5 s; first kill → result |
| I results | finish | Victory / Defeat, "Overtime" when played, n : m badge, MVP card, both rosters with Winner and the MVP crown |
| J Play again | from results | pre-match, 0 : 0, zero statistics, empty feed |
| K other modes | Free for All (both maps) | FFA: kills, board, hot zone, neutral feed, "Destroyed · Back in N" death board |
| L board vs feed | push two long feed lines (`match.feed.push(...)`), hold Tab (or die) at 1920, 1440, 1369 and 1280 px wide | the board never covers a feed line (it moves left of centre when needed); below ~1180 px wide it pins to the left edge and may still cover the start of the longest lines |
| M momentum | set `match.tdm.score` ahead / behind / level | "Leading by n" in blue, "Trailing by n" in red, "Tied" neutral |
| N countdown while down | die (or hold Tab) in the last 10 s | the countdown digits stay visible above the board |
| O input after respawn | hold W / D right after coming back | the car drives and steers at once; the mouse is still captured |
