// node src/lib/nakama/nakama.check.mts — the session rules and the error
// texts the forms rely on.
import assert from 'node:assert/strict'
import { signedInName } from './claims.ts'
import { failure } from './failure.ts'
import { needsRefresh, parse } from './stored.ts'

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`
const now = 1_000_000
const stored = (tokenExp: number, refreshExp: number, guest?: boolean) =>
  JSON.stringify({ token: jwt({ exp: tokenExp, usn: 'razor', uid: 'u1' }), refresh_token: jwt({ exp: refreshExp }), ...(guest && { guest }) })

assert.equal(parse(null, now), null, 'nothing stored: signed out')
assert.equal(parse('not json', now), null, 'junk: signed out')
assert.equal(parse(stored(now - 10, now - 1), now), null, 'refresh token ran out: signed out')
const live = parse(stored(now + 3600, now + 86400), now)
assert.equal(live?.session.username, 'razor')
assert.equal(live?.guest, false)
assert.equal(parse(stored(now + 3600, now + 86400, true), now)?.guest, true, 'guest flag survives')
assert.ok(parse(stored(now - 10, now + 86400), now), 'expired token, live refresh token: still signed in, refreshable')
assert.equal(needsRefresh(live!.session, now), false, 'an hour left: no refresh')
assert.equal(needsRefresh(parse(stored(now + 60, now + 86400), now)!.session, now), true, 'a minute left: refresh')

// the header's quick read names the same player parse() finds (guests: nobody)
for (const raw of [null, 'not json', stored(now - 10, now - 1), stored(now + 3600, now + 86400), stored(now + 3600, now + 86400, true), stored(now - 10, now + 86400)]) {
  const signed = parse(raw, now)
  assert.equal(signedInName(raw, now), signed && !signed.guest ? signed.session.username : '', `header name for ${raw}`)
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
assert.equal(await failure(reply(400, { message: 'Password must be at least 8 characters long.' })), 'Password must be at least 8 characters long.', "Nakama's own sentence")
assert.equal(await failure(reply(401, { message: 'Invalid credentials.' }), { 401: 'Wrong email or password.' }), 'Wrong email or password.', 'known status wins')
assert.match(await failure(new TypeError('fetch failed')), /Can't reach the game server/, 'no response: no server')
assert.match(await failure(new Response('oops', { status: 500 })), /\(500\)/, 'no message: the status')

console.log('nakama.check: ok')
