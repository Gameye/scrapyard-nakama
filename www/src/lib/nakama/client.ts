import { Client } from '@heroiclabs/nakama-js'

// The site's line to Nakama, from the build's PUBLIC_NAKAMA_* settings (the
// defaults are the local Podman stack). The game at /play signs in against
// the same server. autoRefreshSession is off: getSession() (session.ts) is
// the one place that refreshes, so every new token is also saved.
export const nakama = new Client(
  import.meta.env.PUBLIC_NAKAMA_KEY ?? 'defaultkey',
  import.meta.env.PUBLIC_NAKAMA_HOST ?? '127.0.0.1',
  import.meta.env.PUBLIC_NAKAMA_PORT ?? '7350',
  import.meta.env.PUBLIC_NAKAMA_SSL === 'true',
  7000,
  false,
)
