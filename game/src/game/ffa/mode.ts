import RAPIER from '@dimforge/rapier3d-compat'
import type * as THREE from 'three'
import type { Agent } from '../ai.ts'
import type { Arena } from '../arena/arena.ts'
import { clock, type Feed, type MatchMode, type Seat } from '../mode.ts'
import { FFA } from './config.ts'
import { ITEMS, type Item, type Zone } from './items.ts'
import { createFreeForAll, type FfaEvent, type Participant } from './rules.ts'

// Free for all in the match runtime (the MatchMode contract, ../mode.ts):
// eight machines, each on its own team, lined up on the arena's spawns. The
// rules (rules.ts) run on the simulation's fixed step; this reports their
// events to the feed, hands the bots their plan and says when it's over.
// Pickups and the hot zone are drawn by the `scenery` the browser passes in
// (pickups.ts), so the mode also runs headless.

export interface FfaScenery {
  update(items: readonly Item[], zone: Zone | null, now: number, camera: THREE.Camera): void
  clear(): void
  dispose(): void
}

export const lineUp = (arena: Arena): Seat[] => Array.from({ length: FFA.grid }, (_, i) => ({ team: i, spawn: arena.spawns[i % arena.spawns.length] }))

// `seed`: the match's; every item and zone roll comes from it.
export function createFfaMode(machines: readonly (Participant & Agent)[], arena: Arena, world: RAPIER.World, seed: number, scenery?: FfaScenery) {
  const rules = createFreeForAll(machines, { starts: arena.spawns.map((spawn) => spawn.position), spots: itemSpots(arena, world), zones: arena.zones ?? [], seed })
  const mode = {
    kind: 'ffa' as const,
    rules,
    timing: FFA,
    starts: arena.spawns,
    plan: {
      value: (bot: Agent, rival: Agent, distance: number) => rules.targetValue(bot.id, rival.id, distance),
      errand: (bot: Agent) => rules.errand(bot.id),
    },
    outcome: () => (rules.phase !== 'complete' ? undefined : rules.winner < 0 ? null : machines[rules.winner].team),
    speedFactor: (i: number) => rules.speedFactor(i),
    fired() {},
    report(feed?: Feed) {
      if (feed) for (const event of rules.events) announce(event, feed)
      rules.events.length = 0
    },
    show(camera: THREE.Camera) {
      scenery?.update(rules.items, rules.zone, rules.now, camera)
    },
    debug: () => [`FFA    ${rules.phase} ${clock(rules.elapsed())}  items ${rules.items.length}`, `ZONE   ${rules.zone?.name ?? '-'}`],
    restart(next: number) {
      rules.reset(next)
      scenery?.clear()
    },
    dispose() {
      scenery?.dispose()
    },
    // Online: what the HUD, the pickups and the results read of the rules.
    // The standings are sorted here, from the statistics alone; the zone
    // travels by name, so a mirror keeps the arena's own zone object.
    share: () => ({
      phase: rules.phase,
      overtimeAt: ms(rules.overtimeAt),
      winner: rules.winner,
      draw: rules.draw,
      order: [...rules.standings()],
      items: rules.items.map((item) => ({ ...item, born: ms(item.born), expires: ms(item.expires) })),
      zone: rules.zone?.name ?? null,
      contenders: rules.contenders.map(({ life, respawnAt, protectedUntil, effects }) => ({
        life,
        respawnAt: ms(respawnAt),
        protectedUntil: ms(protectedUntil),
        effects: { repair: ms(effects.repair), speed: ms(effects.speed), armor: ms(effects.armor), damage: ms(effects.damage) },
      })),
      feuds: rules.feuds,
    }),
    mirror(state: unknown) {
      const shared = state as FfaShared
      Object.assign(rules, { phase: shared.phase, overtimeAt: shared.overtimeAt, winner: shared.winner, draw: shared.draw, items: shared.items })
      rules.zone = arena.zones?.find((zone) => zone.name === shared.zone) ?? null
      rules.order.splice(0, rules.order.length, ...shared.order)
      shared.contenders.forEach(({ life, respawnAt, protectedUntil, effects }, i) => {
        Object.assign(rules.contenders[i], { life, respawnAt, protectedUntil })
        Object.assign(rules.contenders[i].effects, effects)
      })
      shared.feuds.forEach((row, k) => row.forEach((kills, v) => (rules.feuds[k][v] = kills)))
    },
  }
  type FfaShared = ReturnType<typeof mode.share>
  return mode satisfies MatchMode
}

const ms = (seconds: number) => Math.round(seconds * 1000) / 1000 // match-clock times on the wire

function announce(event: FfaEvent, feed: Feed) {
  switch (event.type) {
    case 'kill':
      return feed.kill(event, FFA.multiKill.titles, false)
    case 'death':
      return feed.death(event.victim, false)
    case 'nemesis':
      if (event.of === feed.me) feed.callout(`${feed.name(event.who)} is your nemesis`)
      return
    case 'item':
      return feed.pickup(event.who, event.item.x, event.item.z, ITEMS[event.item.type].label, ITEMS[event.item.type].color)
    case 'wave':
      if (event.count) feed.news('Supply drop', `${event.count} pickups`)
      return
    case 'zone':
      if (!event.zone) return
      feed.news('Hot zone', event.zone.name)
      return feed.callout(`Hot zone · ${event.zone.name}`, false)
    case 'phase':
      return feed.phase(event.phase)
  }
}

// Where items can appear: the bots' road nodes (drivable and reachable),
// kept when nothing solid is close and no start is near.
function itemSpots(arena: Arena, world: RAPIER.World) {
  const room = new RAPIER.Ball(FFA.items.clearance)
  const centre = { x: 0, y: FFA.items.clearance + 0.2, z: 0 } // clears the kerbs, reaches into anything taller
  const level = { x: 0, y: 0, z: 0, w: 1 }
  return arena.nav.nodes.filter((node) => {
    centre.x = node.x
    centre.z = node.z
    return arena.spawns.every((spawn) => spawn.position.distanceTo(node) >= FFA.items.clearOfStarts) && !world.intersectionWithShape(centre, level, room, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
  })
}
