import js from '@eslint/js'
import astro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist/', '.astro/', 'public/play/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
)
