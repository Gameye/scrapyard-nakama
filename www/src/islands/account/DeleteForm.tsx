import { useState, type SubmitEvent } from 'react'
import { nakama } from '@/lib/nakama/client'
import { clearSession } from '@/lib/nakama/session'
import { Field, Outcome } from '../forms/fields'
import { useAction } from './useAction'

// Deletes the account for good, once its username has been typed out.
export function DeleteForm({ username }: { username: string }) {
  const { busy, error, run } = useAction()
  const [typed, setTyped] = useState('')

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    run(async (session) => {
      await nakama.deleteAccount(session)
      clearSession()
      location.assign('/')
    })
  }

  const label = (
    <>
      Type <span className="normal-case tracking-normal text-ink">{username}</span> to confirm
    </>
  )
  return (
    <form onSubmit={submit} className="space-y-6">
      <Field label={label} name="confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      <Outcome error={error} />
      <button type="submit" disabled={busy || typed !== username} className="button-primary">
        {busy ? 'Deleting…' : 'Delete my account'}
      </button>
    </form>
  )
}
