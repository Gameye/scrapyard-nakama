// Self-check for the match protocol (protocol.ts): what the wire carries
// comes back within its rounding, and every rule a client message must pass
// holds — clamped, coerced, or refused. Plain node:
// node src/net/protocol.check.ts
import * as THREE from 'three'
import { WEAPONS } from '../game/combat.ts'
import { createWorld, initPhysics } from '../game/physics.ts'
import { createStats } from '../game/scoring.ts'
import { enlist } from '../game/simulation.ts'
import { forwardSpeed } from '../game/vehicle/drive.ts'
import { acceptSeq, AIM_MARGIN, BUILD, carRow, clampAim, clampView, inputMessage, LIMITS, meRow, parseClient, readCar, readMe, readStats, REWIND, statsRow, weaponId, type Input } from './protocol.ts'

await initPhysics()

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`protocol: ${what}`)
  checks++
}
const near = (a: number, b: number, within: number) => Math.abs(a - b) <= within

// --- what the wire carries -------------------------------------------------------------

const world = createWorld([])
const car = enlist(world, 3, { name: 'test', team: 1, seed: 4, spawn: { position: new THREE.Vector3(12.3456, 0, -45.6789), heading: 0.7 }, vehicle: 'razor', weapon: WEAPONS.rocketPod, bot: false })
car.car.body.setLinvel({ x: 7.891, y: -0.333, z: -12.345 }, true)
car.car.body.setAngvel({ x: 0.1234, y: -1.5678, z: 0.0042 }, true)
car.rotation.set(0.1, 0.3, -0.05, 0.94).normalize()
car.velocity.copy(car.car.body.linvel() as THREE.Vector3)
car.health = 63.37
Object.assign(car.control, { throttle: -1, handbrake: true, fire: true })
car.control.aim.set(101.119, 2.5, -80.004)
car.car.steer = -0.41
car.car.body.setRotation(car.rotation, true)

const row = carRow(car)
const back = readCar(row)
check(row.every(Number.isInteger), 'a car row is integers only')
check(back.id === 3 && back.alive && back.handbrake && back.fire && back.throttle === -1, 'id, flags and throttle come back exactly')
check(['x', 'y', 'z'].every((k) => near(back.position[k as 'x'], car.position[k as 'x'], 0.005)), 'position within 5 mm')
check(['x', 'y', 'z', 'w'].every((k) => near(back.rotation[k as 'x'], car.rotation[k as 'x'], 1e-4)), 'rotation within 1e-4 a component')
check(['x', 'y', 'z'].every((k) => near(back.velocity[k as 'x'], car.velocity[k as 'x'], 0.005)), 'velocity within 5 mm/s')
check(['x', 'y', 'z'].every((k) => near(back.aim[k as 'x'], car.control.aim[k as 'x'], 0.005)), 'aim within 5 mm')
check(near(back.health, 63.37, 0.05) && near(back.steer, -0.41, 0.005), 'hull within 0.05, steer within 0.005')
check(near(back.speed, forwardSpeed(car.car), 0.02), `speed worked out from rotation and velocity (${back.speed.toFixed(3)} vs ${forwardSpeed(car.car).toFixed(3)})`)
car.alive = false
check(!readCar(carRow(car)).alive, 'a wreck reads as one')

car.weapon.ammo = 4
car.weapon.reload = 1.2345
car.stuck = 2.5
const me = readMe(meRow(car))
check(near(me.spin.y, -1.5678, 0.001) && near(me.steer, -0.41, 1e-4) && me.ammo === 4 && near(me.reload, 1.2345, 0.001) && near(me.stuck, 2.5, 0.001), 'the player’s own row: spin, steer, weapon, timers')

const stats = { ...createStats(), kills: 3, damageDealt: 123.456, combatScore: 461.728 }
const statsBack = readStats(statsRow(stats), createStats())
check(statsBack.kills === 3 && near(statsBack.damageDealt, 123.456, 0.005) && near(statsBack.combatScore, 461.728, 0.005), 'statistics within 0.01')
check(weaponId({ ...WEAPONS.rocketPod, damage: 1 }) === 'rocketPod' && weaponId(WEAPONS.minigun) === 'minigun', 'a scaled bot gun is named by its registry id')

// --- input: what a client sends, what the server reads -------------------------------------------

