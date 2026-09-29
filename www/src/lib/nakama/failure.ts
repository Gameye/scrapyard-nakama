// A sentence for a form from a failed Nakama call. nakama-js rejects with
// the fetch Response (status + { message }); no Response means no server.
export async function failure(e: unknown, known: Record<number, string> = {}): Promise<string> {
  if (!(e instanceof Response)) return "Can't reach the game server. Check your connection and try again."
  if (known[e.status]) return known[e.status]
  const message: unknown = await e.json().then(
    (body) => body?.message,
    () => '',
  )
  return typeof message === 'string' && message ? message : `The game server refused that (${e.status}). Try again.`
}
