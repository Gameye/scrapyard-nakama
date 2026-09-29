# Team Deathmatch — implementation log

Decisions, findings and fixes, grouped by topic. Newest material last within
each section.

## 2026-09-26 — audit

- No git repo: a copy of `src/` and `docs/` taken before this work is kept
  outside the repo for diffing.
- Baseline: `npx tsc -b` clean; `npm run lint` one pre-existing warning
  (`Drawer.tsx` hook deps); `npm run check`: router ok, ffa ok (143 checks).
- Findings (details in TDM_IMPLEMENTATION_PLAN.md §1):
  - TDM rules lived in `match.ts` (`CREW`, `KILL_LIMIT = 20`, `TIME_LIMIT =
    8 min`, `BOT_RESPAWN = 4 s`) as `mode === 'tdm'` branches.
  - **Player respawn advantage**: the Destroyed menu offered Respawn 1.4 s
    after the wreck; bots waited 4 s.
  - **Spawn camping by design**: four base slots within 16 m of each other;
    "farthest from the nearest enemy" among them picked nothing different.
  - No protection, no pre-match, no overtime (a tie at 8:00 was a draw).
  - A rocket still flying after its shooter was wrecked could score a kill,
    and rockets still flying after the result could change the score (the
    world keeps stepping after victory/defeat).
  - Statistics: kills and deaths only.
  - Bots: team-blind apart from skipping teammates.

## Architecture

- **Shared statistics extracted** (`src/game/scoring.ts`): `Stats`, per-life
  attribution (`Tally`), assists, streaks, multi-kills, revenge / nemesis and
  combat score were a closure inside `createFreeForAll`; TDM needs exactly the
  same semantics (the prompt asks to reuse FFA's assist, streak and multi-kill
  rules). The same statements in the same order moved out; each mode passes
  its own config (`ScoreRules`); nemesis only when the mode sets a threshold.
  FFA keeps its data layout (`Contender extends Tally`, same field names), so
  `ffa.check.ts` is untouched and passes 143 / 143. `ffa/rules.ts` re-exports
  `createStats` / `Stats` for it.
- **TDM rules module** (`src/game/tdm/`): `config.ts` (every number),
  `types.ts` (members, contenders, phases, events), `rules.ts` (state machine,
  lives, respawn, protection, spawn scoring, kills, team score, overtime,
  MVP), `tactics.ts` (bot target value, errands, stance), `tdm.check.ts`. No
  Three.js, Rapier, DOM or browser API: portable to a Nakama match handler.
  Imports carry `.ts` so the check runs under plain node (as FFA).
- **One glue path for the scored modes** in `match.ts`: `rules = ffa ?? tdm`
  for damage, kills, the pre-match hold, event draining, respawn placement,
  countdown ticks, pause while down and the death board. FFA-only paths
  (items, zone, speed factor, pickups) stay on `ffa`. The union works because
  both rules objects share the same method signatures.
- **Tactics apart from rules**: the rules decide the game; `createTactics`
  reads their state (clock, contenders, score) and answers the two `Plan`
  hooks `ai.ts` already had. `ai.ts` is unchanged apart from exporting
  `pickTarget` for the check.
- Deleted from `match.ts`: `CREW`, `KILL_LIMIT`, `TIME_LIMIT`,
  `BOT_RESPAWN`, `score()`, the TDM branches of `step()`, `checkOutcome()`,
  `spawnFor()` (now training only) and `respawn()` (training only).

## Rules

- **States**: `preMatch → active → overtime → complete`, guarded like FFA.
  The final minute is a clock mark (one `finalMinute` event, HUD derived),
  not a state, keeping the four states the design asked for.
- **Team score is its own counter** (`tdm.score`), incremented only for a
  credited kill; the invariant "team score = sum of its members' kills" is
  checked, and holds in every measured match.
- **Credited kill**: killer alive and on the other team. Friendly fire is
  refused twice (the match only damages hostiles; the rules refuse same-team
  damage and never credit a same-team kill).
- **No posthumous kills, nothing after the end**: damage needs a live
  attacker and an active or overtime match — fixes both audit findings for TDM.
- **Respawn schedule** kept from FFA, fixed at death; waits carried into
  overtime cut to ≤ 5 s from its start (only sooner), so both teams are back
  for sudden death.
- **Overtime**: the first credited kill ends it (scores are equal on entry,
  so any credited kill breaks the tie). **Safety cap** 5:00 → draw: not asked
  for, added because a match must be guaranteed to end (stuck bots, an idle
  player, a future server). Measured overtime never came near it.
