import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { buildId } from './build-id.ts'

// https://vite.dev/config/
// __BUILD__: the build id the page says hello with (net/protocol.ts); 'dev' from the dev server.
export default defineConfig(({ command }) => ({
  plugins: [ react(), tailwindcss() ],
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildId()) },
  server: { port: 3000 }
}))
