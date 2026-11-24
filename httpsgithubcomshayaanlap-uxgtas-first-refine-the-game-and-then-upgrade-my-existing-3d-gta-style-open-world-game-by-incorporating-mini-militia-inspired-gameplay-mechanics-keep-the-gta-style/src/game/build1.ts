// @ts-nocheck
// Terrain, roads, stream, bridges, flyover, road furniture, signs.
import * as THREE from 'three'
import { Batch, ChunkSet, clamp, fbm, lerp, smoothstep, noise2 } from './util'
import { T, MATS, std } from './materials'
import { signTexture } from './textures'
import {
  ROADS, ROAD_BY_ID, TERRAIN_HALF, terrainH, roadEdgeDist, sx, STREAM_Z, WATER_Y, addCircle, addBox, W, PADDIES, FLY_Z, FLY_H, flyElev,
} from './world'

export const UB = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
export const UC = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0)
export const UC6 = new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0)
export const US = new THREE.IcosahedronGeometry(1, 1)

export function posOn(road: { pts: any[]; cum: number[]; len: number }, s: number) {
  const pts = road.pts
  s = clamp(s, 0, road.len)
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (road.cum[m] <= s) lo = m
    else hi = m
  }
  const t = (s - road.cum[lo]) / Math.max(1e-6, road.cum[hi] - road.cum[lo])
  const dx = pts[hi].x - pts[lo].x, dz = pts[hi].z - pts[lo].z
  const L = Math.hypot(dx, dz) || 1
  return { x: lerp(pts[lo].x, pts[hi].x, t), z: lerp(pts[lo].z, pts[hi].z, t), y: lerp(pts[lo].y, pts[hi].y, t), tx: dx / L, tz: dz / L }
}

function ribbonGeo(pts: any[], cum: number[], offset: number, width: number, yOff: number, vScale: number) {
  const n = pts.length
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4)
  const idx: number[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    let dx = b.x - a.x, dz = b.z - a.z
    const L = Math.hypot(dx, dz) || 1
    dx /= L
    dz /= L
    const nx = -dz, nz = dx
    const o0 = offset - width / 2, o1 = offset + width / 2
    pos.set([pts[i].x + nx * o0, pts[i].y + yOff, pts[i].z + nz * o0, pts[i].x + nx * o1, pts[i].y + yOff, pts[i].z + nz * o1], i * 6)
    const v = cum[i] / vScale
    uv.set([0, v, 1, v], i * 4)
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  // winding so that the normal points up
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  if (g.attributes.normal.getY(0) < 0) {
    const ix = g.index.array
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1]
      ix[i + 1] = ix[i + 2]
      ix[i + 2] = t
    }
    g.computeVertexNormals()
  }
  return g
}

function addRibbon(chunks: ChunkSet, road: any, offset: number, width: number, yOff: number, mat: THREE.Material, vScale = 12, receive = true) {
  const SL = 20
  for (let s = 0; s < road.pts.length - 1; s += SL) {
    const e = Math.min(road.pts.length - 1, s + SL)
    const pts = road.pts.slice(s, e + 1)
    const cum = road.cum.slice(s, e + 1)
    const g = ribbonGeo(pts, cum, offset, width, yOff, vScale)
    const mesh = new THREE.Mesh(g, mat)
    mesh.receiveShadow = receive
    const m = pts[pts.length >> 1]
    chunks.get(m.x, m.z).add(mesh)
  }
}

function circleLine(x0: number, z0: number, x1: number, z1: number, r: number, y0: number, y1: number, step = 1.4) {
  const L = Math.hypot(x1 - x0, z1 - z0)
  const n = Math.max(1, Math.ceil(L / step))
  for (let i = 0; i <= n; i++) addCircle(lerp(x0, x1, i / n), lerp(z0, z1, i / n), r, y0, y1)
}

