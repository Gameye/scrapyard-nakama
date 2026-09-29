import type { WeaponId } from './combat.ts'
import type { VehicleId } from './vehicle/vehicles.ts'

// What a player takes into a match: the garage edits it, the match builds the
// machine from it. Plain ids into the registries (VEHICLES, WEAPONS), so it
// can be kept or sent to a server as it is. More slots (a Super weapon) are
// more fields here.
export interface Loadout {
  vehicle: VehicleId
  weapon: WeaponId // the roof turret
}

export const DEFAULT_LOADOUT: Loadout = { vehicle: 'razor', weapon: 'minigun' }
