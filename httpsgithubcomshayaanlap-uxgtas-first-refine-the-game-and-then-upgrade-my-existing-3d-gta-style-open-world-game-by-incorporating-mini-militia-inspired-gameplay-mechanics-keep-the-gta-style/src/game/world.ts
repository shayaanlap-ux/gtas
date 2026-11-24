// @ts-nocheck
// World data: road network, terrain height function, ground queries and collision grid.
import { clamp, lerp, smoothstep, fbm } from './util'

export const TERRAIN_HALF = 1100
export const PLAY_LIMIT = 820

export interface P3 { x: number; z: number; y: number }
export interface Road {
  id: string
  kind: 'main' | 'lane' | 'hw' | 'conn' | 'market'
  half: number
  pts: P3[]
  cum: number[]
  len: number
  layer: number
}
export interface Route {
  id: string
  road: string
  pts: P3[]
  cum: number[]
  len: number
  kind: string
  speed: number
}

// ---------------- flyover profile ----------------
export const FLY_Z = -260
export const FLY_H = 7.5
export function flyElev(z: number) {
  const dz = Math.abs(z - FLY_Z)
  if (dz < 35) return FLY_H
  if (dz > 125) return 0
  return (FLY_H * (125 - dz)) / 90
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}
function spline(ctrl: number[][], step = 8): P3[] {
  const out: P3[] = []
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      out.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), z: catmull(p0[1], p1[1], p2[1], p3[1], t), y: 0 })
    }
  }
  const l = ctrl[ctrl.length - 1]
  out.push({ x: l[0], z: l[1], y: 0 })
  return out
}
function cumulative(pts: P3[]) {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z))
  return cum
}
function mkRoad(id: string, kind: Road['kind'], half: number, ctrl: number[][], layer: number, elev = false): Road {
  const pts = spline(ctrl, elev ? 5 : 8)
  if (elev) for (const p of pts) p.y = flyElev(p.z)
  const cum = cumulative(pts)
  return { id, kind, half, pts, cum, len: cum[cum.length - 1], layer }
}

export const ROADS: Road[] = [
  mkRoad('lane_a', 'lane', 2.6, [[-300, 0], [-332, 60], [-340, 160], [-285, 262], [-170, 322], [-40, 332], [60, 302], [150, 232], [186, 122], [160, 40], [150, 0]], 1),
  mkRoad('lane_b', 'lane', 2.6, [[0, -120], [-70, -132], [-150, -150], [-230, -192], [-300, -240], [-335, -320]], 1),
  mkRoad('lane_c', 'lane', 2.6, [[420, 0], [432, -60], [482, -122], [562, -150], [620, -205], [622, -262]], 1),
  mkRoad('lane_d', 'lane', 2.6, [[-500, 0], [-520, 80], [-480, 182], [-400, 262], [-380, 340]], 1),
  mkRoad('market', 'market', 4.5, [[0, 340], [0, 100], [0, -100], [0, -262]], 2),
  mkRoad('conn', 'conn', 5, [[300, 330], [300, 100], [300, 0], [300, -130], [300, -260], [300, -390], [312, -460], [335, -560]], 3, true),
  mkRoad('main', 'main', 4.5, [[-900, 70], [-700, 45], [-500, 8], [-300, 0], [0, 0], [300, 0], [500, -2], [700, -25], [900, -70]], 4),
  mkRoad('bypass', 'hw', 8, [[-900, -312], [-700, -292], [-500, -272], [-200, -260], [100, -260], [300, -260], [500, -260], [700, -247], [900, -225]], 5),
]
export const ROAD_BY_ID: Record<string, Road> = {}
ROADS.forEach((r) => (ROAD_BY_ID[r.id] = r))

// ---------------- stream ----------------
export const sx = (z: number) => -170 + 55 * Math.sin(z * 0.0045 + 0.5) + 25 * Math.sin(z * 0.011)
export const STREAM_Z = 650
export const WATER_Y = -0.45
export const STREAM_BED = -1.5

