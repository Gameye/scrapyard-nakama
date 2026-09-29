# Team Deathmatch — balancing

Every value lives in `TDM` (`src/game/tdm/config.ts`); change it there,
nowhere else. Seconds are simulation time; distances metres; hull is 100
points. For each value: the intended effect, the risk, the metric that would
show it is wrong (`work/tdm/tdm-metrics.js` measures all of them), and how to
tune it. Measured values are from TDM_BALANCE_REPORT.md.

No value is "balanced" here because it feels right; where only a person can
judge it, the report says NEEDS PLAYTEST.

Pre-release QA pass (2026-09-26): no value changed. The 20 s late respawn,
revenge, protection and the overtime cap were re-measured and kept; the
evidence and the smallest fallback change for each are in the report's
"Pre-release QA pass".

## Match

| Value | Key | Intended | Risk | Wrong if | Tune |
|---|---|---|---|---|---|
| 4 per team | `teamSize` | player + 3 bots vs 4 bots, 8 machines like FFA, the City's size | — | — | fixed by the design; the rules take any team size, spawn and AI terms are per machine |
| 3 s pre-match | `preMatch` | grab the mouse, see the grid before anyone moves | too short to read the HUD | players miss GO | 3–5 s |
| 10:00 match | `duration` | every minute matters (no kill limit); long enough for momentum swings | long matches drag if one team runs away | margin grows steadily all match; one team behind by 4+ for most of it | 8–12 min |
| final minute 1:00, pulse 0:30, digits 0:10 | `finalMinute`, `finalPush`, `finalCountdown` | late tension, same marks as FFA | — | — | presentation only |
| overtime safety cap 5:00 | `overtimeCap` | guarantees the match ends (not a rule) | a real overtime cut short | any overtime reaching it (measured maximum: well under a minute) | raise, never lower below several minutes |

## Respawn

| Elapsed at death | Wait | Key |
|---|---|---|
| 0:00–3:00 | 5 s | `respawn.phases[0]` |
| 3:00–5:00 | 10 s | `respawn.phases[1]` |
| 5:00–8:00 | 15 s | `respawn.phases[2]` |
| 8:00–10:00 | 20 s | `respawn.phases[3]` |
| overtime | 5 s | `respawn.overtime` (also the cap on waits carried in) |

- **Intended**: early deaths are cheap (learn the map, take risks); late
  deaths cost more, so a lead has to be defended and a trailing team must pick
  its fights. The overtime wait is short so sudden death is fought by full
  teams. Same schedule as FFA, so both modes teach the same lesson.
- **Risk**: 20 s late waits feel long for a person; a team caught out late
  can't answer.
- **Wrong if**: late downtime (share of machine-time waiting) passes ~35 %,
  or late kills per minute fall below ~6 (the arena empties); or deaths in
  the last two minutes decide matches that were level (large late swings).
- **Tune**: the last two steps first (15 → 12 s, 20 → 15 s); keep the rise.

## Spawn protection

| Value | Key |
|---|---|
| 2 s, incoming damage × 0.2 | `protection.duration`, `protection.reduction` |
| ends at once when the machine fires | rules (`fired()`) |

- **Intended**: find your bearings after a respawn; never a shield to attack
  from (hence firing ends it).
- **Risk**: too strong → a spawn becomes a free engagement; too weak → no
  help against a start that turned hot.
- **Wrong if**: damage dealt by protected machines > 0 (must be 0: the first
  shot ends it); deaths while protected rise; deaths within 5 s of spawning
  rise above ~1 % of respawns.
- **Tune**: duration 1.5–3 s; reduction 0.6–0.9. Measured: it absorbs almost
  nothing because spawns are far from enemies — it is insurance.

## Spawn selection

```text
score = min(nearest enemy, 90) + 0.3·min(average enemy, 150) + 12·min(teammates ≤ 60 m, 3)
      + 25·side − 45·watching(≤ 120 m) − 25·crowd(≤ 50 m) − 35·wrecks(≤ 40 m, 20 s) − 60·recent(15 s)
strict filter: no machine within 8 m, no live enemy within 30 m (dropped if it rules out every start)
```

| Value | Key | Intended | Wrong if | Tune |
|---|---|---|---|---|
| occupied 8 m | `spawn.occupied` | never on top of a car or wreck | cars spawning inside each other | 6–10 |
| ramming range 30 m | `spawn.ramRange` | never where an enemy can ram or point-blank you | respawns with an enemy under 30 m (measured 0 %) | 25–40 |
| nearest term cap 90 m | `spawn.nearCap` | past 90 m a start counts as safe and the team terms decide | median nearest enemy far above 150 m (too far from the fight) or under 60 m | 70–120 |
| average term × 0.3, cap 150 m | `spawn.averageWeight`, `spawn.averageCap` | prefers being away from the enemy team, not only its nearest | — | 0.2–0.4 |
| sight −45 per enemy with a line within 120 m | `spawn.sightPenalty`, `spawn.sightRange` | not into a line of fire | deaths within 5 s of spawning | 30–60 |
| crowd −25 per enemy within 50 m | `spawn.crowdPenalty`, `spawn.crowdRadius` | not next to an enemy group | respawns under 50 m from an enemy (measured 0 %) | 15–40 |
| wreck pressure −35 per wreck within 40 m in 20 s | `spawn.pressurePenalty`, `.pressureRadius`, `.pressureMemory` | off where the fight just was; off a start where the last machine died on arrival (anti-camp) | back-to-back spawn deaths (measured 0) | 25–50 / 30–50 m / 15–30 s |
| support +12 per teammate within 60 m, up to 3 | `spawn.supportBonus`, `.supportRadius`, `.supportCap` | rejoin the team, not a lonely corner | isolated share of respawned machines high; spawns in the enemy half | 8–20 |
| side ± 25 | `spawn.sideWeight` | each team keeps its half until it is overrun | spawns in the enemy half above a few % (measured < 1 %), or never leaving the base when it is camped | 15–35 |
| recent −60 within 15 s | `spawn.recentPenalty`, `spawn.recent` | spread respawns over the starts | one start used for most respawns | 40–80 / 10–20 s |

