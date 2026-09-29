export interface Stats {
  registered: number
  active: number // players with the game open right now
}

const EVERY = 30_000 // ms; the server keeps the counts for as long

// Player counts from /api/stats (Caddy asks Nakama; in dev, the Vite proxy):
// now, then every 30 s while the tab is in view. A failed poll keeps the
// last counts.
export function watchStats(onStats: (stats: Stats) => void) {
  const load = () =>
    fetch('/api/stats')
      .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
      .then((stats) => stats && onStats(stats))
      .catch(() => {})
  load()
  setInterval(() => document.hidden || load(), EVERY)
}
