import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Identity } from './auth'

// Who may take a seat in a Gameye match: the seat token the Nakama plugin
// signed for each player it matched (the root AGENTS.md, Contracts):
// "v1.<payload>.<signature>", the payload unpadded base64url JSON
// {"t":"seat","sid","uid","exp"}, the signature unpadded base64url
// HMAC-SHA256 of "v1.<payload>" keyed with SEAT_SECRET's bytes as they are.
// A port of verifySeatToken in nakama/modules-src/tokens.go (the reference);
// change them together. The container holds this match's secret only: no
// Nakama key, so a player from another match, or none, is never seated here.

const VERSION = 'v1'
const MAX_LENGTH = 1024
const BASE64URL = /^[A-Za-z0-9_-]*$/

export const seatSignature = (secret: string, signed: string) => createHmac('sha256', secret).update(signed).digest('base64url')

// Go's RawURLEncoding: the URL alphabet, no padding, no length that can't be one.
function decode(part: string): Buffer | null {
  return BASE64URL.test(part) && part.length % 4 !== 1 ? Buffer.from(part, 'base64url') : null
}

// The player the seat token names, or null: not a string, too long, not the
// format, a signature that isn't this match's, not a seat, another
// session's, or expired (good while now ≤ exp). `now` in seconds.
export function verifySeatToken(token: unknown, secret: string, sessionId: string, now = Math.floor(Date.now() / 1000)): Identity | null {
  if (typeof token !== 'string' || token.length > MAX_LENGTH || !secret || !sessionId) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION || !parts[1]) return null
  const given = decode(parts[2])
  const expected = Buffer.from(seatSignature(secret, `${parts[0]}.${parts[1]}`), 'base64url')
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  const payload = decode(parts[1])
  let claims: unknown
  try {
    claims = payload && JSON.parse(payload.toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null
  const { t, sid, uid, exp = 0 } = claims as Record<string, unknown>
  if (t !== 'seat' || typeof sid !== 'string' || !sid || typeof uid !== 'string' || !uid || !Number.isSafeInteger(exp)) return null
  if (now > (exp as number) || sid !== sessionId) return null
  return { uid, username: `Player ${uid.slice(-4)}`, expires: exp as number }
}

// A seat token as the plugin signs it — for the self-checks and local runs, which have no Nakama.
export function signSeatToken(secret: string, sessionId: string, uid: string, issued = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.from(JSON.stringify({ t: 'seat', sid: sessionId, uid, exp: issued + 120 })).toString('base64url')
  return `${VERSION}.${payload}.${seatSignature(secret, `${VERSION}.${payload}`)}`
}
