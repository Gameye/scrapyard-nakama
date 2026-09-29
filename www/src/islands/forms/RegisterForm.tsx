import { useState, type SubmitEvent, type ReactNode } from 'react'
import { destination } from '@/lib/destination'
import { nakama } from '@/lib/nakama/client'
import { failure } from '@/lib/nakama/failure'
import { saveSession } from '@/lib/nakama/session'
import { useSession } from '@/lib/nakama/useSession'
import { USERNAME } from '@/lib/username'
import { Field, Outcome, PasswordField } from './fields'
import { SignedInAlready } from './SignedInAlready'

export function RegisterForm() {
  const signed = useSession()
  const [error, setError] = useState<ReactNode>('')
  const [busy, setBusy] = useState(false)

  if (signed && !signed.guest) return <SignedInAlready name={signed.session.username} />

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      // create=true on an email that already has an account signs in instead
      // when the password matches (created: false); that's fine here too.
      saveSession(await nakama.authenticateEmail(String(form.get('email')), String(form.get('password')), true, String(form.get('username'))))
      location.assign(destination('/account'))
    } catch (err) {
      // on create, 401 only happens for an email that is already registered
      const taken = err instanceof Response && err.status === 401
      const loginInstead = (
        <>
          This email already has an account.{' '}
          <a href="/login" className="underline underline-offset-4">
            Log in
          </a>{' '}
          instead.
        </>
      )
      setError(taken ? loginInstead : await failure(err, { 409: 'That username is taken. Try another.' }))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <Field label="Username" name="username" autoComplete="username" required pattern={USERNAME.pattern} title={USERNAME.hint} hint={USERNAME.hint} />
      <Field label="Email" name="email" type="email" autoComplete="email" required hint="For logging in. Never shown to anyone." />
      <PasswordField label="Password" name="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." />
      <Outcome error={error} />
      <button type="submit" disabled={busy} className="button-primary w-full">
        {busy ? 'Creating your account…' : 'Create account'}
      </button>
    </form>
  )
}
