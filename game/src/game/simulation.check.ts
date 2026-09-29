// Self-check for the simulation with both real modes, headless: no scene,
// sound, DOM or local player — the code the browser runs, on a flat test
// yard, controls written by hand. Covers the pre-match hold, hitscan and
// rocket damage, wrecks and scoring, respawns, the result, the restart,
// replaying a bots-only match from its seed, and the content registries'
// numbers. Run: node src/game/simulation.check.ts
import * as THREE from 'three'
import type { Arena, SpawnPoint } from './arena/arena.ts'
import { WEAPONS } from './combat.ts'
import { createFfaMode, lineUp as ffaLineUp } from './ffa/mode.ts'
import type { Feed } from './mode.ts'
import { createWorld, initPhysics, PHYSICS_STEP } from './physics.ts'
import { createSimulation, enlist, type Combatant } from './simulation.ts'
import { createTdmMode, lineUp as tdmLineUp } from './tdm/mode.ts'
import { drivePerformance, placeCar } from './vehicle/drive.ts'
import { VEHICLES } from './vehicle/vehicles.ts'

await initPhysics()

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`simulation: ${what}`)
  checks++
}

// A flat yard: eight starts on a 100 m circle facing in, a base of four at
// each end, one hot zone, a ring of road nodes.
const start = (x: number, z: number, heading: number): SpawnPoint => ({ position: new THREE.Vector3(x, 0, z), heading })
const ring = (radius: number, count: number) => Array.from({ length: count }, (_, i) => (i / count) * Math.PI * 2).map((a) => [Math.cos(a) * radius, Math.sin(a) * radius] as const)
const arena: Arena = {
  name: 'Test yard',
  root: new THREE.Group(),
  spawns: ring(100, 8).map(([x, z]) => start(x, z, Math.atan2(-x, -z))),
  bases: [[-15, -5, 5, 15].map((x) => start(x, -120, 0)), [-15, -5, 5, 15].map((x) => start(x, 120, Math.PI))],
  zones: [{ name: 'Middle', x: 0, z: 0, radius: 40 }],
  colliders: [],
  nav: { nodes: ring(60, 12).map(([x, z]) => new THREE.Vector3(x, 0, z)), links: Array.from({ length: 12 }, (_, i) => [(i + 11) % 12, (i + 1) % 12]) },
  emitters: [],
  extent: 160,
  mapRange: 78,
  paintMap() {},
  update() {},
}

// A match as the runtime seats it, with what it reports. No bots unless
// asked: the check drives.
function setup(kind: 'tdm' | 'ffa', { seed = 1, bots = false } = {}) {
  const world = createWorld(arena.colliders)
  const seats = kind === 'tdm' ? tdmLineUp(arena) : ffaLineUp(arena)
  const combatants = seats.map(({ team, spawn }, id) => enlist(world, id, { name: `car${id}`, team, seed: id + 1, spawn, vehicle: 'razor', weapon: WEAPONS.minigun, bot: bots }))
  const mode = kind === 'tdm' ? createTdmMode(combatants, arena) : createFfaMode(combatants, arena, world, seed)
  const heard = { fired: 0, shot: 0, burst: 0, hurt: 0, wrecked: [] as string[], respawned: [] as number[] }
  const sim = createSimulation({
    world,
    arena,
    combatants,
    mode,
    seed,
    events: {
      fired: () => heard.fired++,
      shot: () => heard.shot++,
      rocket() {},
      burst: () => heard.burst++,
      hurt: () => heard.hurt++,
      wrecked: (victim, attacker) => heard.wrecked.push(`${attacker.id}>${victim.id}`),
      crashed() {},
      reloading() {},
      respawned: (c) => heard.respawned.push(c.id),
      recovered() {},
    },
  })
  const lines: string[] = []
  const feed: Feed = {
    me: 0,
    name: (id) => `car${id}`,
    kill: ({ killer, victim }) => lines.push(`kill ${killer}>${victim}`),
    death: (victim) => lines.push(`death ${victim}`),
    phase: (phase) => lines.push(`phase ${phase}`),
    news: (text) => lines.push(text),
    callout() {},
    pickup() {},
  }
  // Fixed steps for `seconds` of match time (or until `done`), the events reported every step, as the match does.
  const run = (seconds: number, done = () => false) => {
    for (let k = Math.round(seconds / PHYSICS_STEP); k > 0 && !done(); k--) {
      sim.step(PHYSICS_STEP, true)
      mode.report(feed)
    }
  }
  return { world, combatants, mode, sim, heard, lines, run }
}

// Parks every car far off except `a` and `b`, 20 m apart on open ground, a's gun on b.
function duel(combatants: readonly Combatant[], a: Combatant, b: Combatant) {
  combatants.forEach((c, i) => placeCar(c.car, { x: 300 + i * 12, y: 0, z: 300 }, 0))
  placeCar(a.car, { x: 0, y: 0, z: 0 }, 0)
  placeCar(b.car, { x: 0, y: 0, z: 20 }, Math.PI)
  a.control.aim.set(0, 1.1, 20)
  a.control.fire = true
}

// --- team deathmatch ------------------------------------------------------------