// ---------------- paddy fields (flattened) ----------------
export const PADDIES = [
  { x: 260, z: 150, w: 120, d: 90 },
  { x: 380, z: 230, w: 100, d: 80 },
  { x: -420, z: 130, w: 90, d: 70 },
  { x: -230, z: 200, w: 70, d: 60 },
  { x: 70, z: 420, w: 120, d: 70 },
  { x: 480, z: -70, w: 80, d: 60 },
  { x: -120, z: -380, w: 90, d: 60 },
]
export const PLANTATIONS = [
  { x: -400, z: -170, w: 200, d: 170, kind: 'areca' },
  { x: 520, z: 220, w: 150, d: 130, kind: 'areca' },
  { x: -60, z: 520, w: 190, d: 110, kind: 'coconut' },
  { x: 560, z: -180, w: 100, d: 90, kind: 'coconut' },
  { x: -620, z: 230, w: 150, d: 120, kind: 'areca' },
  { x: 170, z: -420, w: 150, d: 100, kind: 'coconut' },
  { x: -20, z: 215, w: 120, d: 70, kind: 'coconut' },
]
const HUMPS = [
  [-450, -50, 140, 26],
  [470, 120, 120, 20],
  [-120, 470, 130, 24],
  [100, -470, 140, 26],
  [-640, 130, 120, 28],
  [650, -120, 110, 22],
]

// ---------------- road spatial grid ----------------
const RC = 40
const rgrid = new Map<number, { r: Road; i: number }[]>()
const rkey = (cx: number, cz: number) => (cx + 200) * 1000 + (cz + 200)
for (const r of ROADS) {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1]
    const L = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.ceil(L / 8))
    const seen = new Set<number>()
    for (let k = 0; k <= n; k++) {
      const x = lerp(a.x, b.x, k / n), z = lerp(a.z, b.z, k / n)
      const key = rkey(Math.floor(x / RC), Math.floor(z / RC))
      if (!seen.has(key)) {
        seen.add(key)
        let l = rgrid.get(key)
        if (!l) rgrid.set(key, (l = []))
        l.push({ r, i })
      }
    }
  }
}
function segClosest(r: Road, i: number, x: number, z: number) {
  const a = r.pts[i], b = r.pts[i + 1]
  const dx = b.x - a.x, dz = b.z - a.z
  const L2 = dx * dx + dz * dz || 1
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1)
  const cx = a.x + dx * t, cz = a.z + dz * t
  return { d: Math.hypot(x - cx, z - cz), t, y: lerp(a.y, b.y, t), dx, dz, L: Math.sqrt(L2) }
}
/** scalar distance from the road edge (<=0 means on the carriageway). capped ~ 40 */
export function roadEdgeDist(x: number, z: number) {
  const cx = Math.floor(x / RC), cz = Math.floor(z / RC)
  let best = 60
  for (let ox = -1; ox <= 1; ox++)
    for (let oz = -1; oz <= 1; oz++) {
      const l = rgrid.get(rkey(cx + ox, cz + oz))
      if (!l) continue
      for (const s of l) {
        const c = segClosest(s.r, s.i, x, z)
        const e = c.d - s.r.half
        if (e < best) best = e
      }
    }
  return best
}
export interface RoadHit { road: Road; edge: number; y: number; tx: number; tz: number; d: number; i: number }
/** nearest road info (single) */
export function nearestRoad(x: number, z: number): RoadHit | null {
  const cx = Math.floor(x / RC), cz = Math.floor(z / RC)
  let best: RoadHit | null = null
  for (let ox = -1; ox <= 1; ox++)
    for (let oz = -1; oz <= 1; oz++) {
      const l = rgrid.get(rkey(cx + ox, cz + oz))
      if (!l) continue
      for (const s of l) {
        const c = segClosest(s.r, s.i, x, z)
        const e = c.d - s.r.half
        if (!best || e < best.edge) best = { road: s.r, edge: e, y: c.y, tx: c.dx / c.L, tz: c.dz / c.L, d: c.d, i: s.i }
      }
    }
  return best
}
const _lv: number[] = []
function roadLevels(x: number, z: number, margin: number) {
  _lv.length = 0
  const cx = Math.floor(x / RC), cz = Math.floor(z / RC)
  for (let ox = -1; ox <= 1; ox++)
    for (let oz = -1; oz <= 1; oz++) {
      const l = rgrid.get(rkey(cx + ox, cz + oz))
      if (!l) continue
      for (const s of l) {
        const c = segClosest(s.r, s.i, x, z)
        if (c.d - s.r.half < margin) _lv.push(c.y)
      }
    }
  return _lv
}

