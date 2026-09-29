import * as THREE from 'three'
import type { SimEvents } from '../src/game/simulation'
import { cm, q4, type WireEvent } from '../src/net/protocol'

// A room's SimEvents: everything the simulation reports mid-step, written
// down as wire events ([code, tick, ...], NET_PLAN.md §4) until the next
// snapshot takes them. Each browser plays them back into its own view. A
// rocket reports every step of its flight; those come out joined, one
// segment per rocket per snapshot — a step's `from` is the same numbers as
// the step before's `to`, so the pieces are matched exactly.

const xyz = (v: THREE.Vector3) => [cm(v.x), cm(v.y), cm(v.z)]

export function createRecorder(tick: () => number) {
  let events: WireEvent[] = []
  const flights: Array<{ tick: number; from: THREE.Vector3; to: THREE.Vector3 }> = [] // rockets in flight since the last snapshot

  const sim: SimEvents = {
    fired(c, muzzle, heading) {
      // a hitscan round is written whole when it lands (`shot`)
      if (c.weapon.spec.rocket) events.push(['ln', tick(), c.id, ...xyz(muzzle), q4(heading.x), q4(heading.y), q4(heading.z)])
    },
    shot(c, muzzle, shot, victim) {
      const { point, normal } = shot
      events.push(['sh', tick(), c.id, ...xyz(muzzle), ...xyz(point), Math.round(normal.x * 100), Math.round(normal.y * 100), Math.round(normal.z * 100), shot.collider ? 1 : 0, victim?.id ?? -1])
    },
    rocket(from, to) {
      const flight = flights.find((f) => f.to.equals(from))
      if (flight) flight.to.copy(to)
      else flights.push({ tick: tick(), from: from.clone(), to: to.clone() })
    },
    burst(at) {
      events.push(['bu', tick(), ...xyz(at)])
    },
    hurt(victim, attacker) {
      events.push(['hu', tick(), victim.id, attacker.id])
    },
    wrecked(victim, attacker) {
      events.push(['wr', tick(), victim.id, attacker.id])
    },
    crashed(c, x, z, force) {
      events.push(['cr', tick(), c.id, Math.round(x * 100), Math.round(z * 100), Math.round(force * 100)])
    },
    reloading(c, started) {
      events.push(['rl', tick(), c.id, started ? 1 : 0])
    },
    respawned(c) {
      events.push(['sp', tick(), c.id])
    },
    recovered(c) {
      events.push(['rc', tick(), c.id])
    },
  }

  return {
    sim,
    // The mode's own events, raw: each browser's adapter announces them for its player.
    rules(list: readonly unknown[]) {
      for (const event of list) events.push(['ru', tick(), event])
    },
    // The room starts its next match on `seed`.
    restart(seed: number) {
      events.push(['go', tick(), seed])
    },
    // Everything since the last call, rocket flights last; then starts over.
    drain() {
      for (const { tick, from, to } of flights) events.push(['rk', tick, ...xyz(from), ...xyz(to)])
      flights.length = 0
      const taken = events
      events = []
      return taken
    },
  }
}
