// Lightweight combat effects: one Points draw call for all particles + one LineSegments for tracers.
import * as THREE from 'three'

const N = 900
const M = 72

export class FX {
  private pos = new Float32Array(N * 3)
  private col = new Float32Array(N * 3)
  private vel = new Float32Array(N * 3)
  private life = new Float32Array(N)
  private max = new Float32Array(N)
  private base = new Float32Array(N * 3)
  private grav = new Float32Array(N)
  private head = 0
  private pGeo = new THREE.BufferGeometry()
  readonly points: THREE.Points

  private tPos = new Float32Array(M * 6)
  private tCol = new Float32Array(M * 6)
  private tr: { o: number[]; e: number[]; t: number; len: number; c: THREE.Color; alive: boolean }[] = []
  private tHead = 0
  private tGeo = new THREE.BufferGeometry()
  readonly lines: THREE.LineSegments
  private _c = new THREE.Color()

  constructor(scene: THREE.Scene) {
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 3))
    for (let i = 0; i < N; i++) this.pos[i * 3 + 1] = -9999
    const mat = new THREE.PointsMaterial({ size: 0.34, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    this.points = new THREE.Points(this.pGeo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
    scene.add(this.points)
    this.tGeo.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3))
    this.tGeo.setAttribute('color', new THREE.BufferAttribute(this.tCol, 3))
    this.lines = new THREE.LineSegments(this.tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    this.lines.frustumCulled = false
    this.lines.renderOrder = 6
    scene.add(this.lines)
    for (let i = 0; i < M; i++) this.tr.push({ o: [0, 0, 0], e: [0, 0, 0], t: 0, len: 0, c: new THREE.Color(), alive: false })
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, r: number, g: number, b: number, grav = 0) {
    const i = this.head
    this.head = (this.head + 1) % N
    const k = i * 3
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz
    this.base[k] = r; this.base[k + 1] = g; this.base[k + 2] = b
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b
    this.life[i] = life
    this.max[i] = life
    this.grav[i] = grav
  }
  jetFlame(x: number, y: number, z: number, vx: number, vy: number, vz: number, boost: boolean) {
    for (let i = 0; i < 2; i++) {
      const r = Math.random()
      this.emit(x + (Math.random() - 0.5) * 0.06, y, z + (Math.random() - 0.5) * 0.06, vx * 0.5 + (Math.random() - 0.5) * 1.4, vy * 0.4 - 6 - r * 4 - (boost ? 3 : 0), vz * 0.5 + (Math.random() - 0.5) * 1.4,
        0.22 + r * 0.22, 1, 0.55 + r * 0.35, 0.12 + (boost ? 0.4 : 0), 0)
    }
  }
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    for (let i = 0; i < 5; i++) {
      const s = 3 + Math.random() * 5
      this.emit(x, y, z, dx * s + (Math.random() - 0.5) * 2, dy * s + (Math.random() - 0.5) * 2, dz * s + (Math.random() - 0.5) * 2, 0.07 + Math.random() * 0.05, 1, 0.85, 0.4)
    }
  }
  impact(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0) {
    for (let i = 0; i < 7; i++) {
      const s = 1.5 + Math.random() * 3.5
      this.emit(x, y, z, nx * s + (Math.random() - 0.5) * 3, ny * s + Math.random() * 2, nz * s + (Math.random() - 0.5) * 3, 0.25 + Math.random() * 0.25, 1, 0.8, 0.45, 12)
    }
    for (let i = 0; i < 3; i++) this.emit(x, y, z, (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.4, 0.28, 0.27, 0.25, -0.3)
  }
  blood(x: number, y: number, z: number) {
    for (let i = 0; i < 10; i++) this.emit(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.35 + Math.random() * 0.3, 0.8, 0.04, 0.04, 14)
  }
  burst(x: number, y: number, z: number, r: number, g: number, b: number, n = 18) {
    for (let i = 0; i < n; i++) this.emit(x, y, z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0.5 + Math.random() * 0.4, r, g, b, 4)
  }
  tracer(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, color: number) {
    const t = this.tr[this.tHead]
    this.tHead = (this.tHead + 1) % M
    t.o = [ox, oy, oz]
    t.e = [ex, ey, ez]
    t.len = Math.hypot(ex - ox, ey - oy, ez - oz)
    t.t = 0
    t.c.setHex(color)
    t.alive = t.len > 0.5
  }

  update(dt: number) {
    const pos = this.pos, col = this.col, vel = this.vel, life = this.life
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) continue
      life[i] -= dt
      const k = i * 3
      if (life[i] <= 0) {
        pos[k + 1] = -9999
        col[k] = col[k + 1] = col[k + 2] = 0
        continue
      }
      vel[k + 1] -= this.grav[i] * dt
      pos[k] += vel[k] * dt
      pos[k + 1] += vel[k + 1] * dt
      pos[k + 2] += vel[k + 2] * dt
      const f = life[i] / this.max[i]
      col[k] = this.base[k] * f
      col[k + 1] = this.base[k + 1] * f
      col[k + 2] = this.base[k + 2] * f
    }
    this.pGeo.attributes.position.needsUpdate = true
    this.pGeo.attributes.color.needsUpdate = true
    const tp = this.tPos, tc = this.tCol
    for (let i = 0; i < M; i++) {
      const t = this.tr[i]
      const j = i * 6
      if (!t.alive) {
        tp.fill(0, j, j + 6)
        continue
      }
      t.t += dt
      const head = Math.min(t.len, t.t * 520)
      const tail = Math.max(0, head - 16)
      if (tail >= t.len - 0.01 || t.t > 1.5) {
        t.alive = false
        tp.fill(0, j, j + 6)
        continue
      }
      const hk = head / t.len, tk = tail / t.len
      for (let a = 0; a < 3; a++) {
        tp[j + a] = t.o[a] + (t.e[a] - t.o[a]) * tk
        tp[j + 3 + a] = t.o[a] + (t.e[a] - t.o[a]) * hk
      }
      const f = 1 - Math.max(0, (t.t - 0.12) / 0.2)
      this._c.copy(t.c)
      tc[j] = 0.1 * f; tc[j + 1] = 0.1 * f; tc[j + 2] = 0.05 * f
      tc[j + 3] = this._c.r * f; tc[j + 4] = this._c.g * f; tc[j + 5] = this._c.b * f
    }
    this.tGeo.attributes.position.needsUpdate = true
    this.tGeo.attributes.color.needsUpdate = true
  }
}
