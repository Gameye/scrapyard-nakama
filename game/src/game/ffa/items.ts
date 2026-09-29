import { FFA } from './config.ts'

// Free for all pickups: the catalogue, rarity rolls, where a wave lands, which
// hot zone opens next, and what a bot knows and wants. Stateless helpers —
// rules.ts owns the live items and calls these. (Imports carry .ts: the
// self-check runs this folder under plain node.)

export type ItemType = 'health' | 'repair' | 'ammo' | 'speed' | 'armor' | 'damage'
export type Rarity = 'common' | 'rare' | 'epic'

export const ITEMS: Record<ItemType, { label: string; rarity: Rarity; color: string }> = {
  health: { label: 'Health', rarity: 'common', color: '#4dff7c' },
  repair: { label: 'Repair', rarity: 'common', color: '#3fd7ff' },
  ammo: { label: 'Ammo', rarity: 'common', color: '#ffae3d' },
  speed: { label: 'Speed boost', rarity: 'rare', color: '#ffe23d' },
  armor: { label: 'Armor', rarity: 'rare', color: '#5b8cff' },
  damage: { label: 'Damage boost', rarity: 'epic', color: '#ff2f5f' },
}
export const RARITY_COLORS: Record<Rarity, string> = { common: '#f2ece0', rare: '#4f8cff', epic: '#b84bff' }

const RARITIES: Rarity[] = ['common', 'rare', 'epic']
const TYPES = Object.keys(ITEMS) as ItemType[]
const OF_RARITY = Object.fromEntries(RARITIES.map((rarity) => [rarity, TYPES.filter((type) => ITEMS[type].rarity === rarity)])) as Record<Rarity, ItemType[]>

export interface Point {
  x: number
  z: number
}

// A named area of the map a hot zone can open over.
export interface Zone extends Point {
  name: string
  radius: number
}

export interface Item extends Point {
  id: number
  type: ItemType
  rarity: Rarity
  spot: number // index into the spot list: one item per spot
  born: number // match clock
  expires: number
  state: 'spawned' | 'consumed' | 'expired'
  hot: boolean // landed inside the hot zone
}

// What an item needs to know about a machine.
export interface Holder {
  alive: boolean
  health: number
  maxHealth: number
  position: Point
  weapon: { ammo: number; reload: number; spec: { magazine: number } }
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)
export const inside = (zone: Zone | null, p: Point) => !!zone && distance(zone, p) <= zone.radius

// Index picked with probability proportional to its weight; -1 when every weight is 0.
export function weighted(random: () => number, weights: readonly number[]) {
  let total = 0
  for (const weight of weights) total += weight
  if (total <= 0) return -1
  let roll = random() * total
  let last = -1
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue
    roll -= weights[i]
    last = i
    if (roll < 0) return i
  }
  return last // rounding at the very top of the range
}

// Rarity by the table's weights, then any type of that rarity.
export function rollType(random: () => number, table: Record<Rarity, number>): ItemType {
  const types = OF_RARITY[RARITIES[weighted(random, [table.common, table.rare, table.epic])]]
  return types[Math.floor(random() * types.length)]
}

// A machine takes an item only if it does something for it: health and
// repair need a damaged hull, ammo a magazine that isn't full; boosts always.
export function wants(type: ItemType, holder: Holder) {
  if (type === 'health' || type === 'repair') return holder.health < holder.maxHealth
  if (type === 'ammo') return holder.weapon.ammo < holder.weapon.spec.magazine
  return true
}

export interface WaveInput {
  spots: readonly Point[]
  taken: (spot: number) => boolean // holds a live item already
  cars: readonly Point[] // live machines
  trailing: readonly Point[] // live machines trailing the leader
  zone: Zone | null
  count: number // items anywhere
  zoneCount: number // extra items inside the zone
}

