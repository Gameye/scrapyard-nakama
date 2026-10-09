// Self-check for Gameye mode's matchmaking as the page sees it
// (gameye-queue.ts, the store behind gameye-match.ts): the ticket and its
// query, the solo fallback, the match notification followed through the
// relay with retries, every failure and its message, the recovery after a
// socket reconnect, and the build-time pick between it and Classic
// (matchmaker.ts). A fake Nakama socket, a fake WebSocket and a clock moved
// by hand. Plain node:
// node src/net/gameye-match.check.ts
import type { Notification } from '@heroiclabs/nakama-js'
import { matchmakerPlugin } from '../../matchmaker.ts'
import { createGameyeQueue, CONNECT_WINDOW, MESSAGES, SEARCH_LIMIT, SOLO_AFTER, SOLO_RESUME, SOLO_RPC, ticketProperties, ticketQuery, type QueueSocket } from './gameye-queue.ts'
import { BUILD, PROTOCOL } from './protocol.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`gameye-match: ${what}`)
  checks++
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

// --- a clock moved by hand -----------------------------------------------------------------------

function fakeClock(start = 1_700_000_000_000) {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    unix: () => Math.floor((start + now) / 1000),
    after(ms: number, fn: () => void) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return () => void timers.delete(id)
    },
    // Moves time on in small steps, running what falls due and letting promises settle between.
    async advance(ms: number) {
      const end = now + ms
      while (true) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
        await flush()
      }
      now = end
      await flush()
    },
  }
}

// --- a fake Nakama socket ------------------------------------------------------------------------

function fakeSocket(rpcReply: () => string = () => '{"status":"starting"}') {
  const calls = { add: [] as Array<{ query: string; min: number; max: number; strings?: Record<string, string> }>, remove: [] as string[], rpc: [] as string[], payloads: [] as Array<string | undefined> }
  let tickets = 0
  const socket: QueueSocket & { calls: typeof calls; notify: (n: Notification) => void } = {
    calls,
    async addMatchmaker(query, min, max, strings) {
      calls.add.push({ query, min, max, strings })
      return { ticket: `ticket-${++tickets}` }
    },
    async removeMatchmaker(ticket) {
      calls.remove.push(ticket)
    },
    async rpc(id, payload) {
      calls.rpc.push(id ?? '')
      calls.payloads.push(payload)
      return { id, payload: rpcReply() }
    },
    onnotification: () => {},
    notify(n) {
      this.onnotification(n)
    },
  }
  return socket
}

// --- a fake WebSocket, standing in for the relay and the game server behind it ---------------------

type Fake = InstanceType<typeof FakeWebSocket>
const opened: Fake[] = []
class FakeWebSocket {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  readyState = 0
  binaryType = 'blob'
  sent: string[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    opened.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    queueMicrotask(() => this.onclose?.()) // a browser's close event comes later, never inside close()
  }
  // The relay's 503 (the container isn't listening yet), a 403, or no relay at all: the page sees only an error.
  refuse() {
    this.onerror?.()
    this.close()
  }
  accept() {
    this.readyState = 1
    this.onopen?.()
  }
  hello() {
    return JSON.parse(this.sent.find((s) => s.includes('"hello"')) ?? 'null') as Record<string, unknown> | null
  }
  welcome() {
    this.onmessage?.({ data: JSON.stringify({ t: 'welcome', v: PROTOCOL, room: 'r1', seat: 0, mode: 'ffa', map: 'scrapyard', seed: 1, settings: {}, tick: 0, rate: { step: 60, snap: 30 }, digest: 'd', lineUp: [], chat: { all: 'sy-0' } }) })
  }
}
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket

// --- the store, on fakes -----------------------------------------------------------------------------

const LOADOUT = { vehicle: 'razor', weapon: 'minigun' } as const

