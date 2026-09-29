# Free For All — state machines

Implemented in `src/game/ffa/rules.ts`. Moves go through guarded tables
(`PHASES`, `LIVES`); a move not in the table is refused and returns `false`,
which is also how duplicate kills, deaths and respawns are dropped.

## Match

```text
PRE_MATCH ──(3 s)──▶ ACTIVE ──(01:00 left)──▶ FINAL_MINUTE
                                                   │ 00:00
                                                   ▼
                                    TIME_EXPIRED → CHECK_WINNER
                                      ├─ one leader ───────────▶ MATCH_COMPLETE (winner)
                                      └─ tie ─▶ OVERTIME
                                                  ├─ deciding kill ─▶ MATCH_COMPLETE (winner)
                                                  └─ 60 s ─────────▶ MATCH_COMPLETE (draw)
```

| Stored phase | Enters on | Allowed next |
|---|---|---|
| `preMatch` | creation / reset | `active` |
| `active` | clock ≥ 3 s | `finalMinute`, `overtime`, `complete` |
| `finalMinute` | remaining ≤ 60 s | `overtime`, `complete` |
| `overtime` | tie at 00:00 | `complete` |
| `complete` | winner or draw | — |

`TIME_EXPIRED` and `CHECK_WINNER` are the decision taken inside the step where
the clock reaches 00:00; no step is spent in them. (`active → overtime/complete`
exists only for a `finalMinute` setting of 0.)

Per phase:

| | pre | active / final | overtime | complete |
|---|---|---|---|---|
| driving, firing | held | yes | yes | bots stand down, player's HUD menu |
| damage, kills | no | yes | yes; deciding kill ends it | no |
| respawn wait | — | by elapsed | 5 s (carried waits cut) | cancelled |
| item waves | no | yes | no | items removed |
| hot zone | no | from 1:30 | stays | removed |

Events (`FfaEvent`): `phase` (MatchStarted / FinalMinuteStarted /
OvertimeStarted / MatchCompleted), `kill`, `death`, `respawn`, `item`,
`expired`, `wave`, `zone`.

## Participant

```text
ALIVE ─▶ DESTROYED ─▶ RESPAWN_PENDING ─▶ RESPAWNING ─▶ SPAWN_PROTECTED ─▶ ALIVE
  ▲                                                        │
  └──────────────── (protection over) ─────────────────────┘
SPAWN_PROTECTED ─▶ DESTROYED (killed while protected)
```

| Life | Meaning | Allowed next |
|---|---|---|
| `alive` | driving, fighting | `destroyed` |
| `protected` | alive, damage × 0.2 until `protectedUntil` | `alive`, `destroyed` |
| `destroyed` | wreck; kill being scored, or the match ended | `pending` |
| `pending` | waiting for `respawnAt` | `respawning`, `destroyed` (cancelled: match over) |
| `respawning` | start being chosen and the car placed (inside one call) | `protected` |

- `destroyed → pending` happens in the same call as the kill unless the match
  is complete, so `destroyed` persists only after the match ends.
- `kill()` also requires the victim to be `alive` or `protected`: a second
  kill on a wreck is refused even though `pending → destroyed` exists for
  cancelling.
- Everyone, the player included, moves `pending → respawning` at `respawnAt`.
- Match complete: pending respawns fall back to `destroyed` (cancelled).

## Item

```text
spawned ──pickup──▶ consumed ─▶ removed
spawned ──TTL────▶ expired  ─▶ removed
spawned ──match complete──▶ removed
```

Removal happens in the same step; an item leaves the live list once, so it can
be collected or expire only once.

## Timed effect (Repair, Speed, Armor, Damage)

```text
inactive ──pickup──▶ active(expires = now + duration)
active ──pickup──▶ active(expires = max(expires, now + duration))
active ──now ≥ expires / death / match end──▶ inactive
```
