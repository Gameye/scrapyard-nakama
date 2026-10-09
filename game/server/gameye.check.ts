// Self-check for the Gameye game server (gameye-main.ts): one match per
// container, only seat-token holders seated, and the process ends itself.
// The seat token against the Go reference's own output (nakama/modules-src/
// tokens.go) and every way a token is refused; a real managed server on a
// free port, real sockets: two matched players in one room, a foreign
// session's, an expired and a tampered token refused without harm, the hold
// for the other matched players, the idle timeouts (no one ever came; the
// last one left), the match's end and the hard limit, and the address behind
// the relay (CF-Connecting-IP); then the entry itself, as a process: what it
// refuses to start without, and that it exits on its own.
// Bundled: npm run server:check.
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import type { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linkEnded } from '../src/game/linkEnd'
import { initPhysics } from '../src/game/physics'
import { join as joinMatch, openSocket } from '../src/net/connection'
import { BUILD, PROTOCOL, readServer, type ServerMessage } from '../src/net/protocol'
import { arenaData } from './arenas'
import { page, until as pageUntil } from './browser'
import { seatSignature, signSeatToken, verifySeatToken } from './gameye-auth'
import { createManagedServer, ENDINGS, type ManagedOptions } from './gameye-server'

await initPhysics()
const arena = arenaData('scrapyard')

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`gameye: ${what}`)
  checks++
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(done: () => boolean, ms: number, what: string) {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error(`gameye: timed out waiting for ${what}`)
    await wait(10)
  }
}

// --- the seat token, against the Go reference --------------------------------------------------------

const SECRET = 'seat-secret-for-the-checks-0123456789abcdef'
const SESSION = 'sess-7f3a'
const UID = '2c1d0a9e-4b8f-4e5a-9d2b-6f1e3c7a8b90'
// Printed by tokens.go's signSeatToken / signRelayToken for SECRET, SESSION, UID (and 1.2.3.4:7360), issued at 1900000000.
const GO_SEAT = 'v1.eyJ0Ijoic2VhdCIsInNpZCI6InNlc3MtN2YzYSIsInVpZCI6IjJjMWQwYTllLTRiOGYtNGU1YS05ZDJiLTZmMWUzYzdhOGI5MCIsImV4cCI6MTkwMDAwMDEyMH0.a7yRAQJas9T47fMSEosNo_vJJehS9Ff0htHI4AFaeWk'
const GO_RELAY = 'v1.eyJ0IjoicmVsYXkiLCJzaWQiOiJzZXNzLTdmM2EiLCJob3N0IjoiMS4yLjMuNCIsInBvcnQiOjczNjAsImV4cCI6MTkwMDAwMDEyMH0.FE8NCsPi_n-nq6cOIw871t59b6hsKBSeHc8UfMQxKFY'
const ISSUED = 1_900_000_000

