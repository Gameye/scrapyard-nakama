# Team Deathmatch — gameplay spec

The canonical rules for TDM. Rules: `src/game/tdm/rules.ts`; team AI:
`src/game/tdm/tactics.ts`; statistics: `src/game/scoring.ts` (shared with Free
for All); numbers: `TDM` in `src/game/tdm/config.ts` (TDM_BALANCING.md).

**Time.** *Elapsed* = match time since GO (0:00 → 10:00). The HUD clock shows
*remaining* (10:00 → 0:00). Every timer runs on the simulation clock (fixed
60 Hz steps): pause stops it, frame rate never changes it.

## Design goals

- A fixed-length battlefield: all ten minutes matter. No kill limit, no rounds.
- The team with more kills wins; individual contribution is recognised
  separately (combat score, MVP) and never decides the result.
- Vehicle combat stays central: driving, positioning, chasing, escaping,
  flanking and weapons.
- Teamwork emerges from a few simple bot priorities, not scripts.
- One rule for everyone: the player gets no respawn, spawn or AI advantage;
  a team behind gets smarter behaviour, never better numbers.

## Teams and arena

- 4 v 4. **Blue** (team 0): the player, Rustjaw, Widowmaker, Grinder.
  **Red** (team 1): Hexbolt, Carrion, Buzzkill, Tetanus.
- The City and the Scrapyard. The match lines up at the two bases, Blue
  north and Red south: either end of Main Avenue in the City, the north and
  south gate aprons in the Scrapyard.
- No friendly fire: rounds and blasts never damage a teammate (a blast still
  shoves every car near it).

## Match structure

| State | What happens |
|---|---|
| Pre-match (3 s) | "3 · 2 · 1", then "GO". Everyone is held: no driving, firing or damage, bots don't think; the clock waits at 10:00. The player can look around. |
| Active (10:00) | Continuous combat. No rounds, resets or buy phase; deaths only cost a respawn wait. |
| Final minute | At 1:00 remaining: banner and feed line "Final minute", a cue, the clock turns red; 0:30 the clock pulses; the last 10 s show countdown digits with a tick. Not a separate state. |
| 0:00 | More team kills wins. A tie goes to overtime. |
| Overtime | Sudden death: the next team kill wins. |
| Complete | Result, MVP, results screen. |

## Team score and the winner

- **Team score = team kills.** Every credited enemy wreck is +1 for the
  killer's team, and nothing else moves it.
- A kill is credited when the killer is alive and on the other team. Anything
  else (nobody to credit, yourself, a teammate, a killer already wrecked)
  counts the victim's death only — no team score.
- Assists, damage, streaks, multi-kills, revenge and combat score never change
  the team score.
- At 0:00 the team with more kills wins; equal kills → overtime.

## Overtime

- Starts at 0:00 on a tie ("OVERTIME · FIRST KILL WINS"). The match simply
  continues: same machines, same score and statistics, respawn still on.
- Deaths in overtime wait 5 s. Waits carried over from before 0:00 are cut
  to end at most 5 s after overtime starts (only ever sooner), so both teams
  are back for sudden death.
- The first credited kill ends the match: that team wins by one.
- The HUD clock is labelled "Overtime" and counts up (there is no time limit
  to count down to).
- **Safety cap** (not a gameplay rule): overtime still undecided after 5:00
  ends as a draw. It exists so a match is guaranteed to end — stuck bots, an
  idle player, and later an authoritative server. It is expected never to
  trigger; see TDM_BALANCING.md.

## Respawn

- Automatic for everyone, the player included. No Respawn button, no
  player-only shortcut.
- The wait is fixed at the moment of death by elapsed time:

  | Elapsed at death | Wait |
  |---|---|
  | 0:00–3:00 | 5 s |
  | 3:00–5:00 | 10 s |
  | 5:00–8:00 | 15 s |
  | 8:00–10:00 | 20 s |
  | overtime | 5 s |

- Boundary rule: the phase at the moment of death decides. A death at 2:59
  waits 5 s even though the machine returns after 3:00; a death at 3:01 waits
  10 s. The one exception is the overtime cut above.
- The end of the match cancels pending respawns.
- **Player death screen**: the scoreboard, headed "Your machine is scrap ·
  Wrecked · by X" and "Respawning in N", with "Blue n : m Red" in its header
  line; the team score stays in the HUD corner. No buttons: the match goes on,
  the mouse stays captured, the player is back in the moment the wait ends.
  Esc pauses (Exit to garage is in the pause menu).

