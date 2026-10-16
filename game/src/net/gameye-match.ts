import { Session } from '@heroiclabs/nakama-js'
import { createGameyeQueue, fetchGeo, type Clock } from './gameye-queue'
import type * as Classic from './matchmaking'
import type * as ClassicServers from './servers'
import { freshSession, nakama, onSocket, player } from './session'

// Gameye mode's matchmaking, in Classic's place when the page is built with
// VITE_MATCHMAKER=gameye (matchmaker.ts): the same exports as matchmaking.ts
// and servers.ts, so App.tsx and the screens read it unchanged. The store is
// gameye-queue.ts; this wires it to the page's Nakama socket and session
// (session.ts) and the browser's clocks.

// The player's session for Nakama's REST calls (the notification list).
async function session() {
  const { token } = await freshSession()
  return Session.restore(token, '')
}

// Each is null where the browser blocks it.
function tabStorage() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}
function browserStorage() {
  try {
    return localStorage
  } catch {
    return null
  }
}

const clock: Clock = {
  now: () => performance.now(),
  unix: () => Math.floor(Date.now() / 1000),
  after(ms, fn) {
    const timer = setTimeout(fn, ms)
    return () => clearTimeout(timer)
  },
}

const queue = createGameyeQueue({
  clock,
  onSocket,
  online: () => void player().catch(() => {}), // signs in and holds the socket open (once per page)
  signIn: freshSession,
  geo: () => fetchGeo(import.meta.env.VITE_GAMEYE_RELAY as string | undefined, clock),
  notifications: async () => (await nakama.listNotifications(await session(), 100)).notifications ?? [],
  forget: async (ids) => nakama.deleteNotifications(await session(), ids),
  storage: tabStorage(),
  prefs: browserStorage(),
}) satisfies Omit<typeof Classic, 'NOTES'> & Omit<typeof ClassicServers, 'AUTO'>

export const { currentSearch, onSearch, resumeSearch, findMatch, cancelSearch, answer, takeSeat } = queue
// In servers.ts's place too (matchmaker.ts): the arena screen's server picker.
export const { currentServers, onServers, chooseServer } = queue
export { AUTO } from './servers'
