import type { SubmitEvent } from 'react'
import { nakama } from '@/lib/nakama/client'
import { saveSession } from '@/lib/nakama/session'
import { USERNAME } from '@/lib/username'
import { Field, Outcome } from '../forms/fields'
import { useAction } from './useAction'

// Username and display name.
export function ProfileForm({ username, displayName }: { username: string; displayName: string }) {
  const { busy, error, done, run } = useAction()

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('username'))
    run(async (session) => {
      // send the username only when it changes; the new token carries it, so refresh
      await nakama.updateAccount(session, { display_name: String(form.get('display_name')), ...(name !== username && { username: name }) })
      if (name !== username) saveSession(await nakama.sessionRefresh(session))
      return 'Saved.'
    })
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Field label="Username" name="username" autoComplete="username" required defaultValue={username} pattern={USERNAME.pattern} title={USERNAME.hint} hint={USERNAME.hint} />
      <Field label="Display name" name="display_name" autoComplete="nickname" maxLength={32} defaultValue={displayName} hint="Optional. Shown in the game instead of your username." />
      <Outcome error={error} done={done} />
      <button type="submit" disabled={busy} className="button-quiet">
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  )
}