{
  const seat = verifySeatToken(GO_SEAT, SECRET, SESSION, ISSUED + 5)
  check(seat?.uid === UID && seat.expires === ISSUED + 120, 'a seat token signed by the Go plugin is good here')
  check(signSeatToken(SECRET, SESSION, UID, ISSUED) === GO_SEAT, 'and signed here it is the same token, byte for byte')
  check(!!verifySeatToken(GO_SEAT, SECRET, SESSION, ISSUED + 120), 'good while now ≤ exp')
  check(!verifySeatToken(GO_SEAT, SECRET, SESSION, ISSUED + 121), 'expired a second after')
  check(!verifySeatToken(GO_SEAT, SECRET, 'sess-other', ISSUED), 'another session’s seat is refused')
  check(!verifySeatToken(GO_SEAT, `${SECRET}x`, SESSION, ISSUED), 'another secret’s signature is refused')
  check(!verifySeatToken(GO_RELAY, SECRET, SESSION, ISSUED), 'a relay token, though signed with the same secret, is not a seat')
  const [v, payload, signature] = GO_SEAT.split('.')
  const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
  const resigned = (claims: Record<string, unknown>) => {
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `v1.${p}.${seatSignature(SECRET, `v1.${p}`)}`
  }
  check(!!verifySeatToken(resigned(body), SECRET, SESSION, ISSUED), 'the checks’ own signing is the contract’s')
  const flip = (s: string, at: number) => s.slice(0, at) + (s[at] === 'A' ? 'B' : 'A') + s.slice(at + 1)
  for (const [what, token] of [
    ['a tampered payload', `${v}.${Buffer.from(JSON.stringify({ ...body, uid: 'someone-else' })).toString('base64url')}.${signature}`],
    ['a tampered signature', `${v}.${payload}.${flip(signature, 5)}`],
    ['a signature cut short', `${v}.${payload}.${signature.slice(0, -2)}`],
    ['a padded signature', `${v}.${payload}.${signature}=`],
    ['a signature in plain base64', `${v}.${payload}.${signature.replaceAll('_', '/').replaceAll('-', '+')}/`],
    ['another version', `v2.${payload}.${signature}`],
    ['four parts', `${GO_SEAT}.x`],
    ['two parts', `${v}.${payload}`],
    ['an empty payload', `${v}..${signature}`],
    ['nothing', ''],
    ['over 1024 characters', `${GO_SEAT}${'A'.repeat(1025 - GO_SEAT.length)}`],
    ['not JSON', resigned({}).replace(/^v1\.[^.]+/, 'v1.bm90IGpzb24')],
    ['no uid', resigned({ ...body, uid: '' })],
    ['no session', resigned({ ...body, sid: '' })],
    ['a uid that isn’t text', resigned({ ...body, uid: 7 })],
    ['an exp that isn’t a whole number', resigned({ ...body, exp: '1900000120' })],
    ['an exp with a fraction', resigned({ ...body, exp: 1_900_000_120.5 })],
    ['no type', resigned({ sid: SESSION, uid: UID, exp: ISSUED + 120 })],
  ] as const)
    check(!verifySeatToken(token, SECRET, SESSION, ISSUED), `${what} is refused`)
  check(!verifySeatToken(resigned({ t: 'seat', sid: SESSION, uid: UID }), SECRET, SESSION, ISSUED), 'no exp: dead since 1970')
  for (const odd of [undefined, null, 42, {}, ['v1']]) check(!verifySeatToken(odd, SECRET, SESSION, ISSUED), `a seat of ${JSON.stringify(odd)} is refused, no throw`)
  check(!verifySeatToken(GO_SEAT, '', SESSION, ISSUED) && !verifySeatToken(GO_SEAT, SECRET, '', ISSUED), 'no secret or no session id: nothing is good')
}

// --- a managed server, over real sockets ---------------------------------------------------------------

const ORIGIN = 'https://play.test'
const now = () => Math.floor(Date.now() / 1000)
const seatFor = (uid: string, { session = SESSION, issued = now(), secret = SECRET } = {}) => signSeatToken(secret, session, uid, issued)

function managed(options: Partial<ManagedOptions> = {}) {
  const logs: Array<Record<string, unknown>> = []
  const m = createManagedServer({ port: 0, secret: SECRET, sessionId: SESSION, origins: [ORIGIN], initialIdle: 60_000, emptyIdle: 60_000, maxSession: 120_000, log: (line) => logs.push(line), ...options })
  let ended = ''
  void m.done.then((reason) => (ended = reason))
  return { m, logs, ended: () => ended }
}

