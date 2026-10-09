import { Session } from '@heroiclabs/nakama-js'
import { createGameyeQueue } from './gameye-queue'
import type * as Classic from './matchmaking'
import { freshSession, nakama, onSocket, player } from './session'

// Gameye mode's matchmaking, in Classic's place when the page is built with
// VITE_MATCHMAKER=gameye (matchmaker.ts): the same exports as matchmaking.ts,
// so App.tsx and the screens read it unchanged. The store is gameye-queue.ts;
// this wires it to the page's Nakama socket and session (session.ts) and the
// browser's clocks.

// The player's session for Nakama's REST calls (the notification list).
async function session() {
  const { token } = await freshSession()
  return Session.restore(token, '')
}

function tabStorage() {
  try {
    return sessionStorage
  } catch {
    return null
  }
}

const queue = createGameyeQueue({
  clock: {
    now: () => performance.now(),
    unix: () => Math.floor(Date.now() / 1000),
    after(ms, fn) {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
  },
  onSocket,
  online: () => void player().catch(() => {}), // signs in and holds the socket open (once per page)
  signIn: freshSession,
  notifications: async () => (await nakama.listNotifications(await session(), 100)).notifications ?? [],
  forget: async (ids) => nakama.deleteNotifications(await session(), ids),
  storage: tabStorage(),
}) satisfies Omit<typeof Classic, 'NOTES'>

export const { currentSearch, onSearch, resumeSearch, findMatch, cancelSearch, answer, takeSeat } = queue