The caps matter: without them the farthest corner always wins and the team
walks back into the fight alone.

## Statistics and combat score

Same semantics and values as FFA (shared `scoring.ts`), so a player reads one
system across modes.

| Value | Key | Intended | Wrong if | Tune |
|---|---|---|---|---|
| assist: ≥ 20 damage this life, hit ≤ 10 s before the kill | `assist.minDamage`, `assist.window` | reward real contribution to a team kill, not a scratch | assists per kill far above ~1 (everyone assists everything) or near 0 | 15–30 / 8–12 s |
| multi-kill window 7 s | `multiKill.window` | a quick double is a feat | multi-kills in most matches for most machines | 5–8 s |
| streak milestones 3 / 5 / 7 / 10 | `streaks` | feedback that grows rarer | milestones every minute | — |
| shutdown ≥ 3 | `shutdown` | ending a spree is news | — | 3–5 |

| Event | Points | Key |
|---|---|---|
| kill | 100 | `score.kill` |
| assist | 50 | `score.assist` |
| damage | 0.5 per hull point | `score.damage` |
| multi-kill | 25 × (chain − 1) | `score.multiKill` |
| streak milestone | 25 | `score.streak` |
| revenge | 25 | `score.revenge` |

- **Intended**: a full kill is worth about 150 (100 + 100 hull × 0.5); an
  assist with real damage about 70–90; damage alone counts for something. So
  a machine that softens targets for its team can out-score one that only
  finishes them, and the MVP can come from the losing team.
- **Risk**: kills dominate so completely that MVP is always the top killer on
  the winning team (then it adds nothing); or assists dominate (MVP for
  damage nobody finished).
- **Wrong if**: MVP is the top killer in ~100 % of matches, or on the
  winning team in ~100 %; or MVPs with far fewer kills than the top killer
  are common. Measured: roughly four in five MVPs are the top killer and on
  the winning team — the rest are not.
- **Tune**: `score.assist` 40–60; `score.damage` 0.3–0.7. No item points
  (TDM has no items). Streaks and revenge add score and callouts only: no
  damage, armour or speed, so nothing snowballs.

## MVP

Highest combat score at completion; ties: kills, assists, fewer deaths,
line-up order. Team score plays no part. Tune through the score table above,
never through the MVP rule.

## Team AI

Bot aim, bursts, ranges and routing stay in `AI` (`src/game/ai.ts`), shared
with every mode; the bot gun in `BOT_MINIGUN` (`src/game/match.ts`).

| Value | Key | Intended | Wrong if | Tune |
|---|---|---|---|---|
| threat window 3 s | `bots.threatWindow` | "under attack" means right now | bots chasing an attacker long gone | 2–5 |
| support radius 70 m | `bots.supportRadius` | teammates close enough to help | help arriving from across the map | 50–90 |
| defend bias 45 m | `bots.defendBias` | priority 2: an enemy attacking a nearby teammate beats a nearer one | target share `defend` near 0 (no teamwork) or above the grudge share (bots ignore whoever shoots them) | 30–60 |
| low hull 35 %, finish bias 30 m | `bots.lowHull`, `bots.finishBias` | priority 3: finish the damaged | target share `finish` near 0 or dominating | 25–45 % / 20–40 |
| isolation 35 m, isolated bias 15 m | `bots.isolation`, `bots.isolatedBias` | priority 4: pick off stragglers; also who counts as "alone" | isolated machines die far more often than their time share | 25–50 / 10–25 |
| flank: target with ≥ 2 teammates within 30 m, bot > 45 m off, point 35 m to the side | `bots.flankGroup`, `.flankRadius`, `.flankMin`, `.flankOffset` | approach a group from the side, not head-on | flank stance near 0 (never happens) or dominating (bots never engage) | group 2–3; offset 25–45; keep `flankMin` > `flankOffset` |
| comeback from 4 kills behind | `bots.comebackGap` | trailing teams play smarter | behind share tiny (never used) or huge | 3–6 |
| comeback weights: defend × 1.25, isolated × 1.5, top scorer 20 m, flank groups of 2, regroup when alone | `bots.comeback` | regroup, help, pick off stragglers and the enemy leader — never a stat | kill rate while behind above the average (rubber-banding) or behind teams never recovering | small steps; never touch machine numbers |

## Out of scope here

Weapon damage and spread (shared by every mode; the player's garage gun and
aim assist against the bots' gun is a cross-mode difficulty question, see the
report), vehicle handling, ram damage (none in any mode).
