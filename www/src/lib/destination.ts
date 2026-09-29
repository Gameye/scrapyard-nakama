// Where to go after signing in: ?next= when it is a path on this site (never
// another origin: no //host or /\host), else the fallback.
export function destination(fallback: string) {
  const next = new URLSearchParams(location.search).get('next')
  return next && /^\/(?![/\\])/.test(next) ? next : fallback
}
