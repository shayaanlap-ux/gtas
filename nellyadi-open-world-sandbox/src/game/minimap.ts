// @ts-nocheck
import { ROADS, W, PADDIES, PLANTATIONS, terrainH, sx, STREAM_Z } from './world'

const SIZE = 1024
const SPAN = 1800
const K = SIZE / SPAN
export const mapPx = (x: number, z: number) => [(x + SPAN / 2) * K, (z + SPAN / 2) * K]

export function buildMapCanvas() {
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const x = c.getContext('2d')!
  const N = 256
  const small = document.createElement('canvas')
  small.width = small.height = N
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(N, N)
  const H = new Float32Array(N * N)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = terrainH(-SPAN / 2 + (i + 0.5) * (SPAN / N), -SPAN / 2 + (j + 0.5) * (SPAN / N))
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const h = H[j * N + i]
      const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)]
      const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i]
      const shade = Math.max(0.55, Math.min(1.25, 1 + (hx + hz) * 0.03))
      const f = Math.min(1, h / 45)
      const r = (118 - f * 62) * shade, g = (160 - f * 58) * shade, b = (92 - f * 44) * shade
      const k = (j * N + i) * 4
      img.data[k] = r
      img.data[k + 1] = g
      img.data[k + 2] = b
      img.data[k + 3] = 255
    }
  sctx.putImageData(img, 0, 0)
  x.imageSmoothingEnabled = true
  x.drawImage(small, 0, 0, SIZE, SIZE)
  // fields & plantations
  for (const p of PADDIES) {
    const [px, pz] = mapPx(p.x - p.w / 2, p.z - p.d / 2)
    x.fillStyle = 'rgba(190,215,110,0.9)'
    x.fillRect(px, pz, p.w * K, p.d * K)
  }
  for (const p of PLANTATIONS) {
    const [px, pz] = mapPx(p.x, p.z)
    x.fillStyle = 'rgba(40,95,45,0.55)'
    x.beginPath()
    x.ellipse(px, pz, (p.w / 2) * K, (p.d / 2) * K, 0, 0, 7)
    x.fill()
  }
  // stream
  x.strokeStyle = '#5b9bd5'
  x.lineWidth = 7 * K
  x.beginPath()
  for (let z = -STREAM_Z; z <= STREAM_Z; z += 20) {
    const [px, pz] = mapPx(sx(z), z)
    z === -STREAM_Z ? x.moveTo(px, pz) : x.lineTo(px, pz)
  }
  x.stroke()
  // roads
  const draw = (w: number, col: string) => {
    for (const r of ROADS) {
      x.strokeStyle = col
      x.lineWidth = Math.max(2, (r.kind === 'hw' ? 16 : r.half * 2) * K * w)
      x.lineJoin = 'round'
      x.beginPath()
      r.pts.forEach((p, i) => {
        const [px, pz] = mapPx(p.x, p.z)
        i ? x.lineTo(px, pz) : x.moveTo(px, pz)
      })
      x.stroke()
    }
  }
  draw(1.9, '#2a2a2e')
  draw(1.35, '#d8d4c8')
  // buildings
  x.fillStyle = '#8c7a6a'
  for (const b of W.buildingsMap) {
    if (b.kind === 'slot') continue
    const [px, pz] = mapPx(b.x0, b.z0)
    x.fillRect(px, pz, Math.max(1.5, (b.x1 - b.x0) * K), Math.max(1.5, (b.z1 - b.z0) * K))
  }
  return c
}
