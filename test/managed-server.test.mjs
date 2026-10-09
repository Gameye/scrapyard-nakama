// The Gameye image's entry as a process: game/dist-server/gameye-main.js
// (npm --prefix game run server:build), started as the image starts it
// (TRUST_PROXY=1, so strict) with a seat secret and a session id. Two pages
// with seat tokens for this session take seats in the one room; a third,
// with a seat token for another session, is refused. Tokens are signed here
// from the root AGENTS.md contract, not with the game's own code.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ENTRY = fileURLToPath(new URL('../game/dist-server/gameye-main.js', import.meta.url))
const SECRET = randomBytes(32).toString('base64url')
const SESSION = 'managed-test-session'
const ORIGIN = 'http://localhost:4173'

function seatToken(uid, sid = SESSION) {
  const claims = { t: 'seat', sid, uid, exp: Math.floor(Date.now() / 1000) + 120 }
  const signed = `v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `${signed}.${createHmac('sha256', SECRET).update(signed).digest('base64url')}`
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await wait(50)
  }
}

async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('the Gameye entry seats two seat-token holders and refuses another session’s', { timeout: 60_000 }, async (t) => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing: npm --prefix game run server:build first`)
  const port = await freePort()
  const child = spawn(process.execPath, [ENTRY], {
    env: { PATH: process.env.PATH, PORT: String(port), SEAT_SECRET: SECRET, GAMEYE_SESSION_ID: SESSION, ALLOWED_ORIGINS: ORIGIN, TRUST_PROXY: '1', INITIAL_IDLE_SECONDS: '50' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (data) => (output += data))
  child.stderr.on('data', (data) => (output += data))
  const exited = once(child, 'exit')
  t.after(() => child.kill('SIGKILL'))

  const health = await until(async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/health`)).json()
    } catch {
      return null
    }
  }, 20_000, 'the server’s health')
  assert.equal(health.ok, true)

  async function page(seat, ip) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/match`, { origin: ORIGIN, headers: { 'CF-Connecting-IP': ip } })
    const inbox = []
    let closed = null
    ws.on('message', (data, binary) => binary || inbox.push(JSON.parse(String(data))))
    ws.on('close', (code) => (closed = code))
    t.after(() => ws.terminate())
    await once(ws, 'open')
    ws.send(JSON.stringify({ t: 'hello', v: health.protocol, build: health.build, token: 'no-nakama-session-in-a-container', seat, loadout: { vehicle: 'razor', weapon: 'minigun' } }))
    const first = await until(() => inbox.find((m) => m.t === 'welcome' || m.t === 'err'), 5000, 'a welcome or an error')
    return { ws, first, closed: () => closed }
  }

  const seats = [seatToken('user-a'), seatToken('user-b'), seatToken('user-c', 'another-session')]
  const a = await page(seats[0], '203.0.113.1')
  const b = await page(seats[1], '203.0.113.2')
  assert.equal(a.first.t, 'welcome', JSON.stringify(a.first))
  assert.equal(b.first.t, 'welcome', JSON.stringify(b.first))
  assert.equal(a.first.room, b.first.room, 'one match, one room')
  assert.notEqual(a.first.seat, b.first.seat)

  const c = await page(seats[2], '203.0.113.3')
  assert.equal(c.first.t, 'err')
  assert.equal(c.first.code, 'auth')
  await until(() => c.closed() === 4001, 3000, 'the refused socket to close')

  child.kill('SIGTERM')
  const [code] = await exited
  assert.equal(code, 0, output)
  assert.ok(!output.includes(SECRET), 'the seat secret is never logged')
  for (const seat of seats) assert.ok(!output.includes(seat.split('.')[1]) && !output.includes(seat.split('.')[2]), 'no seat token is logged')
})
