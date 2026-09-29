import { createRng } from '../rng.ts'
import { chainTitle, createScoring, createStats, createTally, forget, type Stats, type Tally } from '../scoring.ts'
import { FFA } from './config.ts'
import { chooseErrand, chooseZone, distance, inside, ITEMS, placeWave, rollType, wants, type Errand, type Holder, type Item, type ItemType, type Point, type Zone } from './items.ts'

// Free for all rules: the match clock and its phases, every machine's life
// cycle (wreck, wait, respawn, protection), spawn choice, kills, assists and
// the statistics, streaks, multi-kills, revenge, pickups and their effects,
// hot zones, standings and the result. Pure: no rendering, physics or DOM —
// the match feeds it damage, wrecks, positions and fixed steps, and reads
// back modifiers and events. That keeps it portable to an authoritative
// server later. Contract: work/ffa/FFA_GAMEPLAY_SPEC.md. The statistics
// themselves are ../scoring.ts, shared with team deathmatch.

export { createStats, type Stats }

// What the rules need of a machine; the match's combatants are participants.
export interface Participant extends Holder {
  name: string
  stats: Stats
}

export type FfaPhase = 'preMatch' | 'active' | 'finalMinute' | 'overtime' | 'complete'
export type Life = 'alive' | 'protected' | 'destroyed' | 'pending' | 'respawning'

// Allowed moves (work/ffa/FFA_STATE_MACHINE.md); anything else is refused.
const PHASES: Record<FfaPhase, readonly FfaPhase[]> = {
  preMatch: ['active'],
  active: ['finalMinute', 'overtime', 'complete'],
  finalMinute: ['overtime', 'complete'],
  overtime: ['complete'],
  complete: [],
}
const LIVES: Record<Life, readonly Life[]> = {
  alive: ['destroyed'],
  protected: ['alive', 'destroyed'],
  destroyed: ['pending'],
  pending: ['respawning', 'destroyed'], // back to destroyed: cancelled by the end of the match
  respawning: ['protected'],
}

export type Effect = 'repair' | 'speed' | 'armor' | 'damage'
export type Effects = Record<Effect, number> // expiry on the match clock; off once it's past

// A machine as the rules see it; the Tally part (this life's hits, kill
// chain) is the statistics'.
export interface Contender extends Tally {
  life: Life
  respawnAt: number
  protectedUntil: number
  spawn: number // start of the current life, -1 for none
  spawnedAt: number
  effects: Effects
  errand: Errand // a bot's errand, rewritten in place
}

export type FfaEvent =
  | { type: 'phase'; phase: FfaPhase }
  | { type: 'kill'; killer: number; victim: number; assists: number[]; streak: number; milestone: string; multi: number; revenge: boolean; nemesis: boolean; shutdown: number } // nemesis: the victim was the killer's nemesis; shutdown: the streak it ended
  | { type: 'death'; victim: number } // wrecked with nobody to credit
  | { type: 'nemesis'; who: number; of: number } // `who` just became the nemesis of `of`
  | { type: 'respawn'; who: number; spawn: number }
  | { type: 'item'; who: number; item: Item }
  | { type: 'expired'; item: Item }
  | { type: 'wave'; count: number }
  | { type: 'zone'; zone: Zone | null }

export interface FfaOptions {
  starts: readonly Point[] // the arena's spawn points
  spots: readonly Point[] // where items can appear (validated by the match)
  zones: readonly Zone[] // hot-zone areas
  seed: number
}

export type FreeForAll = ReturnType<typeof createFreeForAll>

export const multiKillTitle = (chain: number) => chainTitle(chain, FFA.multiKill.titles)

