import { useEffect, useState } from 'react'
import { nakama } from '@/lib/nakama/client'
import { failure } from '@/lib/nakama/failure'
import { getSession } from '@/lib/nakama/session'
import type { SignedIn } from '@/lib/nakama/stored'

export type Account = Awaited<ReturnType<typeof nakama.getAccount>>

// The signed-in account, (re)loaded whenever the stored session changes: after
// a rename, too. Guests and signed-out visitors have none to load.
export function useAccount(signed: SignedIn | null | undefined) {
  const [account, setAccount] = useState<Account>()
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!signed || signed.guest) return
    let live = true
    getSession().then(async (current) => {
      if (!current) return // cleared: `signed` turns null and the panel says so
      try {
        const loaded = await nakama.getAccount(current.session)
        if (live) setAccount(loaded)
      } catch (e) {
        const text = await failure(e)
        if (live) setLoadError(text)
      }
    })
    return () => {
      live = false
    }
  }, [signed])

  return { account, loadError }
}
