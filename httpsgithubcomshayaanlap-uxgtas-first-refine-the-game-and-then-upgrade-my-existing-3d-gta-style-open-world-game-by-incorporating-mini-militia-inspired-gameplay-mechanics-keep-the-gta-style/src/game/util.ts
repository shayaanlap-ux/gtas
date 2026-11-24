// @ts-nocheck
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const WORLD_HALF = 900 // terrain spans -900..900
export const CHUNK = 150

export function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt))
export const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function hash2(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function noise2(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz)
}
export function fbm(x: number, z: number, oct = 4) {
  let v = 0, a = 0.5, f = 1
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, z * f)
    f *= 2.03
    a *= 0.5
  }
  return v
}

// ---------- chunked static geometry ----------
export class ChunkSet {
  groups = new Map<string, THREE.Group>()
  list: THREE.Group[] = []
  constructor(public root: THREE.Object3D) {}
  idx(v: number) {
    return Math.floor((v + WORLD_HALF) / CHUNK)
  }
  get(x: number, z: number) {
    const cx = this.idx(x), cz = this.idx(z)
    const k = cx + ',' + cz
    let g = this.groups.get(k)
    if (!g) {
      g = new THREE.Group()
      g.userData.cx = -WORLD_HALF + (cx + 0.5) * CHUNK
      g.userData.cz = -WORLD_HALF + (cz + 0.5) * CHUNK
      this.groups.set(k, g)
      this.list.push(g)
      this.root.add(g)
    }
    return g
  }
  updateVisibility(px: number, pz: number, dist: number) {
    for (const g of this.list) {
      const d = Math.hypot(g.userData.cx - px, g.userData.cz - pz)
      g.visible = d < dist + CHUNK * 0.8
    }
  }
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

export class Batch {
  groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; chunk: THREE.Group; shadow: boolean }>()
  constructor(public chunks: ChunkSet) {}
  add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, shadow = true, rx = 0, rz = 0) {
    const chunk = this.chunks.get(x, z)
    const key = chunk.userData.cx + ',' + chunk.userData.cz + ',' + mat.uuid + (shadow ? 's' : 'n')
    let g = this.groups.get(key)
    if (!g) {
      g = { mat, geos: [], chunk, shadow }
      this.groups.set(key, g)
    }
    _e.set(rx, ry, rz)
    _q.setFromEuler(_e)
    _p.set(x, y, z)
    _s.set(sx, sy, sz)
    _m.compose(_p, _q, _s)
    let c = geo.clone()
    c.applyMatrix4(_m)
    if (c.index) c = c.toNonIndexed()
    for (const name of Object.keys(c.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name)
    g.geos.push(c)
  }
  build() {
    for (const g of this.groups.values()) {
      const merged = mergeGeometries(g.geos, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, g.mat)
      mesh.castShadow = g.shadow
      mesh.receiveShadow = true
      g.chunk.add(mesh)
      g.geos.forEach((x) => x.dispose())
    }
    this.groups.clear()
  }
}

export class Instancer {
  types = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material; items: Map<THREE.Group, { m: THREE.Matrix4; c?: THREE.Color }[]>; shadow: boolean }>()
  constructor(public chunks: ChunkSet) {}
  register(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) {
    this.types.set(key, { geo, mat, items: new Map(), shadow })
  }
  add(key: string, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, color?: THREE.Color, rx = 0, rz = 0) {
    const t = this.types.get(key)!
    const chunk = this.chunks.get(x, z)
    _e.set(rx, ry, rz)
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
    let arr = t.items.get(chunk)
    if (!arr) {
      arr = []
      t.items.set(chunk, arr)
    }
    arr.push({ m: _m.clone(), c: color })
  }
  build() {
    for (const t of this.types.values()) {
      for (const [chunk, arr] of t.items) {
        const im = new THREE.InstancedMesh(t.geo, t.mat, arr.length)
        arr.forEach((it, i) => {
          im.setMatrixAt(i, it.m)
          if (it.c) im.setColorAt(i, it.c)
        })
        im.instanceMatrix.needsUpdate = true
        im.castShadow = t.shadow
        im.receiveShadow = true
        im.computeBoundingSphere()
        chunk.add(im)
      }
    }
  }
}

// box geometry whose UVs are in world units (so facade textures keep a constant scale)
export function boxWorldUV(w: number, h: number, d: number, tw = 12, th = 6) {
  const g = new THREE.BoxGeometry(w, h, d)
  const uv = g.attributes.uv
  const n = g.attributes.normal
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i))
    let su: number, sv: number
    if (ny > 0.5) {
      su = w / tw
      sv = d / tw
    } else if (nx > 0.5) {
      su = d / tw
      sv = h / th
    } else {
      su = w / tw
      sv = h / th
    }
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  }
  return g
}
