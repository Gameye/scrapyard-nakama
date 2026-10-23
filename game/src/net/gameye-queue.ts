import type { Notification } from '@heroiclabs/nakama-js'
import type { Loadout } from '../game/loadout.ts'
import { gameServerUrl, join, NetError, openSocket, REASONS, type Link } from './connection.ts'
import type { Search } from './matchmaking.ts'
import { BUILD } from './protocol.ts'
import { AUTO, type Servers } from './servers.ts'

// Gameye mode's matchmaking as the page sees it (gameye-match.ts wires it to
// the page's Nakama socket; the formats are the root AGENTS.md's Contracts):
//   idle → searching   Play: the relay's geo token (GET /geo, 2 s at most;
//                      without one the search goes on), the region the plugin
//                      answers for it and the player's pick (gameye_region),
//                      then a ticket on Nakama's matchmaker, mode=gameye, this
//                      build and that region (pick=1 when it's the one the
//                      player picked), for 2 to 8 players. 12 s alone: the ticket
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
// Nakama socket and the relay, 'searching' the ticket. The server picker
// reads Servers: the enabled regions (gameye_region's, asked each time the
// socket comes up while it's on screen) and the player's pick, remembered per
// browser. DOM-free, and every clock is the one passed in, so it runs under
// plain node (gameye-match.check.ts).

export const SOLO_AFTER = 12_000 // ms alone before a match with bots
export const SEARCH_LIMIT = 60_000 // ms of searching, with no match, before giving up
export const CONNECT_WINDOW = 15_000 // ms of relay upgrades before giving up
const BACKOFF = [500, 1000, 2000, 3000] // ms before each further upgrade, the last repeated
const NOTE = 5000 // ms a note is said for
const FAILED_NOTE = 12_000 // ms a failure is said for: long enough to read and press Play again
const MARK = 'scrapyard.gameye' // sessionStorage, per tab: a search is on ({ mode, map })
const HELLO_TOKEN = 'gameye' // the hello's Nakama session field: the container seats by seat token only, and never sees the session
export const GEO_WAIT = 2000 // ms for the relay's /geo before searching without it
export const PICK_KEY = 'scrapyard.region' // localStorage, per browser: the server picked, AUTO or a region id

export const MATCH_CODE = 7300
export const FAILED_CODE = 7301
export const SOLO_RPC = 'gameye_solo_match'
export const REGION_RPC = 'gameye_region'
export const PLAYERS = { min: 2, max: 8 }

export const MESSAGES = {
  unavailable: 'The Gameye demo is unavailable right now — try again later', // quota_exceeded, misconfigured
  unreachable: 'Couldn’t reach the match server — try again', // no session in time, no capacity, Gameye down, the relay or container unreachable
  busy: 'The demo is full right now — try again in a minute', // busy: the plugin's session cap or the solo cooldown
  solo: 'Nobody else yet — starting a match with bots',
  cancelled: 'Search cancelled',
}
const UNAVAILABLE = new Set(['quota_exceeded', 'misconfigured'])

// Where each Gameye region's servers are, as the status line names them.
const REGION_NAMES: Record<string, string> = { 'eu-central-1': 'Frankfurt', 'us-east-1': 'Virginia', 'ap-southeast-1': 'Singapore' }
export const regionName = (region: string) => (Object.hasOwn(REGION_NAMES, region) ? REGION_NAMES[region] : region)

// A gameye_match notification's content (the RPC's match too).
export interface GameyeMatch {
  host: string
  port: number
  session_id: string
  region?: string // the Gameye region the plugin expects the session in
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
  geo(): Promise<string | null> // the relay's geo token for this player, or null (fetchGeo)
  notifications(): Promise<Notification[]> // the player's persistent notifications
  forget(ids: string[]): Promise<unknown>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null // per tab: the search in progress
  prefs: Pick<Storage, 'getItem' | 'setItem'> | null // per browser: the server picked
}

// The ticket: Gameye mode, and only pages of this build (one build's page and
// container speak one protocol) and this region (nobody is matched across an
// ocean). A build id or region with query characters is quoted.
const term = (value: string) => (/^[A-Za-z0-9_-]+$/.test(value) ? value : `"${value.replace(/["\\]/g, '\\$&')}"`)
export const ticketQuery = (build: string, region: string) => `+properties.mode:gameye +properties.build:${term(build)} +properties.region:${term(region)}`
export const ticketProperties = (build: string, region: string, geo: string | null, picked = false): Record<string, string> => ({
  mode: 'gameye',
  build,
  region,
  ...(picked ? { pick: '1' } : {}),
  ...(geo ? { geo } : {}),
})

// An RPC payload of the fields that are set, or none at all.
const payload = (fields: Record<string, string | boolean>) => {
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v))
  return Object.keys(set).length ? JSON.stringify(set) : undefined
}
// gameye_region's payload: the geo token and the region picked, when there are.
export const regionPayload = (geo: string | null, picked: string) => payload({ geo: geo ?? '', region: picked })
// The solo call's payload: fresh or a resume, with the geo token and the picked region when there are.
export const soloPayload = (resume: boolean, geo: string | null, picked = '') => payload({ resume, geo: geo ?? '', region: picked })

// gameye_region's list of enabled regions, or null when it has none (a plugin before the picker).
const readRegions = (regions: unknown) => (Array.isArray(regions) && regions.every((r) => typeof r === 'string' && r) ? (regions as string[]) : null)