type Probe = Awaited<ReturnType<typeof probe>>
function probe(port: number, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/match`, { headers: { Origin: ORIGIN, ...headers } } as unknown as string[])
  const inbox: ServerMessage[] = []
  let closed: { code: number; reason: string } | null = null
  let seq = 0
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (e) => inbox.push(readServer(e.data))
  ws.onclose = (e) => (closed = { code: e.code, reason: e.reason })
  const p = {
    ws,
    inbox,
    closed: () => closed,
    hello: (fields: Record<string, unknown>) => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, build: BUILD, token: 'a-nakama-session-the-container-cannot-check', loadout: { vehicle: 'razor', weapon: 'minigun' }, ...fields })),
    input: () => ws.send(JSON.stringify({ t: 'in', s: ++seq, th: 0, st: 0, a: [0, 100, 0], w: 0 })),
    of: <T extends ServerMessage['t']>(t: T) => inbox.filter((m) => m.t === t) as Array<Extract<ServerMessage, { t: T }>>,
    last: <T extends ServerMessage['t']>(t: T) => p.of(t).at(-1),
  }
  return new Promise<typeof p>((resolve, reject) => {
    ws.onopen = () => resolve(p)
    ws.onerror = () => reject(new Error('refused'))
  })
}
async function seated(port: number, uid: string, fields: Record<string, unknown> = {}) {
  const p = await probe(port)
  p.hello({ seat: seatFor(uid), ...fields })
  await until(() => !!p.last('welcome') || !!p.closed(), 3000, `${uid}'s welcome`)
  check(!!p.last('welcome'), `${uid} is seated (${JSON.stringify(p.last('err'))})`)
  return p
}
async function refused(port: number, fields: Record<string, unknown>) {
  const p = await probe(port)
  p.hello(fields)
  await until(() => !!p.closed(), 3000, 'a refusal')
  return p
}
const leaveAll = (ps: Probe[]) => ps.forEach((p) => p.ws.close())

// Two matched players into one room; the others' tokens refused, and the server none the worse.
{
  const { m, logs, ended } = managed()
  const port = await m.listen()
  const a = await seated(port, 'user-a')
  const b = await seated(port, 'user-b', { mode: 'tdm', map: 'city' })
  const c = await seated(port, 'user-c', { mode: '', map: '' })
  check(m.server.lobby.rooms.length === 1 && new Set([a, b, c].map((p) => p.last('welcome')!.room)).size === 1, 'matched players are seated in the one room, whatever mode or arena the hello names, a map or none')
  const welcome = a.last('welcome')!
  check(welcome.mode === 'ffa' && welcome.map === 'scrapyard' && b.last('welcome')!.mode === 'ffa', 'the match’s own mode and arena')
  check(welcome.lineUp.length === 8 && welcome.lineUp.filter((s) => s.human).length >= 1 && m.server.lobby.rooms[0].humans.length === 3, 'bots fill the seats nobody holds')

  for (const [what, fields] of [
    ['a seat for another session', { seat: seatFor('user-x', { session: 'sess-elsewhere' }) }],
    ['an expired seat', { seat: seatFor('user-y', { issued: now() - 121 }) }],
    ['a tampered seat', { seat: seatFor('user-z').replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) }],
    ['another match’s secret', { seat: seatFor('user-w', { secret: 'some-other-match-secret-0123456789abcdef' }) }],
    ['no seat at all', {}],
    ['a seat that isn’t text', { seat: { uid: 'user-v' } }],
    ['a Nakama session token in the seat’s place', { seat: 'eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOiJ1In0.c2ln' }],
  ] as const) {
    const p = await refused(port, fields)
    check(p.last('err')?.code === 'auth' && p.closed()!.code === 4001, `${what}: refused with the protocol’s auth error`)
  }
  check(!ended() && m.server.lobby.rooms[0].humans.length === 3, 'refusals leave the match and the server as they were')
  check(!logs.some((line) => JSON.stringify(line).includes(seatFor('user-a').split('.')[2])), 'no seat token reaches the logs')

  const again = await seated(port, 'user-a')
  await until(() => !!a.closed(), 2000, 'the older socket to go')
  check(a.last('err')?.code === 'replaced' && m.server.lobby.rooms[0].humans.filter((h) => h.uid === 'user-a').length === 1, 'the same player again: the older socket is replaced')
  leaveAll([again, b, c])
  m.stop('check over')
  check((await m.done) === 'check over', 'stops when told')
}

