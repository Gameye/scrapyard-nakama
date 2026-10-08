// Self-check for what an online match's link ending does to the player's
// view of it (linkEnd.ts, used by match.ts): a close before the result is a
// lost connection, whatever the player is doing; a close once the result is
// in keeps the results up (a Gameye session ends after them; a Classic room
// can stop during them), and a result that arrives with the close is shown
// first. Run: node src/game/linkEnd.check.ts
import { linkEnded } from './linkEnd.ts'
import type { MatchPhase } from './match.ts'

let checks = 0
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`linkEnd: ${what}`)
  checks++
}

// Mid-match: no result yet (the rules' outcome is undefined while they run).
for (const phase of ['playing', 'destroyed', 'paused'] as MatchPhase[]) check(linkEnded(phase, undefined) === 'lost', `a close mid-match (${phase}) is a lost connection`)

// After the result: the results stay, for a win, a loss and a draw (null).
for (const [phase, outcome] of [
  ['victory', 0],
  ['defeat', 1],
  ['victory', null],
  ['defeat', null],
] as Array<[MatchPhase, number | null]>)
  check(linkEnded(phase, outcome) === 'stay', `a close during the results (${phase}, outcome ${outcome}) keeps them up`)

// The result and the close in one batch (a tab in the background, then back): the result is shown, never Connection lost.
for (const phase of ['playing', 'destroyed', 'paused'] as MatchPhase[]) {
  check(linkEnded(phase, 0) === 'result', `the result with the close (${phase}): the results are shown`)
  check(linkEnded(phase, null) === 'result', `a draw with the close (${phase}): the results are shown`)
}

console.log(`linkEnd ok (${checks} checks)`)
