import { useState } from 'react'
import { nakama } from '@/lib/nakama/client'
import { clearSession, getSession } from '@/lib/nakama/session'

// Signs this browser out: revoked on the server when it answers, forgotten here either way.
export function LogOutButton() {
  const [busy, setBusy] = useState(false)

  async function logOut() {
    setBusy(true)
    const current = await getSession()
    if (current) await nakama.sessionLogout(current.session, current.session.token, current.session.refresh_token).catch(() => {})
    clearSession()
    location.assign('/')
  }

  return (
    <button type="button" onClick={logOut} disabled={busy} className="button-quiet">
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
