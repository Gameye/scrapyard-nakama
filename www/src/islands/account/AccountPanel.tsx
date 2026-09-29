import { useEffect, useRef } from 'react'
import { useSession } from '@/lib/nakama/useSession'
import { Outcome } from '../forms/fields'
import { DeleteForm } from './DeleteForm'
import { LogOutButton } from './LogOutButton'
import { GuestNotice, SignedOut } from './Notices'
import { PasswordForm } from './PasswordForm'
import { ProfileForm } from './ProfileForm'
import { Section } from './Section'
import { useAccount } from './useAccount'

// Everything on /account. The page itself is static; who is signed in is
// only known here, in the browser.
export function AccountPanel() {
  const signed = useSession()
  const { account, loadError } = useAccount(signed)
  const seen = useRef(false) // was signed in during this visit

  // Opened while signed out: off to log in. Signed out while here (this
  // page's Log out, another tab): say so and stay put.
  useEffect(() => {
    if (signed) seen.current = true
    else if (signed === null && !seen.current) location.replace('/login?next=/account')
  }, [signed])

  if (signed === null) return <SignedOut />
  if (signed?.guest) return <GuestNotice />
  if (loadError) return <Outcome error={loadError} />
  if (!signed || !account?.user) {
    return (
      <p className="mt-8 text-neutral-400" aria-busy="true">
        Loading your account…
      </p>
    )
  }

  const user = account.user
  const since = user.create_time ? new Date(user.create_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <div className="mt-10 space-y-8">
      <Section title="Profile" note={`${account.email ?? ''}${since ? ` · playing since ${since}` : ''}`}>
        <ProfileForm username={user.username ?? ''} displayName={user.display_name ?? ''} />
      </Section>
      {account.email && (
        <Section title="Password" note="Other browsers where you are signed in stay signed in.">
          <PasswordForm email={account.email} />
        </Section>
      )}
      <Section title="Log out" note="Signs this browser out, the game included.">
        <LogOutButton />
      </Section>
      <Section title="Delete account" note="Removes your account from the game server for good." danger>
        <DeleteForm username={user.username ?? ''} />
      </Section>
    </div>
  )
}
