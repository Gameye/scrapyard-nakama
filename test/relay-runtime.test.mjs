import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { test } from 'node:test'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import WebSocket, { WebSocketServer } from 'ws'

const SECRET = 'relay-secret-for-tests-0123456789abcdef'
const SITE = 'https://scrapyard.gameye.com'

function sign(claims) {
  const signed = `v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `${signed}.${createHmac('sha256', SECRET).update(signed).digest('base64url')}`
}

// Stands in for the internet: the relay asks for <ip>.sslip.io, this sends it
// to the local game server, so the test needs no DNS.
const LOOPBACK_DNS = `export default { fetch(request) {
  const url = new URL(request.url)
  if (url.hostname !== '127.0.0.1.sslip.io') return new Response('unexpected upstream ' + url.hostname, { status: 500 })
  url.hostname = '127.0.0.1'
  return fetch(new Request(url, request))
} }`

/** A raw upgrade attempt (fetch cannot send Upgrade); resolves with status and headers. */
function rawUpgrade(url, origin) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', Origin: origin } })
    req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode, headers: res.headers }) })
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers }) })
    req.on('error', reject)
    req.end()
  })
}

async function startRelay(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    {
      name: 'relay', modules: true, scriptPath: 'edge/worker.js', compatibilityDate: '2026-09-26',
      bindings: { RELAY_SECRET: SECRET, ALLOWED_ORIGINS: SITE, GAMEYE_IPV4_DNS_SUFFIX: 'sslip.io' },
      outboundService: 'loopback-dns',
    },
    { name: 'loopback-dns', modules: true, script: LOOPBACK_DNS, compatibilityDate: '2026-09-26' },
  ] }))
  t.after(() => mf.dispose())
  return (await mf.ready).origin
}

test('workerd relays a signed upgrade to the game server and passes messages through', { timeout: 30000 }, async (t) => {
  const backend = createServer()
  const sockets = new WebSocketServer({ server: backend })
  const upgrades = []
  sockets.on('connection', (ws, req) => {
    upgrades.push({ url: req.url, origin: req.headers.origin, ip: req.headers['x-forwarded-for'] })
    ws.on('message', (data) => ws.send(data.toString()))
  })
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  t.after(() => { for (const ws of sockets.clients) ws.terminate(); sockets.close(); backend.close() })

  const origin = await startRelay(t)
  const token = sign({ t: 'relay', sid: 's1', host: '127.0.0.1', port: backend.address().port, exp: Math.floor(Date.now() / 1000) + 120 })
  const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/match?token=${token}`, { origin: SITE, headers: { 'CF-Connecting-IP': '203.0.113.7' } })
  t.after(() => ws.terminate())
  await once(ws, 'open')
  const received = once(ws, 'message')
  ws.send('game-state-probe')
  assert.equal(String((await received)[0]), 'game-state-probe')
  // workerd, like Cloudflare, drops CF-Connecting-IP on subrequests; X-Forwarded-For carries it.
  assert.deepEqual(upgrades, [{ url: '/match', origin: SITE, ip: '203.0.113.7' }])
  ws.close(); await once(ws, 'close')
})

test('workerd answers 503 with Retry-After while nothing listens on the port, and 403 to a bad origin', { timeout: 30000 }, async (t) => {
  const closed = createServer()
  closed.listen(0, '127.0.0.1'); await once(closed, 'listening')
  const port = closed.address().port
  closed.close(); await once(closed, 'close')

  const origin = await startRelay(t)
  const token = sign({ t: 'relay', sid: 's1', host: '127.0.0.1', port, exp: Math.floor(Date.now() / 1000) + 120 })
  const refused = await rawUpgrade(`${origin}/match?token=${token}`, SITE)
  assert.equal(refused.status, 503)
  assert.equal(refused.headers['retry-after'], '1')
  const foreign = await rawUpgrade(`${origin}/match?token=${token}`, 'https://evil.example')
  assert.equal(foreign.status, 403)
})
