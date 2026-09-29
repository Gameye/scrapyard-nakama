import { unified } from '@astrojs/markdown-remark'
import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import remarkGfm from 'remark-gfm'
import { loadEnv, type Plugin } from 'vite'

// The config runs before Vite reads the .env files, so read them here; CI's
// environment wins over them.
const env = { ...loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), ''), ...process.env }
const nakama = env.NAKAMA_URL ?? 'http://127.0.0.1:7350'
const gameServer = env.GAME_SERVER_URL ?? 'ws://127.0.0.1:7360' // online matches (game/server)
const httpKey = encodeURIComponent(env.NAKAMA_HTTP_KEY ?? 'defaulthttpkey')

// In dev, /play is the last game build in public/play (scripts/build.sh), as
// Caddy serves it on the server.
const play: Plugin = {
  name: 'play',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.split('?')[0] === '/play') req.url = '/play/index.html'
      next()
    })
  },
}

// A static site: Caddy serves dist/ on the server (deploy/Caddyfile), nothing
// else runs there. Pages build to docs/modes.html and are served at
// /docs/modes, the URLs their canonical links name.
export default defineConfig({
  site: env.SITE_URL ?? 'http://localhost:8000',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [react(), mdx({ processor: unified({ remarkPlugins: [remarkGfm] }) })], // remark-gfm: the guide's tables
  vite: {
    plugins: [tailwindcss(), play],
    server: {
      proxy: {
        // In dev, /api/stats goes straight to Nakama with the HTTP key, as Caddy sends it on the server.
        '/api/stats': { target: nakama, changeOrigin: true, rewrite: () => `/v2/rpc/get_stats?http_key=${httpKey}&unwrap` },
        // /play's online matches connect to /match on the page's own origin, as on the server: on to the game server.
        '/match': { target: gameServer, ws: true },
      },
    },
  },
})
