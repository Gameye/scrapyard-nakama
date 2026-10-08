import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { buildId } from './build-id.ts'
import { matchmakerPlugin } from './matchmaker.ts'

// https://vite.dev/config/
// __BUILD__: the build id the page says hello with (net/protocol.ts); 'dev' from the dev server.
// VITE_MATCHMAKER=gameye: Gameye mode's matchmaking in place of Classic's (matchmaker.ts).
export default defineConfig(({ command, mode }) => ({
  plugins: [ matchmakerPlugin(loadEnv(mode, process.cwd(), 'VITE_').VITE_MATCHMAKER), react(), tailwindcss() ],
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildId()) },
  server: { port: 3000 }
}))