function setup(options: { rpcReply?: () => string; stored?: Notification[] } = {}) {
  const clock = fakeClock()
  const listeners = new Set<(socket: QueueSocket | null) => void>()
  let live: QueueSocket | null = fakeSocket(options.rpcReply)
  const store = { stored: options.stored ?? [], forgotten: [] as string[], listed: 0, online: 0 }
  const queue = createGameyeQueue({
    clock,
    onSocket(listener) {
      listeners.add(listener)
      listener(live)
      return () => void listeners.delete(listener)
    },
    online: () => void store.online++,
    signIn: async () => ({ guest: true }),
    async notifications() {
      store.listed++
      return store.stored
    },
    async forget(ids) {
      store.forgotten.push(...ids)
      store.stored = store.stored.filter((n) => !ids.includes(n.id ?? ''))
    },
    storage: null,
  })
  const socket = () => live as ReturnType<typeof fakeSocket>
  // The Nakama socket drops, and (with a socket) comes back.
  function swap(next: ReturnType<typeof fakeSocket> | null) {
    live = next
    for (const listener of listeners) listener(next)
  }
  return { clock, queue, socket, swap, store }
}

const match = (unix: number, over: Partial<Record<string, unknown>> = {}) => ({
  host: '203.0.113.7',
  port: 41234,
  session_id: 'sess-1',
  relay_url: 'wss://relay.example.test',
  relay_token: 'v1.relay+token/=.sig',
  seat_token: 'v1.seat-token.sig',
  exp: unix + 120,
  ...over,
})
const matchNote = (content: unknown, id = 'n-1'): Notification => ({ id, code: 7300, subject: 'gameye_match', persistent: true, content: content as {} })
const failedNote = (reason: string): Notification => ({ id: 'f-1', code: 7301, subject: 'gameye_failed', persistent: false, content: { reason } })
const last = () => opened.at(-1)!

// --- the ticket: mode=gameye, this build, 2–8 ---------------------------------------------------------

{
  const { queue, socket, store } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  check(store.online === 1, 'Play brings the Nakama socket up if it isn’t yet')
  const add = socket().calls.add
  check(add.length === 1 && add[0].min === 2 && add[0].max === 8, 'one ticket, for 2 to 8 players')
  check(add[0].strings?.mode === 'gameye' && add[0].strings?.build === BUILD, 'the ticket carries mode=gameye and this build')
  check(add[0].query.includes('+properties.mode:gameye') && add[0].query.includes(`+properties.build:${BUILD}`), `the query asks for both (${add[0].query})`)
  check(queue.currentSearch().phase === 'searching', 'searching once the ticket is in')
  queue.cancelSearch()
  await flush()
  check(socket().calls.remove[0] === 'ticket-1', 'Cancel takes the ticket back')
  const now = queue.currentSearch()
  check(now.phase === 'idle' && now.note === 'Search cancelled', 'and the store is idle, saying so')
}

// A ticket matches another only when each's query holds for the other's properties
// (Nakama's matchmaker, for the +properties.key:value terms the page writes).
{
  const TERM = /\+properties\.(\w+):("(?:[^"\\]|\\.)*"|\S+)/g
  const holds = (query: string, props: Record<string, string>) =>
    query.replace(TERM, '').trim() === '' && [...query.matchAll(TERM)].every(([, key, raw]) => props[key] === (raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw))
  const pair = (a: string, b: string) => holds(ticketQuery(a), ticketProperties(b)) && holds(ticketQuery(b), ticketProperties(a))
  check(pair('abc123def456', 'abc123def456'), 'two pages of one build match')
  check(!pair('abc123def456', '0123456789ab'), 'pages of different builds don’t: an old page never lands in a new server')
  check(!holds(ticketQuery('b1'), { mode: 'classic', build: 'b1' }), 'a ticket without mode=gameye is never matched')
  check(pair('dev', 'dev') && pair('odd:build "x"', 'odd:build "x"') && !pair('odd:build "x"', 'odd:build'), 'a build with query characters is quoted, not read as syntax')
}

// --- a live gameye_match: through the relay, seated with the seat token -------------------------------

