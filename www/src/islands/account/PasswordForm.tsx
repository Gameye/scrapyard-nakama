import type { SubmitEvent } from 'react'
import { nakama } from '@/lib/nakama/client'
import { Outcome, PasswordField } from '../forms/fields'
import { useAction } from './useAction'

// Change the password: the current one first, then the new one.
export function PasswordForm({ email }: { email: string }) {
  const { busy, error, done, run } = useAction()

  function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const target = e.currentTarget
    const form = new FormData(target)
    run(
      async (session) => {
        // prove the current password, then set the new one: linking the same
        // email again with a new password replaces it
        await nakama.authenticateEmail(email, String(form.get('current')), false)
        await nakama.linkEmail(session, { email, password: String(form.get('password')) })
        target.reset()
        return 'Password changed.'
      },
      { 401: 'Your current password is wrong.' },
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <PasswordField label="Current password" name="current" autoComplete="current-password" required />
      <PasswordField label="New password" name="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." />
      <Outcome error={error} done={done} />
      <button type="submit" disabled={busy} className="button-quiet">
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
