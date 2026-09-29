import type { Agent } from '../ai.ts'
import type { Arena, SpawnPoint } from '../arena/arena.ts'
import { clock, type Feed, type MatchMode, type Seat } from '../mode.ts'
import { TDM } from './config.ts'
import { createTeamDeathmatch } from './rules.ts'
import { createTactics } from './tactics.ts'
import type { Member, TdmEvent } from './types.ts'

// Team deathmatch in the match runtime (the MatchMode contract, ../mode.ts):
// two teams of four from the arena's bases, seat 0 (the player) leading team
// 0. The rules (rules.ts) run on the simulation's fixed step, the bots play
// through the team tactics (tactics.ts); this reports the events to the feed
// and says who won. No scenery of its own.

export function lineUp(arena: Arena): Seat[] {
  const bases = teamBases(arena)
  return Array.from({ length: 2 * TDM.teamSize }, (_, seat) => {
    const team = seat < TDM.teamSize ? 0 : 1
    const base = bases[team]
    return { team, spawn: base[(seat % TDM.teamSize) % base.length] }
  })
}

export function createTdmMode(machines: readonly (Member & Agent)[], arena: Arena) {
  const bases = teamBases(arena)
  // Respawns at any prepared start — both bases and the other starts — scored for the team coming back in.
  const starts = [...bases[0], ...bases[1], ...arena.spawns]
  const rules = createTeamDeathmatch(machines, { starts: starts.map((spawn) => spawn.position), homes: [midpoint(bases[0]), midpoint(bases[1])] })
  const tactics = createTactics(machines, rules, arena.nav.nodes)
  const mode = {
    kind: 'tdm' as const,
    rules,
    tactics, // the bots' teamwork
    timing: TDM,
    starts,
    plan: {
      value: (bot: Agent, rival: Agent, distance: number) => tactics.targetValue(bot.id, rival.id, distance),
      errand: (bot: Agent) => tactics.errand(bot.id, bot.brain?.target?.id ?? -1),
    },
    outcome: () => (rules.phase !== 'complete' ? undefined : rules.winner < 0 ? null : rules.winner),
    speedFactor: () => 1,
    fired: (i: number) => rules.fired(i), // firing ends spawn protection
    report(feed?: Feed) {
      if (feed) for (const event of rules.events) announce(event, feed)
      rules.events.length = 0
    },
    show() {},
    // the match clock stands at 10:00 through overtime: show overtime's own
    debug: () => [`TDM    ${rules.phase} ${clock(rules.phase === 'overtime' ? rules.overtimeElapsed() : rules.elapsed())}  ${rules.score.join(' : ')}`],
    restart: () => rules.reset(),
    dispose() {},
    // Online: what the HUD and the results read of the rules (standings,
    // deficit and overtime follow from these and the statistics).
    share: () => ({
      phase: rules.phase,
      overtimeAt: ms(rules.overtimeAt),
      winner: rules.winner,
      draw: rules.draw,
      mvp: rules.mvp,
      score: [...rules.score],
      contenders: rules.contenders.map(({ life, respawnAt, protectedUntil }) => ({ life, respawnAt: ms(respawnAt), protectedUntil: ms(protectedUntil) })),
    }),
    mirror(state: unknown) {
      const shared = state as TdmShared
      Object.assign(rules, { phase: shared.phase, overtimeAt: shared.overtimeAt, winner: shared.winner, draw: shared.draw, mvp: shared.mvp })
      rules.score[0] = shared.score[0]
      rules.score[1] = shared.score[1]
      shared.contenders.forEach((c, i) => Object.assign(rules.contenders[i], c))
    },
  }
  type TdmShared = ReturnType<typeof mode.share>
  return mode satisfies MatchMode
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000 // match-clock times on the wire

function teamBases(arena: Arena) {
  if (!arena.bases) throw new Error(`${arena.name} has no team bases`)
  return arena.bases
}

const midpoint = (spawns: SpawnPoint[]) => ({ x: spawns.reduce((sum, s) => sum + s.position.x, 0) / spawns.length, z: spawns.reduce((sum, s) => sum + s.position.z, 0) / spawns.length })

function announce(event: TdmEvent, feed: Feed) {
  switch (event.type) {
    case 'kill':
      return feed.kill(event, TDM.multiKill.titles, true)
    case 'death':
      return feed.death(event.victim, true)
    case 'finalMinute': // a clock mark here, not a state
      return feed.phase('finalMinute')
    case 'phase':
      return feed.phase(event.phase)
  }
}
