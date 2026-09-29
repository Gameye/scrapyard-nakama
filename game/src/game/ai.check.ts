// Self-check for the bots' router. Run: node src/game/ai.check.ts
import * as THREE from 'three'
import { routesTo } from './ai.ts'

const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`router: ${what}`)
}

// A 100 m square with one diagonal road; node 4 is cut off.
//   0 --- 1
//   |   / |
//   3 --- 2      4
const at = (x: number, z: number) => new THREE.Vector3(x, 0, z)
const nav = { nodes: [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(300, 300)], links: [[1, 3], [0, 2, 3], [1, 3], [0, 2, 1], []] }
const { cost, next } = routesTo(nav, 3)
check(next[3] === -1, 'the end has no next hop')
check(next[1] === 3 && Math.abs(cost[1] - Math.hypot(100, 100)) < 1e-9, 'the diagonal beats going round')
check(next[0] === 3 && next[2] === 3, 'neighbours drive straight there')
check(cost[4] === Infinity && next[4] === -1, 'a cut-off node has no route')
console.log('router ok')
