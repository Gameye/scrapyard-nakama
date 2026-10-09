import { initPhysics } from '../src/game/physics'
import { arenaData } from './arenas'
import { createManagedServer } from './gameye-server'

// The Gameye image's entry (main.ts is the shared server's): one match per
// container, for the players the Nakama plugin matched into this session
// (gameye-server.ts), then the process exits. Refuses to start without its
// settings. Stops cleanly on SIGTERM / SIGINT (Gameye stopping the session).
//   PORT                  7360 (the application's port, 7360/tcp)
//   SEAT_SECRET           this match's secret, from the plugin (32 characters or more): seat tokens are signed with it
//   GAMEYE_SESSION_ID     set by Gameye: seat tokens name it
//   ALLOWED_ORIGINS       pages that may connect, comma-separated; never '*'
//   TRUST_PROXY           1 behind the relay: addresses from X-Forwarded-For, else CF-Connecting-IP;
//                         production, so pages from Vite's dev server (build 'dev') are refused too
//   INITIAL_IDLE_SECONDS  nobody has taken a seat yet: exit after this long (default 120)
//   EMPTY_IDLE_SECONDS    the last person left: exit after this long (default 30)
//   MAX_SESSION_SECONDS   the hard limit, however the match goes (default 1200); Gameye's TTL backs it up
// The secret and the tokens are never logged.

const env = process.env
const refuse = (reason: string): never => {
  console.error(JSON.stringify({ time: new Date().toISOString(), msg: 'not starting', reason }))
  process.exit(1)
}
const whole = (name: string, fallback: number, least: number, most = Number.MAX_SAFE_INTEGER) => {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= least && value <= most ? value : refuse(`${name} is ${JSON.stringify(raw)}: a whole number from ${least} to ${most}`)
}
const secret = env.SEAT_SECRET ?? ''
if (secret.length < 32) refuse('SEAT_SECRET is unset or shorter than 32 characters')
const sessionId = env.GAMEYE_SESSION_ID || refuse('GAMEYE_SESSION_ID is unset')
const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (!origins.length || origins.includes('*')) refuse('ALLOWED_ORIGINS must name the pages that may connect, and not *')
const trustProxy = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true'
const settings = {
  port: whole('PORT', 7360, 0, 65535),
  initialIdle: whole('INITIAL_IDLE_SECONDS', 120, 1) * 1000,
  emptyIdle: whole('EMPTY_IDLE_SECONDS', 30, 1) * 1000,
  maxSession: whole('MAX_SESSION_SECONDS', 1200, 1) * 1000,
}

await initPhysics()
arenaData('scrapyard')

const session = createManagedServer({ ...settings, secret, sessionId, origins, trustProxy, strict: trustProxy })
await session.listen()
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => session.stop(signal))
await session.done
setTimeout(() => process.exit(0), 100) // its last log lines out; nothing else may hold the process
