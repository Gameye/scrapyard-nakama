import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import relay, { originAllowed, upstreamTarget, verifyRelayToken } from '../edge/worker.js'

const SECRET = 'relay-secret-for-tests-0123456789abcdef'
const SITE = 'https://scrapyard.gameye.com'
const env = { RELAY_SECRET: SECRET, ALLOWED_ORIGINS: SITE }
const now = () => Math.floor(Date.now() / 1000)

/** Signs like nakama/modules-src/tokens.go: v1.<b64url json>.<b64url hmac of "v1.<payload>">. */
function sign(claims, secret = SECRET) {
  const signed = `v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `${signed}.${createHmac('sha256', Buffer.from(secret, 'utf8')).update(signed).digest('base64url')}`
}
const claims = (over = {}) => ({ t: 'relay', sid: 'session-1', host: '51.195.60.60', port: 32123, exp: now() + 120, ...over })

function upgrade(token, { origin = SITE, path = '/match', method = 'GET', headers = {} } = {}) {
  const h = new Headers({ Upgrade: 'websocket', Connection: 'Upgrade', 'CF-Connecting-IP': '203.0.113.7', ...headers })
  if (origin) h.set('Origin', origin)
  const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`
  return new Request(`https://scrapyard-relay.gameye.com${path}${query}`, { method, headers: h })
}

/** Runs the worker with fetch stubbed; returns the response and what reached the upstream. */
// Node cannot build a 101 Response, so the stand-in upstream answer is a plain object.
const switched = { status: 101, headers: new Headers({ 'x-upstream': '101-stand-in' }) }
async function run(request, runEnv = env, upstream = async () => switched) {
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init)
    seen.push(req)
    return upstream(req)
  }
  try {
    return { response: await relay.fetch(request, runEnv), seen }
  } finally {
    globalThis.fetch = realFetch
  }
}

test('a valid token from the allowed origin is relayed to <ip>.<suffix>:<port>/match', async () => {
  const { response, seen } = await run(upgrade(sign(claims())))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'http://51.195.60.60.sslip.io:32123/match')
  assert.equal(seen[0].headers.get('upgrade'), 'websocket')
  assert.equal(seen[0].headers.get('origin'), SITE)
  assert.equal(response, switched, 'the upstream 101 is returned as is')
})

test('the DNS suffix and upstream Origin come from env', async () => {
  const { seen } = await run(upgrade(sign(claims())), { ...env, GAMEYE_IPV4_DNS_SUFFIX: 'nip.io', UPSTREAM_ORIGIN: 'https://play.example' })
  assert.equal(seen[0].url, 'http://51.195.60.60.nip.io:32123/match')
  assert.equal(seen[0].headers.get('origin'), 'https://play.example')
})

test('the forwarded request carries the player CF-Connecting-IP and nothing from the browser URL', async () => {
  const { seen } = await run(upgrade(sign(claims()), { headers: { Cookie: 'a=b', Authorization: 'Bearer x', 'X-Forwarded-For': '10.0.0.1' } }))
  assert.equal(seen[0].headers.get('cf-connecting-ip'), '203.0.113.7')
  assert.equal(seen[0].headers.get('x-forwarded-for'), '203.0.113.7', 'only the address Cloudflare saw, nothing the browser sent')
  assert.equal(seen[0].headers.get('cookie'), null)
  assert.equal(seen[0].headers.get('authorization'), null)
  assert.equal(new URL(seen[0].url).search, '', 'the token is not forwarded upstream')
})

test('a token signed with another secret is refused', async () => {
  const { response, seen } = await run(upgrade(sign(claims(), 'another-secret-another-secret-0000000')))
  assert.equal(response.status, 403)
  assert.equal(seen.length, 0)
})

test('an expired token is refused; one at exp is still good', async () => {
  assert.equal((await run(upgrade(sign(claims({ exp: now() - 1 }))))).response.status, 403)
  assert.equal(await verifyRelayToken(SECRET, sign(claims({ exp: 1000 })), 1000) !== null, true)
  assert.equal(await verifyRelayToken(SECRET, sign(claims({ exp: 1000 })), 1001), null)
})

test('a token whose host is not an IPv4 address is refused', async () => {
  for (const host of ['game.example', 'localhost', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '::1', '1.2.3.4/x', '1.2.3.4:80', '']) {
    const { response, seen } = await run(upgrade(sign(claims({ host }))))
    assert.equal(response.status, 403, host)
    assert.equal(seen.length, 0, host)
  }
})

test('ports outside 1-65535 and malformed claims are refused', async () => {
  for (const over of [{ port: 0 }, { port: 65536 }, { port: 80.5 }, { port: '80' }, { t: 'seat' }, { sid: '' }, { sid: 7 }, { exp: '9999999999' }]) {
    assert.equal(await verifyRelayToken(SECRET, sign(claims(over)), now()), null, JSON.stringify(over))
  }
})

