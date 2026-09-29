# Team Deathmatch — implementation plan

Scope: turn the local Team Deathmatch (player + 3 bots against 4 bots, The
City) into a 10-minute, kill-scored 4v4 with a pre-match countdown, overtime,
automatic progressive respawns, spawn protection, team-aware spawn selection,
combat statistics, MVP, team-aware bots, HUD, kill feed, scoreboard and a
results screen. Same philosophy and architecture as Free for All
(`work/ffa/`). No networking (Nakama comes later), no items or hot zones.

Status: done — see the checklist at the end; decisions in TDM_IMPLEMENTATION_LOG.md, the measured result in TDM_BALANCE_REPORT.md.
Followed by a pre-release QA pass (TDM_QA_PROMPT.md): 4 fixes, no value changed —
TDM_IMPLEMENTATION_LOG.md and the report's "Pre-release QA pass".

## 1. Audit — what TDM was before this work

| Area | Where | Found |
|---|---|---|
| Rules | `match.ts` | constants `CREW = 4`, `KILL_LIMIT = 20`, `TIME_LIMIT = 8 min`, `BOT_RESPAWN = 4 s` at the top of the match; `mode === 'tdm'` branches in set-up, `step()`, `checkOutcome()`, `spawnFor()`, `respawn()` |
| Win | `checkOutcome()` | first crew to 20 kills, else most kills at 8:00, a tie is a draw |
| Clock | `state.elapsed` | advanced by the match step; no pre-match countdown; the HUD shows `TIME_LIMIT − elapsed` |
| Respawn | `step()` / `respawn()` | bots come back 4 s after the wreck; the player only by clicking Respawn on the Destroyed menu, available 1.4 s after the wreck — so the player could come back **faster than the bots**, or wait on the menu indefinitely |
| Spawns | `arena.bases` + `spawnFor()` | 4 fixed slots per crew at the two ends of Main Avenue, all within 16 m of each other; "farthest from the nearest enemy" among four neighbouring slots changes nothing, so enemies parked at a base farm every respawn |
| Protection | — | none |
| Damage | `damage()` | no rules layer: a rocket still flying after its shooter died could kill (posthumous kill), and rockets still flying after victory/defeat could change the score (the world keeps stepping) |
| Statistics | `destroy()` | kills and deaths only (`c.stats`); no assists, damage, combat score, streaks, multi-kills |
| Bots | `ai.ts` | team-blind apart from skipping teammates: grudge on the last attacker (6 s), else the nearest enemy within 70 m, else roam random nodes; no awareness of teammates under attack, damaged enemies, isolation or score |
| HUD | `Hud.tsx` | "Crew kills N / 20 · Enemy M" in the corner, one-line "X wrecked Y" message, Tab board with kills and deaths only |
| Results | `Results.tsx` | kills / deaths / K-D and each crew by kills; no MVP |
| Menus | `MapSelect.tsx` | "4 vs 4 · first to 20 · 8 min" |
| Checks | — | none for TDM (FFA: `ffa.check.ts`, 143 checks; router: `ai.check.ts`) |

### Free for All — the reference

- `ffa/rules.ts`: pure rules (no Three, Rapier or DOM): clock and guarded phase
  table, guarded participant life cycle, respawn schedule fixed at death,
  protection, scored spawn choice with a sight-line callback, kill credit
  (assists, streaks, multi-kills, revenge, nemesis, combat score), standings,
  an event queue drained by the match every step, and bot hooks (`targetValue`,
  `errand`) through `ai.ts`'s optional `Plan`.
- `match.ts` glue: hands the rules damage, wrecks and fixed steps; drains
  events into the feed, callouts and sounds; places respawned cars; holds
  everyone during pre-match.
- HUD: countdown digits, banners, clock urgency, feed, callouts, SHIELD chip,
  a Tab scoreboard that doubles as the death screen (no buttons, mouse stays
  captured, automatic respawn).
- Docs and checks: `work/ffa/*`, `ffa.check.ts`, `ffa-metrics.js`.

### What to reuse, extract, keep, move

| Decision | What |
|---|---|
| **Extract** (shared, mode-independent) | combat statistics: `Stats`, per-life damage attribution, assists, streaks, multi-kills, revenge / nemesis, combat score. Today a closure inside `createFreeForAll`; TDM needs exactly the same semantics. Moves to `src/game/scoring.ts`, numbers passed in from each mode's config. FFA behaviour must not change: `ffa.check.ts` stays untouched and must pass. |
| **Reuse as is** | `match.ts` combat entry points (`damage()`, `destroy()`, rockets), `ai.ts` (its `Plan` hooks), `rng`-free deterministic rules pattern, the event-queue glue, FFA's feed / callouts / countdown / respawn placement / death board, `Arena.bases` + `Arena.spawns` |
| **Keep separate** | FFA items, pickups, hot zones, comeback item weighting, nemesis UI; FFA's winner logic (sole leader) and its spawn scoring (rivals only) |
| **Move into `tdm/`** | everything TDM decides: clock and phases, team score, winner, overtime, respawn schedule, protection, team-aware spawn selection, MVP, bot target value, errands (support / flank / regroup) |
| **Delete** | `CREW`, `KILL_LIMIT`, `TIME_LIMIT`, `BOT_RESPAWN`, the TDM branches of `spawnFor()` / `respawn()` / `checkOutcome()` / `step()`, `match.score()` |

