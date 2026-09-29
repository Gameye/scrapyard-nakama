import type { Session } from '@heroiclabs/nakama-js'
import { nakama } from './client'
import { readStored, writeStored } from './storage'
import { needsRefresh, parse, serialize, type SignedIn } from './stored'

export const saveSession = (session: Session, guest = false) => writeStored(serialize(session, guest))
export const clearSession = () => writeStored(null)

// The session to call Nakama with: refreshed and saved when close to expiry.
// A revoked or dead session is cleared; a network failure keeps it (null for now).
export async function getSession(): Promise<SignedIn | null> {
  const raw = readStored()
  const signed = parse(raw)
  if (!signed) {
    if (raw) clearSession()
    return null
  }
  if (!needsRefresh(signed.session)) return signed
  try {
    const session = await nakama.sessionRefresh(signed.session)
    saveSession(session, signed.guest)
    return { session, guest: signed.guest }
  } catch (e) {
    if (e instanceof Response && e.status === 401) clearSession()
    return null
  }
}