export function createFreeForAll(participants: readonly Participant[], { starts, spots, zones, seed }: FfaOptions) {
  const n = participants.length
  const contender = (i: number): Contender => ({
    life: 'alive',
    respawnAt: 0,
    protectedUntil: 0,
    spawn: starts.length ? i % starts.length : -1, // the grid the match lines up on
    spawnedAt: FFA.preMatch,
    ...createTally(n),
    effects: { repair: 0, speed: 0, armor: 0, damage: 0 },
    errand: { x: 0, z: 0, urgent: false },
  })
  let random = createRng(seed)
  const lastUsed = starts.map(() => -Infinity) // per start
  const benched = starts.map(() => -Infinity) // spawn camping: out of use until
  const marks = starts.map((): number[] => []) // spawn camping: recent quick deaths
  let nextWave = FFA.items.firstWave // elapsed
  let nextZone = FFA.hotZone.first
  let nextItem = 1
  let dirty = true // standings need sorting

  const ffa = {
    seed,
    phase: 'preMatch' as FfaPhase,
    now: 0, // match clock, pre-match included
    overtimeAt: 0,
    winner: -1, // participant who took the match; -1 on a draw or while it runs
    draw: false,
    contenders: participants.map((_, i) => contender(i)),
    items: [] as Item[], // live ones only
    zone: null as Zone | null,
    zoneSpots: [] as number[], // spots inside the zone
    events: [] as FfaEvent[], // the match drains these every step
    order: participants.map((_, i) => i), // standings, best first (standings() sorts)
    feuds: [] as number[][], // [k][v]: kills k made on v since v last killed k — the statistics' own table (nemesisOf reads it)
    elapsed,
    remaining,
    overtimeLeft,
    tick,
    damage,
    kill,
    respawnDue,
    pickSpawn,
    respawned,
    standings,
    place,
    soleLeader,
    trailing,
    nemesisOf,
    speedFactor,
    targetValue,
    errand,
    reset,
  }
  const scoring = createScoring(participants, ffa.contenders, FFA)
  ffa.feuds = scoring.feuds

  // --- clock and phases --------------------------------------------------------

  function elapsed() {
    return Math.min(Math.max(ffa.now - FFA.preMatch, 0), FFA.duration)
  }
  function remaining() {
    return FFA.duration - elapsed()
  }
  function overtimeLeft() {
    return ffa.phase === 'overtime' ? Math.max(0, FFA.overtime - (ffa.now - ffa.overtimeAt)) : FFA.overtime
  }
  const fighting = () => ffa.phase === 'active' || ffa.phase === 'finalMinute' || ffa.phase === 'overtime'
  const over = () => ffa.phase === 'complete' // a call, so a check after complete() isn't narrowed away

  function setPhase(next: FfaPhase) {
    if (!PHASES[ffa.phase].includes(next)) return false
    ffa.phase = next
    ffa.events.push({ type: 'phase', phase: next })
    return true
  }

  function move(c: Contender, next: Life) {
    if (!LIVES[c.life].includes(next)) return false
    c.life = next
    return true
  }

  // One fixed step of match time: phases, protection, effects, hot zones,
  // item waves, expiry and pickups — in that order.
  function tick(dt: number) {
    if (over()) return
    ffa.now += dt
    if (ffa.phase === 'preMatch') {
      if (ffa.now < FFA.preMatch) return
      setPhase('active')
    }
    if (ffa.phase === 'active' && remaining() <= FFA.finalMinute) setPhase('finalMinute')
    if ((ffa.phase === 'active' || ffa.phase === 'finalMinute') && remaining() <= 0) expire()
    if (ffa.phase === 'overtime' && overtimeLeft() <= 0) complete(-1)
    if (over()) return
    for (let i = 0; i < n; i++) {
      const c = ffa.contenders[i]
      const p = participants[i]
      if (c.life === 'protected' && ffa.now >= c.protectedUntil) move(c, 'alive')
      if (c.effects.repair > ffa.now && p.alive) p.health = Math.min(p.maxHealth, p.health + FFA.items.repair.rate * dt)
    }
    if (ffa.phase !== 'overtime') {
      if (zones.length && elapsed() >= nextZone) {
        openZone()
        nextZone += FFA.hotZone.duration
      }
      if (elapsed() >= nextWave) {
        wave()
        nextWave += FFA.items.waveInterval
      }
    }
    expireItems()
    collect()
  }

  // The clock hit 00:00: one leader takes it, a tie goes to overtime. Waits
  // carried into overtime are cut so the tied can get back into it.
  function expire() {
    const leader = soleLeader()
    if (leader >= 0) return complete(leader)
    if (!setPhase('overtime')) return
    ffa.overtimeAt = ffa.now
    for (const c of ffa.contenders) if (c.life === 'pending') c.respawnAt = Math.min(c.respawnAt, ffa.now + FFA.respawn.overtime)
  }

  // Ends the match (winner -1: a draw) and clears everything temporary:
  // pending respawns, protection, effects, damage attribution, items, zone.
  function complete(winner: number) {
    if (!setPhase('complete')) return
    ffa.winner = winner
    ffa.draw = winner < 0
    for (const c of ffa.contenders) {
      if (c.life === 'pending') move(c, 'destroyed')
      if (c.life === 'protected') move(c, 'alive')
      c.protectedUntil = 0
      c.chain = 0
      clearEffects(c)
      forget(c)
    }
    ffa.items.length = 0
    ffa.zone = null
    ffa.zoneSpots = []
    dirty = true
  }

  const clearEffects = (c: Contender) => {
    c.effects.repair = c.effects.speed = c.effects.armor = c.effects.damage = 0
  }

  // --- combat -------------------------------------------------------------------

  // Hull a hit actually takes (0: none) once the attacker's damage boost and
  // the victim's protection or armor (the stronger one) apply; recorded for
  // assists and the statistics. The match subtracts it. A destroyed attacker
  // does no damage, so nothing scores after its own death.
  function damage(attacker: number, victim: number, amount: number) {
    const a = participants[attacker]
    const v = participants[victim]
    if (!fighting() || !a.alive || !v.alive || !(amount > 0)) return 0
    const hit = ffa.contenders[victim]
    const shield = hit.life === 'protected' && ffa.now < hit.protectedUntil ? FFA.protection.reduction : 0
    const armor = hit.effects.armor > ffa.now ? FFA.items.armor.reduction : 0
    const boost = ffa.contenders[attacker].effects.damage > ffa.now ? FFA.items.damage.factor : 1
    const dealt = Math.min(v.health, amount * boost * (1 - Math.max(shield, armor)))
    if (dealt <= 0) return 0
    scoring.hit(attacker, victim, dealt, ffa.now)
    dirty = true
    return dealt
  }

  // The victim's hull reached 0 and the match has wrecked it; `killer` landed
  // the hit (-1: nobody). Scores it, then schedules the respawn — or, in
  // overtime, may end the match. False if the victim was already down.
  function kill(victim: number, killer: number) {
    const c = ffa.contenders[victim]
    if ((c.life !== 'alive' && c.life !== 'protected') || !move(c, 'destroyed')) return false
    if (!fighting()) return true // can't happen through damage(); nothing to score or schedule
    const ended = scoring.death(victim)
    c.protectedUntil = 0
    clearEffects(c)
    if (ffa.now - c.spawnedAt <= FFA.spawn.campWindow) mark(c.spawn)
    const credited = killer >= 0 && killer !== victim && participants[killer].alive
    if (credited) {
      ffa.events.push({ type: 'kill', ...scoring.credit(killer, victim, ended, ffa.now) })
      if (scoring.against(killer, victim) === FFA.nemesis) ffa.events.push({ type: 'nemesis', who: killer, of: victim })
    } else ffa.events.push({ type: 'death', victim })
    forget(c)
    dirty = true
    if (ffa.phase === 'overtime' && credited && soleLeader() >= 0) complete(soleLeader())
    if (over()) return true
    c.respawnAt = ffa.now + (ffa.phase === 'overtime' ? FFA.respawn.overtime : FFA.respawn.phases.find((phase) => elapsed() < phase.before)!.delay)
    move(c, 'pending')
    return true
  }

  // The rival with the most unanswered kills on `victim`, once that reaches FFA.nemesis; -1 for none.
  function nemesisOf(victim: number) {
    return scoring.nemesisOf(victim)
  }

  // --- respawn ------------------------------------------------------------------

  // Everyone, the player included, goes back in the moment the wait ends.
  function respawnDue(i: number) {
    const c = ffa.contenders[i]
    return c.life === 'pending' && ffa.now >= c.respawnAt
  }

  // Back in at `start`: protected for a moment, with a clean slate of damage.
  // The match places the car once this agrees.
  function respawned(i: number, start: number) {
    const c = ffa.contenders[i]
    if (!respawnDue(i) || !move(c, 'respawning')) return false
    c.spawn = start
    c.spawnedAt = ffa.now
    c.protectedUntil = ffa.now + FFA.protection.duration
    forget(c)
    if (start >= 0) lastUsed[start] = ffa.now
    move(c, 'protected')
    ffa.events.push({ type: 'respawn', who: i, spawn: start })
    return true
  }

  // The safest start for `who` (see the spec's spawn selection). `sees(rival,
  // at)`: a clear line from that rival to the start. Starts that are occupied
  // (any car, wrecks included) or benched for spawn camping are passed over,
  // unless that leaves none.
  function pickSpawn(who: number, sees: (rival: number, at: Point) => boolean) {
    let best = -1
    let bestScore = -Infinity
    for (const strict of [true, false]) {
      for (let s = 0; s < starts.length; s++) {
        if (strict && (benched[s] > ffa.now || occupied(who, starts[s]))) continue
        const score = scoreSpawn(who, s, sees)
        if (score > bestScore) {
          best = s
          bestScore = score
        }
      }
      if (best >= 0) break
    }
    return best
  }

  function occupied(who: number, at: Point) {
    for (let i = 0; i < n; i++) if (i !== who && distance(participants[i].position, at) < FFA.spawn.occupied) return true
    return false
  }

  function scoreSpawn(who: number, s: number, sees: (rival: number, at: Point) => boolean) {
    const t = FFA.spawn
    const at = starts[s]
    let nearest = Infinity
    let total = 0
    let rivals = 0
    let watching = 0
    let crowd = 0
    for (let i = 0; i < n; i++) {
      if (i === who || !participants[i].alive) continue
      const d = distance(participants[i].position, at)
      nearest = Math.min(nearest, d)
      total += d
      rivals++
      if (d <= t.crowdRadius) crowd++
      if (d <= t.sightRange && sees(i, at)) watching++
    }
    let score = Math.min(nearest, t.nearCap) + t.averageWeight * (rivals ? Math.min(total / rivals, t.averageCap) : t.averageCap)
    score -= t.sightPenalty * watching + t.crowdPenalty * crowd
    if (ffa.now - lastUsed[s] < t.recent) score -= t.recentPenalty
    if (inside(ffa.zone, at)) score -= t.hotZonePenalty
    return score
  }

  // A death soon after spawning marks the start; enough marks bench it.
  function mark(start: number) {
    if (start < 0) return
    const list = marks[start]
    list.push(ffa.now)
    while (ffa.now - list[0] > FFA.spawn.campMemory) list.shift()
    if (list.length < FFA.spawn.campDeaths) return
    benched[start] = ffa.now + FFA.spawn.cooldown
    list.length = 0
  }

  // --- standings ----------------------------------------------------------------

  // Most kills first; ties by combat score, fewer deaths, then grid order.
  const byRank = (a: number, b: number) => {
    const sa = participants[a].stats
    const sb = participants[b].stats
    return sb.kills - sa.kills || sb.combatScore - sa.combatScore || sa.deaths - sb.deaths || a - b
  }

  function standings() {
    if (dirty) ffa.order.sort(byRank)
    dirty = false
    return ffa.order
  }

  function topKills() {
    let top = 0
    for (const p of participants) top = Math.max(top, p.stats.kills)
    return top
  }

  // The one machine with the most kills; -1 while two or more share it.
  function soleLeader() {
    let leader = -1
    let top = -1
    for (let i = 0; i < n; i++) {
      const kills = participants[i].stats.kills
      if (kills > top) {
        top = kills
        leader = i
      } else if (kills === top) leader = -1
    }
    return leader
  }

  // Far enough behind the leader for the comeback weighting.
  function trailing(i: number) {
    return topKills() - participants[i].stats.kills >= FFA.comeback.gap
  }

  // 1-based; in a draw everyone tied for the most kills shares first.
  function place(i: number) {
    if (ffa.draw && participants[i].stats.kills === topKills()) return 1
    return standings().indexOf(i) + 1
  }

  // --- items, effects, hot zone ------------------------------------------------------

  function openZone() {
    const zone = chooseZone(random, zones, ffa.zone, trailingPositions())
    ffa.zone = zone
    ffa.zoneSpots = []
    for (let i = 0; i < spots.length; i++) if (inside(zone, spots[i])) ffa.zoneSpots.push(i)
    ffa.events.push({ type: 'zone', zone })
    for (const spot of placeWave(random, { spots, taken, cars: livePositions(), trailing: [], zone, count: 0, zoneCount: FFA.hotZone.drops })) addItem(spot)
  }

  function wave() {
    const zone = ffa.zone
    let count = 0
    for (const spot of placeWave(random, { spots, taken, cars: livePositions(), trailing: trailingPositions(), zone, count: FFA.items.perWave, zoneCount: zone ? FFA.hotZone.bonusItems : 0 })) {
      if (addItem(spot)) count++
    }
    ffa.events.push({ type: 'wave', count })
  }

  const taken = (spot: number) => ffa.items.some((item) => item.spot === spot)
  const livePositions = () => participants.filter((p) => p.alive).map((p) => p.position)
  const trailingPositions = () => participants.filter((p, i) => p.alive && trailing(i)).map((p) => p.position)

  function addItem(spot: number) {
    if (ffa.items.length >= FFA.items.maxActive) return false
    const at = spots[spot]
    const hot = inside(ffa.zone, at)
    const type = rollType(random, hot ? FFA.hotZone.rarity : FFA.items.rarity)
    const [shortest, longest] = FFA.items.ttl
    ffa.items.push({ id: nextItem++, type, rarity: ITEMS[type].rarity, x: at.x, z: at.z, spot, born: ffa.now, expires: ffa.now + shortest + random() * (longest - shortest), state: 'spawned', hot })
    return true
  }

  function expireItems() {
    for (let k = ffa.items.length - 1; k >= 0; k--) {
      const item = ffa.items[k]
      if (ffa.now < item.expires) continue
      item.state = 'expired'
      ffa.items.splice(k, 1)
      ffa.events.push({ type: 'expired', item })
    }
  }

  // Every item goes to the first machine in grid order within reach that wants it.
  function collect() {
    const reach = FFA.items.pickupRadius
    for (let k = ffa.items.length - 1; k >= 0; k--) {
      const item = ffa.items[k]
      for (let i = 0; i < n; i++) {
        const p = participants[i]
        if (!p.alive || distance(p.position, item) > reach || !wants(item.type, p)) continue
        item.state = 'consumed'
        ffa.items.splice(k, 1)
        apply(i, item.type)
        p.stats.itemsCollected++
        p.stats.combatScore += FFA.score.item
        dirty = true
        ffa.events.push({ type: 'item', who: i, item })
        break
      }
    }
  }

  // Instant items change the machine now; timed ones set (or restart) an
  // expiry — never stacking a strength, never touching a base value.
  function apply(i: number, type: ItemType) {
    const p = participants[i]
    const effects = ffa.contenders[i].effects
    const t = FFA.items
    if (type === 'health') p.health = Math.min(p.maxHealth, p.health + t.health.amount)
    else if (type === 'ammo') {
      p.weapon.ammo = Math.min(p.weapon.spec.magazine, p.weapon.ammo + t.ammo.magazines * p.weapon.spec.magazine)
      p.weapon.reload = 0
    } else effects[type] = Math.max(effects[type], ffa.now + t[type].duration)
  }

  function speedFactor(i: number) {
    return ffa.contenders[i].effects.speed > ffa.now ? FFA.items.speed.factor : 1
  }

  // --- bots ---------------------------------------------------------------------

  // How near `rival` looks to `bot` choosing a target: protected rivals are
  // skipped, the sole leader looks nearer, a trailing bot reaches further.
  function targetValue(bot: number, rival: number, d: number) {
    const c = ffa.contenders[rival]
    if (c.life === 'protected' && ffa.now < c.protectedUntil) return Infinity
    if (rival === soleLeader()) d -= FFA.bots.leaderBias
    return trailing(bot) ? d / FFA.bots.trailingReach : d
  }

  // Where the bot would drive when it isn't fighting (items.ts chooseErrand).
  function errand(bot: number) {
    return chooseErrand(participants[bot], bot, trailing(bot), ffa.items, spots, ffa.zone, ffa.zoneSpots, ffa.now, ffa.contenders[bot].errand)
  }

  // --- restart ------------------------------------------------------------------

  // A fresh match on the same participants: clock, phases, statistics,
  // relationships, spawn history, items, zone and events all start over.
  function reset(next: number) {
    ffa.seed = next
    random = createRng(next)
    scoring.reset()
    ffa.phase = 'preMatch'
    ffa.now = ffa.overtimeAt = 0
    ffa.winner = -1
    ffa.draw = false
    ffa.zone = null
    ffa.zoneSpots = []
    ffa.contenders.forEach((c, i) => Object.assign(c, contender(i)))
    ffa.items.length = 0
    ffa.events.length = 0
    for (const p of participants) Object.assign(p.stats, createStats())
    ffa.order.forEach((_, k) => (ffa.order[k] = k))
    lastUsed.fill(-Infinity)
    benched.fill(-Infinity)
    for (const list of marks) list.length = 0
    nextWave = FFA.items.firstWave
    nextZone = FFA.hotZone.first
    dirty = true
  }

  return ffa
}