// The first match holds for the other matched players: it starts once the
// first person has been seated for the hold, or at once when every seat is a
// person's and their pages have loaded.
{
  const { m } = managed({ gather: 700 })
  const port = await m.listen()
  const a = await seated(port, 'hold-a')
  const b = await seated(port, 'hold-b')
  const room = m.server.lobby.rooms[0]
  a.input()
  b.input()
  await wait(300)
  check(room.hold >= 0, 'both pages loaded, but two of eight seats: the match still holds for the other matched players')
  await until(() => room.hold < 0, 2000, 'the hold to run out')
  check(room.tick >= 0.6 * 60, 'the match goes once the first person has been seated for the hold')
  leaveAll([a, b])
  m.stop('check over')
  await m.done
}
{
  const { m } = managed({ gather: 60_000, perAddress: 16 })
  const port = await m.listen()
  const people: Probe[] = []
  for (let i = 0; i < 8; i++) people.push(await seated(port, `full-${i}`))
  const room = m.server.lobby.rooms[0]
  check(room.hold >= 0, 'every seat a person’s, pages still loading: held')
  for (const p of people) p.input()
  await until(() => room.hold < 0, 2000, 'a full room to start')
  check(room.tick < 10 * 60, 'every seat a person’s and loaded: the match goes at once, not after the hold')
  const ninth = await refused(port, { seat: seatFor('full-8') })
  check(ninth.last('err')?.code === 'full', 'a ninth is told the match is full')
  leaveAll(people)
  m.stop('check over')
  await m.done
}

// No one ever comes: it ends after the initial idle time.
{
  const { m, ended } = managed({ initialIdle: 400, emptyIdle: 50 })
  await m.listen()
  const started = performance.now()
  await wait(250)
  check(!ended(), 'nobody yet: the initial idle time, not the empty one, applies')
  check((await m.done) === 'idle' && performance.now() - started >= 350, 'nobody came: it ends after the initial idle time')
}

// The last one leaves: it ends after the empty idle time.
{
  const { m, ended } = managed({ initialIdle: 300, emptyIdle: 400 })
  const port = await m.listen()
  const a = await seated(port, 'empty-a')
  const stream = setInterval(() => a.input(), 1000 / 60)
  await wait(600)
  check(!ended(), 'someone seated past both idle times: the match goes on')
  clearInterval(stream)
  a.ws.close()
  await until(() => m.server.lobby.humans() === 0, 2000, 'the player to leave')
  const left = performance.now()
  await wait(200)
  check(!ended(), 'just emptied: not yet')
  check((await m.done) === 'empty' && performance.now() - left >= 300, 'the last one left: it ends after the empty idle time')
}

// The match ends: the results go out, then the process is done.
{
  const { m, ended } = managed({ results: 1, gather: 0 })
  const port = await m.listen()
  const a = await seated(port, 'end-a')
  a.input()
  const room = m.server.lobby.rooms[0]
  room.combatants[1].stats.kills = 3 // a sole leader at the buzzer: no overtime
  Object.assign(room.mode.rules, { now: 3 + 600 - 0.2 })
  await until(() => room.mode.outcome() !== undefined, 2000, 'the buzzer')
  const buzzer = performance.now()
  await until(() => (a.last('st')?.rules as { phase?: string } | undefined)?.phase === 'complete', 1000, 'the result to reach the page')
  check(!ended(), 'the results are up: still running')
  check((await m.done) === 'match over' && performance.now() - buzzer >= 900, 'after the results it ends: one match, no next one')
  await until(() => !!a.closed(), 2000, 'the page to be let go')
  check(a.last('err')?.code === 'closing' && !a.of('s').some((s) => s.ev.some((e) => e[0] === 'go')), 'the page is told, and no next match ever started')
  check(a.last('err')?.text === ENDINGS['match over'] && a.closed()!.code === 4006, `told the match is over, with the protocol's closing code (${JSON.stringify(a.last('err'))}, ${a.closed()!.code})`)
}

