import type { MapId } from '../src/game/maps'
import type { Mode } from '../src/game/modes'
import { RATE } from '../src/net/protocol'
import { verifySeatToken } from './gameye-auth'
import { createGameServer } from './server'

// The game server as a Gameye container runs it: one match, for the players
// Nakama matched into this session. A seat takes a seat token for this
// session (gameye-auth.ts; the hello's `seat`), and nothing else: no Classic
// matchmaking, no custom lobbies. Bots fill the seats nobody holds, as
// anywhere. The first match holds `gather` from the first seat for the
// others Nakama matched (their pages connect through the relay one by one),
// and starts sooner only when every seat is a person's and loaded: a match
// for 2 of 8 waits the whole hold, so the second player isn't left behind.
// The session ends itself, and `done` says why:
//   'match over'   the match ended and its results were up for `results` seconds
//   'idle'         nobody took a seat within `initialIdle`
//   'empty'        the last person left `emptyIdle` ago
//   'time limit'   `maxSession` since it started, whatever the match is doing
// (or whatever `stop` was given: a signal). Gameye's TTL is the backstop.
// Every page is told why as the protocol's `closing` error, then let go:
// ENDINGS' words. A page whose link ends once the result is in keeps the
// results up (src/game/linkEnd.ts); 'match over' only comes after them.

export interface ManagedOptions {
  port: number
  secret: string // SEAT_SECRET: this match's, from the plugin
  sessionId: string // GAMEYE_SESSION_ID: seat tokens for another session are refused
  origins: string[]
  trustProxy?: boolean // behind the relay: the player's address from X-Forwarded-For, else CF-Connecting-IP
  initialIdle: number // ms
  emptyIdle: number // ms
  maxSession: number // ms
  gather?: number // ms the first match holds for the matched players (default 10 s)
  mode?: Mode
  map?: MapId
  results?: number // seconds of results before the end
  perAddress?: number
  strict?: boolean
  log?: (line: Record<string, unknown>) => void
}

export const GATHER = 10_000 // ms

// The closing error's text for each end (root AGENTS.md, Contracts); any other: SHUT_DOWN.
export const ENDINGS: Record<string, string> = {
  'match over': 'The match is over',
  'time limit': 'The match ran out of time',
}
const SHUT_DOWN = 'The match server shut down'

export function createManagedServer(options: ManagedOptions) {
  const { secret, sessionId, initialIdle, emptyIdle, maxSession, gather = GATHER, mode = 'ffa', map = 'scrapyard', log: write = (line) => console.log(JSON.stringify(line)) } = options
  const log = (msg: string, fields: Record<string, unknown> = {}) => write({ time: new Date().toISOString(), msg, ...fields })
  let finish: (reason: string) => void = () => {}
  const done = new Promise<string>((resolve) => (finish = resolve))
  let stopping = false
  let seatedOnce = false
  let emptySince = performance.now()
  let idle: NodeJS.Timeout | undefined
  let limit: NodeJS.Timeout | undefined

  const server = createGameServer({
    port: options.port,
    key: '', // no Nakama key in a container: seats are taken with seat tokens only
    origins: options.origins,
    maxRooms: 1,
    trustProxy: options.trustProxy,
    clientHeader: 'cf-connecting-ip',
    strict: options.strict,
    perAddress: options.perAddress,
    results: options.results,
    log: write,
    authenticate: (hello) => verifySeatToken(hello.seat, secret, sessionId),
    managed: { mode, map, gather: Math.round((gather / 1000) * RATE.step), complete: () => queueMicrotask(() => stop('match over')) },
    onJoin: () => void (seatedOnce = true),
    onLeave: () => void (emptySince = performance.now()),
  })

  function stop(reason: string) {
    if (stopping) return
    stopping = true
    clearInterval(idle)
    clearTimeout(limit)
    log('session over', { reason, session: sessionId })
    // Everyone told, the room closed; a socket that won't finish closing doesn't hold the end up past 3 s.
    void Promise.race([server.close(Object.hasOwn(ENDINGS, reason) ? ENDINGS[reason] : SHUT_DOWN), new Promise((resolve) => setTimeout(resolve, 3000).unref())]).then(() => finish(reason))
  }

  return {
    server,
    done,
    stop,
    async listen() {
      const port = await server.listen()
      emptySince = performance.now()
      // Nobody in a seat: the first wait is long (the pages are coming through the relay), the second short.
      idle = setInterval(() => {
        if (server.lobby.humans()) return void (emptySince = performance.now())
        if (performance.now() - emptySince >= (seatedOnce ? emptyIdle : initialIdle)) stop(seatedOnce ? 'empty' : 'idle')
      }, Math.min(250, initialIdle, emptyIdle))
      limit = setTimeout(() => stop('time limit'), maxSession)
      return port
    },
  }
}