const control = { throttle: 1, steer: -0.5, handbrake: false, fire: true, recover: false, aim: new THREE.Vector3(10.004, 1.5, -3.2) }
const sent = inputMessage(42, control, 900)
check(sent.length <= 120, `an input is small (${sent.length} bytes)`)
const parsed = parseClient(sent)
check(parsed.ok && parsed.message.t === 'in', 'an input parses')
const input = (parsed.ok ? parsed.message : null) as Input
check(input.seq === 42 && input.throttle === 1 && input.steer === -0.5 && input.fire && !input.handbrake && input.view === 900, 'an input comes back whole')
check(near(input.aim.x, 10.004, 0.005) && near(input.aim.z, -3.2, 0.005), 'its aim within 5 mm')

const raw = (fields: Record<string, unknown>) => JSON.stringify({ t: 'in', s: 1, th: 0, st: 0, hb: 0, f: 0, r: 0, a: [0, 0, 0], w: 0, ...fields })
const parse = (text: string) => {
  const result = parseClient(text)
  return result.ok ? (result.message as Input) : null
}
check(parse(raw({ th: 5000, st: -5000 }))?.throttle === 1 && parse(raw({ th: 5000, st: -5000 }))?.steer === -1, 'throttle and steer are clamped to [-1, 1]')
check(parse(raw({ hb: 'yes', f: 7, r: [] }))?.handbrake === true && parse(raw({ hb: 0, f: null }))?.fire === false, 'flags are coerced to booleans')
const infinite = (field: string) => raw({ [field]: 0 }).replace(`"${field}":0`, `"${field}":1e999`) // JSON.parse reads 1e999 as Infinity
check(['th', 'st', 'w'].every((field) => JSON.parse(infinite(field))[field] === Infinity && parse(infinite(field)) === null), 'Infinity is refused')
check(parse(raw({ th: null })) === null && parse(raw({ th: '1' })) === null && parse(raw({ w: undefined })) === null, 'a missing or non-number control is refused')
check(parse(raw({ a: [0, 0] })) === null && parse(raw({ a: [0, 0, 7] }).replace('[0,0,7]', '[0,0,-1e999]')) === null && parse(raw({ a: 'here' })) === null, 'an aim that is not three finite numbers is refused')
check(parse(raw({ s: -1 })) === null && parse(raw({ s: 1.5 })) === null && parse(raw({ s: 2 ** 60 })) === null, 'a seq must be a whole number ≥ 0')
const forged = parse(raw({ health: 100, position: [0, 0, 0], damage: 999, kill: 3, ammo: 60, alive: true }))
check(forged !== null && Object.keys(forged).sort().join() === 'aim,fire,handbrake,recover,seq,steer,t,throttle,view', 'fields besides the controls are left behind')
check(parse(raw({ a: [1e9, -1e9, 5e8] }))?.aim.x === 10000, 'a wild aim is pulled in before the room clamps it to range')
check(!parseClient(raw({ pad: 'x'.repeat(LIMITS.input) })).ok, 'an input over 1 KB is refused')
check(!parseClient('{"t":"hello"}', LIMITS.hello + 1).ok, 'anything over 4 KB is refused')

// --- the other messages -----------------------------------------------------------------