// Spots for one wave, zone extras first. Weighted random over free spots:
// x hotZone.weight inside the zone, x comeback.weight near a trailing machine.
// Never within clearOfCars of a live machine; spacing between the wave's own
// items is dropped only when nothing else is left. Fewer spots than asked
// when the map runs out.
export function placeWave(random: () => number, { spots, taken, cars, trailing, zone, count, zoneCount }: WaveInput) {
  const picked: number[] = []
  const weights = new Array<number>(spots.length)
  const place = (zoneOnly: boolean) => {
    for (const spaced of [true, false]) {
      for (let i = 0; i < spots.length; i++) {
        const spot = spots[i]
        const free =
          !taken(i) &&
          !picked.includes(i) &&
          (!zoneOnly || inside(zone, spot)) &&
          cars.every((car) => distance(car, spot) >= FFA.items.clearOfCars) &&
          (!spaced || picked.every((other) => distance(spots[other], spot) >= FFA.items.spacing))
        weights[i] = free ? (inside(zone, spot) ? FFA.hotZone.weight : 1) * (trailing.some((t) => distance(t, spot) <= FFA.comeback.radius) ? FFA.comeback.weight : 1) : 0
      }
      const choice = weighted(random, weights)
      if (choice >= 0) return picked.push(choice)
    }
  }
  if (zone) for (let k = 0; k < zoneCount; k++) place(true)
  for (let k = 0; k < count; k++) place(false)
  return picked
}

// The next hot zone: never the one just closing (unless it's the only one);
// each trailing machine near a zone adds to its weight.
export function chooseZone(random: () => number, zones: readonly Zone[], previous: Zone | null, trailing: readonly Point[]) {
  const weights = zones.map((zone) => (zone === previous && zones.length > 1 ? 0 : 1 + FFA.comeback.zoneWeight * trailing.filter((t) => distance(t, zone) <= FFA.comeback.radius * 1.5).length))
  const choice = weighted(random, weights)
  return choice < 0 ? null : zones[choice]
}

// A hot-zone spot for a bot to drive to: each bot starts at its own place in
// the zone's list and moves along it every `patrol` seconds, skipping a spot
// it's already on, so it keeps working the zone's streets.
function patrol(bot: Holder, index: number, spots: readonly Point[], zone: Zone, zoneSpots: readonly number[], now: number): Point {
  const first = index + Math.floor(now / FFA.bots.patrol)
  for (let k = 0; k < zoneSpots.length; k++) {
    const spot = spots[zoneSpots[(first + k) % zoneSpots.length]]
    if (distance(bot.position, spot) > FFA.bots.arrive) return spot
  }
  return zone
}

// Somewhere a bot would drive when it isn't busy fighting (`urgent`: go even mid-fight).
export interface Errand extends Point {
  urgent: boolean
}

// A bot's errand from what it knows: items within its sense range only (the
// radius the player's minimap shows), the hot zone (announced to everyone).
// Low on hull, health it knows about comes first, even mid-fight; otherwise
// the nearest item it wants; otherwise, if it cares for the zone, a patrol of
// the zone's streets. Writes `out`; null for none.
export function chooseErrand(bot: Holder, index: number, trailing: boolean, items: readonly Item[], spots: readonly Point[], zone: Zone | null, zoneSpots: readonly number[], now: number, out: Errand): Errand | null {
  const reach = FFA.items.senseRange * (trailing ? FFA.bots.trailingReach : 1)
  const low = bot.health < bot.maxHealth * FFA.bots.lowHealth
  let best: Item | null = null
  let bestDistance = reach
  let urgent = false
  for (const item of items) {
    if (!wants(item.type, bot)) continue
    const healing = item.type === 'health' || item.type === 'repair'
    const d = distance(bot.position, item)
    if (d > reach || (urgent && !healing)) continue
    if ((low && healing && !urgent) || d < bestDistance) {
      best = item
      bestDistance = d
      urgent = low && healing
    }
  }
  const curious = trailing || ((index * 0.618034) % 1) < FFA.bots.zoneInterest // golden-ratio spread over the grid
  const target = best ?? (zone && curious ? patrol(bot, index, spots, zone, zoneSpots, now) : null)
  if (!target) return null
  out.x = target.x
  out.z = target.z
  out.urgent = urgent
  return out
}