## Spawn protection

- 2 s after a respawn: incoming damage × 0.2.
- **Firing ends it at once**, for the player and bots alike: protection is for
  finding your bearings, not for attacking from behind it.
- Enemy bots never choose a protected machine as a target.
- A protected machine can still be wrecked (it takes a fifth of the damage).
- HUD: a SHIELD chip with the time left; markers over protected machines are
  dimmed.

## Spawn selection

Every prepared start is a candidate: both team bases (4 each) and the 16
starts on the perimeter road — 24 in either arena. Each respawn scores them all
for the machine coming back; the highest wins (ties: the lowest index), so
the choice is deterministic for a given battlefield.

- **Out** (strict pass): any machine within 8 m (wrecks included), or a live
  enemy within 30 m (ramming range). If that rules out every start, the filter
  is dropped and the best-scoring start is used anyway.
- **Score**:

  ```text
  score = min(nearest enemy, 90) + 0.3 × min(average enemy distance, 150)
        + 12 × min(teammates within 60 m, 3)
        + 25 × side
        − 45 × enemies within 120 m with a clear line of sight to the start
        − 25 × enemies within 50 m
        − 35 × wrecks within 40 m in the last 20 s
        − 60 if the start was used in the last 15 s
  ```

  *side*: +1 at the team's own base, −1 at the enemy's, 0 halfway (from the
  distances to the two base centres). Sight: a ray from the enemy's gun
  height to the start; only the static world blocks it.
- What each term is for: distance and sight keep a respawn out of the fight
  and out of view; crowd keeps it off enemy clusters; wreck pressure keeps it
  off where the fighting just was (and off a start where the last machine
  died on arrival); support puts it near teammates, so it rejoins the team;
  side keeps each team on its own half; recent use spreads respawns.

## Spawn camping

The fixed-base problem — enemies parked at a base farming every respawn — is
handled with the minimum set of mechanisms:

1. dynamic selection over every prepared start (no fixed pair of bases);
2. danger scoring: enemy distance, sight, crowd, and no start within ramming
   range of an enemy;
3. recent-death pressure: wrecks near a start count against it for 20 s;
4. spawn protection that ends on firing.

Enemy pushes into a base → its starts score badly (enemies near, watching,
crowding, fresh wrecks) → respawns move to flank starts on the team's own
half → the team comes back in from the side. When the enemy leaves, the base
scores best again. Machines only ever appear at prepared starts; nothing is
moved while alive.

## Statistics

Shared with Free for All (`scoring.ts`), same semantics and values:

- **Attribution**: each victim keeps, for its current life, each enemy's
  damage and the time of its last hit; cleared on death (after the kill is
  scored) and on respawn. Damage dealt / taken count hull actually removed.
- **Assist**: every enemy of the victim other than the killer with at least
  20 damage on the victim's current life and a hit within the 10 s before the
  kill. Once per kill. Counts in the statistics and combat score, never in the
  team score.
- **Kill streak**: kills since the last death. Milestones, once each per
  streak: 3 Killing spree, 5 Rampage, 7 Unstoppable, 10 Godlike. Death resets
  it. **Shutdown**: wrecking a machine on a streak of 3+ (feed tag).
- **Multi-kill**: a kill within 7 s of your previous one extends the chain:
  2 Double kill, 3 Triple kill, 4 Quad kill, 5+ Overkill.
- **Revenge**: wrecking an enemy that wrecked you since you last wrecked it.
- Streaks, multi-kills and revenge are feedback, statistics and combat score
  only — never damage, armour, speed or any other advantage.
- Not in TDM: nemesis (Free for All only), items.

## Combat score

| Event | Points |
|---|---|
| kill | 100 |
| assist | 50 |
| damage dealt | 0.5 per hull point |
| multi-kill | 25 per extra kill in the chain |
| streak milestone | 25 |
| revenge | 25 |

No item points (TDM has no items). Deterministic. It orders the scoreboard
and decides the MVP; it never decides the team result.

## MVP

- The machine with the highest combat score when the match completes.
- Ties: more kills, then more assists, then fewer deaths, then line-up order.
- No MVP when nobody has any combat score (nothing happened all match): the
  tie-break never crowns a machine with 0.
- Independent of the team result: the MVP can be on the losing team, and can
  have fewer kills than others. Not a vote; never given to the winning team
  automatically.

## Team AI

Bots stay light: the existing driving, routing and firing (`ai.ts`), steered
by two TDM hooks (`tactics.ts`).

