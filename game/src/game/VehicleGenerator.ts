import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { createRng } from './rng'
import { createWeatheredMetalTexture } from './proceduralTexture'

export interface VehicleOptions {
  bodyColor?: string
  seed?: number
}

const LENGTH = 4.2
const WIDTH = 1.9
const WHEEL_RADIUS = 0.42
const WHEEL_WIDTH = 0.32
const TRACK_X = WIDTH / 2 - 0.12
const AXLE_Z = LENGTH / 2 - 0.55

const WHEEL_POSITIONS: Array<[string, number, number]> = [
  ['fl', -TRACK_X, AXLE_Z],
  ['fr', TRACK_X, AXLE_Z],
  ['rl', -TRACK_X, -AXLE_Z],
  ['rr', TRACK_X, -AXLE_Z],
]

export function generateVehicle({ bodyColor = '#4b5245', seed = 1 }: VehicleOptions = {}): THREE.Group {
  const rng = createRng(seed)
  const vehicle = new THREE.Group()
  vehicle.name = 'vehicle'

  const bodyWeathered = createWeatheredMetalTexture(seed, bodyColor)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: bodyWeathered.map,
    roughnessMap: bodyWeathered.roughnessMap,
    roughness: 0.6,
    metalness: 0.35,
  })

  const armorWeathered = createWeatheredMetalTexture(seed + 100, '#33312e')
  const armorMaterial = new THREE.MeshStandardMaterial({
    map: armorWeathered.map,
    roughnessMap: armorWeathered.roughnessMap,
    roughness: 0.75,
    metalness: 0.5,
  })

  const cageMaterial = new THREE.MeshStandardMaterial({ color: '#2a2a28', roughness: 0.4, metalness: 0.8 })
  const rubberMaterial = new THREE.MeshStandardMaterial({ color: '#0d0d0d', roughness: 0.95 })
  const rimMaterial = new THREE.MeshStandardMaterial({ color: '#6b6b6b', roughness: 0.35, metalness: 0.8 })
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: '#2b3a3d',
    roughness: 0.35,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  })
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: '#fff4c2',
    emissive: '#fff4c2',
    emissiveIntensity: 1.4,
  })
  const metalMaterial = new THREE.MeshStandardMaterial({ color: '#4a4a48', roughness: 0.5, metalness: 0.85 })

  function addMesh(geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], rotation?: [number, number, number]) {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    if (rotation) mesh.rotation.set(...rotation)
    mesh.castShadow = true
    mesh.receiveShadow = true
    vehicle.add(mesh)
    return mesh
  }

  // Chassis / hood / cabin
  addMesh(new RoundedBoxGeometry(WIDTH * 0.92, 0.5, LENGTH * 0.88, 3, 0.06), bodyMaterial, [0, 0.62, 0])
  addMesh(new RoundedBoxGeometry(WIDTH * 0.8, 0.32, LENGTH * 0.26, 3, 0.05), bodyMaterial, [0, 0.82, LENGTH * 0.32], [0.04, 0, 0])
  addMesh(new RoundedBoxGeometry(WIDTH * 0.78, 0.55, LENGTH * 0.34, 3, 0.07), bodyMaterial, [0, 0.98, -LENGTH * 0.06])

  // Windshield + side windows
  const windshield = addMesh(new THREE.PlaneGeometry(WIDTH * 0.68, 0.4), glassMaterial, [0, 1.18, LENGTH * 0.1])
  windshield.rotation.x = -Math.PI / 2 + 1.15
  for (const side of [-1, 1]) {
    const window = addMesh(new THREE.PlaneGeometry(LENGTH * 0.22, 0.3), glassMaterial, [side * WIDTH * 0.39, 1.05, -LENGTH * 0.06])
    window.rotation.y = Math.PI / 2
  }

  // Roll cage: 4 corner posts + top rails, each post lightly jittered for a welded look
  const cageTop = 1.62
  const cageCorners: Array<[number, number]> = [
    [-WIDTH * 0.36, LENGTH * 0.12],
    [WIDTH * 0.36, LENGTH * 0.12],
    [-WIDTH * 0.36, -LENGTH * 0.22],
    [WIDTH * 0.36, -LENGTH * 0.22],
  ]
  for (const [x, z] of cageCorners) {
    addMesh(
      new THREE.CylinderGeometry(0.035, 0.035, cageTop - 1.15, 8),
      cageMaterial,
      [x, (cageTop + 1.15) / 2, z],
      [(rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.05],
    )
  }
  for (const side of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.06, 0.06, LENGTH * 0.36), cageMaterial, [side * WIDTH * 0.36, cageTop, -LENGTH * 0.05])
  }
  addMesh(new THREE.BoxGeometry(WIDTH * 0.74, 0.06, 0.06), cageMaterial, [0, cageTop, LENGTH * 0.12])

  // Roof-mounted weapon: mount plate + 4-barrel cluster + ammo box behind
  const weaponMountZ = LENGTH * 0.1
  addMesh(new THREE.BoxGeometry(0.5, 0.1, 0.4), cageMaterial, [0, cageTop + 0.05, weaponMountZ])
  const barrelLength = 0.9
  for (const dx of [-0.09, -0.03, 0.03, 0.09]) {
    addMesh(
      new THREE.CylinderGeometry(0.03, 0.03, barrelLength, 10),
      metalMaterial,
      [dx, cageTop + 0.13, weaponMountZ + barrelLength / 2 - 0.1],
      [Math.PI / 2, 0, 0],
    )
  }
  addMesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), armorMaterial, [0, cageTop + 0.18, weaponMountZ - 0.25])

  // Bumpers + grille + headlights
  addMesh(new RoundedBoxGeometry(WIDTH * 0.95, 0.28, 0.22, 2, 0.04), armorMaterial, [0, 0.55, LENGTH / 2 + 0.05])
  addMesh(new THREE.BoxGeometry(WIDTH * 0.5, 0.22, 0.05), cageMaterial, [0, 0.62, LENGTH / 2 + 0.15])
  for (const side of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.18, 0.14, 0.06), headlightMaterial, [side * WIDTH * 0.32, 0.65, LENGTH / 2 + 0.17])
  }
  addMesh(new RoundedBoxGeometry(WIDTH * 0.95, 0.26, 0.2, 2, 0.04), armorMaterial, [0, 0.5, -LENGTH / 2 - 0.04])

  // Front ram spikes, welded onto the bumper face with uneven lengths
  const spikeCount = 5
  for (let i = 0; i < spikeCount; i++) {
    const t = i / (spikeCount - 1)
    const x = (t - 0.5) * WIDTH * 0.85
    const spikeLength = 0.35 + rng() * 0.2
    addMesh(
      new THREE.ConeGeometry(0.055, spikeLength, 6),
      metalMaterial,
      [x, 0.42 + (rng() - 0.5) * 0.05, LENGTH / 2 + 0.16 + spikeLength / 2],
      [Math.PI / 2, 0, 0],
    )
  }

  // Side armor plates — two mismatched sections per side
  for (const side of [-1, 1]) {
    for (const zOffset of [LENGTH * 0.18, -LENGTH * 0.2]) {
      addMesh(
        new THREE.BoxGeometry(0.06, 0.35, LENGTH * 0.28),
        armorMaterial,
        [side * (WIDTH * 0.48 + 0.02), 0.58 + (rng() - 0.5) * 0.04, zOffset],
        [0, 0, side * (rng() - 0.5) * 0.06],
      )
    }
  }

  // Exhaust, mirrors, antenna
  addMesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12),
    cageMaterial,
    [WIDTH * 0.44, 0.5, -LENGTH * 0.42],
    [0, 0, Math.PI / 2],
  )
  for (const side of [-1, 1]) {
    addMesh(new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6), cageMaterial, [side * WIDTH * 0.42, 1.15, LENGTH * 0.18])
    addMesh(new THREE.BoxGeometry(0.05, 0.12, 0.18), armorMaterial, [side * WIDTH * 0.48, 1.2, LENGTH * 0.18])
  }
  addMesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 6), cageMaterial, [WIDTH * 0.34, cageTop + 0.3, -LENGTH * 0.2])

  // Wheels — tire + inset rim, named per corner for future independent rotation
  const tireGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24)
  const rimGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.5, WHEEL_RADIUS * 0.5, WHEEL_WIDTH * 1.01, 16)
  for (const [id, x, z] of WHEEL_POSITIONS) {
    const wheel = new THREE.Group()
    wheel.name = `wheel_${id}`
    const tire = new THREE.Mesh(tireGeometry, rubberMaterial)
    tire.rotation.z = Math.PI / 2
    tire.castShadow = true
    const rim = new THREE.Mesh(rimGeometry, rimMaterial)
    rim.rotation.z = Math.PI / 2
    wheel.add(tire, rim)
    wheel.position.set(x, WHEEL_RADIUS, z)
    vehicle.add(wheel)
  }

  return vehicle
}
