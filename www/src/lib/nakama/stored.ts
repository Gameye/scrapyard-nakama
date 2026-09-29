import { Session } from '@heroiclabs/nakama-js'

// What a stored session holds: { token, refresh_token, guest? } as JSON
// (storage.ts keeps it). Keep in step with game/src/net/session.ts.
const MARGIN = 5 * 60 // refresh a token with less than this many seconds left

export interface SignedIn {
  session: Session
  guest: boolean // a device account the game made; no email, no password
}

// A stored session, or null when there is none, it can't be read, or even
// its refresh token has run out.
export function parse(raw: string | null, now = Date.now() / 1000): SignedIn | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw)
    const session = Session.restore(stored.token, stored.refresh_token)
    return session.isrefreshexpired(now) ? null : { session, guest: stored.guest === true }
  } catch {
    return null
  }
}

export const needsRefresh = (session: Session, now = Date.now() / 1000) => session.isexpired(now + MARGIN)

// What gets stored for a session.
export const serialize = (session: Session, guest: boolean) =>
  JSON.stringify({ token: session.token, refresh_token: session.refresh_token, ...(guest && { guest }) })
