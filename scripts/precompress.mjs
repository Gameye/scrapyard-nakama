// Writes a .br and a .gz copy next to every text file of a static build, so
// Caddy sends them compressed without compressing on each request
// (deploy/Caddyfile: precompressed). scripts/build.sh runs it.
//   node scripts/precompress.mjs www/dist
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const TEXT = /\.(html|css|js|mjs|json|svg|xml|txt|wasm)$/
const MIN = 1024 // bytes; smaller files gain next to nothing
const root = process.argv[2] ?? 'www/dist'

let count = 0
for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  const path = join(entry.parentPath, entry.name)
  if (!entry.isFile() || !TEXT.test(path)) continue
  const data = readFileSync(path)
  if (data.length < MIN) continue
  const brotli = { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: data.length }
  writeFileSync(`${path}.br`, brotliCompressSync(data, { params: brotli }))
  writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }))
  count++
}
console.log(`precompress: ${count} files in ${root}`)