export function buildTerrain(root: THREE.Object3D) {
  const SEG = 380
  const geo = new THREE.PlaneGeometry(TERRAIN_HALF * 2, TERRAIN_HALF * 2, SEG, SEG)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  const col = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const h = terrainH(x, z)
    pos.setY(i, h)
    const re = roadEdgeDist(x, z)
    const n = fbm(x * 0.03, z * 0.03, 3)
    const n2 = noise2(x * 0.2, z * 0.2)
    // lush tropical green, darker/bluer on high forested slopes
    const f = smoothstep(6, 40, h)
    let r = lerp(0.3, 0.12, f) + (n - 0.5) * 0.14
    let g = lerp(0.5, 0.3, f) + (n - 0.5) * 0.18
    let b = lerp(0.16, 0.1, f) + (n2 - 0.5) * 0.03
    // red laterite soil along road edges and bare patches
    const soil = smoothstep(9, 2, re) * 0.85 + smoothstep(0.62, 0.8, fbm(x * 0.01 + 9, z * 0.01, 3)) * 0.35 * (1 - f)
    r = lerp(r, 0.5 + n2 * 0.1, Math.min(1, soil))
    g = lerp(g, 0.27 + n2 * 0.05, Math.min(1, soil))
    b = lerp(b, 0.15, Math.min(1, soil))
    // stream banks
    const dx = Math.abs(x - sx(z))
    if (Math.abs(z) < STREAM_Z) {
      const bank = smoothstep(11, 3, dx)
      r = lerp(r, 0.32, bank)
      g = lerp(g, 0.3, bank)
      b = lerp(b, 0.2, bank)
    }
    c.setRGB(r * 1.25, g * 1.25, b * 1.25)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, T.terrain)
  mesh.receiveShadow = true
  root.add(mesh)
  return mesh
}