- **Protection ends on firing** (`fired()`, called by the match when a round
  leaves the barrel): the design's explicit TDM rule. FFA keeps its own rule
  (firing doesn't end it).
- **MVP** at completion: the top of the combat-score order (score, kills,
  assists, fewer deaths, line-up). Team score plays no part.

## Spawn selection

- **Candidates**: both bases and the 16 perimeter starts (24). Prepared
  starts only: they are kept clear of parked cars by the arena, and nothing is
  ever moved while alive, so no teleport-like behaviour.
- **Formula chosen**: FFA's shape (capped distance terms, sight and crowd
  penalties, recent use) plus three team terms — support (teammates near),
  side (own half), wreck pressure (recent deaths near) — and a hard
  ramming-range exclusion. Distance is capped at 90 m so that past it the
  team terms decide: the safest start is not the farthest corner but a safe
  one near the team.
- **Spawn camping**: FFA's start benching was not carried over; wreck
  pressure covers the same case (a machine dying on arrival leaves a wreck by
  the start) and also active fights there. Fewer mechanisms, as asked.
- **Determinism**: no randomness (ties → lowest index), so it is testable
  and the same battlefield always gives the same start.

## Team AI

- **Priorities as biases in metres** on the existing "nearest target" choice:
  simple, tunable, keeps distance relevant, and lets a teammate under fire
  pull help beyond the 70 m detection range (up to 115 m).
- **Team-shared knowledge**: with nobody in range a bot heads for the enemy it
  values most anywhere, instead of roaming random nodes. The player's minimap
  already shows every enemy, so this is parity, not a cheat.
- **Errands snap to road nodes**: `ai.ts` re-routes whenever an errand moves
  by more than 1 m; errands that follow a moving enemy would re-plan every
  step. Snapped, they re-plan only when the node changes.
- **Flank**: an urgent errand (the bot keeps shooting on the way) to a point
  35 m off the side of a grouped target; side fixed per bot, so a team splits.
- **Comeback**: behaviour weights only; no numbers of any machine change
  (checked).

## HUD, results

- Top-left team score (hidden in the other modes) instead of "Crew kills n /
  20"; momentum line.
- Feed lines gained `who` / `whom` / `teams`, rendered as three spans
  coloured by team relative to the player; FFA lines use no colour, so FFA
  reads exactly as before ("Rustjaw wrecked you").
- Scoreboard: per-team header rows interleaved with the pooled rows (works
  for any team split); scored-mode columns shown for TDM too.
- Death board shared with FFA; TDM wording "Wrecked · by X · Respawning in
  N"; FFA wording unchanged.
- Results: MVP card, overtime note, rosters by team with Winner and the MVP
  crown; the player's full record (as FFA's, without items / nemesis).
- Map select: "4 vs 4 · 10 min · most kills wins" and a new blurb.

## Bugs found during the work

- Check draft: a line-of-sight case put the start outside the 120 m sight
  range, so sight could not apply; rewritten with a start inside it. (Test
  bug, not a rules bug.)
- Check draft: an overtime case used a machine already wrecked as the killer
  (no damage from a wreck, correctly); fixed the test.
- Check draft: expected a regroup errand on the wrong road node (the nearest
  to the teammate is (0, −112), not (0, −84)); fixed the expectation.
- `Results.tsx`: an unused destructured `mode` after the rewrite (TS6133);
  removed.
- HUD (found in play): the team score is a CSS grid in the top-left column;
  as a block-level grid it stretched its tracks to the column's width, so the
  F3 overlay (a wide `<pre>` in the same column) pushed "0 : 2" apart. The
  same class of bug as FFA's feed shifting the minimap. The grid is now sized
  to its content (`w-max`); measured identical with F3 on and off.

## Validation

- `npm run check`: router ok, ffa ok (143), tdm ok (160). `npx tsc -b`
  clean. `npm run lint`: only the pre-existing `Drawer.tsx` warning.
  `npm run build` ok (the > 500 kB chunk warning predates this work: Rapier's
  inlined WASM).
- Browser, dev build at :3000: countdown and hold, GO, team score and
  momentum, team-coloured feed with tags, death board with team headers and
  the countdown, automatic respawn at a flank start 80–236 m from enemies,
  SHIELD chip, firing ending protection (live: 2.0 s left → 2 rounds →
  `alive`), final minute, forced overtime (banner, amber clock counting up,
  waits ≤ 5 s, decided 5.7 s later), results (Victory · Overtime, 51 : 50,
  a losing-team MVP), Play again (pre-match, all zero). FFA (kills, board,
  hot zone, neutral feed, unchanged death board) and Training (Destroyed menu
  with Respawn) re-checked. No console errors.
