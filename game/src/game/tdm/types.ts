import type { Credit, Stats, Tally } from '../scoring.ts'

// Team deathmatch domain types, shared by the rules and the team AI.

export interface Point {
  x: number
  z: number
}

// What the rules need of a machine; the match's combatants are members.
export interface Member {
  name: string
  team: number // 0 or 1
  alive: boolean
  health: number
  maxHealth: number
  position: Point
  stats: Stats
}

// Match states (work/tdm/TDM_STATE_MACHINE.md).
export type TdmPhase = 'preMatch' | 'active' | 'overtime' | 'complete'
// A machine's life cycle, the same as free for all's.
export type Life = 'alive' | 'protected' | 'destroyed' | 'pending' | 'respawning'

// A machine as the rules see it; the Tally part is the statistics'.
export interface Contender extends Tally {
  life: Life
  respawnAt: number
  protectedUntil: number
  spawn: number // start of the current life, -1 before the first respawn
  spawnedAt: number
  errand: Errand // a bot's errand, rewritten in place
}

// Somewhere a bot drives when it isn't fighting (`urgent`: even with a target, still shooting at it on the way).
export interface Errand extends Point {
  urgent: boolean
}

// What a bot is doing for its team (reported, not stored: it follows from the battlefield).
export type Stance = 'attack' | 'support' | 'flank' | 'defend'

export type TdmEvent =
  | { type: 'phase'; phase: TdmPhase }
  | { type: 'finalMinute' }
  | ({ type: 'kill'; team: number } & Credit) // team: the killer's, whose score just went up
  | { type: 'death'; victim: number } // wrecked with nobody to credit
  | { type: 'respawn'; who: number; spawn: number }

export interface TdmOptions {
  starts: readonly Point[] // every start a machine can respawn at
  homes: readonly [Point, Point] // each team's base: where its own half is
}