{
  const { clock, queue, socket, store } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  check(queue.currentSearch().phase === 'connecting', 'a gameye_match moves the store from searching to connecting')
  check(store.forgotten.includes('n-1'), 'and the persistent notification it used is deleted')
  check(last().url === 'wss://relay.example.test/match?token=v1.relay%2Btoken%2F%3D.sig', `the page opens <relay_url>/match?token=<relay_token> (${last().url})`)
  last().accept()
  await flush()
  const hello = last().hello()
  check(hello?.seat === 'v1.seat-token.sig' && hello.build === BUILD && hello.v === PROTOCOL, 'the hello carries the seat token as `seat`')
  check(!JSON.stringify(hello).includes('eyJ'), 'and no Nakama session token goes to the container')
  last().welcome()
  await flush()
  check(queue.currentSearch().phase === 'seated', 'the welcome seats the player')
  const seat = queue.takeSeat()
  check(!!seat && seat.welcome.room === 'r1' && queue.currentSearch().phase === 'idle', 'the runtime takes the seat once; the store is idle again')
  seat?.close()
  socket().notify(matchNote(match(clock.unix()), 'n-late'))
  await flush()
  check(queue.currentSearch().phase === 'idle' && opened.length === 1, 'a match notification with no search on is ignored')
}

// Cancel while the ticket is still being made: once Nakama answers, that ticket is taken back too.
{
  const { queue, socket } = setup()
  let answer: (made: { ticket: string }) => void = () => {}
  socket().addMatchmaker = (query, min, max, strings) => {
    socket().calls.add.push({ query, min, max, strings })
    return new Promise((resolve) => (answer = resolve))
  }
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  check(socket().calls.add.length === 1 && queue.currentSearch().phase === 'connecting', 'Play: the ticket is on its way')
  queue.cancelSearch()
  await flush()
  check(queue.currentSearch().phase === 'idle' && socket().calls.remove.length === 0, 'cancelled before Nakama answered: no ticket to take back yet')
  answer({ ticket: 'ticket-late' })
  await flush()
  check(socket().calls.remove.includes('ticket-late'), `the ticket made after the cancel is removed (${JSON.stringify(socket().calls.remove)})`)
  check(queue.currentSearch().phase === 'idle', 'and the store stays idle')
}

// A tab with no search on (it cancelled, or never searched) ignores a gameye_match: another tab of the player may be the one searching.
{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  queue.cancelSearch()
  await flush()
  const opens = opened.length
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  check(opened.length === opens && queue.currentSearch().phase === 'idle', 'a cancelled tab doesn’t follow a gameye_match')
}

// --- 12 s alone: the ticket goes and the solo RPC is called -------------------------------------------

{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  await clock.advance(SOLO_AFTER - 100)
  check(socket().calls.rpc.length === 0 && socket().calls.remove.length === 0, 'nothing before 12 s: a pair can still match')
  await clock.advance(100)
  check(socket().calls.remove[0] === 'ticket-1' && socket().calls.rpc[0] === SOLO_RPC, '12 s alone: the ticket is removed and gameye_solo_match called')
  check(socket().calls.payloads[0] === undefined, 'a fresh solo call has no payload: the plugin starts a new match, never an old one')
  const now = queue.currentSearch()
  check(now.phase === 'searching' && !!now.note, 'still searching, saying a match with bots is on its way')
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  check(queue.currentSearch().phase === 'connecting' && opened.length === 2, 'the notification that follows takes the page to the relay')
  queue.cancelSearch()
  await flush()
}

// The solo RPC answering with the caller's existing match: straight to it.
{
  const clock0 = fakeClock()
  const { clock, queue, socket } = setup({ rpcReply: () => JSON.stringify({ status: 'matched', match: match(clock0.unix(), { session_id: 'sess-existing', relay_token: 'existing-relay' }) }) })
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  await clock.advance(SOLO_AFTER)
  check(socket().calls.rpc.length === 1 && queue.currentSearch().phase === 'connecting', 'a solo RPC that answers "matched" goes straight to that match')
  check(last().url.endsWith('/match?token=existing-relay'), 'its relay token is the one used')
  last().accept()
  await flush()
  last().welcome()
  await flush()
  queue.takeSeat()?.close()
}

