import type { Notification } from '@heroiclabs/nakama-js'
import type { Loadout } from '../game/loadout.ts'
import { gameServerUrl, join, NetError, openSocket, REASONS, type Link } from './connection.ts'
import type { Search } from './matchmaking.ts'
import { BUILD } from './protocol.ts'

// Gameye mode's matchmaking as the page sees it (gameye-match.ts wires it to
// the page's Nakama socket; the formats are the root AGENTS.md's Contracts):
//   idle → searching   Play: a ticket on Nakama's matchmaker, mode=gameye and
//                      this build, for 2 to 8 players. 12 s alone: the ticket
//                      goes and the solo RPC starts a match for this player
//                      (bots fill the rest), or answers with the one they have.
//   searching → connecting  a gameye_match notification (or the RPC's match):
//                      the relay at <relay_url>/match?token=<relay_token>,
//                      tried again with backoff for 15 s while the container
//                      comes up (a page can't read the relay's 503: any failed
//                      upgrade is one more try), then a hello with the seat token.
//   connecting → seated (playing)  the welcome; the runtime takes the seat
//                      (takeSeat) and the store is idle again: the match and
//                      its end are the runtime's, as in Classic.
//   → failed           gameye_failed, 60 s searching, or 15 s of failed
//                      upgrades: idle with the reason in the player's words,
//                      never queued again by itself; Play again is the retry.
// The Nakama socket dropping takes the ticket with it: once it's back, the
// player's persistent gameye_match notifications are listed (the live one may
// have gone while it was away), the newest whose tokens are good is followed
// and deleted, expired ones skipped; with none, the search goes on (a new
// ticket, or the solo RPC again if it was called). A reload with a search on
// does the same (resumeSearch). The screens read it through the same Search
// as Classic's store (matchmaking.ts): 'connecting' covers waiting for the
// Nakama socket and the relay, 'searching' the ticket. DOM-free, and every
// clock is the one passed in, so it runs under plain node (gameye-match.check.ts).

export const SOLO_AFTER = 12_000 // ms alone before a match with bots
export const SEARCH_LIMIT = 60_000 // ms of searching, with no match, before giving up
export const CONNECT_WINDOW = 15_000 // ms of relay upgrades before giving up
const BACKOFF = [500, 1000, 2000, 3000] // ms before each further upgrade, the last repeated
const NOTE = 5000 // ms a note is said for
const FAILED_NOTE = 12_000 // ms a failure is said for: long enough to read and press Play again
const MARK = 'scrapyard.gameye' // sessionStorage, per tab: a search is on ({ mode, map })
const HELLO_TOKEN = 'gameye' // the hello's Nakama session field: the container seats by seat token only, and never sees the session

export const MATCH_CODE = 7300
export const FAILED_CODE = 7301
export const SOLO_RPC = 'gameye_solo_match'
export const PLAYERS = { min: 2, max: 8 }

export const MESSAGES = {
  unavailable: 'The Gameye demo is unavailable right now — try again later', // quota_exceeded, misconfigured
  unreachable: 'Couldn’t reach the match server — try again', // no session in time, no capacity, Gameye down, the relay or container unreachable
  solo: 'Nobody else yet — starting a match with bots',
  cancelled: 'Search cancelled',
}
const UNAVAILABLE = new Set(['quota_exceeded', 'misconfigured'])

// A gameye_match notification's content (the RPC's match too).
export interface GameyeMatch {
  host: string
  port: number
  session_id: string
  relay_url: string
  relay_token: string
  seat_token: string
  exp: number // unix seconds: both tokens are good while now ≤ exp
}

// What the store needs of a Nakama socket (nakama-js's Socket has it).
export interface QueueSocket {
  addMatchmaker(query: string, min: number, max: number, strings?: Record<string, string>): Promise<{ ticket: string }>
  removeMatchmaker(ticket: string): Promise<void>
  rpc(id: string, payload?: string): Promise<{ payload?: string }>
  onnotification: (notification: Notification) => void
}

