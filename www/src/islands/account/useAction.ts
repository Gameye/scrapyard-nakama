import type { Session } from '@heroiclabs/nakama-js'
import { useState, type ReactNode } from 'react'
import { failure } from '@/lib/nakama/failure'
import { getSession } from '@/lib/nakama/session'

// Runs a form's Nakama work with the current session, keeping busy/error/done.
// `work` returns the success line to show; `known` maps statuses to sentences.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReactNode>('')
  const [done, setDone] = useState('')

  async function run(work: (session: Session) => Promise<string | void>, known?: Record<number, string>) {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const current = await getSession()
      if (!current) throw new TypeError('no session')
      setDone((await work(current.session)) ?? '')
    } catch (e) {
      setError(await failure(e, known))
    }
    setBusy(false)
  }

  return { busy, error, done, run }
}