- Balance: 66 full TDM matches through `match.frame()` with
  `work/tdm/tdm-metrics.js` (player seat even 40 / human 16 / idle 10) and 20
  FFA matches with `work/ffa/ffa-metrics.js`. Numbers in
  TDM_BALANCE_REPORT.md.

## Balance pass

- Decision: **no tuning change**. Even teams split 22 / 18; per-seat kills
  10.5–11.2; ~5,400 respawns with none under 50 m from an enemy and no death
  within 8 s of spawning; waits exact; no friendly or protected targeting;
  MVP 72.5 % the top killer and 22.5 % on the losing team; a team 4+ behind
  won 10 of 40 times without any rubber band.
- Decision: a strong player (garage Minigun + aim assist) carries Blue in
  every match (16 / 16). Weapon data shared with every mode, already flagged
  by the FFA report; not changed here.
- Kept: revenge on 46 % of kills (four enemies make it common); feedback only,
  readability left to playtests.
- FFA regression: every measured FFA number matches FFA_BALANCE_REPORT.md
  within the noise of 20 matches (kills 86.6 vs 87.6, same downtime curve,
  same spawn safety, items, hot zone, assists per kill 0.51).
- Probe pitfall: metrics scripts were served from `game/public/` during the
  runs (the dev server doesn't serve `docs/`) and removed afterwards.

## Behaviour kept from FFA

Respawn schedule and the overtime cut, protection length and strength,
assist / streak / multi-kill / revenge semantics and values, combat score
values (without items), the automatic respawn with the scoreboard as the
death screen, Esc pause while down, the pre-match hold, the event-queue glue.

## Behaviour intentionally different from FFA

Team score and team winner; overtime decided by any team kill (FFA: a sole
leader); no overtime time limit as a rule (only a safety cap); protection
ends on firing; team-aware spawns over bases and perimeter with team terms;
no start benching; no items, hot zones or nemesis; MVP by combat score (FFA
places by kills); team AI priorities and stances.

## 2026-09-26 — pre-release QA and polish pass

Scope: find remaining real problems, fix only justified ones, validate,
decide release readiness (TDM_QA_PROMPT.md). Findings and numbers:
TDM_BALANCE_REPORT.md, "Pre-release QA pass".

Fixed (all found in an agent-driven browser session, then measured):

- **Death / Tab board hid the kill feed.** The board is centred and 780 px
  wide; feed lines grow leftward from the right edge (the earlier FFA fix that
  keeps the minimap still). At 1369 px wide the board covered the first
  57–70 px of long lines — the killer's name — exactly while the player is
  down and reading the feed. Shared with FFA (same board, same feed). Fix: the
  board stays centred but moves left as far as needed to clear the feed
  (`left: clamp(half + 1rem, 100% − half − 24rem, 50%)`, half =
  min(46vw, 390px)). Measured: no overlap at 1920, 1440, 1369 and 1280 px;
  below ~1180 px the board pins to the left edge and some overlap remains
  (1024 px: 128 px, was 234). UI only; FFA behaviour unchanged.
- **Countdown digits hidden behind the board.** In the last 10 s the big
  digits (15vh) sit where the board's top edge is; a player down (20 s waits)
  lost them. `z-10` on the digits: they draw over the board's empty top
  centre. Shared with FFA.
- **Momentum line in the enemy's colour.** "Leading by n" was always red —
  red is Red team's colour in TDM. Now: blue when Blue leads, red when
  trailing, neutral when tied (`data-tone`). TDM only.
- **MVP with nothing scored.** If no machine ever scored (combat score 0 for
  all), the tie-break would crown the first in the line-up — the player — with
  0. Now there is no MVP (the results screen shows no MVP card). Checked;
  cannot happen in a normal match.

Tooling:

- `tdm-metrics.js` gained late-game, support-response, abandoned-fight,
  focus, spawn-usefulness, protection-incident, revenge-age and MVP-composition
  measures, and two controlled autopilots (`gun`: garage weapon without aim
  assist; `assist`: bot weapon with the lock-on assist).
- Probe bug found and fixed: with the window visible, the page's own rAF
  frames re-laid the autopilot player's aim from the camera between probe
  slices, so an unassisted player seat aimed worse than the bots (9.3 kills
  against 10.0–11.5). The probe now restores the brain's aim after every
  frame, whoever calls it. The affected 50-match run was discarded and re-run.
- Harness pitfall: a console call that times out is killed mid-physics-step and
  leaves Rapier's world locked ("recursive use of an object"); reload the page.
  Not a game bug.

Kept on purpose (evidence in the report): the 20 s late respawn, revenge
semantics, no ram damage, spawn protection, overtime and its safety cap, the
bots' grudge priority.
