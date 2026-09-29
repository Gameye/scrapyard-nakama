// Smoke test for a running Nakama: guest and email sign-in, account, session
// refresh, realtime socket (a match, the online count's RPC), logout, account
// delete. Deletes what it creates.
//   local:  node scripts/nakama-smoke.mjs
//   server: NAKAMA_URL=https://api.example.com NAKAMA_CLIENT_KEY=... node scripts/nakama-smoke.mjs
// Node 22+ (global fetch and WebSocket). Exits non-zero on the first failure.
import assert from 'node:assert/strict'

const url = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350'
const basic = 'Basic ' + Buffer.from(`${process.env.NAKAMA_CLIENT_KEY ?? 'defaultkey'}:`).toString('base64')
const lifetime = (jwt) => Math.round(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).exp - Date.now() / 1000)
const bearer = (session) => 'Bearer ' + session.token

async function call(method, path, { auth = basic, body } = {}) {
  const res = await fetch(url + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

const made = [] // sessions of the accounts to delete at the end
try {
  const guest = (await call('POST', '/v2/account/authenticate/device?create=true', { body: { id: crypto.randomUUID() } })).body
  assert.ok(guest.token, 'guest sign-in')
  made.push(guest)
  assert.ok(lifetime(guest.refresh_token) >= lifetime(guest.token), 'refresh token outlives the session token (session.refresh_token_expiry_sec)')
  console.log(`ok  guest sign-in: token ${lifetime(guest.token)} s, refresh token ${lifetime(guest.refresh_token)} s`)

  const stamp = Date.now()
  const creds = { email: `smoke-${stamp}@example.test`, password: 'smoke-pass-1' }
  const reg = await call('POST', `/v2/account/authenticate/email?create=true&username=smoke${stamp}`, { body: creds })
  assert.equal(reg.body.created, true, `register: ${reg.status} ${reg.body.message ?? ''}`)
  made.push(reg.body)
  assert.equal((await call('POST', '/v2/account/authenticate/email?create=false', { body: { ...creds, password: 'wrong-pass-1' } })).status, 401, 'wrong password is refused')
  console.log('ok  register, wrong password refused')

  assert.equal((await call('PUT', '/v2/account', { auth: bearer(reg.body), body: { display_name: 'Smoke Test' } })).status, 200, 'account update')
  assert.equal((await call('GET', '/v2/account', { auth: bearer(reg.body) })).body.user?.display_name, 'Smoke Test', 'account read')
  console.log('ok  account update + read')

  const login = (await call('POST', '/v2/account/authenticate/email?create=false', { body: creds })).body
  const fresh = (await call('POST', '/v2/account/session/refresh', { body: { token: login.refresh_token } })).body
  assert.ok(fresh.token, 'session refresh')
  console.log('ok  login + session refresh')

  const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws?lang=en&status=true&token=${fresh.token}`)
  const reply = await new Promise((resolve, reject) => {
    const got = {}
    setTimeout(() => reject(new Error('socket: no reply in 5 s')), 5000)
    socket.onerror = () => reject(new Error('socket: connection failed'))
    socket.onopen = () => {
      socket.send(JSON.stringify({ cid: '1', match_create: {} }))
      socket.send(JSON.stringify({ cid: '2', rpc: { id: 'join_online', payload: '{}' } }))
    }
    socket.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.cid) got[m.cid] = m
      if (got[1] && got[2]) resolve(got)
    }
  })
  socket.close()
  assert.ok(reply[1].match?.match_id, `socket match_create: ${JSON.stringify(reply[1])}`)
  assert.equal(reply[2].rpc?.id, 'join_online', `socket rpc join_online (nakama/data/modules/stats.lua): ${JSON.stringify(reply[2])}`)
  console.log('ok  realtime socket + match_create + join_online')

  assert.equal((await call('POST', '/v2/session/logout', { auth: bearer(fresh), body: { token: fresh.token, refresh_token: login.refresh_token } })).status, 200, 'logout')
  assert.equal((await call('POST', '/v2/account/session/refresh', { body: { token: login.refresh_token } })).status, 401, 'logout revokes the refresh token')
  console.log('ok  logout revokes the session')
} finally {
  const gone = await Promise.all(made.map(async (session) => (await call('DELETE', '/v2/account', { auth: bearer(session) })).status))
  console.log(gone.every((status) => status === 200) ? `ok  cleanup: ${gone.length} accounts deleted` : `!!  cleanup statuses: ${gone.join(', ')}`)
}
