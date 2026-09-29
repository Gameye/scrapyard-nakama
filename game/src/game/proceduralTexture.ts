import * as THREE from 'three'
import { createRng } from './rng'

interface WeatheredTextureOptions {
  size?: number
  rustColor?: string
  dirtColor?: string
}

// Draws base-color + roughness canvases with seeded rust/dirt/scratch
// blotches, biased toward the bottom (grime settles low on a real panel).
export function createWeatheredMetalTexture(
  seed: number,
  baseColor: string,
  { size = 256, rustColor = '#5c3420', dirtColor = '#1c1712' }: WeatheredTextureOptions = {},
) {
  const rng = createRng(seed)

  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = colorCanvas.height = size
  const cctx = colorCanvas.getContext('2d')!
  cctx.fillStyle = baseColor
  cctx.fillRect(0, 0, size, size)

  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = roughCanvas.height = size
  const rctx = roughCanvas.getContext('2d')!
  rctx.fillStyle = '#8a8a8a'
  rctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 40; i++) {
    const x = rng() * size
    const y = size * (0.4 + rng() * 0.6)
    const r = 6 + rng() * 22

    cctx.globalAlpha = 0.08 + rng() * 0.12
    cctx.fillStyle = dirtColor
    cctx.beginPath()
    cctx.arc(x, y, r, 0, Math.PI * 2)
    cctx.fill()

    rctx.globalAlpha = 0.15 + rng() * 0.15
    rctx.fillStyle = '#ffffff'
    rctx.beginPath()
    rctx.arc(x, y, r, 0, Math.PI * 2)
    rctx.fill()
  }

  for (let i = 0; i < 18; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 4 + rng() * 14

    cctx.globalAlpha = 0.25 + rng() * 0.3
    cctx.fillStyle = rustColor
    cctx.beginPath()
    cctx.arc(x, y, r, 0, Math.PI * 2)
    cctx.fill()

    rctx.globalAlpha = 0.3
    rctx.fillStyle = '#dddddd'
    rctx.beginPath()
    rctx.arc(x, y, r, 0, Math.PI * 2)
    rctx.fill()
  }

  cctx.globalAlpha = 0.2
  cctx.strokeStyle = '#d8d0c0'
  for (let i = 0; i < 25; i++) {
    const x = rng() * size
    const y = rng() * size
    const len = 4 + rng() * 20
    const angle = rng() * Math.PI
    cctx.lineWidth = 0.5 + rng()
    cctx.beginPath()
    cctx.moveTo(x, y)
    cctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    cctx.stroke()
  }

  cctx.globalAlpha = 1
  rctx.globalAlpha = 1

  const map = new THREE.CanvasTexture(colorCanvas)
  map.colorSpace = THREE.SRGBColorSpace
  const roughnessMap = new THREE.CanvasTexture(roughCanvas)

  return { map, roughnessMap }
}
