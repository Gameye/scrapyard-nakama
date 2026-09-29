import * as THREE from 'three'
import { createRng } from './rng'

const ARENA_SIZE = 60
const WALL_HEIGHT = 4
const SCRAP_COUNT = 20

export function generateArena(seed = 1): THREE.Group {
  const rng = createRng(seed)
  const arena = new THREE.Group()
  arena.name = 'arena'

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
    new THREE.MeshStandardMaterial({ color: '#2b2521', roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  arena.add(ground)

  const half = ARENA_SIZE / 2
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#4a3b2f', roughness: 0.9, metalness: 0.2 })
  const wallSpecs: Array<[number, number, number, number, number]> = [
    [0, WALL_HEIGHT / 2, -half, ARENA_SIZE, 1],
    [0, WALL_HEIGHT / 2, half, ARENA_SIZE, 1],
    [-half, WALL_HEIGHT / 2, 0, 1, ARENA_SIZE],
    [half, WALL_HEIGHT / 2, 0, 1, ARENA_SIZE],
  ]
  for (const [x, y, z, w, d] of wallSpecs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMaterial)
    wall.position.set(x, y, z)
    wall.castShadow = true
    wall.receiveShadow = true
    arena.add(wall)
  }

  const scrapMaterial = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.8, metalness: 0.3 })
  for (let i = 0; i < SCRAP_COUNT; i++) {
    const size = 0.8 + rng() * 2
    const scrap = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), scrapMaterial)
    const radius = 8 + rng() * (half - 10)
    const angle = rng() * Math.PI * 2
    scrap.position.set(Math.cos(angle) * radius, size / 2, Math.sin(angle) * radius)
    scrap.rotation.y = rng() * Math.PI
    scrap.castShadow = true
    scrap.receiveShadow = true
    arena.add(scrap)
  }

  return arena
}
