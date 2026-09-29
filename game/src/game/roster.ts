import { armBot, type Skill } from './ai'
import type { Arena } from './arena/arena'
import type { WeaponSpec } from './combat'
import { MODES, type Mode } from './modes'
import { createRng } from './rng'
import type { Recruit } from './simulation'
import type { VehicleId } from './vehicle/vehicles'

// Who takes each seat of a match's line-up, the same for a practice match
// (match.ts: the player in seat 0) and an online room (server/room.ts:
// bots in every seat until people take them over). Seats and starts come
// from the mode's lineUp; each bot draws its gun from the garage's roster
// with the match seed, in seat order, its skill scaling that gun.

export const BOT_NAMES = ['Rustjaw', 'Widowmaker', 'Grinder', 'Hexbolt', 'Carrion', 'Buzzkill', 'Tetanus', 'Sawtooth']
export const BOT_VEHICLE: VehicleId = 'razor'

// Seat 1 is the first name; seat 0 (a bot only online) the last.
export const botName = (seat: number) => BOT_NAMES[(seat + BOT_NAMES.length - 1) % BOT_NAMES.length]

// Whoever drives seat 0 in person (practice: the player, with the garage loadout).
export interface Driver {
  name: string
  vehicle: VehicleId
  weapon: WeaponSpec
}

export function recruits(kind: Mode, arena: Arena, seed: number, skill: Skill, player?: Driver): Recruit[] {
  const arsenal = createRng(seed ^ 0x2545f491) // the bots' guns, apart from the simulation's stream
  return MODES[kind].lineUp(arena).map(({ team, spawn }, id) =>
    id === 0 && player
      ? { name: player.name, team, seed: 1, spawn, vehicle: player.vehicle, weapon: player.weapon, bot: false }
      : { name: botName(id), team, seed: id + 1, spawn, vehicle: BOT_VEHICLE, weapon: armBot(skill, arsenal), bot: true, skill },
  )
}
