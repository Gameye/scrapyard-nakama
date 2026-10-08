import type { MatchPhase } from './match.ts'

// What an online match's link ending does to the player's view of it
// (match.ts): before the result it's a lost connection; once the result is
// in, the results stay up, and their own buttons leave — a Gameye session
// ends after its results, and a Classic room that stops during them has
// nothing more to send. A result that came with the close (a tab in the
// background) is shown first. `outcome`: the mode's (mode.ts), undefined
// while the rules run.
export function linkEnded(phase: MatchPhase, outcome: number | null | undefined): 'lost' | 'result' | 'stay' {
  if (outcome === undefined) return 'lost'
  return phase === 'victory' || phase === 'defeat' ? 'stay' : 'result'
}