export interface Clock {
  now(): number // ms, performance.now()'s: the screens count `since` with it
  unix(): number // seconds since the epoch: token expiry
  after(ms: number, fn: () => void): () => void // returns the cancel
}

export interface QueueDeps {
  clock: Clock
  onSocket(listener: (socket: QueueSocket | null) => void): () => void // the live Nakama socket, now and on each change (session.ts)
  online(): void // brings that socket up if nothing has yet
  signIn(): Promise<{ guest: boolean }>
  notifications(): Promise<Notification[]> // the player's persistent notifications
  forget(ids: string[]): Promise<unknown>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

// The ticket: Gameye mode, and only pages of this build (one build's page and
// container speak one protocol). A build id with query characters is quoted.
const term = (value: string) => (/^[A-Za-z0-9_-]+$/.test(value) ? value : `"${value.replace(/["\\]/g, '\\$&')}"`)
export const ticketQuery = (build: string) => `+properties.mode:gameye +properties.build:${term(build)}`
export const ticketProperties = (build: string) => ({ mode: 'gameye', build })

export function readMatch(content: unknown): GameyeMatch | null {
  if (typeof content !== 'object' || content === null) return null
  const m = content as Record<string, unknown>
  const texts = [m.session_id, m.relay_url, m.relay_token, m.seat_token].every((v) => typeof v === 'string' && v.length > 0)
  return texts && Number.isFinite(m.exp) ? (m as unknown as GameyeMatch) : null
}

export const failureMessage = (reason: unknown) => (typeof reason === 'string' && UNAVAILABLE.has(reason) ? MESSAGES.unavailable : MESSAGES.unreachable)

type Stage = 'idle' | 'waiting' | 'searching' | 'connecting' | 'seated' // waiting: for the Nakama socket

export function createGameyeQueue(deps: QueueDeps) {
  const { clock } = deps
  let state: Search = { phase: 'idle', note: '' }
  let stage: Stage = 'idle'
  const listeners = new Set<() => void>()
  let run = 0 // each search; a stale one's callbacks do nothing
  let timers: Array<() => void> = [] // this search's, cancelled together
  let quiet: (() => void) | null = null // the note's
  let unsubscribe: (() => void) | null = null
  let socket: QueueSocket | null = null
  let detach: (() => void) | null = null
  let ticket: string | null = null
  let solo = false // the solo RPC was called for this search
  let pick = { mode: '', map: '' }
  let since = 0
  let gear: Loadout | null = null
  let guest = true
  let pending: WebSocket | null = null // the relay socket, opened, not yet seated

  function set(next: Search, noteFor = NOTE) {
    state = next
    try {
      if (stage === 'idle' || stage === 'seated') deps.storage?.removeItem(MARK)
      else deps.storage?.setItem(MARK, JSON.stringify(pick))
    } catch {} // no storage: a reload just starts over
    quiet?.()
    quiet = null
    for (const listener of listeners) listener()
    if ('note' in next && next.note) quiet = clock.after(noteFor, () => state === next && set({ ...next, note: '' }))
  }
  const searching = (note = '', away: '' | 'dropped' | 'reloaded' = '') => set({ phase: 'searching', ...pick, since, note, away })
  const live = (mine: number) => mine === run && (stage === 'waiting' || stage === 'searching')

  const after = (ms: number, fn: () => void) => void timers.push(clock.after(ms, fn))
  function quietTimers() {
    for (const cancel of timers) cancel()
    timers = []
  }

  // Leaves Nakama be: no listener, no notification hook, the ticket taken back.
  function letGo() {
    unsubscribe?.()
    unsubscribe = null
    detach?.()
    detach = null
    if (socket && ticket) void socket.removeMatchmaker(ticket).catch(() => {})
    socket = null
    ticket = null
  }

  // Everything this search started, stopped; the store says `note`.
  function end(note: string, noteFor = NOTE) {
    run++
    quietTimers()
    letGo()
    solo = false
    pending?.close()
    pending = null
    stage = 'idle'
    set({ phase: 'idle', note }, noteFor)
  }
  const fail = (message: string) => end(message, FAILED_NOTE)

  // The two notifications, heard on whichever socket is live; anything else goes to whoever listened before (the chat).
  function hook(on: QueueSocket) {
    const before = on.onnotification
    const heard = (n: Notification) => {
      if (n.code === MATCH_CODE) {
        const m = readMatch(n.content)
        if (m && live(run) && clock.unix() <= m.exp) follow(run, m, n.id ?? null)
      } else if (n.code === FAILED_CODE) {
        if (live(run)) fail(failureMessage((n.content as { reason?: unknown } | undefined)?.reason))
      } else before?.call(on, n)
    }
    on.onnotification = heard
    return () => {
      if (on.onnotification === heard) on.onnotification = before
    }
  }

  function begin(mode: string, map: string, loadout: Loadout, resumed: boolean) {
    const mine = ++run
    pick = { mode, map }
    gear = loadout
    since = clock.now()
    solo = false
    let first = !resumed // the first socket of a fresh search queues; any later one (or a reload's) looks for a match first
    stage = resumed ? 'searching' : 'waiting'
    if (resumed) searching('', 'reloaded')
    else set({ phase: 'connecting', mode, map })
    after(SEARCH_LIMIT, () => live(mine) && fail(MESSAGES.unreachable))
    deps.online()
    void deps.signIn().then(
      (who) => void (guest = who.guest),
      () => {}, // offline: the socket never comes, and the limit says so
    )
    unsubscribe = deps.onSocket((next) => {
      if (!live(mine) || next === socket) return
      detach?.()
      detach = null
      socket = next
      ticket = null // a ticket goes with the socket it was made on
      if (!next) return void (stage === 'searching' && searching('', 'dropped'))
      detach = hook(next)
      if (first) {
        first = false
        return void enqueue(mine, next)
      }
      void recover(mine, next)
    })
  }

  async function enqueue(mine: number, on: QueueSocket) {
    let made: string
    try {
      made = (await on.addMatchmaker(ticketQuery(BUILD), PLAYERS.min, PLAYERS.max, ticketProperties(BUILD))).ticket
    } catch {
      if (live(mine) && socket === on) fail(MESSAGES.unreachable)
      return
    }
    if (!live(mine) || socket !== on) {
      if (socket === on) void on.removeMatchmaker(made).catch(() => {})
      return
    }
    ticket = made
    stage = 'searching'
    searching()
    after(SOLO_AFTER, () => void goSolo(mine, on))
  }

  // 12 s alone: the ticket goes, and the plugin starts a match for this player alone.
  async function goSolo(mine: number, on: QueueSocket) {
    if (!live(mine) || socket !== on) return
    solo = true
    if (ticket) void on.removeMatchmaker(ticket).catch(() => {})
    ticket = null
    searching(MESSAGES.solo)
    await askSolo(mine, on)
  }

  async function askSolo(mine: number, on: QueueSocket) {
    let reply: { status?: unknown; match?: unknown }
    try {
      reply = JSON.parse((await on.rpc(SOLO_RPC)).payload || '{}')
    } catch {
      if (live(mine) && socket === on) fail(MESSAGES.unreachable)
      return
    }
    const m = reply?.status === 'matched' ? readMatch(reply.match) : null
    if (m && live(mine) && clock.unix() <= m.exp) follow(mine, m, null)
    // 'starting': the notification follows (or gameye_failed, or the limit)
  }

  // Back on a socket (a reconnect, a reload): the match it may have missed, else the search again.
  async function recover(mine: number, on: QueueSocket) {
    let listed: Notification[] = []
    try {
      listed = await deps.notifications()
    } catch {} // can't list: search again; the plugin answers a second solo call with the match it has
    if (!live(mine) || socket !== on) return
    const now = clock.unix()
    const found = listed
      .filter((n) => n.code === MATCH_CODE)
      .map((n) => ({ id: n.id ?? null, m: readMatch(n.content) }))
      .filter((x): x is { id: string | null; m: GameyeMatch } => !!x.m && now <= x.m.exp)
      .sort((a, b) => b.m.exp - a.m.exp)[0]
    if (found) return follow(mine, found.m, found.id)
    if (!solo) return enqueue(mine, on)
    stage = 'searching'
    searching()
    await askSolo(mine, on)
  }

  // A match: the notification it came in is deleted (persistent, it would be found again), then the relay.
  function follow(mine: number, m: GameyeMatch, id: string | null) {
    quietTimers()
    ticket = null // a match took it
    letGo()
    stage = 'connecting'
    set({ phase: 'connecting', ...pick })
    void forget(m, id)
    after(CONNECT_WINDOW, () => mine === run && stage === 'connecting' && fail(MESSAGES.unreachable))
    void reach(mine, m, 0)
  }

  async function forget(m: GameyeMatch, id: string | null) {
    try {
      const ids = id ? [id] : (await deps.notifications()).filter((n) => n.code === MATCH_CODE && readMatch(n.content)?.session_id === m.session_id && n.id).map((n) => n.id!)
      if (ids.length) await deps.forget(ids)
    } catch {} // left behind: it expires, and is skipped then
  }

  const reaching = (mine: number) => mine === run && stage === 'connecting'

  async function reach(mine: number, m: GameyeMatch, tries: number) {
    const again = () => reaching(mine) && after(BACKOFF[Math.min(tries, BACKOFF.length - 1)], () => void reach(mine, m, tries + 1))
    let open: WebSocket
    try {
      open = await openSocket(gameServerUrl({ url: m.relay_url, token: m.relay_token }))
    } catch {
      return again() // the relay's 503 while the container comes up, a 502, a 403, no network: all alike from here
    }
    if (!reaching(mine)) return open.close()
    pending = open
    try {
      const seat = await join(open, { token: HELLO_TOKEN, guest, loadout: gear!, mode: pick.mode, map: pick.map, seat: m.seat_token })
      pending = null
      if (!reaching(mine)) return seat.close()
      quietTimers()
      stage = 'seated'
      set({ phase: 'seated', link: seat })
    } catch (error) {
      if (pending === open) pending = null
      if (!reaching(mine)) return
      // The game server's own refusal (an old page, a full match, a seat refused) won't change with another try.
      if (error instanceof NetError && error.message !== REASONS.unreachable) return fail(error.message)
      again()
    }
  }

  return {
    currentSearch: () => state,
    onSearch(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    // A reload with a search on in this tab: a match found meanwhile, else the search again.
    resumeSearch(loadout: Loadout) {
      let mark: { mode?: unknown; map?: unknown } | null = null
      try {
        mark = JSON.parse(deps.storage?.getItem(MARK) ?? 'null')
      } catch {}
      const { mode, map } = mark ?? {}
      if (typeof mode !== 'string' || typeof map !== 'string' || stage !== 'idle') return
      begin(mode, map, loadout, true)
    },
    // Play: the mode and arena are the screens' labels; the Gameye match plays what its server plays (the welcome says).
    async findMatch(mode: string, map: string, loadout: Loadout) {
      if (stage === 'idle') begin(mode, map, loadout, false)
    },
    cancelSearch() {
      if (stage !== 'idle' && stage !== 'seated') end(MESSAGES.cancelled)
    },
    answer(_accept: boolean) {}, // no ready check: Nakama's match is the match
    // The seat, once: the runtime plays the match on it.
    takeSeat(): Link | null {
      if (state.phase !== 'seated') return null
      const seat = state.link
      stage = 'idle'
      set({ phase: 'idle', note: '' })
      return seat
    },
  }
}
