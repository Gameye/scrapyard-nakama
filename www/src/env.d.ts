// Build-time settings (.env.example); PUBLIC_* ends up in the browser bundle.
interface ImportMetaEnv {
  readonly PUBLIC_NAKAMA_HOST?: string
  readonly PUBLIC_NAKAMA_PORT?: string
  readonly PUBLIC_NAKAMA_SSL?: string
  readonly PUBLIC_NAKAMA_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
