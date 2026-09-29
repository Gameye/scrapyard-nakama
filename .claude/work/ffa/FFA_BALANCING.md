# Free For All — balancing

Every value lives in `FFA` (`src/game/ffa/config.ts`); change it there, nowhere
else. Seconds are simulation time; distances metres; hull is 100 points.

## Match

| Value | Key | Why |
|---|---|---|
| 8 machines | `grid` | player + 7 bots |
| 3 s pre-match | `preMatch` | time to grab the mouse before anyone moves |
| 10:00 match | `duration` | |
| final minute at 1:00 | `finalMinute` | |
| urgent clock at 0:30 | `finalPush` | |
| countdown digits from 0:10 | `finalCountdown` | |
| 60 s overtime | `overtime` | then a draw |

## Respawn

| Elapsed at death | Wait | Key |
|---|---|---|
| 0:00–3:00 | 5 s | `respawn.phases[0]` |
| 3:00–5:00 | 10 s | `respawn.phases[1]` |
| 5:00–8:00 | 15 s | `respawn.phases[2]` |
| 8:00–10:00 | 20 s | `respawn.phases[3]` |
| overtime | 5 s | `respawn.overtime` (also the cap on waits carried into overtime) |

Longer waits late make each death cost more as the clock runs down.

## Spawn protection and selection

| Value | Key |
|---|---|
| 2 s, damage × 0.2 | `protection.duration`, `protection.reduction` |
| occupied within 8 m | `spawn.occupied` |
| nearest-rival term capped at 120 m | `spawn.nearCap` |
| average-rival term × 0.35, capped at 160 m | `spawn.averageWeight`, `spawn.averageCap` |
| −45 per rival with a line within 110 m | `spawn.sightPenalty`, `spawn.sightRange` |
| −25 per rival within 50 m | `spawn.crowdPenalty`, `spawn.crowdRadius` |
| −60 if used in the last 15 s | `spawn.recentPenalty`, `spawn.recent` |
| −30 inside the hot zone | `spawn.hotZonePenalty` |
| camp mark: death ≤ 8 s after spawning | `spawn.campWindow` |
| 2 marks in 60 s bench the start 30 s | `spawn.campDeaths`, `spawn.campMemory`, `spawn.cooldown` |

```text
score = min(nearest, 120) + 0.35·min(average, 160) − 45·watching − 25·crowd − 60·recent − 30·hot
```

The caps stop "farthest" from dominating: past 120 m a start counts as safe
and the sight/crowd terms decide.

## Combat statistics

| Value | Key |
|---|---|
| assist: ≥ 20 damage this life, hit ≤ 10 s before the kill | `assist.minDamage`, `assist.window` |
| multi-kill window 7 s | `multiKill.window` |
| multi-kill titles 2 / 3 / 4 / 5+ | `multiKill.titles` |
| streak milestones 3 / 5 / 7 / 10 | `streaks` |
| shutdown: victim's streak ≥ 3 | `shutdown` |
| nemesis at 3 unanswered kills | `nemesis` |

### Combat score

| Event | Points | Key |
|---|---|---|
| kill | 100 | `score.kill` |
| assist | 50 | `score.assist` |
| damage dealt | 0.5 per hull point | `score.damage` |
| multi-kill | 25 × (chain − 1) | `score.multiKill` |
| streak milestone | 25 | `score.streak` |
| revenge | 25 | `score.revenge` |
| item pickup | 10 | `score.item` |

A full kill is worth about 150 (100 + 100 hull × 0.5). Streaks and revenge add
score and callouts only — no damage or hull, so nothing snowballs.

## Items

| Value | Key |
|---|---|
| first wave 2:00, then every 2:00 | `items.firstWave`, `items.waveInterval` |
| 6 items per wave (+2 hot zone) | `items.perWave`, `hotZone.bonusItems` |
| max 16 live | `items.maxActive` |
| TTL 45–60 s | `items.ttl` |
| pickup radius 3.5 m | `items.pickupRadius` |
| sense range 75 m (minimap and bots) | `items.senseRange` |
| 30 m apart in a wave | `items.spacing` |
| ≥ 15 m from live machines, ≥ 25 m from starts | `items.clearOfCars`, `items.clearOfStarts` |
| spot clearance 1.8 m | `items.clearance` |

| Rarity | Wave weight | Hot-zone weight | Types |
|---|---|---|---|
| Common | 70 | 40 | Health, Repair, Ammo |
| Rare | 25 | 45 | Speed boost, Armor |
| Epic | 5 | 15 | Damage boost |

| Item | Strength | Duration | Key |
|---|---|---|---|
| Health | +40 hull | instant | `items.health` |
| Repair | +10 hull/s | 6 s | `items.repair` |
| Ammo | +1 magazine, ≤ full | instant | `items.ammo` |
| Speed boost | × 1.3 | 8 s | `items.speed` |
| Armor | −35 % damage taken | 12 s | `items.armor` |
| Damage boost | × 1.5 damage dealt | 10 s | `items.damage` |

Damage boost is the only offensive item, so it's Epic. Armor and spawn
protection take the stronger reduction, never both.

## Hot zone

| Value | Key |
|---|---|
| first at 1:30, each 2:00 | `hotZone.first`, `hotZone.duration` |
| wave spot weight × 3 inside | `hotZone.weight` |
| 1 drop when a zone opens | `hotZone.drops` |
| rarity 40 / 45 / 15 | `hotZone.rarity` |

## Comeback

| Value | Key |
|---|---|
| trailing at 4+ kills behind the leader | `comeback.gap` |
| wave spot weight × 1.75 within 70 m of a trailing machine | `comeback.weight`, `comeback.radius` |
| hot-zone choice +0.5 per trailing machine within 105 m | `comeback.zoneWeight` |

## Bots

| Value | Key |
|---|---|
| sole leader counts 15 m nearer | `bots.leaderBias` |
| trailing bots hunt / sense × 1.15 | `bots.trailingReach` |
| go for Health/Repair mid-fight below 40 % | `bots.lowHealth` |
| 60 % patrol the hot zone when idle | `bots.zoneInterest` |
| move to the next zone spot every 10 s... | `bots.patrol` |
| ...or on getting within 8 m of it | `bots.arrive` |

Bot aim, burst and ranges stay in `AI` (`src/game/ai.ts`); the bot minigun in
`BOT_MINIGUN` (`src/game/match.ts`).