test('malformed tokens are refused', async () => {
  const good = sign(claims())
  const [, payload, signature] = good.split('.')
  for (const token of [
    '', 'v1', `v2.${payload}.${signature}`, `v1..${signature}`, `v1.${payload}.`, `v1.${payload}.${signature}.x`,
    `v1.${payload}.${signature}=`, `v1.${payload}+.${signature}`, `${good}a`.padEnd(1025, 'a'),
    sign('not an object'), sign(null), `v1.${Buffer.from('{bad json').toString('base64url')}.x`,
  ]) {
    assert.equal(await verifyRelayToken(SECRET, token, now()), null, token)
  }
  assert.equal((await run(upgrade(undefined))).response.status, 403)
})

test('an over-length token is refused even when correctly signed', async () => {
  const long = sign(claims({ sid: 's'.repeat(800) }))
  assert.ok(long.length > 1024)
  assert.equal(await verifyRelayToken(SECRET, long, now()), null)
})

test('an upgrade from a disallowed origin is refused even with a valid token', async () => {
  for (const origin of ['https://evil.example', 'https://scrapyard.gameye.com.evil.example', 'http://scrapyard.gameye.com', 'null', 'http://localhost:5173', null]) {
    const { response, seen } = await run(upgrade(sign(claims()), { origin }))
    assert.equal(response.status, 403, String(origin))
    assert.equal(seen.length, 0, String(origin))
  }
})

test('the dev allow-list admits any localhost port', async () => {
  const devEnv = { ...env, ALLOWED_ORIGINS: `${SITE}, http://localhost:*` }
  for (const origin of ['http://localhost:5173', 'http://localhost:8080', 'http://localhost']) {
    assert.equal(originAllowed(devEnv, origin), true, origin)
    const { seen } = await run(upgrade(sign(claims()), { origin }), devEnv)
    assert.equal(seen[0].headers.get('origin'), origin)
  }
  for (const origin of ['https://localhost:5173', 'http://localhost.evil.example:80', 'http://evil.localhost:80', 'http://127.0.0.1:5173']) {
    assert.equal(originAllowed(devEnv, origin), false, origin)
  }
})

test('a non-upgrade request is refused', async () => {
  const token = sign(claims())
  for (const request of [
    new Request(`https://relay.example/match?token=${token}`, { headers: { Origin: SITE } }),
    upgrade(token, { headers: { Upgrade: 'h2c' } }),
    upgrade(token, { method: 'POST' }),
  ]) {
    const { response, seen } = await run(request)
    assert.equal(response.status, 400)
    assert.equal(seen.length, 0)
  }
})

test('every other path is not found', async () => {
  for (const path of ['/', '/match/', '/rooms/v1/queue', '/game/abc', '/matchx']) {
    const { response, seen } = await run(upgrade(sign(claims()), { path }))
    assert.equal(response.status, 404, path)
    assert.equal(seen.length, 0)
  }
})

test('when the upstream refuses the connection the relay answers 503 with Retry-After', async () => {
  const refused = async () => { throw new TypeError('connect ECONNREFUSED') }
  const { response } = await run(upgrade(sign(claims())), env, refused)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('retry-after'), '1')
  for (const status of [502, 503, 521, 522]) {
    const { response } = await run(upgrade(sign(claims())), env, async () => new Response('down', { status }))
    assert.equal(response.status, 503, String(status))
    assert.equal(response.headers.get('retry-after'), '1')
  }
})

test('an upstream that answers but refuses the upgrade is not retryable', async () => {
  const { response } = await run(upgrade(sign(claims())), env, async () => new Response('no', { status: 403 }))
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('retry-after'), null)
})

test('refusals never echo the token', async () => {
  const token = sign(claims({ exp: now() - 10 }))
  for (const request of [upgrade(token), upgrade(token, { origin: 'https://evil.example' }), upgrade(token, { path: '/nope' }), upgrade(token, { method: 'POST' })]) {
    const { response } = await run(request)
    const text = await response.text()
    assert.ok(!text.includes(token) && !text.includes(token.split('.')[1]))
    for (const [, value] of response.headers) assert.ok(!value.includes(token.split('.')[1]))
  }
})

test('a relay without a usable RELAY_SECRET refuses everything', async () => {
  for (const RELAY_SECRET of [undefined, '', 'short']) {
    const { response, seen } = await run(upgrade(sign(claims(), RELAY_SECRET || 'x')), { ...env, RELAY_SECRET })
    assert.equal(response.status, 500)
    assert.equal(seen.length, 0)
  }
})

test('upstreamTarget refuses a bad suffix and never builds a non-IPv4 target', () => {
  assert.equal(upstreamTarget({}, { host: '51.195.60.60', port: 1 }), 'http://51.195.60.60.sslip.io:1/match')
  assert.equal(upstreamTarget({ GAMEYE_IPV4_DNS_SUFFIX: 'evil.example/x?' }, { host: '51.195.60.60', port: 1 }), null)
  assert.equal(upstreamTarget({}, { host: 'game.example', port: 1 }), null)
})
