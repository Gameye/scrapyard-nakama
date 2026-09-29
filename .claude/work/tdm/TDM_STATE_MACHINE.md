# Team Deathmatch — state machines

Implemented in `src/game/tdm/rules.ts`. Moves go through guarded tables
(`PHASES`, `LIVES`); a move not in the table is refused and returns `false`,
which is also how duplicate kills, deaths and respawns are dropped. The rules
advance only when the match calls `tick(dt)` with a fixed simulation step, so
pause and frame rate never move a timer.

## Match

```text
PRE_MATCH ──(3 s)──▶ ACTIVE ──(00:00, one team ahead)──────────────▶ COMPLETE (winner)
                       │
                       └─(00:00, tied)──▶ OVERTIME ──(first team kill)─▶ COMPLETE (winner)
                                              │
                                              └─(5:00, safety cap)────▶ COMPLETE (draw)
```

| Stored phase | Enters on | Allowed next |
|---|---|---|
| `preMatch` | creation / `reset()` | `active` |
| `active` | clock reaches 3 s (GO) | `overtime`, `complete` |
| `overtime` | tie at 00:00 | `complete` |
| `complete` | a winner, or the safety cap (draw) | — |

The final minute is a clock mark inside `active`, not a state: the rules push
one `finalMinute` event when 1:00 remains, and the HUD derives its banner,
clock colour and countdown digits from `remaining()`. `TIME_EXPIRED` and
`CHECK_WINNER` are the decision taken inside the step where the clock reaches
00:00 (`expire()`); no step is spent in them.

### Entry, exit and behaviour per state

| | PRE_MATCH | ACTIVE | OVERTIME | COMPLETE |
|---|---|---|---|---|
| entry | match created or Play again: clock 0, score 0 : 0, statistics and lives reset, everyone on the grid at the bases | GO (`phase` event, "GO" callout) | tie at 00:00: `overtimeAt` set, pending waits cut to ≤ 5 s, `phase` event, banner and feed line | winner (or draw) fixed, MVP fixed, `phase` event |
| exit | 3 s of match clock | 00:00 | the first credited kill, or 5:00 | none (a new match is a `reset()`) |
| clock | waits at 10:00 | counts down 10:00 → 00:00 | counts up (no limit to count down to) | stops |
| driving, firing | held (the match's `held`) | yes | yes | bots stand down; the player sees the results |
| damage | refused | enemies only; protection × 0.2 | same | refused |
| kills | impossible (no damage) | +1 team score each | the first ends the match | refused |
| respawn wait | — | 5 / 10 / 15 / 20 s by elapsed at death | 5 s (carried waits cut) | pending respawns cancelled |
| bots | don't think | tactics on | tactics on | stand down |
| events | — | `phase`, `finalMinute`, `kill`, `death`, `respawn` | `kill`, `death`, `respawn`, `phase` | — |

### What happens at 00:00

`tick()` sees `remaining() <= 0` in `active` and calls `expire()`:

1. Scores differ → `complete(leading team)`.
2. Scores equal → `overtime`; `overtimeAt = now`; every `pending` machine's
   `respawnAt` becomes `min(respawnAt, now + 5)`.

At the game's 1/60 s step the clock expires within one step of 10:00
(checked).

### Completion cleanup

`complete(winner)`: pending respawns → `destroyed` (cancelled); protected →
`alive`; protection times, kill chains and damage attribution cleared; recent
wrecks forgotten; `mvp = standings()[0]`. The match (`match.ts`) then stops
the bots and shows the results. Rockets still in flight can't score: damage is
refused once the match is complete.

## Machine (every member, the player included)

```text
ALIVE ─▶ DESTROYED ─▶ RESPAWN_PENDING ─▶ RESPAWNING ─▶ SPAWN_PROTECTED ─▶ ALIVE
  ▲                                                        │   │
  └────────── (2 s, or it fires) ──────────────────────────┘   │
SPAWN_PROTECTED ─▶ DESTROYED (wrecked while protected) ◀───────┘
```

| Life | Meaning | Allowed next |
|---|---|---|
| `alive` | driving, fighting | `destroyed` |
| `protected` | alive, damage × 0.2 until `protectedUntil` | `alive` (time up, or fired), `destroyed` |
| `destroyed` | wreck; kill being scored, or the match over | `pending` |
| `pending` | waiting for `respawnAt` | `respawning`, `destroyed` (cancelled by the end) |
| `respawning` | start chosen and car placed (inside one call) | `protected` |

- `kill()` requires `alive` or `protected`: a second kill on a wreck is
  refused even though `pending → destroyed` exists for cancelling.
- `destroyed → pending` happens in the same call as the kill unless the match
  completes, so `destroyed` persists only after the end.
- Everyone moves `pending → respawning` at `respawnAt`; the match asks
  `respawnDue()` after every tick, picks the start with `pickSpawn()` and
  places the car once `respawned()` agrees.
- `fired()` ends protection at once (`protectedUntil = now`, `protected →
  alive`); for an unprotected machine it does nothing.

### What happens when the player dies

1. The hit that empties the hull calls `kill(victim, killer)`: the team score
   and statistics update, a `kill` (or `death`) event goes to the feed, the
   wait is fixed from the elapsed time.
2. 1.4 s later the match's view switches to `destroyed`: the HUD shows the
   scoreboard as the death screen ("Wrecked · by X", "Respawning in N"); the
   mouse stays captured; Esc pauses and Resume returns to it.
3. At `respawnAt` the player is placed at the chosen start, protected for
   2 s, the camera snaps behind the car, the view returns to `playing`.
4. If the match completes during the wait, the respawn is cancelled and the
   results screen follows.

Bots follow the same steps without the screens.

## Events (`TdmEvent`)

| Event | When | Match glue |
|---|---|---|
| `phase` (`active`, `overtime`, `complete`) | state changes | "GO" callout; overtime banner, feed line, cue |
| `finalMinute` | 1:00 remaining, once | feed line, cue |
| `kill` (killer, victim, team, assists, streak, milestone, multi, revenge, shutdown) | a credited kill | feed line in team colours, tags, the player's callouts |
| `death` (victim) | a death nobody is credited for | feed line |
| `respawn` (who, spawn) | a machine is back in | — |

The match drains the queue after every tick.
