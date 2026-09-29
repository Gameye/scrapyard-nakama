// The name the header shows for a stored session, read straight from its
// tokens: the header is on every page, and shouldn't load Nakama's client
// for this. Empty means "Log in": signed out, a guest, or unreadable. Agrees
// with parse() in stored.ts (nakama.check.mts holds them to it).
export function signedInName(raw: string | null, now = Date.now() / 1000): string {
  try {
    const stored = JSON.parse(raw ?? '')
    if (stored.guest === true || claims(stored.refresh_token).exp < now) return ''
    return String(claims(stored.token).usn ?? '')
  } catch {
    return ''
  }
}

// A JWT's payload: its middle part, base64url-encoded JSON.
function claims(jwt: string): { exp: number; usn?: string } {
  const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))))
}