const hello = parseClient(JSON.stringify({ t: 'hello', v: 1, token: 'a.b.c', guest: 1, mode: 'ffa', map: 'city', loadout: { vehicle: 'tank', weapon: 'railgun' }, admin: true }))
check(hello.ok && hello.message.t === 'hello' && hello.message.guest && hello.message.loadout.vehicle === 'razor' && hello.message.loadout.weapon === 'minigun', 'unknown loadout ids get the defaults')
check(hello.ok && !('admin' in hello.message), 'a hello keeps only its own fields')
const good = parseClient(JSON.stringify({ t: 'hello', v: 1, token: 't', mode: 'tdm', map: 'scrapyard', loadout: { vehicle: 'razor', weapon: 'rocketPod' } }))
check(good.ok && good.message.t === 'hello' && good.message.loadout.weapon === 'rocketPod', 'a known loadout is kept')
check(!parseClient(JSON.stringify({ t: 'hello', v: 1, token: '', mode: 'ffa', map: 'city' })).ok, 'a hello needs a token')
check(!parseClient(JSON.stringify({ t: 'hello', v: 1, token: 'x'.repeat(LIMITS.token + 1), mode: 'ffa', map: 'city' })).ok, 'a token has a length limit')
check(!parseClient(JSON.stringify({ t: 'hello', v: 1, token: 't', mode: 'x'.repeat(40), map: 'city' })).ok, 'mode and map have a length limit')
const built = parseClient(JSON.stringify({ t: 'hello', v: 2, build: '0123456789ab', token: 't', mode: 'ffa', map: 'city' }))
check(built.ok && built.message.t === 'hello' && built.message.build === '0123456789ab', 'a hello carries its build')
for (const build of [undefined, 42, '', 'x'.repeat(LIMITS.build + 1)]) {
  const odd = parseClient(JSON.stringify({ t: 'hello', v: 2, build, token: 't', mode: 'ffa', map: 'city' }))
  check(odd.ok && odd.message.t === 'hello' && odd.message.build === '', `a hello with no build, or a wrong kind (${JSON.stringify(build)?.slice(0, 12)}), is kept, as no build at all: the server tells that page to reload`)
}
check(BUILD === 'dev', 'under plain node there is no build id: dev')
const session = parseClient(JSON.stringify({ t: 'hello', v: 3, build: 'b', token: 't', loadout: {} }))
check(session.ok && session.message.t === 'hello' && session.message.mode === '' && session.message.map === '', 'a hello without mode and map is kept (a matchmaking session), both as empty')
check(!parseClient(JSON.stringify({ t: 'hello', v: 3, token: 't', mode: 7, map: 'city' })).ok && !parseClient(JSON.stringify({ t: 'hello', v: 3, token: 't', map: ['city'] })).ok, 'a mode or map of the wrong kind is refused')

// --- matchmaking ----------------------------------------------------------------------------

const queue = (message: object) => parseClient(JSON.stringify({ t: 'mm', ...message }))
const search = queue({ do: 'search', mode: 'tdm', uid: 'someone-else', createdAt: 0, id: 'p1' })
check(search.ok && JSON.stringify(search.message) === '{"t":"mm","do":"search","mode":"tdm","id":"p1"}', 'a search keeps its action, mode and id only: never a player id or a time')
check(!queue({ do: 'search' }).ok && !queue({ do: 'search', mode: '' }).ok, 'a search needs its mode')
check(queue({ do: 'accept', id: 'p12' }).ok && queue({ do: 'decline', id: 'p12' }).ok && !queue({ do: 'accept' }).ok && !queue({ do: 'decline', id: 5 }).ok, 'an answer needs the proposal it answers')
check(queue({ do: 'cancel' }).ok && queue({ do: 'state' }).ok, 'cancel and state need nothing else')
check(!queue({ do: 'start' }).ok && !queue({}).ok && !queue({ do: 'accept', id: 'x'.repeat(40) }).ok, 'an unknown action, none, or an overlong id is refused')
check(!parseClient(JSON.stringify({ t: 'mm', do: 'state', pad: 'x'.repeat(2000) })).ok, 'a queue message is small')
check(parseClient('{"t":"ping","c":12.5}').ok && !parseClient('{"t":"ping"}').ok, 'a ping needs its time')
check(parseClient('{"t":"bye"}').ok, 'bye')
for (const junk of ['nope', '[]', 'null', '42', '{"t":"shoot"}', '{"t":"state"}', '{}']) check(!parseClient(junk).ok, `refused: ${junk}`)

// --- the room's rules ------------------------------------------------------------------------

const from = new THREE.Vector3(0, 1, 0)
const far = clampAim({ x: 10000, y: 1, z: 0 }, from, WEAPONS.minigun.range)
check(near(Math.hypot(far.x - from.x, far.y - from.y, far.z - from.z), WEAPONS.minigun.range + AIM_MARGIN, 1e-6), 'an aim 10 km away is pulled in to the range')
check(clampAim({ x: 20, y: -50, z: 0 }, from, 160).y === -1, 'an aim deep underground is lifted to 1 m below')
const close = clampAim({ x: 30, y: 2, z: -40 }, from, 160)
check(close.x === 30 && close.y === 2 && close.z === -40, 'an aim within range is left alone')
check(clampView(100, 500) === 500 - REWIND && clampView(900, 500) === 500 && clampView(495.4, 500) === 495, 'the tick a player sees is held to the last 200 ms')
check(acceptSeq(5, 6) && !acceptSeq(5, 5) && !acceptSeq(5, 4), 'seqs only move forward')

world.free()
console.log(`protocol ok (${checks} checks)`)