export function buildInfra(root: THREE.Object3D, chunks: ChunkSet, batch: Batch, rng: () => number) {
  // ---------- roads ----------
  const matFor: Record<string, any> = { main: T.roadMain, market: T.roadMarket, lane: T.roadLane, conn: T.roadConn }
  for (const r of ROADS) {
    const layerY = 0.03 + r.layer * 0.004
    if (r.kind === 'hw') {
      addRibbon(chunks, r, -4.5, 7, layerY, T.roadHwL)
      addRibbon(chunks, r, 4.5, 7, layerY, T.roadHw)
      // median: curb + grass
      addRibbon(chunks, r, 0, 2, 0.16, std(0x4f8a2e, 1), 4)
      for (let s = 0; s < r.len; s += 6) {
        const p = posOn(r, s)
        batch.add(UB, T.curb, p.x, 0, p.z, Math.atan2(p.tx, p.tz) + Math.PI / 2, 6.2, 0.16, 2.3, false)
        if (rng() < 0.7) batch.add(US, T.shrub, p.x, 0.5, p.z + (rng() - 0.5) * 0.4, rng() * 3, 0.55 + rng() * 0.3, 0.45 + rng() * 0.35, 0.55 + rng() * 0.3, false)
      }
    } else {
      addRibbon(chunks, r, 0, r.half * 2, layerY, matFor[r.kind])
      if (r.kind !== 'lane') {
        // pavements / kerbs along the town stretch of main & market roads
      }
    }
  }
  // kerbed pavements in town
  const main = ROAD_BY_ID.main, market = ROAD_BY_ID.market
  for (const s of [-1, 1]) {
    for (let x = -170; x < 170; x += 8) {
      if (Math.abs(x) < 8) continue
      batch.add(UB, T.sidewalk, x + 4, 0, s * 6, 0, 8, 0.2, 3.0, false)
    }
    for (let z = -110; z < 120; z += 8) {
      if (Math.abs(z) < 8) continue
      batch.add(UB, T.sidewalk, s * 6, 0, z + 4, 0, 3.0, 0.2, 8, false)
    }
  }

  // ---------- stream ----------
  {
    const pts: any[] = []
    for (let z = -STREAM_Z; z <= STREAM_Z; z += 12) pts.push({ x: sx(z), z, y: WATER_Y })
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
    const g = ribbonGeo(pts, cum, 0, 15, 0, 10)
    const m = new THREE.Mesh(g, T.water)
    m.renderOrder = 2
    root.add(m)
    MATS.waterMesh = m
  }

  // ---------- bridges over the stream ----------
  for (const r of ROADS) {
    let start = -1
    const groups: [number, number][] = []
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i]
      const inW = Math.abs(z2(p)) < STREAM_Z - 10 && Math.abs(p.x - sx(p.z)) < 9
      if (inW && start < 0) start = i
      if ((!inW || i === r.pts.length - 1) && start >= 0) {
        groups.push([start, i])
        start = -1
      }
    }
    for (const [a, b] of groups) {
      const pa = r.pts[a], pb = r.pts[b]
      const mx = (pa.x + pb.x) / 2, mz = (pa.z + pb.z) / 2
      const dx = pb.x - pa.x, dz = pb.z - pa.z
      const L = Math.hypot(dx, dz) + 8
      const ang = Math.atan2(dx, dz)
      const half = r.kind === 'hw' ? 8 : r.half
      const ux = dx / (L - 8 || 1), uz = dz / (L - 8 || 1)
      batch.add(UB, T.concreteDark, mx, -0.9, mz, ang, half * 2 + 0.8, 0.95, L, true)
      for (const side of [-1, 1]) {
        const ox = -uz * side * (half + 0.15), oz = ux * side * (half + 0.15)
        batch.add(UB, T.concrete, mx + ox, 0, mz + oz, ang, 0.3, 0.95, L, true)
        circleLine(mx + ox - ux * L / 2, mz + oz - uz * L / 2, mx + ox + ux * L / 2, mz + oz + uz * L / 2, 0.4, -5, 1.5)
      }
      for (const k of [-0.28, 0.28]) batch.add(UC, T.concreteDark, mx + ux * L * k, -2.2, mz + uz * L * k, 0, 0.5, 2.3, 0.5, true)
    }
  }

  // ---------- flyover ----------
  {
    const conn = ROAD_BY_ID.conn
    const half = conn.half
    const wallMat = T.concrete
    const sideWall = (side: number) => {
      const pos: number[] = [], uvs: number[] = []
      const idx: number[] = []
      let k = 0
      for (let i = 0; i < conn.pts.length; i++) {
        const p = conn.pts[i]
        const dz = Math.abs(p.z - FLY_Z)
        if (dz < 24 || dz > 126) continue
        const a = conn.pts[Math.max(0, i - 1)], b = conn.pts[Math.min(conn.pts.length - 1, i + 1)]
        let tx = b.x - a.x, tz = b.z - a.z
        const L = Math.hypot(tx, tz) || 1
        tx /= L
        tz /= L
        const nx = -tz * side * (half + 0.1), nz = tx * side * (half + 0.1)
        pos.push(p.x + nx, -0.4, p.z + nz, p.x + nx, p.y + 0.02, p.z + nz)
        uvs.push(conn.cum[i] / 4, 0, conn.cum[i] / 4, 1)
        if (k > 0 && Math.abs(conn.pts[i - 1].z - FLY_Z) >= 24 && Math.abs(conn.pts[i - 1].z - FLY_Z) <= 126 && Math.abs(p.z - conn.pts[i - 1].z) < 20) {
          const q = k * 2
          idx.push(q - 2, q - 1, q, q - 1, q + 1, q)
        }
        k++
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      g.setIndex(idx)
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.95, side: THREE.DoubleSide }))
      m.castShadow = true
      m.receiveShadow = true
      root.add(m)
    }
    sideWall(-1)
    sideWall(1)
    // abutment caps + deck beams + columns
    const cx0 = conn.pts[0].x
    for (const sgn of [-1, 1]) {
      const z = FLY_Z + sgn * 24
      const p = posOn(conn, conn.cum[conn.pts.findIndex((q) => Math.abs(q.z - z) < 3)] || 0)
      batch.add(UB, T.concreteDark, p.x, -0.4, z, 0, half * 2 + 0.6, FLY_H + 0.4, 0.6, true)
      addBox(p.x - half - 0.3, z - 0.3, p.x + half + 0.3, z + 0.3, -5, FLY_H - 1.2)
    }
    batch.add(UB, T.concreteDark, 300, FLY_H - 1.25, FLY_Z, 0, half * 2 + 0.6, 1.25, 48, true)
    for (const sz of [-15, 15]) {
      for (const sxo of [-3.2, 3.2]) {
        batch.add(UC, T.concrete, 300 + sxo, 0, FLY_Z + sz, 0, 0.75, FLY_H - 1.2, 0.75, true)
        addCircle(300 + sxo, FLY_Z + sz, 0.85, -5, FLY_H - 1.3)
      }
      batch.add(UB, T.concreteDark, 300, FLY_H - 2.0, FLY_Z + sz, 0, 9, 0.8, 1.4, true)
    }
    // jersey barriers & colliders along the elevated section
    for (let i = 0; i < conn.pts.length - 1; i++) {
      const p = conn.pts[i], q = conn.pts[i + 1]
      if (p.y < 0.25 && q.y < 0.25) continue
      const dxx = q.x - p.x, dzz = q.z - p.z
      const L = Math.hypot(dxx, dzz)
      const ang = Math.atan2(dxx, dzz)
      for (const side of [-1, 1]) {
        const nx = (-dzz / L) * side * (half - 0.2), nz = (dxx / L) * side * (half - 0.2)
        batch.add(UB, T.concrete, (p.x + q.x) / 2 + nx, Math.min(p.y, q.y) + 0.03, (p.z + q.z) / 2 + nz, ang, 0.5, 0.9, L + 0.05, true)
        addCircle(p.x + nx, p.z + nz, 0.45, p.y - 0.5, p.y + 1.5)
        const dz = Math.abs(p.z - FLY_Z)
        if (dz >= 24) addCircle(p.x + nx * 1.12, p.z + nz * 1.12, 0.9, -6, p.y - 1.2)
      }
    }
  }

  // ---------- furniture: street lights ----------
  const headGeo = new THREE.BoxGeometry(0.9, 0.14, 0.34).translate(0, 0, 0)
  const lampLight = (x: number, y: number, z: number, warm = true) => W.lights.push({ x, y, z, r: warm ? 1 : 0.9, g: warm ? 0.78 : 0.92, b: warm ? 0.5 : 1, kind: 'street' })
  const streetLight = (x: number, z: number, faceX: number, faceZ: number, h = 7.5, y0 = 0) => {
    batch.add(UC6, T.pole, x, y0, z, 0, 0.09, h, 0.09, true)
    const ang = Math.atan2(faceX, faceZ)
    batch.add(UB, T.pole, x + (faceX * 1.0), y0 + h - 0.1, z + (faceZ * 1.0), ang, 0.08, 0.08, 2.0, false)
    const hx = x + faceX * 1.95, hz = z + faceZ * 1.95
    batch.add(headGeo, T.lamp, hx, y0 + h - 0.15, hz, ang + Math.PI / 2, 1, 1, 1, false)
    lampLight(hx, y0 + h - 0.3, hz)
    if (y0 === 0) addCircle(x, z, 0.2)
  }
  for (let x = -165; x <= 165; x += 30) {
    if (Math.abs(x) < 8) continue
    const s = ((x / 30) | 0) % 2 === 0 ? 1 : -1
    streetLight(x, s * 5.6, 0, -s)
  }
  for (let x = 195; x <= 420; x += 70) streetLight(x, 5.6, 0, -1)
  for (let x = -195; x >= -420; x -= 70) streetLight(x, -5.6, 0, 1)
  for (let z = -105; z <= 105; z += 30) {
    if (Math.abs(z) < 10) continue
    streetLight(5.6, z, -1, 0)
  }
  // bypass median lamps (double arm)
  {
    const by = ROAD_BY_ID.bypass
    for (let s = 160; s < by.len - 100; s += 40) {
      const p = posOn(by, s)
      const nx = -p.tz, nz = p.tx
      for (const side of [-1, 1]) {
        // short arm per direction
        batch.add(UC6, T.pole, p.x, 0.16, p.z, 0, 0.09, 8, 0.09, true)
        if (side === 1) {
          addCircle(p.x, p.z, 0.2)
        }
        const ang = Math.atan2(nx * side, nz * side)
        batch.add(UB, T.pole, p.x + nx * side, 8.0, p.z + nz * side, ang, 0.08, 0.08, 2.0, false)
        const hx = p.x + nx * side * 2, hz = p.z + nz * side * 2
        batch.add(headGeo, T.lamp, hx, 8.0, hz, ang + Math.PI / 2, 1, 1, 1, false)
        if (s % 80 === 0) lampLight(hx, 7.8, hz, false)
      }
    }
  }
  // flyover lamps
  {
    const conn = ROAD_BY_ID.conn
    for (let s = 0; s < conn.len; s += 28) {
      const p = posOn(conn, s)
      if (p.y < 5) continue
      for (const side of [-1, 1]) {
        const nx = -p.tz * side, nz = p.tx * side
        const bx = p.x + nx * (conn.half - 0.2), bz = p.z + nz * (conn.half - 0.2)
        batch.add(UC6, T.pole, bx, p.y + 0.9, bz, 0, 0.08, 6.5, 0.08, true)
        const ang = Math.atan2(-nx, -nz)
        batch.add(UB, T.pole, bx - nx * 0.9, p.y + 7.3, bz - nz * 0.9, ang, 0.07, 0.07, 1.8, false)
        const hx = bx - nx * 1.8, hz = bz - nz * 1.8
        batch.add(headGeo, T.lamp, hx, p.y + 7.25, hz, ang + Math.PI / 2, 1, 1, 1, false)
        lampLight(hx, p.y + 7.1, hz, false)
      }
    }
  }

  // ---------- electricity poles & wires ----------
  const wires: number[] = []
  const poleLine = (pts: { x: number; z: number }[]) => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      batch.add(UC6, T.pole, p.x, 0, p.z, 0, 0.13, 9.2, 0.13, true)
      const ang = pts[i + 1] ? Math.atan2(pts[i + 1].x - p.x, pts[i + 1].z - p.z) : i > 0 ? Math.atan2(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0
      batch.add(UB, T.wood, p.x, 8.6, p.z, ang + Math.PI / 2, 0.1, 0.1, 2.2, true)
      batch.add(UB, T.wood, p.x, 7.9, p.z, ang + Math.PI / 2, 0.1, 0.1, 1.8, true)
      addCircle(p.x, p.z, 0.22)
      if (i < pts.length - 1) {
        const q = pts[i + 1]
        const rx = Math.cos(ang), rz = -Math.sin(ang)
        for (const [off, hh] of [[-1.0, 8.75], [0, 8.75], [1.0, 8.75], [-0.8, 8.05], [0.8, 8.05]]) {
          const ax = p.x + rx * off, az = p.z + rz * off, bx = q.x + rx * off, bz = q.z + rz * off
          const N = 6
          for (let k = 0; k < N; k++) {
            const t0 = k / N, t1 = (k + 1) / N
            const sag = (t: number) => -0.9 * 4 * t * (1 - t)
            wires.push(lerp(ax, bx, t0), hh + sag(t0), lerp(az, bz, t0), lerp(ax, bx, t1), hh + sag(t1), lerp(az, bz, t1))
          }
        }
      }
    }
  }
  {
    const north: any[] = [], south: any[] = [], mk: any[] = []
    for (let x = -520; x <= 560; x += 34) {
      if (Math.abs(x) < 10) continue
      const z = main.pts.reduce((b, p) => (Math.abs(p.x - x) < Math.abs(b.x - x) ? p : b), main.pts[0]).z
      if (Math.abs(x - sx(z)) < 11) continue
      north.push({ x, z: z - 5.5 })
    }
    for (let x = -150; x <= 150; x += 38) if (Math.abs(x) > 10) south.push({ x, z: 5.5 })
    for (let z = -110; z <= 330; z += 38) if (Math.abs(z) > 12) mk.push({ x: -5.4, z })
    poleLine(north)
    poleLine(south)
    poleLine(mk)
    for (const l of ROADS.filter((r) => r.kind === 'lane')) {
      const pl: any[] = []
      for (let s = 20; s < l.len - 10; s += 36) {
        const p = posOn(l, s)
        if (Math.abs(p.x - sx(p.z)) < 12) continue
        pl.push({ x: p.x - p.tz * 3.4, z: p.z + p.tx * 3.4 })
      }
      // split at stream gaps
      poleLine(pl)
    }
  }
  const wg = new THREE.BufferGeometry()
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3))
  const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }))
  wl.frustumCulled = false
  root.add(wl)

  // ---------- signs ----------
  const signPlane = (x: number, y: number, z: number, ry: number, w: number, h: number, tex: THREE.Texture) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.0 }))
    MATS.night.push({ mat: m.material, max: 0.35 })
    m.position.set(x, y, z)
    m.rotation.y = ry
    m.castShadow = false
    root.add(m)
    return m
  }
  const green = '#0b6b3a'
  const texNell = signTexture([{ t: 'ನೆಲ್ಲ್ಯಾಡಿ ↑', s: 62 }, { t: 'Nellyadi', s: 50 }, { t: '574229', s: 34, bold: false }], green, '#fff', 512, 256)
  const texDist = signTexture([{ t: 'Mangaluru   45 ↑', s: 52 }, { t: 'Dharmasthala   32 ↑', s: 52 }], green, '#fff', 512, 256)
  // gantries over the town road (both directions)
  for (const [gx, face] of [[-128, -1], [132, 1]]) {
    const zs = 8.2
    batch.add(UC6, T.metal, gx, 0, -zs, 0, 0.22, 7.2, 0.22, true)
    batch.add(UC6, T.metal, gx, 0, zs, 0, 0.22, 7.2, 0.22, true)
    addCircle(gx, -zs, 0.3)
    addCircle(gx, zs, 0.3)
    batch.add(UB, T.metal, gx, 6.6, 0, 0, 0.3, 0.3, zs * 2, true)
    batch.add(UB, T.metal, gx, 6.0, 0, 0, 0.1, 0.1, zs * 2, true)
    signPlane(gx + face * 0.25, 4.6, -3.1, face < 0 ? -Math.PI / 2 : Math.PI / 2, 6, 3, texNell)
    signPlane(gx + face * 0.25, 4.6, 3.3, face < 0 ? -Math.PI / 2 : Math.PI / 2, 6, 3, texDist)
  }
  // roadside green boards
  const bigBoard = signTexture([{ t: 'ನೆಲ್ಲ್ಯಾಡಿ', s: 78 }, { t: 'NELLYADI', s: 66 }, { t: '574229', s: 52 }], '#0b6b3a', '#fff', 512, 384)
  for (const [bx, bz, face] of [[-262, -7.4, -1], [262, 7.4, 1]]) {
    for (const o of [-1.6, 1.6]) {
      batch.add(UC6, T.metal, bx, 0, bz + o, 0, 0.07, 3.0, 0.07, true)
      addCircle(bx, bz + o, 0.12)
    }
    signPlane(bx + face * 0.08, 3.1, bz, face < 0 ? -Math.PI / 2 : Math.PI / 2, 4.2, 3.1, bigBoard)
  }
  const hwBoard = signTexture([{ t: 'NELLYADI', s: 76 }, { t: '574229', s: 56 }], '#2e3338', '#fff', 512, 256)
  batch.add(UC6, T.metal, 335, 0, -277, 0, 0.1, 3.5, 0.1, true)
  batch.add(UC6, T.metal, 339, 0, -277, 0, 0.1, 3.5, 0.1, true)
  addCircle(335, -277, 0.15)
  addCircle(339, -277, 0.15)
  signPlane(337, 3.4, -277.05, Math.PI, 5, 2.4, hwBoard)

  // ---------- puddles ----------
  const pg = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2)
  for (const r of ROADS) {
    const count = Math.floor(r.len / (r.kind === 'lane' ? 55 : 30))
    for (let i = 0; i < count; i++) {
      const s = rng() * r.len
      const p = posOn(r, s)
      if (p.y > 0.2) continue
      if (r.kind === 'conn' && Math.abs(p.z - FLY_Z) < 140) continue
      const off = (rng() - 0.5) * (r.half * 2 - 1.4)
      const x = p.x + -p.tz * off, z = p.z + p.tx * off
      const sz = 0.9 + rng() * 2.2
      batch.add(pg, T.puddle, x, 0.06 + r.layer * 0.004 + 0.012, z, rng() * 3, sz * (1 + rng()), 1, sz, false)
    }
  }
  return { wireLines: wl }
}
function z2(p: any) {
  return p.z
}