// The socket dropping after the solo call, and nothing in the persistent list: the solo call again, as a resume.
{
  const clock0 = fakeClock()
  const { clock, queue, socket, swap } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  await clock.advance(SOLO_AFTER)
  swap(null)
  await flush()
  swap(fakeSocket(() => JSON.stringify({ status: 'matched', match: match(clock0.unix(), { relay_token: 'resumed-relay' }) })))
  await flush()
  check(socket().calls.rpc[0] === SOLO_RPC && socket().calls.payloads[0] === SOLO_RESUME, `back on a socket after going solo: the solo call says it resumes (${socket().calls.payloads[0]})`)
  check(socket().calls.add.length === 0, 'and no new ticket')
  check(queue.currentSearch().phase === 'connecting' && last().url.endsWith('token=resumed-relay'), 'the match it was handed is followed')
  queue.cancelSearch()
  await flush()
}

// --- relay upgrades that keep failing: 15 s, then the unreachable message ------------------------------

{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  const before = opened.length - 1
  for (let t = 0; t < CONNECT_WINDOW + 1000; t += 250) {
    const ws = last()
    if (ws.readyState === 0) ws.refuse() // every upgrade refused: the container never listens
    await clock.advance(250)
  }
  const tries = opened.length - before
  check(tries >= 4, `the relay is tried again with backoff (${tries} tries)`)
  const now = queue.currentSearch()
  check(now.phase === 'idle' && now.note === MESSAGES.unreachable, `15 s of failed upgrades end in failed, with the unreachable message (${JSON.stringify(now)})`)
  const after = opened.length
  await clock.advance(60_000)
  check(opened.length === after && socket().calls.add.length === 1, 'and nothing more is tried, nor queued again')
}

// A 503 or two while the container comes up, then the upgrade goes through.
{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  last().refuse()
  await clock.advance(1000)
  last().refuse()
  await clock.advance(3000)
  last().accept()
  await flush()
  last().welcome()
  await flush()
  check(queue.currentSearch().phase === 'seated', 'refused upgrades within the window are retried until one is seated')
  queue.takeSeat()?.close()
}

// The game server refusing the seat (its own word, not a failed upgrade): failed at once.
{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  last().accept()
  await flush()
  last().onmessage?.({ data: JSON.stringify({ t: 'err', code: 'version', text: 'old' }) })
  await flush()
  const now = queue.currentSearch()
  check(now.phase === 'idle' && now.note === 'Game updated — reload the page', 'a refusal from the game server ends the attempt with its reason')
}

// --- gameye_failed: the reason's message, no automatic re-queue -----------------------------------------

for (const [reason, message] of [
  ['quota_exceeded', MESSAGES.unavailable],
  ['misconfigured', MESSAGES.unavailable],
  ['timeout', MESSAGES.unreachable],
  ['no_capacity', MESSAGES.unreachable],
  ['unavailable', MESSAGES.unreachable],
  ['error', MESSAGES.unreachable],
  ['something-new', MESSAGES.unreachable],
] as const) {
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  await clock.advance(SOLO_AFTER)
  socket().notify(failedNote(reason))
  await flush()
  const now = queue.currentSearch()
  check(now.phase === 'idle' && now.note === message, `gameye_failed ${reason}: failed, "${message}"`)
  await clock.advance(SEARCH_LIMIT)
  check(socket().calls.add.length === 1 && socket().calls.rpc.length === 1, `${reason}: no automatic re-queue`)
}
check(MESSAGES.unavailable !== MESSAGES.unreachable, 'the two failures read differently')

// --- 60 s searching with nothing: failed ---------------------------------------------------------------

{
  const { clock, queue, socket } = setup()
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  await clock.advance(SEARCH_LIMIT - 1)
  check(queue.currentSearch().phase === 'searching', 'still searching just before the limit')
  await clock.advance(1)
  const now = queue.currentSearch()
  check(now.phase === 'idle' && now.note === MESSAGES.unreachable, '60 s with no match: failed, never waiting forever')
  socket().notify(matchNote(match(clock.unix())))
  await flush()
  check(queue.currentSearch().phase === 'idle', 'a notification after the limit is ignored')
}