// ---------------- terrain ----------------
function hillBase(x: number, z: number) {
  const d = Math.hypot(x / 1.7, z + 30)
  let h = 80 * smoothstep(330, 800, d) * (0.65 + 0.8 * fbm(x * 0.0032 + 3, z * 0.0032 - 7, 3))
  h += 14 * smoothstep(250, 600, d) * fbm(x * 0.012, z * 0.012, 3)
  for (const hp of HUMPS) {
    const dd = Math.hypot(x - hp[0], z - hp[1]) / hp[2]
    if (dd < 1) h += hp[3] * Math.pow(1 - dd * dd, 2) * (0.8 + 0.4 * fbm(x * 0.02, z * 0.02, 2))
  }
  h += (fbm(x * 0.015 + 40, z * 0.015, 3) - 0.5) * 4.5 * smoothstep(40, 200, d)
  return h
}
function paddyMask(x: number, z: number) {
  let m = 0
  for (const p of PADDIES) {
    const dx = Math.abs(x - p.x) - p.w / 2, dz = Math.abs(z - p.z) - p.d / 2
    const d = Math.max(dx, dz)
    m = Math.max(m, 1 - smoothstep(2, 18, d))
  }
  return m
}
export function terrainH(x: number, z: number) {
  if (Math.abs(x) > 2500) return 0
  let h = hillBase(x, z)
  const re = roadEdgeDist(x, z)
  const rm = smoothstep(1.5, 30, re)
  const town = smoothstep(0.85, 1.5, Math.hypot(x / 210, z / 120))
  const dx = Math.abs(x - sx(z))
  const sm = Math.abs(z) < STREAM_Z ? smoothstep(5, 55, dx) : 1
  h *= rm * town * sm
  h = lerp(h, 0, paddyMask(x, z))
  if (Math.abs(z) < STREAM_Z + 40) {
    const w = Math.exp(-Math.pow(dx / 4.8, 2)) * (1 - smoothstep(STREAM_Z - 20, STREAM_Z + 40, Math.abs(z)))
    h = lerp(h, STREAM_BED, w)
  }
  return h
}

/** ground height with multi-level (flyover) awareness */
export function groundAt(x: number, z: number, yRef: number, stepUp = 0.7) {
  if (x > 2500) return 0
  const t = terrainH(x, z)
  const lv = roadLevels(x, z, 0.3)
  let best = -1e9
  let lowest = t
  if (t <= yRef + stepUp) best = t
  for (let i = 0; i < lv.length; i++) {
    const y = lv[i]
    if (y <= yRef + stepUp && y > best) best = y
    if (y < lowest) lowest = y
  }
  return best > -1e8 ? best : lowest
}
export function onRoad(x: number, z: number, margin = 0.2) {
  return roadEdgeDist(x, z) < margin
}