// A page (net/connection.ts and net/client.ts, as online.ts plays them) at
// the end: its link ends only once the result is in, so the results stay up
// (linkEnd.ts) — never Connection lost. A session cut short mid-match is.
async function pageIn(port: number, uid: string) {
  const link = await joinMatch(await openSocket(`ws://127.0.0.1:${port}/match`, ORIGIN), { token: 'gameye', guest: false, mode: 'ffa', map: 'scrapyard', loadout: { vehicle: 'razor', weapon: 'minigun' }, seat: seatFor(uid) })
  return page(link, arena)
}
{
  const { m } = managed({ results: 1, gather: 0 })
  const port = await m.listen()
  const b = await pageIn(port, 'page-end')
  const room = m.server.lobby.rooms[0]
  room.combatants[1].stats.kills = 3 // a sole leader at the buzzer: no overtime
  Object.assign(room.mode.rules, { now: 3 + 600 - 0.2 })
  await pageUntil(() => b.mode.outcome() !== undefined, 2000, 'the result on the page', [b])
  check(b.client.net.lost === '', 'the results are up and the link is still open')
  await pageUntil(() => b.client.net.lost !== '', 4000, 'the session to end', [b])
  check((await m.done) === 'match over' && b.client.net.lost === ENDINGS['match over'], `the page's link ends with the server's word (“${b.client.net.lost}”)`)
  const outcome = b.mode.outcome()
  check(outcome !== undefined && linkEnded('victory', outcome) === 'stay' && linkEnded('defeat', outcome) === 'stay', 'the result is in when the link ends: the results stay up')
  check(linkEnded('playing', outcome) === 'result', 'even a page that had not drawn the result yet shows it, not Connection lost')
}
{
  const { m } = managed({ maxSession: 700, gather: 0 })
  const port = await m.listen()
  const b = await pageIn(port, 'page-cut')
  await pageUntil(() => b.client.net.lost !== '', 3000, 'the hard limit', [b])
  check((await m.done) === 'time limit' && b.mode.outcome() === undefined && linkEnded('playing', b.mode.outcome()) === 'lost', `cut short mid-match: Connection lost (“${b.client.net.lost}”)`)
  check(b.client.net.lost !== ENDINGS['match over'], 'and not told the match is over')
}

// A match that never finishes: the hard limit ends it.
{
  const { m, ended } = managed({ maxSession: 700, gather: 0 })
  const port = await m.listen()
  const a = await seated(port, 'long-a')
  const stream = setInterval(() => a.input(), 1000 / 60)
  await wait(400)
  check(!ended(), 'within the limit: playing')
  check((await m.done) === 'time limit', 'the hard limit ends the session')
  clearInterval(stream)
}

