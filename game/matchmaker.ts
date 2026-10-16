import type { Plugin } from 'vite'

// Which matchmaking the page's online play uses, picked at build time by
// VITE_MATCHMAKER (game/.env.example). Unset (or anything but 'gameye'):
// upstream's Classic, src/net/matchmaking.ts, untouched, and src/net/servers.ts
// (one server, no picker). 'gameye': every import of either resolves to
// src/net/gameye-match.ts instead — the same exports, over Nakama's
// matchmaker and a Gameye session per match, with the regions to pick from —
// so the screens and App.tsx stay as they are and a Classic page carries no
// Gameye code. gameye-* files themselves still see the originals (for their
// types). Read by vite.config.ts.

const CLASSIC = /\/src\/net\/(matchmaking|servers)\.ts$/

export function matchmakerPlugin(choice: string | undefined): Plugin {
  return {
    name: 'scrapyard-matchmaker',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (choice !== 'gameye' || !importer || !/(^|\/)(matchmaking|servers)(\.ts)?$/.test(source) || /\/gameye-[^/]*$/.test(importer)) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && CLASSIC.test(resolved.id) ? resolved.id.replace(/(matchmaking|servers)\.ts$/, 'gameye-match.ts') : null
    },
  }
}
