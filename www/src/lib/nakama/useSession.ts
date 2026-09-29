import { useMemo, useSyncExternalStore } from 'react'
import { readStored, subscribe } from './storage'
import { parse, type SignedIn } from './stored'

// Who is signed in, for rendering: undefined until the island hydrates (the
// build can't know), then the session or null. The snapshot is the raw
// stored string, so it only changes when the session does.
export function useSession(): SignedIn | null | undefined {
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, readStored, () => undefined)
  return useMemo(() => (raw === undefined ? undefined : parse(raw)), [raw])
}