**Target priority** — each enemy's distance, less a bias in metres:

1. the enemy shooting the bot (its 6 s grudge; always first)
2. an enemy that hit a teammate within 70 m of the bot in the last 3 s: 45 m nearer
3. an enemy at or below 35 % hull: 30 m nearer
4. an isolated enemy (no teammate within 35 m): 15 m nearer
5. the nearest enemy

A bot picks from enemies whose biased distance is under 70 m, so a teammate
under fire pulls help from up to 115 m away. Teammates, wrecks and protected
machines are never targets.

**Stances** (not classes: recomputed continuously from the battlefield):

- *Attack* — engage the target; with nobody in range, head for the enemy the
  bot values most, anywhere (the team shares what it sees, as the player's
  minimap does).
- *Support* — going for an enemy that is attacking a teammate.
- *Flank* — the target stands with 2+ teammates within 30 m and the bot is
  more than 45 m off: it drives for a point 35 m off the target's side,
  firing on the way, and engages once within 45 m. Each bot has a fixed side,
  so a team splits round both flanks.
- *Defend* — its team is 4+ kills behind and the bot is isolated with nobody
  in range: it regroups with its nearest teammate before hunting.

**Comeback** (team 4+ kills behind): the defend bias × 1.25, the isolated
bias × 1.5, the enemy team's sole top scorer counts 20 m nearer, groups of
two already get flanked, isolated bots regroup. No damage, hull, armour,
speed, fire-rate or respawn change — ever.

The same rules drive both teams; allied bots defend the player like any
teammate.

## Vehicle combat

The vehicle and weapon model is shared with every mode and unchanged: arcade
handling with real mass, collisions and rocket shoves. Ramming moves, spins,
flips and blocks machines — it takes firing angles away and gives them —
but deals no hull damage (no mode has collision damage), so weapons stay the
way to wreck. Adding ram damage would be a cross-mode combat change and a
separate feature.

## HUD

- **Team score** (top left, the largest numbers on screen): BLUE n : m RED
  in team colours, then "Leading by n" (blue) / "Tied" (neutral) / "Trailing
  by n" (red) — the line takes the colour of the team ahead.
- **Clock** (top right, under the minimap): Time / Overtime, urgency colours.
- **Banners and countdown**: pre-match digits and GO; "Final minute";
  "Overtime · First kill wins"; digits in the last 10 s.
- **Kill feed** (under the clock): the last 5 lines, each for 7 s, newest on
  top: killer and victim names in team colours (relative to the player:
  allies blue, enemies red), "wrecked", up to two tags (Revenge, multi-kill,
  streak, Shutdown); lines involving the player are marked. News lines:
  Final minute, Overtime.
- **Callouts**: GO; the player's own tags; "Assist".
- Player status unchanged: health, SHIELD chip, speed, weapon, minimap
  (allies blue, enemies red).

## Scoreboard

Hold Tab (in play or while down); it is also the death screen. It sits
centred, moved left only as far as needed to keep clear of the kill feed, so
the feed stays readable while the player is down; the last-10-seconds
countdown digits draw above it.

- Header: "The City · Blue n : m Red · Time mm:ss".
- Each team under its own header (name in team colour, "n kills"), the
  player's team first; members ranked by combat score, then kills, assists,
  fewer deaths.
- Columns: #, machine, K, D, A, streak, damage, score. The player's row is
  highlighted; wrecks are dimmed.

## Results

- "Match complete · Team Deathmatch · The City"; VICTORY / DEFEAT / DRAW;
  "Overtime" under it when overtime was played; the player's kills · deaths ·
  assists; the badge "n : m" (Blue · Red).
- **MVP** card: name, team, combat score; kills · deaths · assists · damage.
- The player's tiles: kills, deaths, assists, damage, score, best streak;
  then K/D, multi-kills, revenge kills, damage taken.
- Final standings: both rosters under their team headers (kills, "Winner"),
  ranked like the scoreboard, the MVP crowned.
- Play again (a fresh match from pre-match) / Exit to garage.

## Match end

Bots stand down; no more damage, kills or respawns; pending respawns are
cancelled; protection, kill chains and damage attribution are cleared; the
MVP is fixed. Wrecks stay where they fell.

## Explicitly excluded

Items and pickups of every kind (health, repair, ammo, speed, armour, damage
boost), rarity, supply waves, hot zones, comeback item weighting, nemesis;
kill limits ("first to N"); rounds, buy phases, resets; manual respawn;
stat buffs from streaks or for a team behind; ram damage.