// GET <relay>/geo: the relay's geo token for where Cloudflare places this
// player, or null when the build has no relay, it fails, or GEO_WAIT passes.
export function fetchGeo(relay: string | undefined, clock: Clock, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!relay) return Promise.resolve(null)
  return new Promise((resolve) => {
    const abort = new AbortController()
    const cancel = clock.after(GEO_WAIT, () => {
      abort.abort()
      resolve(null)
    })
    fetcher(`${relay.replace(/\/+$/, '')}/geo`, { signal: abort.signal, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (body: { geo?: unknown } | null) => resolve(typeof body?.geo === 'string' && body.geo ? body.geo : null),
        () => resolve(null),
      )
      .finally(cancel)
  })
}

export function readMatch(content: unknown): GameyeMatch | null {
  if (typeof content !== 'object' || content === null) return null
  const m = content as Record<string, unknown>
  const texts = [m.session_id, m.relay_url, m.relay_token, m.seat_token].every((v) => typeof v === 'string' && v.length > 0)
  return texts && Number.isFinite(m.exp) ? (m as unknown as GameyeMatch) : null
}

export const failureMessage = (reason: unknown) =>
  reason === 'busy' ? MESSAGES.busy : typeof reason === 'string' && UNAVAILABLE.has(reason) ? MESSAGES.unavailable : MESSAGES.unreachable

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
  let geo: Promise<string | null> = Promise.resolve(null) // this search's geo token, fetched once
  let region = '' // the region this search queues in, once the plugin says
  let picked = false // and the player picked it
  let enabled: string[] = [] // the plugin's last list
  let servers: Servers = { regions: [], choice: AUTO }
  const serverListeners = new Set<() => void>()
  let wanted: string | null = null // the pick as remembered, read once
  let watching: (() => void) | null = null // the picker's socket subscription
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
  const searching = (note = '', away: '' | 'dropped' | 'reloaded' = '') => set({ phase: 'searching', ...pick, since, note, away, server: region && regionName(region) })
  const live = (mine: number) => mine === run && (stage === 'waiting' || stage === 'searching')

  function want() {
    if (wanted === null) {
      try {
        wanted = deps.prefs?.getItem(PICK_KEY) || AUTO
      } catch {
        wanted = AUTO // no storage: the pick lasts as long as the page
      }
    }
    return wanted
  }
  function showServers(regions: string[]) {
    const choice = regions.includes(want()) ? want() : AUTO
    if (choice === servers.choice && regions.join() === enabled.join()) return
    enabled = regions
    servers = { regions: regions.map((id) => ({ id, name: regionName(id) })), choice }
    for (const listener of serverListeners) listener()
  }
  async function askRegions(on: QueueSocket) {
    try {
      const regions = readRegions(JSON.parse((await on.rpc(REGION_RPC)).payload || '{}')?.regions)
      if (regions) showServers(regions)
    } catch {} // the picker keeps what it has: Auto at least
  }

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
    region = ''
    picked = false
    geo = deps.geo().catch(() => null)
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
      const token = await geo
      if (!live(mine) || socket !== on) return
      const choice = want()
      const reply = JSON.parse((await on.rpc(REGION_RPC, regionPayload(token, choice === AUTO ? '' : choice))).payload || '{}')
      if (typeof reply?.region !== 'string' || !reply.region) throw new Error('no region')
      if (!live(mine) || socket !== on) return
      const regions = readRegions(reply.regions)
      if (regions) showServers(regions)
      region = reply.region
      picked = choice !== AUTO && region === choice && !!regions?.includes(choice)
      made = (await on.addMatchmaker(ticketQuery(BUILD, region), PLAYERS.min, PLAYERS.max, ticketProperties(BUILD, region, token, picked))).ticket
    } catch {
      if (live(mine) && socket === on) fail(MESSAGES.unreachable)
      return
    }
    if (!live(mine) || socket !== on) {
      // Ended (cancel, a match, a failure) or moved on while Nakama made it: nobody holds this ticket, so it goes
      // (on a socket that has dropped since, the call fails and the ticket went with it anyway).
      void on.removeMatchmaker(made).catch(() => {})
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
    await askSolo(mine, on, false)
  }

  // A fresh call always gets a new match; a resume may get the one this search missed while away.
  async function askSolo(mine: number, on: QueueSocket, resume: boolean) {
    let reply: { status?: unknown; match?: unknown }
    try {
      reply = JSON.parse((await on.rpc(SOLO_RPC, soloPayload(resume, await geo, picked ? region : ''))).payload || '{}')
    } catch {
      if (live(mine) && socket === on) fail(MESSAGES.unreachable)
      return
    }
    if (reply?.status === 'busy') {
      if (live(mine) && socket === on) fail(MESSAGES.busy)
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
    } catch {} // can't list: search again; the plugin answers a resumed solo call with the match it has
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
    await askSolo(mine, on, true)
  }

  // A match: the notification it came in is deleted (persistent, it would be found again), then the relay.
  function follow(mine: number, m: GameyeMatch, id: string | null) {
    quietTimers()
    ticket = null // a match took it
    letGo()
    stage = 'connecting'
    set({ phase: 'connecting', ...pick, server: m.region ? regionName(m.region) : '' })
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
    currentServers: () => servers,
    // While the picker listens, each socket that comes up asks which regions are enabled.
    onServers(listener: () => void) {
      serverListeners.add(listener)
      watching ??= deps.onSocket((next) => void (next && askRegions(next)))
      return () => {
        serverListeners.delete(listener)
        if (serverListeners.size || !watching) return
        watching()
        watching = null
      }
    },
    // The next search's pick, remembered for this browser: AUTO, or one of the enabled regions.
    chooseServer(choice: string) {
      if (choice !== AUTO && !enabled.includes(choice)) return
      wanted = choice
      try {
        deps.prefs?.setItem(PICK_KEY, choice)
      } catch {} // not remembered: it lasts as long as the page
      showServers(enabled)
    },
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