// Behind the relay (TRUST_PROXY): each player's own address, not the relay's.
function holdOpen(port: number, headers: Record<string, string>) {
  return new Promise<{ status: number; socket?: Socket }>((resolve) => {
    const req = request({ port, path: '/match', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: ORIGIN, ...headers } })
    req.on('response', (res) => resolve({ status: res.statusCode ?? 0 }))
    req.on('upgrade', (_res, socket) => resolve({ status: 101, socket }))
    req.on('error', () => resolve({ status: -1 }))
    req.end()
  })
}
{
  const { m } = managed({ trustProxy: true, perAddress: 1 })
  const port = await m.listen()
  const held: Socket[] = []
  const open = async (headers: Record<string, string>) => {
    const r = await holdOpen(port, headers)
    if (r.socket) held.push(r.socket)
    return r.status
  }
  check((await open({ 'X-Forwarded-For': '203.0.113.1' })) === 101 && (await open({ 'X-Forwarded-For': '203.0.113.2' })) === 101, 'two players through the same relay, told apart by X-Forwarded-For')
  check((await open({ 'X-Forwarded-For': '203.0.113.1' })) === 429, 'one player’s address is still counted')
  check((await open({ 'X-Forwarded-For': '203.0.113.1', 'CF-Connecting-IP': '203.0.113.9' })) === 429, 'X-Forwarded-For wins over CF-Connecting-IP')
  check((await open({ 'CF-Connecting-IP': '198.51.100.1' })) === 101 && (await open({ 'CF-Connecting-IP': '198.51.100.2' })) === 101, 'no X-Forwarded-For: CF-Connecting-IP tells them apart')
  check((await open({ 'CF-Connecting-IP': '198.51.100.1' })) === 429, 'and counts each')
  for (const s of held) s.destroy()
  m.stop('check over')
  await m.done
}
{
  const { m } = managed({ perAddress: 1 })
  const port = await m.listen()
  const first = await holdOpen(port, { 'X-Forwarded-For': '203.0.113.1', 'CF-Connecting-IP': '203.0.113.1' })
  const second = await holdOpen(port, { 'X-Forwarded-For': '203.0.113.2', 'CF-Connecting-IP': '203.0.113.2' })
  check(first.status === 101 && second.status === 429, 'without TRUST_PROXY neither header counts: the socket’s own address does')
  first.socket?.destroy()
  m.stop('check over')
  await m.done
}

// --- the entry, as a process --------------------------------------------------------------------------

const MAIN = join(dirname(fileURLToPath(import.meta.url)), 'gameye-main.js')
function run(env: Record<string, string>, ms = 30_000) {
  return new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`gameye: ${MAIN} still running after ${ms} ms:\n${out}`))
    }, ms)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}
{
  const good = { SEAT_SECRET: SECRET, GAMEYE_SESSION_ID: SESSION, ALLOWED_ORIGINS: ORIGIN, PORT: '0' }
  for (const [what, env, says] of [
    ['no SEAT_SECRET', { ...good, SEAT_SECRET: '' }, 'SEAT_SECRET'],
    ['a short SEAT_SECRET', { ...good, SEAT_SECRET: 'short' }, 'SEAT_SECRET'],
    ['no GAMEYE_SESSION_ID', { ...good, GAMEYE_SESSION_ID: '' }, 'GAMEYE_SESSION_ID'],
    ['no ALLOWED_ORIGINS', { ...good, ALLOWED_ORIGINS: '' }, 'ALLOWED_ORIGINS'],
    ['ALLOWED_ORIGINS *', { ...good, ALLOWED_ORIGINS: '*' }, 'ALLOWED_ORIGINS'],
    ['* among ALLOWED_ORIGINS', { ...good, ALLOWED_ORIGINS: `${ORIGIN}, *` }, 'ALLOWED_ORIGINS'],
    ['INITIAL_IDLE_SECONDS as words', { ...good, INITIAL_IDLE_SECONDS: 'soon' }, 'INITIAL_IDLE_SECONDS'],
    ['EMPTY_IDLE_SECONDS of 0', { ...good, EMPTY_IDLE_SECONDS: '0' }, 'EMPTY_IDLE_SECONDS'],
    ['MAX_SESSION_SECONDS as a fraction', { ...good, MAX_SESSION_SECONDS: '1.5' }, 'MAX_SESSION_SECONDS'],
    ['a PORT past 65535', { ...good, PORT: '70000' }, 'PORT'],
  ] as const) {
    const { code, out } = await run(env)
    check(code === 1 && out.includes('not starting') && out.includes(says), `${what}: refuses to start (${code}: ${out.trim()})`)
    check(!out.includes(SECRET), `${what}: the secret isn’t printed`)
  }
  const { code, out } = await run({ ...good, INITIAL_IDLE_SECONDS: '1' })
  check(code === 0 && out.includes('"listening"') && out.includes('"session over"') && out.includes('"idle"'), `nobody came: the process exits by itself (${code}: ${out.trim()})`)
  check(!out.includes(SECRET), 'the secret is never printed')
}

console.log(`gameye ok (${checks} checks)`)