// No Nakama socket at all: the same limit, and the store says so.
{
  const { clock, queue, swap } = setup()
  swap(null)
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  check(queue.currentSearch().phase === 'connecting', 'waiting for the Nakama socket: connecting')
  await clock.advance(SEARCH_LIMIT)
  check(queue.currentSearch().phase === 'idle', 'no socket within the limit: failed')
}

// --- a reconnect that missed the live notification: the persistent list ----------------------------------

{
  const clock0 = fakeClock()
  const expired = matchNote(match(clock0.unix() - 200, { relay_token: 'expired-relay' }), 'n-expired')
  const good = matchNote(match(clock0.unix() + 5, { relay_token: 'good-relay' }), 'n-good')
  const { clock, queue, socket, swap, store } = setup({ stored: [expired, good] })
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  check(store.listed === 0, 'a fresh search doesn’t look at old notifications')
  swap(null)
  await flush()
  const away = queue.currentSearch()
  check(away.phase === 'searching' && away.away === 'dropped', 'the Nakama socket dropped: searching, reconnecting')
  await clock.advance(2000)
  swap(fakeSocket())
  await flush()
  check(store.listed === 1, 'back: the persistent notifications are listed')
  check(last().url.endsWith('token=good-relay') && queue.currentSearch().phase === 'connecting', 'the unexpired gameye_match is followed')
  check(store.forgotten.includes('n-good') && !store.forgotten.includes('n-expired'), 'and deleted; the expired one is skipped')
  check(socket().calls.add.length === 0, 'no new ticket once the match is found')
  queue.cancelSearch()
  await flush()
}

{
  const clock0 = fakeClock()
  const { clock, queue, swap, socket } = setup({ stored: [matchNote(match(clock0.unix() - 121, { relay_token: 'expired-relay' }), 'n-expired')] })
  void queue.findMatch('ffa', 'scrapyard', LOADOUT)
  await flush()
  swap(null)
  await flush()
  const opens = opened.length
  swap(fakeSocket())
  await flush()
  check(opened.length === opens && queue.currentSearch().phase === 'searching', 'only an expired one: it is ignored')
  check(socket().calls.add.length === 1, 'and the search goes on with a new ticket on the new socket')
  await clock.advance(SOLO_AFTER)
  check(socket().calls.rpc[0] === SOLO_RPC, 'which goes solo 12 s later as before')
  queue.cancelSearch()
  await flush()
}

// --- the build-time pick: VITE_MATCHMAKER=gameye or upstream's Classic ------------------------------------

{
  const MM = '/game/src/net/matchmaking.ts'
  const ctx = { resolve: async (source: string) => ({ id: source.endsWith('matchmaking') ? MM : `/game/src/${source}` }) }
  const resolve = (choice: string | undefined, source: string, importer: string) => {
    const hook = matchmakerPlugin(choice).resolveId as unknown as (this: typeof ctx, s: string, i: string, o: object) => Promise<string | null>
    return hook.call(ctx, source, importer, {})
  }
  check((await resolve(undefined, '../net/matchmaking', '/game/src/screens/Matchmaking.tsx')) === null, 'without VITE_MATCHMAKER, matchmaking.ts is upstream’s, unchanged')
  check((await resolve('classic', './net/matchmaking', '/game/src/App.tsx')) === null, 'any other value too')
  check((await resolve('gameye', './net/matchmaking', '/game/src/App.tsx'))?.endsWith('/src/net/gameye-match.ts') === true, 'with VITE_MATCHMAKER=gameye, the screens get gameye-match.ts')
  check((await resolve('gameye', './custom', '/game/src/App.tsx')) === null, 'and nothing else moves')
  check((await resolve('gameye', './matchmaking', '/game/src/net/gameye-match.ts')) === null, 'gameye-match.ts itself still reaches upstream’s types')
}

for (const ws of opened) if (ws.readyState === 0) ws.refuse() // nothing left waiting on a real timer
console.log(`gameye-match: ${checks} checks passed`)
