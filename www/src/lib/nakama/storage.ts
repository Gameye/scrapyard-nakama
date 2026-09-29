// Where the session lives: localStorage, shared with the game at /play (same
// origin), so a login here is a login there. Keep in step with
// game/src/net/session.ts. Nothing here loads Nakama's client: the header
// reads it on every page.
export const KEY = 'scrapyard.session' // { token, refresh_token, guest? } (stored.ts)
const CHANGED = 'scrapyard:session' // this tab's own writes; other tabs get 'storage'

export function readStored(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null // storage blocked (private window, settings): behave as signed out
  }
}

// Stores a session (null forgets it) and tells this tab's listeners.
export function writeStored(raw: string | null) {
  try {
    if (raw === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, raw)
  } catch {
    // storage blocked: signed in for this page only
  }
  dispatchEvent(new Event(CHANGED))
}

// Calls `onChange` whenever the stored session changes, in this tab or another.
export function subscribe(onChange: () => void) {
  addEventListener('storage', onChange)
  addEventListener(CHANGED, onChange)
  return () => {
    removeEventListener('storage', onChange)
    removeEventListener(CHANGED, onChange)
  }
}
