# Free For All — test plan

## Automated

`node src/game/ffa/ffa.check.ts` (also `npm run check`, with the router check) — 143 checks.
Pure rules, plain participants, seeded RNG, fixed 1/64 s steps (exact in
binary, so phase boundaries land on a step) plus one run at the game's 1/60 s;
assert-style, throws on the first failure.

| Area | Checks |
|---|---|
| Match | starts in pre-match and holds damage; goes active after 3 s; clock counts down; final minute at 1:00; ends at 10:00; unique leader wins; tie → overtime; leader's overtime kill wins; a non-leader's overtime kill doesn't end it; overtime timeout → draw; the spec's cases: 10 · 10 · 8, a kill that leaves the top tied goes on and a tied leader's kill wins; 10 · 10 · 10, any of the three wins with the next kill |
| Kills | killer +1, victim +1; duplicate kill refused; self kill scores no kill; a destroyed attacker does no damage and gets no kill |
| Assists | valid assist; killer gets none; stale damage cleared by respawn; low damage gives none; old damage outside the window gives none |
| Streaks | streak grows; resets on death; milestones at 3, 5, 7, 10, once each; multi-kill inside the window; chain resets after it; titles Double kill to Overkill |
| Revenge | triggers after being killed; not without a prior death; nemesis at 3 unanswered; cleared by revenge |
| Respawn | 5 / 10 / 15 / 20 s for deaths at 02:50, 02:59, 03:01, 03:10, 04:50, 04:59, 05:01, 05:10, 07:50, 07:59, 08:01, 08:10; death at 02:59.9 keeps 5 s; overtime death 5 s; carried wait cut in overtime; nobody back before the wait ends, player and bots on time; protection applied and expires; protection with armor takes the stronger reduction, a death clears both; occupied start rejected; safe start chosen; camped start benched; two machines due in the same step take different starts |
| Items | first wave at 2:00, then every 2:00; TTL expiry removes; pickup consumes once; health and ammo capped; a full magazine leaves Ammo; Repair stops at a full hull; armor, damage, speed modifiers; effects expire; base stats untouched; effects cleared on death; full hull skips Health |
| Hot zone | opens at 1:30 from the arena's list; expires and rotates; bonus items inside; spot weighting favours the zone |
| Comeback | trailing detected at the gap; leader never trailing; weighting leaves stats alone |
| Bots | errands only see items in sense range; low hull seeks Health; curious bots patrol the zone and move on from a reached spot; incurious ignore it, trailing always go; target value skips protected rivals and favours the leader |
| Cleanup | completion clears items, zone, effects, pending respawns; reset starts from zero with no stale events |
| Determinism | same seed → same wave layout |

Also: `node src/game/ai.check.ts`, `npx tsc -b`, `npm run lint`, `npm run build`.

Balance: `work/ffa/ffa-metrics.js`, pasted into the dev console of a free for
all match, plays whole matches with the player on the bots' brain and
summarises them (numbers and method in FFA_BALANCE_REPORT.md).

## Manual QA (browser, dev build at :3000)

Start: Play → Free for All → The City. Console: `match` (state),
`match.ffa` (rules), `tick(ms)` (one frame by hand when the tab is hidden).
Fast-forward the real simulation (each call = 0.1 s = 6 physics steps), then
render one frame for the HUD:

```js
let t = performance.now() + 1000
const run = (s) => { for (let i = 0; i < s * 10; i++) match.frame((t += 100)); tick((t += 16)) }
run(120 - match.ffa.elapsed()) // to the first wave
```

The rAF loop keeps stepping in real time between console calls; do timing-
sensitive steps (e.g. catching a respawn) inside one call.

| Scenario | Steps | Expect |
|---|---|---|
| A normal match | play | 8 cars, 3-2-1-GO, 10:00 countdown, kills/deaths, respawns, HUD |
| B respawn phases | kill the player at the listed elapsed times (`match.ffa.elapsed()`) | wait 5/10/10/15/15/20 s; death screen is the scoreboard headed by the killer and "Back in N", no buttons; back in on time with the mouse still captured; Esc on the death screen pauses, Resume returns to it |
| C waves | run past 2:00, 4:00, 6:00, 8:00 | 6–8 pickups, "Supply drop" in the feed |
| D TTL | wait ~60 s after a wave | untouched pickups vanish |
| E streak | 2 kills inside 7 s, 3 without dying | DOUBLE KILL, KILLING SPREE |
| F revenge | die to a bot, kill it | REVENGE |
| G overtime | tie at 0:00 | OVERTIME · FIRST KILL WINS |
| H final minute | reach 1:00 | FINAL MINUTE banner, red clock |
| I protection | respawn next to rivals | SHIELD chip, reduced damage |
| J restart | finish, Play again / new FFA | zero stats, no items, no effects, pre-match again |
| K other modes | Team Deathmatch (both maps) | unchanged rules and HUD |
| L scoreboard | hold Tab in FFA (alive and down), TDM; release; alt-tab while holding | table in standings order with FFA columns; TDM grouped by crew; wrecks dimmed; hides on release or focus loss; no pause, no focus jump |
