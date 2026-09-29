import { MAPS, type MapId } from '../src/game/maps'
import { initPhysics } from '../src/game/physics'
import { arenaData } from './arenas'
import { createGameServer } from './server'

// The game server's entry: settings from the environment, the physics
// engine and every arena built up front (a player never waits on one), then
// the server. Stops cleanly on SIGTERM / SIGINT (a deploy, Ctrl-C):
// everyone in a match is told, and the matches end.
//   PORT                   7360
//   NAKAMA_ENCRYPTION_KEY  Nakama's session.encryption_key (local default: Nakama's own default;
//                          with TRUST_PROXY it must be set, and not to that default, or the server won't start)
//   ALLOWED_ORIGINS        pages that may connect, comma-separated (default: localhost and 127.0.0.1, any port)
//   MAX_ROOMS              rooms at once (default 12)
//   TRUST_PROXY            1 behind a proxy that is the only way in (Caddy): addresses from X-Forwarded-For;
//                          production, so pages from Vite's dev server (build 'dev') are refused too
//   NET_LAG_MS             development only: ms added each way to every message
//   NET_JITTER_MS          development only: ms either side of NET_LAG_MS, message by message (order kept)

const env = process.env
const list = (value: string | undefined, fallback: string[]) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback)
const trustProxy = env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true'
const key = env.NAKAMA_ENCRYPTION_KEY || 'defaultencryptionkey'
// Behind the proxy is production: there, Nakama's default key (or none) would let anyone sign a session.
if (trustProxy && key === 'defaultencryptionkey') {
  console.error(JSON.stringify({ time: new Date().toISOString(), msg: 'not starting', reason: 'NAKAMA_ENCRYPTION_KEY is unset or Nakama’s default, and TRUST_PROXY says this is production' }))
  process.exit(1)
}

await initPhysics()
for (const id of Object.keys(MAPS) as MapId[]) arenaData(id)

const server = createGameServer({
  port: Number(env.PORT ?? 7360),
  key,
  origins: list(env.ALLOWED_ORIGINS, ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*', 'https://127.0.0.1:*']),
  maxRooms: Number(env.MAX_ROOMS ?? 12),
  trustProxy,
  strict: trustProxy,
  lag: Number(env.NET_LAG_MS ?? 0),
  jitter: Number(env.NET_JITTER_MS ?? 0),
})
await server.listen()

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(JSON.stringify({ time: new Date().toISOString(), msg: 'stopping', signal }))
    void server.close().then(() => process.exit(0))
  })
}