{
  const m = setup('tdm')
  const [me] = m.combatants
  const enemy = m.combatants[4]
  check(m.combatants.length === 8 && m.combatants.every((c, i) => c.team === (i < 4 ? 0 : 1)), 'four a side, the player leading team 0')
  check(m.combatants.every((c) => c.position.distanceTo(c.spawn.position) < 0.5), 'everyone lined up on their own start')

  // on the grid: throttle and trigger do nothing until GO
  me.control.throttle = 1
  me.control.fire = true
  m.run(1)
  check(me.position.distanceTo(me.spawn.position) < 0.5 && m.heard.fired === 0, 'held on the grid through the countdown')
  m.run(3, () => m.mode.rules.phase !== 'preMatch')
  check(m.mode.rules.phase === 'active' && m.lines.includes('phase active'), 'GO: active, reported')
  me.control.throttle = 0

  duel(m.combatants, me, enemy)
  m.run(10, () => !enemy.alive)
  check(!enemy.alive && enemy.health === 0, 'the minigun wrecks a car in plain view')
  check(m.heard.fired > 20 && m.heard.shot === m.heard.fired && m.heard.hurt > 20, 'every round fired is reported, the hits hurt')
  check(Math.abs(me.stats.damageDealt - 100) < 1e-6 && Math.abs(enemy.stats.damageTaken - 100) < 1e-6, 'the rules record the hull removed')
  check(m.heard.wrecked.join() === '0>4' && m.lines.includes('kill 0>4'), 'the wreck is reported and fed as a kill')
  const tdm = m.mode.kind === 'tdm' ? m.mode.rules : null
  check(tdm?.score[0] === 1 && me.stats.kills === 1 && enemy.stats.deaths === 1, 'a team kill scores for the killer’s team')
  check(m.mode.rules.contenders[4].life === 'pending' && m.mode.outcome() === undefined, 'the victim waits to respawn; the match runs on')

  me.control.fire = false
  m.run(8, () => enemy.alive)
  check(enemy.alive && enemy.health === enemy.maxHealth && m.heard.respawned.includes(4), 'back in after the wait, whole')
  check(m.mode.starts.some((s) => s.position.distanceTo(enemy.position) < 0.5), 'respawned on a start the rules picked')

  // rockets: a direct hit, then the blast; every car near it is shoved
  me.weapon = { spec: WEAPONS.rocketPod, ammo: 6, cooldown: 0, reload: 0 }
  duel(m.combatants, me, enemy)
  const hull = enemy.health
  m.run(3, () => m.heard.burst > 0)
  check(m.heard.burst === 1 && enemy.health < hull, 'a rocket flies, bursts and damages')

  // the buzzer: more kills takes it
  Object.assign(m.mode.rules, { now: 3 + 600 - 0.2 })
  me.control.fire = false
  m.run(1, () => m.mode.outcome() !== undefined)
  check(m.mode.outcome() === 0, 'team 0 ahead at the buzzer wins')

  m.sim.restart(2)
  m.mode.restart(2)
  check(m.mode.rules.phase === 'preMatch' && m.mode.outcome() === undefined && tdm?.score.join() === '0,0', 'restart: the rules start over')
  check(m.combatants.every((c) => c.alive && c.health === c.maxHealth && c.position.distanceTo(c.spawn.position) < 0.5), 'restart: everyone whole on their start')
  m.world.free()
}

// --- free for all ------------------------------------------------------------------

{
  const m = setup('ffa')
  check(m.combatants.length === 8 && new Set(m.combatants.map((c) => c.team)).size === 8, 'eight machines, each its own team')
  m.run(4, () => m.mode.rules.phase === 'active')
  const [me, rival] = [m.combatants[0], m.combatants[3]]
  duel(m.combatants, me, rival)
  m.run(10, () => !rival.alive)
  check(!rival.alive && me.stats.kills === 1 && m.lines.includes('kill 0>3'), 'a kill scores for the machine')
  check(m.mode.speedFactor(0) === 1, 'no boost without a pickup')
  Object.assign(m.mode.rules, { now: 3 + 600 - 0.2 })
  me.control.fire = false
  m.run(1, () => m.mode.outcome() !== undefined)
  check(m.mode.outcome() === me.team, 'the sole leader at the buzzer takes the match')
  m.world.free()
}

// --- determinism -------------------------------------------------------------------------

// Bots only, no hand on the controls: the seed is the whole match.
function replay(seed: number) {
  const m = setup('ffa', { seed, bots: true })
  m.run(30)
  const state = JSON.stringify(m.combatants.map((c) => [c.position.toArray(), c.health, c.stats, c.weapon.ammo]))
  m.world.free()
  return state
}
const first = replay(7)
check(first === replay(7), 'the same seed replays the same match, to the last bit')
check(first !== replay(8), 'another seed, another match')

// --- content ---------------------------------------------------------------------------

for (const [id, w] of Object.entries(WEAPONS)) {
  check(w.damage > 0 && w.fireRate > 0 && w.magazine > 0 && w.reloadTime >= 0 && w.range > 0 && w.spread >= 0, `weapon ${id}: positive numbers`)
  check(!w.rocket || (w.rocket.speed > 0 && w.rocket.blast > 0), `weapon ${id}: a rocket needs speed and blast`)
}
for (const [id, v] of Object.entries(VEHICLES)) {
  check(v.armour > 0 && v.handling.mass > 0 && v.chassis.wheels.length === 4 && v.chassis.wheelRadius > 0, `vehicle ${id}: armour, mass, four wheels`)
  const { topSpeed, zeroTo80 } = drivePerformance(v.handling)
  check(topSpeed > 0 && topSpeed <= v.handling.maxSpeed && zeroTo80 > 0, `vehicle ${id}: it drives (top speed ${topSpeed.toFixed(1)} m/s)`)
}

console.log(`simulation ok (${checks} checks)`)
