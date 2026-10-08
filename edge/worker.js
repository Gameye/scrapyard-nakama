// The Scrapyard relay: TLS for the browser's game socket. The page opens
// /match?token=<relay token>; the container address comes only from that
// token, which the Nakama plugin signs with RELAY_SECRET (root AGENTS.md,
// Contracts). Nothing is logged: URLs carry tokens.

const MAX_TOKEN_LENGTH = 1024
const MIN_SECRET_BYTES = 32
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const BASE64URL = /^[A-Za-z0-9_-]*$/
const DNS_SUFFIX = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i

const encoder = new TextEncoder()

/** @param {string} text unpadded base64url */
function decodeBase64url(text) {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/**
 * The relay half of nakama/modules-src/tokens.go verifyRelayToken.
 * @param {string} secret
 * @param {string} token
 * @param {number} now unix seconds
 * @returns {Promise<{ sid: string, host: string, port: number, exp: number } | null>}
 */
export async function verifyRelayToken(secret, token, now) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1' || parts[1] === '') return null
  const signature = decodeBase64url(parts[2])
  if (!signature) return null
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  // subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${parts[0]}.${parts[1]}`)))) return null
  const payload = decodeBase64url(parts[1])
  if (!payload) return null
  let claims
  try {
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
  } catch {
    return null
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null
  const { t, sid, host, port, exp } = claims
  if (t !== 'relay' || typeof sid !== 'string' || sid === '' || typeof host !== 'string' || !IPV4.test(host)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(exp)) return null
  if (now > exp) return null
  return { sid, host, port, exp }
}

/**
 * ALLOWED_ORIGINS is comma-separated; an entry ending in ":*" admits that
 * scheme and host on any port (the dev environment's http://localhost:*).
 * @param {{ ALLOWED_ORIGINS?: string }} env
 * @param {string | null} origin
 */
export function originAllowed(env, origin) {
  if (!origin) return false
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.origin !== origin) return false
  return (env.ALLOWED_ORIGINS || '').split(',').map((entry) => entry.trim()).filter(Boolean).some((entry) => {
    if (!entry.endsWith(':*')) return entry === origin
    const base = entry.slice(0, -2)
    return `${parsed.protocol}//${parsed.hostname}` === base
  })
}

/**
 * Cloudflare's fetch refuses bare-IP hosts, so the container's IPv4 becomes a
 * wildcard-DNS hostname (sslip.io by default).
 * @param {{ GAMEYE_IPV4_DNS_SUFFIX?: string }} env
 * @param {{ host: string, port: number }} claims
 */
export function upstreamTarget(env, { host, port }) {
  const suffix = env.GAMEYE_IPV4_DNS_SUFFIX || 'sslip.io'
  if (!IPV4.test(host) || !DNS_SUFFIX.test(suffix)) return null
  return `http://${host}.${suffix}:${port}/match`
}

const refuse = (status, text) => new Response(text, { status, headers: { 'cache-control': 'no-store' } })
const retryLater = () => new Response('Game server not ready', { status: 503, headers: { 'retry-after': '1', 'cache-control': 'no-store' } })

/** @type {ExportedHandler<{ RELAY_SECRET?: string, ALLOWED_ORIGINS?: string, UPSTREAM_ORIGIN?: string, GAMEYE_IPV4_DNS_SUFFIX?: string }>} */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/match') return refuse(404, 'Not found')
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return refuse(400, 'WebSocket upgrade required')
    if (!env.RELAY_SECRET || encoder.encode(env.RELAY_SECRET).length < MIN_SECRET_BYTES) return refuse(500, 'Relay misconfigured')
    const origin = request.headers.get('origin')
    if (!originAllowed(env, origin)) return refuse(403, 'Origin refused')
    const claims = await verifyRelayToken(env.RELAY_SECRET, url.searchParams.get('token') || '', Math.floor(Date.now() / 1000))
    const target = claims && upstreamTarget(env, claims)
    if (!target) return refuse(403, 'Match unavailable')

    const headers = new Headers({ Upgrade: 'websocket', Origin: env.UPSTREAM_ORIGIN || origin })
    // The player's address, for the game server's per-address limit (KTD9).
    // Cloudflare (and workerd) replace CF-Connecting-IP on a Worker's
    // subrequests, so X-Forwarded-For carries it too: this one value, never
    // anything the browser sent.
    const ip = request.headers.get('cf-connecting-ip')
    if (ip) {
      headers.set('CF-Connecting-IP', ip)
      headers.set('X-Forwarded-For', ip)
    }
    let response
    try {
      response = await fetch(target, { headers, redirect: 'manual' })
    } catch {
      // Connection refused or reset: the container is not listening yet (KTD6).
      return retryLater()
    }
    // Pass the upgrade through without touching game messages.
    if (response.status === 101) return response
    await response.body?.cancel()
    return response.status >= 500 ? retryLater() : refuse(502, 'Game server refused')
  },
}