// ---------------- collision grid ----------------
export interface Collider {
  t: 0 | 1 // 0 circle 1 aabb
  x: number; z: number; r: number
  x0: number; z0: number; x1: number; z1: number
  y0: number; y1: number
  tag?: string
}
const CC = 16
const cgrid = new Map<number, Collider[]>()
const ckey = (cx: number, cz: number) => (cx + 400) * 2000 + (cz + 400)
function ins(c: Collider, x0: number, z0: number, x1: number, z1: number) {
  for (let cx = Math.floor(x0 / CC); cx <= Math.floor(x1 / CC); cx++)
    for (let cz = Math.floor(z0 / CC); cz <= Math.floor(z1 / CC); cz++) {
      const k = ckey(cx, cz)
      let l = cgrid.get(k)
      if (!l) cgrid.set(k, (l = []))
      l.push(c)
    }
}
export function addCircle(x: number, z: number, r: number, y0 = -50, y1 = 14, tag?: string) {
  const c: Collider = { t: 0, x, z, r, x0: 0, z0: 0, x1: 0, z1: 0, y0, y1, tag }
  ins(c, x - r, z - r, x + r, z + r)
  return c
}
export function addBox(x0: number, z0: number, x1: number, z1: number, y0 = -50, y1 = 12, tag?: string) {
  const c: Collider = { t: 1, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 0, x0, z0, x1, z1, y0, y1, tag }
  ins(c, x0, z0, x1, z1)
  return c
}
/** highest flat rooftop (tag 'bld') under (x,z) that is at or below yRef+stepUp; -1e9 when none */
export function roofAt(x: number, z: number, yRef: number, stepUp = 0.7) {
  const l = cgrid.get(ckey(Math.floor(x / CC), Math.floor(z / CC)))
  let best = -1e9
  if (!l) return best
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c.tag !== 'bld' || c.t !== 1) continue
    if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue
    if (c.y1 <= yRef + stepUp && c.y1 > best) best = c.y1
  }
  return best
}
/** is the 3D point inside any collider volume or below terrain? (used for bullets) */
export function pointSolid(x: number, y: number, z: number) {
  const l = cgrid.get(ckey(Math.floor(x / CC), Math.floor(z / CC)))
  if (!l) return false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c.tag === 'int' || y < c.y0 || y > c.y1) continue
    if (c.t === 1) {
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return true
    } else if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < c.r * c.r) return true
  }
  return false
}
/** marches a ray through the collision grid + terrain. Returns the travel distance at first impact (or maxD). */
export function raycastWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number) {
  let t = 0.3
  let lastTerrain = 0
  while (t < maxD) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t
    if (pointSolid(x, y, z)) return t
    if (y < 140 && (t < 8 || t - lastTerrain >= 1.5)) {
      lastTerrain = t
      if (y < terrainH(x, z) - 0.05) return t
    }
    t += t < 12 ? 0.35 : 0.8
  }
  return maxD
}
export const hit = { nx: 0, nz: 0, pen: 0, any: false }
const seenStamp = new Set<Collider>()
/** pushes a circle out of colliders, mutates pos, fills `hit` with accumulated normal */
export function pushOut(pos: { x: number; z: number }, r: number, y: number, ignore?: string) {
  hit.nx = 0
  hit.nz = 0
  hit.pen = 0
  hit.any = false
  const cx0 = Math.floor((pos.x - r) / CC), cx1 = Math.floor((pos.x + r) / CC)
  const cz0 = Math.floor((pos.z - r) / CC), cz1 = Math.floor((pos.z + r) / CC)
  seenStamp.clear()
  for (let cx = cx0; cx <= cx1; cx++)
    for (let cz = cz0; cz <= cz1; cz++) {
      const l = cgrid.get(ckey(cx, cz))
      if (!l) continue
      for (const c of l) {
        if (seenStamp.has(c)) continue
        seenStamp.add(c)
        if (y < c.y0 - 1.6 || y > c.y1 + 0.6) continue
        if (ignore && c.tag === ignore) continue
        let nx = 0, nz = 0, pen = 0
        if (c.t === 0) {
          const dx = pos.x - c.x, dz = pos.z - c.z
          const d = Math.hypot(dx, dz)
          const rr = r + c.r
          if (d < rr) {
            pen = rr - d
            if (d > 1e-5) {
              nx = dx / d
              nz = dz / d
            } else nx = 1
          }
        } else {
          const qx = clamp(pos.x, c.x0, c.x1), qz = clamp(pos.z, c.z0, c.z1)
          const dx = pos.x - qx, dz = pos.z - qz
          const d2 = dx * dx + dz * dz
          if (d2 < r * r) {
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2)
              pen = r - d
              nx = dx / d
              nz = dz / d
            } else {
              // centre inside box: push along shortest axis
              const l = pos.x - c.x0, rr = c.x1 - pos.x, t = pos.z - c.z0, b = c.z1 - pos.z
              const m = Math.min(l, rr, t, b)
              if (m === l) { nx = -1; pen = l + r }
              else if (m === rr) { nx = 1; pen = rr + r }
              else if (m === t) { nz = -1; pen = t + r }
              else { nz = 1; pen = b + r }
            }
          }
        }
        if (pen > 0) {
          pos.x += nx * pen
          pos.z += nz * pen
          hit.nx += nx
          hit.nz += nz
          hit.pen += pen
          hit.any = true
        }
      }
    }
  if (hit.any) {
    const l = Math.hypot(hit.nx, hit.nz) || 1
    hit.nx /= l
    hit.nz /= l
  }
  return hit.any
}