Coupled incorrectly today: TDM's respawn timer is the physics-side
`Combatant.deadFor`, its clock the match's `elapsed`, its outcome a check in
the render/physics owner. Hard to maintain as maps and vehicles grow: spawn
logic that only knows "the four base slots", team sizes hard-coded through
`CREW`, and HUD / results reading a score summed on the fly.

## 2. Target architecture

```text
src/game/scoring.ts        shared combat statistics (FFA + TDM)
src/game/tdm/config.ts     TDM: every number
src/game/tdm/types.ts      TDM: members, contenders, phases, events
src/game/tdm/rules.ts      TDM: clock, phases, lives, respawn, protection,
                           spawn selection, kills, team score, overtime, MVP
src/game/tdm/tactics.ts    TDM: team-aware bot target value, errands, stance
src/game/tdm/tdm.check.ts  assert-style self-check (plain node)
```

Rules are pure (no Three.js, Rapier, DOM or browser API), fed by the match:

```text
physics / rendering                 TDM rules                     match glue
─────────────────────               ─────────────                 ─────────────
hit lands        ── damage(a,v,x) ─▶ dealt (0: refused) ────────▶ hull − dealt
hull reaches 0   ── kill(v,k) ─────▶ score, stats, respawn wait
round fired      ── fired(i) ──────▶ protection ends
fixed step       ── tick(dt) ──────▶ clock, phases, protection ─▶ events ─▶ feed, callouts, sounds
wait over        ── respawnDue(i) ─▶ pickSpawn(i, sees) ───────▶ car placed, camera snapped
bot thinks       ── targetValue / errand ─────────────────────▶ ai.ts Plan
```

The match keeps a single glue path for both scored modes (`rules = ffa ?? tdm`):
damage, kills, pre-match hold, event draining, respawn placement, death board,
pause while down. FFA-only extras (items, zone, speed factor) stay on `ffa`.

## 3. Phases

| # | Phase | Output |
|---|---|---|
| 1 | Audit TDM and FFA | section 1 of this plan |
| 2 | Extract shared scoring; TDM config / types / rules skeleton | `scoring.ts` (FFA on it, 143 checks green), `tdm/config.ts`, `tdm/types.ts` |
| 3 | Match lifecycle | pre-match → active → overtime → complete, clock, final minute event, winner, safety cap; checks |
| 4 | Scoring / MVP | team score, credit via `scoring.ts`, MVP with a deterministic tie-break; checks |
| 5 | Respawn / protection | schedule fixed at death, overtime 5 s and carried waits, cancellation, protection ends on firing; checks |
| 6 | Team-aware spawn selection | scored starts over bases + perimeter, danger / sight / crowd / pressure / support / side / recent terms, strict filter with fallback; checks |
| 7 | Team-aware AI | `tactics.ts` + `Plan` wiring; checks (including `ai.ts pickTarget` with plain combatants) |
| 8 | HUD / scoreboard / results | team score, clock, banners, countdown, team-coloured feed, death board, Tab board, results with MVP |
| 9 | Testing | `npm run check`, `tsc`, lint, build, browser QA of TDM, FFA and Training |
| 10 | Balance pass | `work/tdm/tdm-metrics.js` over full matches, tuning if justified |
| 11 | Documentation | the eight `work/tdm/` files, CLAUDE.md code map |

Dependencies: 3–7 build on 2; 8 needs 3–5; 10 needs 1–9.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Extracting scoring changes FFA | pure move of the same statements in the same order; FFA's check file untouched; FFA played end to end in the browser afterwards |
| One glue path for FFA and TDM regresses FFA | union-typed `rules` only where both modes do the same thing; FFA-only paths keep `ffa`; FFA metrics probe re-run |
| Moving errands replan bot routes every step | errand points snapped to nav nodes, so a route changes only when the node does |
| Dynamic spawns feel like teleporting | candidates are the prepared starts only (bases + perimeter road); a mild own-half preference keeps crews on their side unless it is overrun |
| Protection abused to attack | it ends the moment the machine fires |
| Overtime never ends (stuck bots, AFK) | 5:00 safety cap ends it as a draw; documented, expected never to trigger |
| Player advantage | one respawn path for everyone; no player-only terms in rules or tactics |

## 5. Explicitly out of scope

Items, pickups, hot zones, ram damage (the combat model has none in any mode),
new maps or TDM on the Scrapyard, networking, difficulty changes to the bot gun
(cross-mode weapon data), team sizes other than 4.

## 6. Checklist

- [x] Audit (this document)
- [x] Shared scoring extracted (`src/game/scoring.ts`), FFA green (143 checks, check file untouched)
- [x] Lifecycle, scoring, MVP, respawn, protection, spawns (`tdm/rules.ts`)
- [x] Team-aware AI (`tdm/tactics.ts`; `ai.ts` only exports `pickTarget` for the check)
- [x] HUD, feed, scoreboard, death board, results, map select copy, patch notes
- [x] Checks (router, ffa 143, tdm 160), typecheck, lint (only the old `Drawer.tsx` warning), build
- [x] Browser QA: TDM end to end; FFA and Training re-checked
- [x] Balance pass: 66 TDM matches (even 40, human 16, idle 10) and 20 FFA regression matches; no tuning change (TDM_BALANCE_REPORT.md)
- [x] Documentation: all eight `work/tdm/` files; CLAUDE.md code map
