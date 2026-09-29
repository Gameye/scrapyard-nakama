import { useState, type SubmitEvent } from 'react'
import { destination } from '@/lib/destination'
import { nakama } from '@/lib/nakama/client'
import { failure } from '@/lib/nakama/failure'
import { saveSession } from '@/lib/nakama/session'
import { useSession } from '@/lib/nakama/useSession'
import { Field, Outcome, PasswordField } from './fields'
import { SignedInAlready } from './SignedInAlready'

// Unknown email and wrong password get the same answer: the form shouldn't
// tell anyone which emails have accounts.
const WRONG = 'Wrong email or password.'

export function LoginForm() {
  const signed = useSession()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (signed && !signed.guest) return <SignedInAlready name={signed.session.username} />

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    setBusy(true)
    setError('')
    try {
      saveSession(await nakama.authenticateEmail(String(form.get('email')), String(form.get('password')), false))
      location.assign(destination('/')) // a full load: the destination may be the game
    } catch (err) {
      setError(await failure(err, { 401: WRONG, 404: WRONG }))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <PasswordField label="Password" name="password" autoComplete="current-password" required />
      <Outcome error={error} />
      <button type="submit" disabled={busy} className="button-primary w-full">
        {busy ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  )
}