// ---------------- routes (lane following for traffic) ----------------
function offsetPoly(pts: P3[], off: number): P3[] {
  const out: P3[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]
    let dx = b.x - a.x, dz = b.z - a.z
    const L = Math.hypot(dx, dz) || 1
    dx /= L
    dz /= L
    // right normal = (-dz, dx); left lane => negative offset
    out.push({ x: pts[i].x + -dz * off, z: pts[i].z + dx * off, y: pts[i].y })
  }
  return out
}
function mkRoute(road: Road, rev: boolean, off: number, speed: number, tag: string): Route {
  let pts = road.pts.map((p) => ({ ...p }))
  if (rev) pts.reverse()
  pts = offsetPoly(pts, -off)
  const cum = cumulative(pts)
  return { id: road.id + (rev ? '_r' : '_f') + tag, road: road.id, pts, cum, len: cum[cum.length - 1], kind: road.kind, speed }
}
export const ROUTES: Route[] = []
for (const r of ROADS) {
  if (r.kind === 'hw') {
    for (const rev of [false, true]) {
      ROUTES.push(mkRoute(r, rev, 2.75, 19, 'a'))
      ROUTES.push(mkRoute(r, rev, 6.25, 25, 'b'))
    }
  } else if (r.kind === 'lane') {
    for (const rev of [false, true]) ROUTES.push(mkRoute(r, rev, 1.15, 6.5, 'a'))
  } else {
    const sp = r.kind === 'main' ? 11 : r.kind === 'conn' ? 14 : 9
    for (const rev of [false, true]) ROUTES.push(mkRoute(r, rev, r.half / 2, sp, 'a'))
  }
}
export function routePos(rt: Route, s: number) {
  const pts = rt.pts
  s = clamp(s, 0, rt.len)
  let lo = 0, hi = pts.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (rt.cum[m] <= s) lo = m
    else hi = m
  }
  const t = (s - rt.cum[lo]) / Math.max(1e-6, rt.cum[hi] - rt.cum[lo])
  return { x: lerp(pts[lo].x, pts[hi].x, t), z: lerp(pts[lo].z, pts[hi].z, t), y: lerp(pts[lo].y, pts[hi].y, t), i: lo }
}

// ---------------- shared registries filled by the builder ----------------
export interface Door { id: string; x: number; z: number; face: number; interior: string; label: string; open: [number, number] }
export interface LightSrc { x: number; y: number; z: number; r: number; g: number; b: number; kind: 'street' | 'shop' }
export const W = {
  doors: [] as Door[],
  lights: [] as LightSrc[],
  pois: [] as { x: number; z: number; kind: string; face?: number }[],
  benches: [] as { x: number; z: number; face: number }[],
  stalls: [] as { x: number; z: number; face: number; kind: string; name: string }[],
  buildingsMap: [] as { x0: number; z0: number; x1: number; z1: number; kind: string }[],
  signs: [] as any[],
  houses: [] as { x: number; z: number }[],
}
