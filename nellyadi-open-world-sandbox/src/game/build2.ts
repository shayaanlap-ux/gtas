// @ts-nocheck
// Town buildings, houses, stalls, vegetation, fields, tower.
import * as THREE from 'three'
import { Batch, ChunkSet, Instancer, boxWorldUV, clamp, fbm, lerp, noise2 } from './util'
import { T, MATS, std, facadeMat, shopfrontMat, wind } from './materials'
import { signTexture } from './textures'
import { UB, UC, UC6, US, posOn } from './build1'
import {
  ROADS, ROAD_BY_ID, terrainH, roadEdgeDist, sx, STREAM_Z, addCircle, addBox, W, PADDIES, PLANTATIONS, groundAt, FLY_Z, FLY_H,
} from './world'

const PLANE = new THREE.PlaneGeometry(1, 1)
const rotW = (cx: number, cz: number, rot: number, lx: number, lz: number) => ({
  x: cx + lx * Math.cos(rot) + lz * Math.sin(rot),
  z: cz - lx * Math.sin(rot) + lz * Math.cos(rot),
})

export function free(x: number, z: number, r = 2, rm = 3) {
  if (roadEdgeDist(x, z) < rm) return false
  if (Math.abs(z) < STREAM_Z + 20 && Math.abs(x - sx(z)) < 12 + r) return false
  for (const b of W.buildingsMap) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return false
  for (const p of PADDIES) if (Math.abs(x - p.x) < p.w / 2 + r + 2 && Math.abs(z - p.z) < p.d / 2 + r + 2) return false
  return true
}
function rectFree(x0: number, z0: number, x1: number, z1: number, rm = 1.2) {
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2], [(x0 + x1) / 2, (z0 + z1) / 2]]) {
    if (roadEdgeDist(x, z) < rm) return false
    if (Math.abs(z) < STREAM_Z + 20 && Math.abs(x - sx(z)) < 14) return false
  }
  for (const b of W.buildingsMap) if (x1 > b.x0 - 0.15 && x0 < b.x1 + 0.15 && z1 > b.z0 - 0.15 && z0 < b.z1 + 0.15) return false
  for (const p of PADDIES) if (x1 > p.x - p.w / 2 - 3 && x0 < p.x + p.w / 2 + 3 && z1 > p.z - p.d / 2 - 3 && z0 < p.z + p.d / 2 + 3) return false
  return true
}

const PALETTE = [0xf2c6c2, 0xe8d9a0, 0xb9d8c2, 0xf6e3a8, 0xa9c8e6, 0xe8b48a, 0xd9d9d9, 0xc7e0a2, 0xe9a8a0, 0xcfc3e6, 0xf0f0e6, 0x9fd1d0]
const AWN = [0x1f5fa8, 0xb3282d, 0x2b7a4b, 0xd9a521, 0xdd6b20, 0x1f5fa8]
const SIGN_PAL: [string, string][] = [['#14306e', '#fff'], ['#a4141b', '#fff'], ['#0d6b3e', '#fff'], ['#f3c614', '#7a1010'], ['#fff', '#14306e'], ['#5a1a6e', '#ffe45a']]
const SHOPS = [
  ['ಜನರಲ್ ಸ್ಟೋರ್ಸ್', 'GENERAL STORES'], ['ಮೆಡಿಕಲ್ಸ್', 'MEDICALS'], ['ಬೇಕರಿ', 'BAKERY'], ['ಟೈಲರ್', 'TAILOR'], ['ಹಾರ್ಡ್‌ವೇರ್', 'HARDWARE'],
  ['ಮೊಬೈಲ್ ಶಾಪ್', 'MOBILE SHOP'], ['ಫ್ಯಾನ್ಸಿ ಸ್ಟೋರ್', 'FANCY STORE'], ['ಜವಳಿ ಅಂಗಡಿ', 'TEXTILES'], ['ದಿನಸಿ ಅಂಗಡಿ', 'PROVISION STORES'],
  ['ಸಲೂನ್', 'SALOON'], ['ಕೃಷಿ ಕೇಂದ್ರ', 'AGRO CENTRE'], ['ಸ್ಟೇಷನರಿ', 'STATIONERY'], ['ಚಪ್ಪಲಿ ಅಂಗಡಿ', 'FOOTWEAR'], ['ಎಲೆಕ್ಟ್ರಿಕಲ್ಸ್', 'ELECTRICALS'],
  ['ಶ್ರೀ ಲಕ್ಷ್ಮೀ ಜನರಲ್ ಸ್ಟೋರ್ಸ್', 'SHRI LAKSHMI GENERAL STORES'],
]
const signMats: THREE.MeshStandardMaterial[] = []
function signMat(i: number) {
  i = i % SHOPS.length
  if (!signMats[i]) {
    const pal = SIGN_PAL[i % SIGN_PAL.length]
    const tex = signTexture([{ t: SHOPS[i][0], s: 50 }, { t: SHOPS[i][1], s: 30 }], pal[0], pal[1], 512, 128, true, pal[1])
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 })
    MATS.night.push({ mat: m, max: 0.5 })
    signMats[i] = m
  }
  return signMats[i]
}

export function buildTown(root: THREE.Object3D, chunks: ChunkSet, batch: Batch, inst: Instancer, rng: () => number) {
  const R = (a: number, b: number) => a + rng() * (b - a)
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)]
  const shopLight = (x: number, y: number, z: number) => W.lights.push({ x, y, z, r: 1, g: 0.72, b: 0.4, kind: 'shop' })

  const footprint = (cx: number, cz: number, w: number, d: number, rot: number) => {
    const a = rotW(cx, cz, rot, -w / 2, -d / 2), b = rotW(cx, cz, rot, w / 2, d / 2)
    return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }
  }

  function shopBuilding(cx: number, cz: number, w: number, d: number, floors: number, rot: number, o: any = {}) {
    const fp = footprint(cx, cz, w, d, rot)
    const H = floors * 3.3 + 0.7
    const color = o.color ?? pick(PALETTE)
    const geo = boxWorldUV(w, H, d)
    batch.add(geo, facadeMat(color), cx, H / 2, cz, rot)
    const front = (lx: number, ly: number, lzOff: number) => rotW(cx, cz, rot, lx, d / 2 + lzOff)
    // shopfront
    const sfw = Math.max(2.5, w - 0.9)
    const sf = front(0, 0, 0.04)
    batch.add(PLANE, shopfrontMat(o.shopVariant ?? Math.floor(rng() * 4)), sf.x, 1.62, sf.z, rot, sfw, 2.5, 1)
    // pillars
    for (const side of [-1, 1]) {
      const p = front(side * (sfw / 2 + 0.2), 0, 0.12)
      batch.add(UB, T.concrete, p.x, 0, p.z, rot, 0.4, 3.0, 0.25)
    }
    // awning
    const aw = front(0, 0, 0.9)
    const awc = o.awning ?? pick(AWN)
    batch.add(UB, std(awc, 0.9), aw.x, 2.85, aw.z, rot, w - 0.2, 0.06, 1.8, true, 0.26)
    // sign
    const si = o.signIdx ?? Math.floor(rng() * (SHOPS.length - 1))
    const sg = front(0, 0, 0.07)
    if (!o.bigSign) batch.add(PLANE, signMat(si), sg.x, 3.55 + (floors === 1 ? 0.0 : 0), sg.z, rot, Math.min(4.2, w - 0.8), 1.05, 1, false)
    // parapet + roof clutter
    const par = (lx: number, lz: number, ww: number, dd: number) => {
      const p = rotW(cx, cz, rot, lx, lz)
      batch.add(UB, T.concrete, p.x, H, p.z, rot, ww, 0.75, dd)
    }
    par(0, d / 2 - 0.1, w, 0.2)
    par(0, -d / 2 + 0.1, w, 0.2)
    par(w / 2 - 0.1, 0, 0.2, d)
    par(-w / 2 + 0.1, 0, 0.2, d)
    if (rng() < 0.7) {
      const p = rotW(cx, cz, rot, R(-w / 3, w / 3), R(-d / 3, d / 3))
      batch.add(UC, T.tank, p.x, H, p.z, 0, 0.6, 1.0, 0.6)
      batch.add(UB, T.concreteDark, p.x, H, p.z, 0, 0.2, 0.05, 0.2)
    }
    if (rng() < 0.3) {
      const p = rotW(cx, cz, rot, R(-w / 4, w / 4), -d / 4)
      batch.add(UB, T.concreteDark, p.x, H, p.z, rot, 2.2, 2.3, 2.2)
    }
    addBox(fp.x0, fp.z0, fp.x1, fp.z1)
    W.buildingsMap.push({ ...fp, kind: 'shop' })
    // light + door POI
    const dp = front(0, 0, 1.6)
    if (rng() < 0.6 || o.lit) shopLight(dp.x, 2.6, dp.z)
    W.pois.push({ x: dp.x, z: dp.z, kind: 'door', face: rot })
    return { fp, H, door: front(0, 0, 0.9), rot }
  }

  // ---------------- main street ----------------
  const stallSlots = [
    { x: -104, s: -1, kind: 'coconut' }, { x: -66, s: 1, kind: 'veg' }, { x: -40, s: -1, kind: 'tea' }, { x: 26, s: -1, kind: 'flower' },
    { x: 48, s: 1, kind: 'fruit' }, { x: 90, s: 1, kind: 'veg' }, { x: 124, s: -1, kind: 'coconut' }, { x: -142, s: 1, kind: 'tea' },
  ]
  const busSlots = [{ x: -76, s: -1 }, { x: 72, s: 1 }]
  for (const s of stallSlots) W.buildingsMap.push({ x0: s.x - 4.5, x1: s.x + 4.5, z0: s.s < 0 ? -20 : 7, z1: s.s < 0 ? -7 : 20, kind: 'slot' })
  for (const s of busSlots) W.buildingsMap.push({ x0: s.x - 6, x1: s.x + 6, z0: s.s < 0 ? -20 : 7.5, z1: s.s < 0 ? -7.5 : 20, kind: 'slot' })

  W.buildingsMap.push({ x0: -203.5, x1: -188.5, z0: 7.0, z1: 23, kind: 'home' })
  // special enterable buildings
  const specials: any[] = []
  {
    // Nellyadi Stores - north side next to the market road, hotel - south side
    const w = 11, d = 11
    const cxN = 7.5 + w / 2 + 0.3, czN = -7.5 - d / 2
    const sN = shopBuilding(cxN, czN, w, d, 3, 0, { color: 0xf0c4c8, bigSign: true, signIdx: 0, awning: 0xb3282d, lit: true, shopVariant: 1 })
    // big navy sign
    const tex = signTexture([{ t: 'ನೆಲ್ಲ್ಯಾಡಿ ಸ್ಟೋರ್ಸ್', s: 70, col: '#fff' }, { t: 'NELLYADI STORES', s: 46 }], '#14306e', '#fff', 512, 192, true, '#fff')
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 })
    MATS.night.push({ mat: m, max: 0.6 })
    const mesh = new THREE.Mesh(PLANE, m)
    mesh.scale.set(9.2, 2.2, 1)
    mesh.position.set(cxN, 4.55, czN + d / 2 + 0.3)
    mesh.rotation.x = -0.12
    root.add(mesh)
    batch.add(UB, T.metal, cxN, 3.4, czN + d / 2 + 0.25, 0, 9.4, 0.12, 0.3)
    W.doors.push({ id: 'store', x: sN.door.x, z: sN.door.z + 0.3, face: 0, interior: 'store', label: 'Nellyadi Stores', open: [6, 22] })
    const cxS = -(7.5 + w / 2 + 0.3), czS = 7.5 + d / 2
    const sS = shopBuilding(cxS, czS, w, d, 2, Math.PI, { color: 0xf4e3a2, awning: 0x2b7a4b, signIdx: 8, lit: true })
    const tex2 = signTexture([{ t: 'ಉಡುಪಿ ಹೋಟೆಲ್', s: 66 }, { t: 'UDUPI HOTEL  •  MEALS • TIFFIN', s: 30 }], '#7a1010', '#ffe9a0', 512, 160, true, '#ffe9a0')
    const m2 = new THREE.MeshStandardMaterial({ map: tex2, emissiveMap: tex2, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 })
    MATS.night.push({ mat: m2, max: 0.6 })
    const mesh2 = new THREE.Mesh(PLANE, m2)
    mesh2.scale.set(7.6, 1.7, 1)
    mesh2.position.set(cxS, 4.2, czS - d / 2 - 0.3)
    mesh2.rotation.y = Math.PI
    root.add(mesh2)
    W.doors.push({ id: 'hotel', x: sS.door.x, z: sS.door.z - 0.3, face: Math.PI, interior: 'hotel', label: 'Udupi Hotel', open: [6, 21] })
    specials.push(sN, sS)
  }

  for (const s of [-1, 1]) {
    let x = -180
    while (x < 180) {
      const slot = stallSlots.find((q) => q.s === s && Math.abs(q.x - (x + 5)) < 7) || busSlots.find((q) => q.s === s && Math.abs(q.x - (x + 5)) < 9)
      if (slot) {
        x = slot.x + (slot.kind ? 5 : 7)
        continue
      }
      const w = R(5.2, 10.5)
      const dens = 1 - Math.abs(x) / 260
      const floors = rng() < 0.45 * dens + 0.1 ? 3 : rng() < 0.7 ? 2 : 1
      const d = R(9, 13)
      const cx = x + w / 2
      const cz = s * (7.5 + d / 2)
      const fp = footprint(cx, cz, w, d, s < 0 ? 0 : Math.PI)
      if (rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 1.6)) {
        shopBuilding(cx, cz, w, d, floors, s < 0 ? 0 : Math.PI)
        x += w + (rng() < 0.12 ? R(1, 3.5) : 0.25)
      } else x += 2.5
    }
  }
  // market road sides
  for (const s of [-1, 1]) {
    for (const [z0, z1] of [[-112, -22], [22, 112]]) {
      let z = z0
      while (z < z1) {
        const w = R(5.5, 9.5), d = R(8, 12)
        const cz = z + w / 2, cx = s * (7.5 + d / 2)
        const rot = s < 0 ? Math.PI / 2 : -Math.PI / 2
        const fp = footprint(cx, cz, w, d, rot)
        if (rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 1.6)) {
          shopBuilding(cx, cz, w, d, rng() < 0.4 ? 2 : 1, rot)
          z += w + 0.25
        } else z += 3
      }
    }
  }
  // sparse roadside shops further out on the main road
  for (const s of [-1, 1])
    for (const [x0, x1] of [[190, 330], [-340, -190]]) {
      let x = x0
      while (x < x1) {
        const w = R(5.5, 9), d = R(8, 11)
        const main = ROAD_BY_ID.main
        const p = main.pts.reduce((b, q) => (Math.abs(q.x - x) < Math.abs(b.x - x) ? q : b), main.pts[0])
        const cx = x + w / 2, cz = p.z + s * (7.8 + d / 2)
        const fp = footprint(cx, cz, w, d, s < 0 ? 0 : Math.PI)
        if (rng() < 0.55 && rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 2.5)) {
          shopBuilding(cx, cz, w, d, rng() < 0.3 ? 2 : 1, s < 0 ? 0 : Math.PI)
          x += w + R(1, 10)
        } else x += R(8, 18)
      }
    }
  // highway-side strip near the flyover (matches the concept art feel)
  {
    let x = 60
    while (x < 270) {
      const w = R(7, 12), d = R(9, 12)
      const cx = x + w / 2, cz = -260 + 8 + 4.2 + d / 2
      if (rectFree(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 3.2)) {
        shopBuilding(cx, cz, w, d, rng() < 0.5 ? 3 : 2, Math.PI, { awning: 0x1f5fa8 })
        x += w + R(0.3, 4)
      } else x += 5
    }
    x = 340
    while (x < 540) {
      const w = R(7, 12), d = R(9, 12)
      const cx = x + w / 2, cz = -260 - 8 - 4.2 - d / 2
      if (rectFree(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 3.2)) {
        shopBuilding(cx, cz, w, d, rng() < 0.5 ? 3 : 2, 0, { awning: 0x1f5fa8 })
        x += w + R(0.3, 6)
      } else x += 5
    }
  }

  // ---------------- stalls ----------------
  const stallSign: Record<string, any> = {}
  const stallDefs: Record<string, any> = {
    coconut: { kn: 'ಎಳನೀರು', en: 'TENDER COCONUT', bg: '#1d7a3a', tarp: 0x1f5fa8 },
    veg: { kn: 'ತರಕಾರಿ', en: 'VEGETABLES', bg: '#b3282d', tarp: 0x2b7a4b },
    fruit: { kn: 'ಹಣ್ಣುಗಳು', en: 'FRUITS', bg: '#d9791a', tarp: 0xb3282d },
    flower: { kn: 'ಹೂವು', en: 'FLOWERS', bg: '#8e2b8e', tarp: 0xd9a521 },
    tea: { kn: 'ಚಹಾ', en: 'TEA • SNACKS', bg: '#5a3a1e', tarp: 0x1f5fa8 },
  }
  const sphere = new THREE.IcosahedronGeometry(1, 0)
  for (const sl of stallSlots) {
    const def = stallDefs[sl.kind]
    const rot = sl.s < 0 ? 0 : Math.PI
    const cz = sl.s * 9.6
    const cx = sl.x
    const P = (lx: number, lz: number) => rotW(cx, cz, rot, lx, lz)
    // table
    const t = P(0, 0.4)
    batch.add(UB, T.wood, t.x, 0, t.z, rot, 2.8, 0.85, 0.9)
    // canopy
    for (const lx of [-1.7, 1.7])
      for (const lz of [-1.2, 1.2]) {
        const p = P(lx, lz)
        batch.add(UC6, T.wood, p.x, 0, p.z, 0, 0.045, 2.5, 0.045)
      }
    const cp = P(0, 0)
    batch.add(UB, std(def.tarp, 0.9), cp.x, 2.45, cp.z, rot, 3.8, 0.05, 3.1, true, 0.1)
    // goods
    const g = (lx: number, lz: number, y: number, s: number, hex: number, sy = 1) => {
      const p = P(lx, lz)
      batch.add(sphere, std(hex, 0.7), p.x, y, p.z, rng() * 6, s, s * sy, s, false)
    }
    if (sl.kind === 'coconut') {
      for (let i = 0; i < 34; i++) {
        const lx = R(-1.3, 1.3), lz = 0.15 + R(0, 0.5)
        g(lx, lz, 0.95 + R(0, 0.3) * (1 - Math.abs(lx) / 1.5), 0.15, rng() < 0.15 ? 0xd7b23a : 0x6aa84f)
      }
      for (let i = 0; i < 22; i++) g(R(-1.4, 1.4), 1.05 + R(0, 0.5), 0.12, 0.17, 0x78b157)
    } else if (sl.kind === 'veg') {
      for (let i = 0; i < 44; i++) g(R(-1.3, 1.3), 0.15 + R(0, 0.5), 0.95 + R(0, 0.1), 0.1 + R(0, 0.05), pick([0xd62828, 0x4f9d2d, 0xf77f00, 0x6a2c70, 0x90be6d]))
      for (let k = 0; k < 3; k++) {
        const p = P(-1.0 + k, 1.3)
        batch.add(UB, std(0xc9a063, 0.9), p.x, 0, p.z, rot, 0.7, 0.35, 0.5)
        g(-1.0 + k, 1.3, 0.4, 0.2, pick([0xd62828, 0x4f9d2d, 0xf77f00]))
      }
    } else if (sl.kind === 'fruit') {
      for (let i = 0; i < 26; i++) g(R(-1.3, 1.3), 0.15 + R(0, 0.5), 0.98, 0.1, pick([0xf2c230, 0xf2c230, 0xe76f51, 0x6aa84f]), 1.6)
      g(-1.0, 0.0, 1.1, 0.28, 0x2e7d32, 0.9)
      g(-0.5, 0.0, 1.1, 0.28, 0x2e7d32, 0.9)
      for (let i = 0; i < 4; i++) {
        const p = P(-1.2 + i * 0.8, -0.9)
        batch.add(UB, T.wood, p.x, 1.6, p.z, 0, 0.05, 0.05, 0.05)
        g(-1.2 + i * 0.8, -0.9, 1.5, 0.22, 0xf2c230, 2)
      }
    } else if (sl.kind === 'flower') {
      for (let i = 0; i < 46; i++) g(R(-1.3, 1.3), 0.15 + R(0, 0.5), 0.98, 0.12, pick([0xff9f1c, 0xffbf00, 0xffffff, 0xe63946, 0xff9f1c]))
      for (let i = 0; i < 6; i++) g(-1.2 + i * 0.5, -0.5, 1.9 - R(0, 0.4), 0.08, pick([0xff9f1c, 0xffffff, 0xe63946]), 4)
    } else {
      // tea kiosk
      const k = P(0, 0.5)
      batch.add(UB, std(0x7d5a3c, 0.9), k.x, 0, k.z, rot, 2.8, 1.05, 0.9)
      g(-0.9, 0.5, 1.2, 0.3, 0x222222, 1.2)
      g(0.2, 0.5, 1.15, 0.22, 0xe0e0e0, 1.1)
      for (let i = 0; i < 6; i++) g(-1.2 + i * 0.35, 0.45, 1.35, 0.1, pick([0xf4a261, 0xe9c46a, 0xd4a373]))
      for (const lx of [-0.8, 0.5]) {
        const p = P(lx, 2.0)
        batch.add(UC, std(0xc0392b, 0.8), p.x, 0, p.z, 0, 0.22, 0.4, 0.22)
        addCircle(p.x, p.z, 0.25)
      }
    }
    // stall sign
    let tex = stallSign[sl.kind]
    if (!tex) {
      tex = new THREE.MeshStandardMaterial({ map: signTexture([{ t: def.kn, s: 54 }, { t: def.en, s: 30 }], def.bg, '#fff', 512, 128), roughness: 0.7 })
      stallSign[sl.kind] = tex
    }
    const sp = P(0, 1.56)
    batch.add(PLANE, tex, sp.x, 2.15, sp.z, rot, 2.8, 0.7, 1, false)
    const fp = footprint(cx, cz + sl.s * 0, 3.0, 1.0, rot)
    const tp = P(0, 0.4)
    const f2 = footprint(tp.x, tp.z, 2.9, 1.0, rot)
    addBox(f2.x0, f2.z0, f2.x1, f2.z1)
    const front = P(0, 2.1)
    const keeper = P(0, -0.4)
    W.stalls.push({ x: keeper.x, z: keeper.z, face: rot, kind: sl.kind, name: def.en, fx: front.x, fz: front.z })
    W.pois.push({ x: front.x, z: front.z, kind: 'stall', face: rot + Math.PI })
    const lp = P(0, 0.2)
    shopLight(lp.x, 2.2, lp.z)
  }

  // ---------------- bus stops ----------------
  for (const bs of busSlots) {
    const rot = bs.s < 0 ? 0 : Math.PI
    const cz = bs.s * 10.2
    const P = (lx: number, lz: number) => rotW(bs.x, cz, rot, lx, lz)
    const pad = P(0, 0)
    batch.add(UB, T.sidewalk, pad.x, 0, pad.z, rot, 7, 0.18, 3.4, false)
    for (const lx of [-2.9, 2.9])
      for (const lz of [-1.3, 1.3]) {
        const p = P(lx, lz)
        batch.add(UC6, T.metal, p.x, 0, p.z, 0, 0.06, 2.9, 0.06)
      }
    batch.add(UB, std(0x1c4f8a, 0.7), pad.x, 2.9, pad.z, rot, 7.2, 0.14, 3.4, true, 0.08)
    const back = P(0, -1.5)
    batch.add(UB, T.concreteDark, back.x, 0.2, back.z, rot, 6.6, 2.5, 0.15)
    const b1 = P(0, -0.9)
    batch.add(UB, T.wood, b1.x, 0.18, b1.z, rot, 4, 0.1, 0.55)
    batch.add(UB, T.metal, b1.x, 0, b1.z, rot, 3.6, 0.2, 0.4)
    const bb = footprint(b1.x, b1.z, 4, 0.5, rot)
    W.benches.push({ x: b1.x, z: b1.z, face: rot })
    const tx = signTexture([{ t: 'ಬಸ್ ನಿಲ್ದಾಣ', s: 52 }, { t: 'BUS STOP • KSRTC', s: 32 }], '#0d6b3e', '#fff', 512, 128)
    const sm = new THREE.MeshStandardMaterial({ map: tx, roughness: 0.7 })
    const sg = P(0, 1.78)
    batch.add(PLANE, sm, sg.x, 3.25, sg.z, rot, 3.6, 0.9, 1, false)
    const stand = P(0, 2.2)
    W.pois.push({ x: stand.x, z: stand.z, kind: 'busstop', face: rot + Math.PI })
    W.pois.push({ x: stand.x + 1.5, z: stand.z, kind: 'busstop', face: rot + Math.PI })
    W.pois.push({ x: stand.x - 1.5, z: stand.z, kind: 'busstop', face: rot + Math.PI })
    shopLight(pad.x, 2.6, pad.z)
    W.busStops = W.busStops || []
    W.busStops.push({ x: bs.x, z: bs.s * 2.25, side: bs.s })
  }

  // ---------------- houses ----------------
  const hipGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0)
  const wallColors = [0xf4efe2, 0xf2d7b6, 0xe9c3b8, 0xc8dcc0, 0xe9dca5, 0xbcd4e6]
  function compound(cx: number, cz: number, w: number, d: number, rot: number) {
    const gate = rng() < 0.5 ? 1 : -1
    const sides: [number, number, number, number][] = [[0, -d / 2, w, 0.25], [-w / 2, 0, 0.25, d], [w / 2, 0, 0.25, d]]
    for (const [lx, lz, ww, dd] of sides) {
      const p = rotW(cx, cz, rot, lx, lz)
      batch.add(UB, T.whitewash, p.x, 0, p.z, rot, ww, 1.2, dd)
      const fp = footprint(p.x, p.z, ww, dd, rot)
      addBox(fp.x0, fp.z0, fp.x1, fp.z1)
    }
    // front wall with a gate gap
    const gw = 3.2
    const seg = (w - gw) / 2
    for (const sgn of [-1, 1]) {
      const lx = sgn * (gw / 2 + seg / 2) + gate * 0
      const p = rotW(cx, cz, rot, lx, d / 2)
      batch.add(UB, T.whitewash, p.x, 0, p.z, rot, seg, 1.2, 0.25)
      const fp = footprint(p.x, p.z, seg, 0.25, rot)
      addBox(fp.x0, fp.z0, fp.x1, fp.z1)
    }
    for (const sgn of [-1, 1]) {
      const p = rotW(cx, cz, rot, sgn * gw / 2, d / 2)
      batch.add(UB, T.concrete, p.x, 0, p.z, rot, 0.4, 1.6, 0.4)
    }
  }
  function tradHouse(cx: number, cz: number, rot: number, w: number, d: number) {
    const color = pick(wallColors)
    const wallH = 3.1
    batch.add(boxWorldUV(w, wallH, d, 6, 6), std(color, 0.95), cx, wallH / 2, cz, rot)
    // plinth
    batch.add(UB, T.concreteDark, cx, 0, cz, rot, w + 0.2, 0.4, d + 0.2)
    // hip roof
    const rh = 2.3
    batch.add(hipGeo, T.roof, cx, wallH, cz, rot, (w + 2.0), rh, (d + 2.0), false)
    // veranda at front
    const vz = d / 2 + 1.1
    const vp = rotW(cx, cz, rot, 0, vz)
    batch.add(UB, T.concreteDark, vp.x, 0, vp.z, rot, w - 0.4, 0.3, 2.0)
    batch.add(UB, T.roof, vp.x, 2.7, vp.z, rot, w, 0.08, 2.6, true, 0.2)
    for (const lx of [-w / 2 + 0.5, -w / 6, w / 6, w / 2 - 0.5]) {
      const p = rotW(cx, cz, rot, lx, d / 2 + 1.9)
      batch.add(UB, T.wood, p.x, 0.3, p.z, rot, 0.2, 2.4, 0.2)
    }
    // door and windows
    const dp = rotW(cx, cz, rot, 0, d / 2 + 0.03)
    batch.add(PLANE, std(0x4a2f1b, 0.8), dp.x, 1.15, dp.z, rot, 1.1, 2.1, 1, false)
    for (const lx of [-w / 3, w / 3]) {
      const p = rotW(cx, cz, rot, lx, d / 2 + 0.03)
      batch.add(PLANE, std(0x1d2a33, 0.3, 0.3), p.x, 1.7, p.z, rot, 0.9, 1.0, 1, false)
    }
    const fp = footprint(cx, cz, w, d, rot)
    addBox(fp.x0, fp.z0, fp.x1, fp.z1)
    W.buildingsMap.push({ ...fp, kind: 'house' })
    W.houses.push({ x: dp.x + Math.sin(rot) * 2.8, z: dp.z + Math.cos(rot) * 2.8 })
    if (rng() < 0.6) {
      const lp = rotW(cx, cz, rot, 0, d / 2 + 2.2)
      shopLight(lp.x, 2.2, lp.z)
    }
    return { door: dp }
  }
  function modernHouse(cx: number, cz: number, rot: number, w: number, d: number, floors: number, gy: number, drop = 3.5) {
    const H = floors * 3.2 + 0.4
    const color = pick(PALETTE)
    const g = boxWorldUV(w, H + drop, d)
    batch.add(g, facadeMat(color), cx, gy - drop + (H + drop) / 2, cz, rot)
    batch.add(UB, T.concrete, cx, gy + H, cz, rot, w + 0.3, 0.3, d + 0.3)
    if (rng() < 0.7) batch.add(UC, T.tank, cx + R(-1, 1), gy + H + 0.3, cz + R(-1, 1), 0, 0.6, 1.0, 0.6)
    const fp = footprint(cx, cz, w, d, rot)
    addBox(fp.x0, fp.z0, fp.x1, fp.z1)
    W.buildingsMap.push({ ...fp, kind: 'house' })
  }
  // the player's own traditional house on the west side of town
  {
    const hd = tradHouse(-196, 14, Math.PI, 10, 8)
    W.doors.push({ id: 'home', x: hd.door.x, z: hd.door.z - 1.6, face: Math.PI, interior: 'home', label: 'Your home', open: [0, 24] })
    for (const [px, pz] of [[-206, 12], [-188, 20]]) addCoconut(px, pz)
  }
  // traditional houses & compounds scattered along rural lanes and in the valley
  let nTrad = 0
  for (let tries = 0; tries < 900 && nTrad < 30; tries++) {
    const lane = pick(ROADS.filter((r) => r.kind === 'lane' || r.kind === 'market' || r.kind === 'main'))
    const s0 = R(30, lane.len - 30)
    const p = posOn(lane, s0)
    const side = rng() < 0.5 ? -1 : 1
    const off = lane.half + R(10, 22)
    const hx = p.x + -p.tz * side * off, hz = p.z + p.tx * side * off
    if (Math.abs(hx) < 190 && Math.abs(hz) < 25) continue
    const w = R(9, 13), d = R(7, 9)
    // face the lane
    const rot = Math.atan2(p.x - hx, p.z - hz)
    const rr = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2)
    const cw = w + 8, cd = d + 9
    const fp = footprint(hx, hz, cw, cd, rr)
    if (!rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 3)) continue
    if (terrainH(hx, hz) > 3 || Math.abs(terrainH(hx + 8, hz) - terrainH(hx - 8, hz)) > 2.5) continue
    tradHouse(hx, hz - 0, rr, w, d)
    compound(hx, hz, cw, cd, rr)
    W.buildingsMap.push({ ...fp, kind: 'compound' })
    nTrad++
    // coconut palms inside the compound
    for (let k = 0; k < 3; k++) {
      const lp = rotW(hx, hz, rr, R(-cw / 2 + 1.5, cw / 2 - 1.5), R(-cd / 2 + 1.2, -d / 2 - 0.5))
      addCoconut(lp.x, lp.z)
    }
  }
  // modern 2-storey houses in the valley
  let nMod = 0
  for (let tries = 0; tries < 900 && nMod < 22; tries++) {
    const lane = pick(ROADS.filter((r) => r.kind === 'lane' || r.kind === 'market' || r.kind === 'conn'))
    const p = posOn(lane, R(30, lane.len - 30))
    const side = rng() < 0.5 ? -1 : 1
    const off = lane.half + R(9, 26)
    const hx = p.x + -p.tz * side * off, hz = p.z + p.tx * side * off
    if (Math.abs(hx) < 190 && Math.abs(hz) < 25) continue
    const w = R(8, 12), d = R(8, 11)
    const fp = footprint(hx, hz, w + 2, d + 2, 0)
    if (!rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 3)) continue
    const ys = [terrainH(fp.x0, fp.z0), terrainH(fp.x1, fp.z1), terrainH(fp.x0, fp.z1), terrainH(fp.x1, fp.z0)]
    const gy = Math.max(...ys)
    if (gy - Math.min(...ys) > 3.5) continue
    modernHouse(hx, hz, 0, w, d, rng() < 0.5 ? 2 : 1, gy)
    W.houses.push({ x: hx, z: hz + d / 2 + 1.5 })
    nMod++
  }
  // hill-side houses (visual skyline, as seen in the concept art)
  let nHill = 0
  for (let tries = 0; tries < 2500 && nHill < 38; tries++) {
    const hx = R(-800, 800), hz = R(-700, 700)
    const h = terrainH(hx, hz)
    if (h < 6 || h > 55) continue
    const w = R(7, 11), d = R(7, 10)
    const fp = footprint(hx, hz, w + 1, d + 1, 0)
    const ys = [terrainH(fp.x0, fp.z0), terrainH(fp.x1, fp.z1), terrainH(fp.x0, fp.z1), terrainH(fp.x1, fp.z0)]
    if (Math.max(...ys) - Math.min(...ys) > 4) continue
    if (!rectFree(fp.x0, fp.z0, fp.x1, fp.z1, 6)) continue
    if (rng() < 0.45) tradHouse(hx, hz, Math.floor(rng() * 4) * (Math.PI / 2), w, d)
    else modernHouse(hx, hz, 0, w, d, rng() < 0.6 ? 2 : 3, Math.max(...ys), 5)
    nHill++
  }

  // ---------------- vegetation ----------------
  function crownCol() { return new THREE.Color().setHSL(0.27 + R(-0.03, 0.03), 0.5, R(0.42, 0.6)) }
  function addCoconut(x: number, z: number, big = 1) {
    const y = terrainH(x, z) - 0.1
    const s = R(0.8, 1.2) * big
    const ry = R(0, 6.28)
    inst.add('cocoTrunk', x, y, z, ry, s, s, s)
    inst.add('cocoCrown', x, y, z, ry, s, s, s, crownCol())
    addCircle(x, z, 0.28 * s)
  }
  function addAreca(x: number, z: number) {
    const y = terrainH(x, z) - 0.1
    const s = R(0.6, 1.1)
    const ry = R(0, 6.28)
    inst.add('arecaTrunk', x, y, z, ry, s, s, s, undefined, R(-0.04, 0.04), R(-0.04, 0.04))
    inst.add('arecaCrown', x, y, z, ry, s, s, s, crownCol(), 0, 0)
    addCircle(x, z, 0.14)
  }
  function addBanana(x: number, z: number) {
    const y = terrainH(x, z)
    const s = R(0.8, 1.3)
    inst.add('banana', x, y, z, R(0, 6), s, s, s, crownCol())
    addCircle(x, z, 0.2)
  }
  function addBroad(x: number, z: number, s: number) {
    const y = terrainH(x, z) - 0.2
    const c = new THREE.Color().setHSL(0.28 + R(-0.04, 0.03), 0.5, R(0.2, 0.34))
    inst.add('broadTrunk', x, y, z, R(0, 6), s, s, s)
    inst.add('broadCrown', x, y, z, R(0, 6), s, s, s, c)
    addCircle(x, z, 0.45 * s)
  }
  // plantations
  for (const pl of PLANTATIONS) {
    const sp = pl.kind === 'areca' ? 4.6 : 8.2
    for (let x = pl.x - pl.w / 2; x < pl.x + pl.w / 2; x += sp)
      for (let z = pl.z - pl.d / 2; z < pl.z + pl.d / 2; z += sp) {
        const px = x + R(-0.8, 0.8), pz = z + R(-0.8, 0.8)
        if (!free(px, pz, 1.2, 5.5)) continue
        // soft edge
        const ex = Math.min(px - (pl.x - pl.w / 2), pl.x + pl.w / 2 - px) / 14, ez = Math.min(pz - (pl.z - pl.d / 2), pl.z + pl.d / 2 - pz) / 14
        if (rng() > Math.min(1, Math.min(ex, ez) + 0.3)) continue
        if (pl.kind === 'areca') {
          addAreca(px, pz)
          if (rng() < 0.12) addBanana(px + 1.6, pz + 1.2)
        } else {
          addCoconut(px, pz)
          if (rng() < 0.2) addBanana(px + 2.5, pz)
        }
      }
  }
  // palms and trees around the town and along the roads
  for (let i = 0; i < 360; i++) {
    const x = R(-260, 260), z = (rng() < 0.5 ? -1 : 1) * R(22, 90)
    if (free(x, z, 2.5, 5)) rng() < 0.7 ? addCoconut(x, z) : rng() < 0.5 ? addBroad(x, z, R(0.9, 1.4)) : addBanana(x, z)
  }
  for (const r of ROADS) {
    const step = r.kind === 'lane' ? 9 : r.kind === 'hw' ? 28 : 14
    for (let s = 6; s < r.len; s += step) {
      const p = posOn(r, s)
      if (r.kind === 'conn' && Math.abs(p.z - FLY_Z) < 135) continue
      for (const side of [-1, 1]) {
        if (rng() < 0.45) continue
        const off = r.half + R(3, 9)
        const x = p.x + -p.tz * side * off, z = p.z + p.tx * side * off
        if (!free(x, z, 1.5, r.half > 6 ? 10 : 3.5)) continue
        const q = rng()
        if (q < 0.4) addCoconut(x, z)
        else if (q < 0.55) addAreca(x, z)
        else if (q < 0.7) addBanana(x, z)
        else if (q < 0.85) addBroad(x, z, R(0.9, 1.7))
        else {
          // bush
          const y = terrainH(x, z)
          inst.add('bush', x, y + 0.3, z, R(0, 6), R(0.8, 1.6), R(0.5, 1.0), R(0.8, 1.6), crownCol())
        }
      }
      // undergrowth on verges
      if (rng() < 0.7) {
        const side = rng() < 0.5 ? -1 : 1
        const off = r.half + R(1.4, 3.6)
        const x = p.x + -p.tz * side * off, z = p.z + p.tx * side * off
        if (free(x, z, 0.5, r.half + 0.8)) inst.add('bush', x, terrainH(x, z) + 0.2, z, R(0, 6), R(0.6, 1.4), R(0.4, 0.8), R(0.6, 1.4), new THREE.Color().setHSL(0.25 + R(0, 0.06), 0.5, R(0.3, 0.45)))
      }
    }
  }
  // big shade trees near the market junction (as in the street reference)
  for (const [x, z, s] of [[-14, -22, 1.9], [18, 22, 1.7], [-11, 24, 1.6], [32, -23, 1.8], [-60, 24, 1.7], [-40, 30, 1.5], [55, -26, 1.6], [150, 22, 1.7]]) {
    if (free(x, z, 3, 4)) addBroad(x, z, s)
  }
  // banana clumps along the stream & riverside shrubs
  for (let z = -STREAM_Z + 20; z < STREAM_Z - 20; z += 14) {
    for (const side of [-1, 1]) {
      const x = sx(z) + side * R(8, 14)
      if (rng() < 0.7 && free(x, z, 1, 4)) (rng() < 0.4 ? addBanana : (a, b) => inst.add('bush', a, terrainH(a, b) + 0.3, b, R(0, 6), R(1, 2), R(0.7, 1.2), R(1, 2), crownCol()))(x, z)
    }
  }
  // forest on the hills (low-cost single blob per tree)
  let nf = 0
  for (let i = 0; i < 16000 && nf < 6500; i++) {
    const x = R(-1050, 1050), z = R(-1050, 1050)
    const h = terrainH(x, z)
    if (h < 7) continue
    if (roadEdgeDist(x, z) < 12) continue
    if (rng() > 0.55 + h / 160) continue
    const s = R(0.8, 1.7)
    const col = new THREE.Color().setHSL(0.3 + R(-0.05, 0.02), 0.45, R(0.14, 0.27))
    inst.add('forest', x, h - 0.3, z, R(0, 6), s, s * R(0.9, 1.5), s, col)
    nf++
  }
  // some palms on mid-slopes (hill villages in the reference are palm-covered)
  for (let i = 0; i < 2200; i++) {
    const x = R(-900, 900), z = R(-800, 800)
    const h = terrainH(x, z)
    if (h < 2 || h > 40 || roadEdgeDist(x, z) < 8 || !free(x, z, 1, 6)) continue
    if (rng() < 0.6) {
      const y = h - 0.1, s = R(0.9, 1.4), ry = R(0, 6)
      inst.add('cocoTrunk', x, y, z, ry, s, s, s)
      inst.add('cocoCrown', x, y, z, ry, s, s, s, crownCol())
    }
  }

  // ---------------- paddy fields ----------------
  const bund = std(0x7a5a3a, 1)
  for (const p of PADDIES) {
    const g = new THREE.PlaneGeometry(p.w, p.d).rotateX(-Math.PI / 2)
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.w / 9, uv.getY(i) * p.d / 9)
    batch.add(g, T.paddy, p.x, 0.05, p.z, 0, 1, 1, 1, false)
    // bunds
    const nx = Math.round(p.w / 30), nz = Math.round(p.d / 30)
    for (let i = 0; i <= nx; i++) batch.add(UB, bund, p.x - p.w / 2 + (i * p.w) / nx, 0, p.z, 0, 0.7, 0.3, p.d, false)
    for (let i = 0; i <= nz; i++) batch.add(UB, bund, p.x, 0, p.z - p.d / 2 + (i * p.d) / nz, 0, p.w, 0.3, 0.7, false)
    W.pois.push({ x: p.x, z: p.z, kind: 'farm' })
  }
  for (const pl of PLANTATIONS) W.pois.push({ x: pl.x, z: pl.z, kind: 'farm' })

  // ---------------- phone tower on the western hill ----------------
  const tx = -450, tz = -50
  const ty = terrainH(tx, tz)
  {
    const lat = new THREE.MeshStandardMaterial({ color: 0xc23a2a, wireframe: true })
    const lat2 = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, wireframe: true })
    const tg = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.CylinderGeometry(1.6 - (i + 1) * 0.2, 1.6 - i * 0.2, 6, 4, 3, true).rotateY(Math.PI / 4).translate(0, 3, 0)
      const m = new THREE.Mesh(g, i % 2 ? lat2 : lat)
      m.position.set(tx, ty + i * 6, tz)
      m.scale.set(2, 1, 2)
      m.castShadow = true
      chunks.get(tx, tz).add(m)
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      batch.add(UB, T.concrete, tx + Math.cos(a) * 1.2, ty + 33.5, tz + Math.sin(a) * 1.2, -a, 1.4, 2.4, 0.2)
    }
    W.lights.push({ x: tx, y: ty + 37, z: tz, r: 1, g: 0.1, b: 0.05, kind: 'beacon' })
    batch.add(UB, T.concrete, tx + 6, ty - 0.3, tz, 0, 4, 2.2, 3)
    addBox(tx + 4, tz - 1.5, tx + 8, tz + 1.5)
  }

  // ---------------- collectible spots ----------------
  const collectibles: { x: number; y: number; z: number }[] = []
  const fixed: [number, number][] = [
    [300, FLY_Z], [337, -268], [-76, -12], [72, 12], [-145, 9], [0, -70], [-6, 120], [-340, 160], [-300, -240], [620, -230], [-400, 300], [150, 120],
    [-450, -48],
  ]
  for (const [x, z] of fixed) collectibles.push({ x, z, y: groundAt(x, z, 20, 20) + 1.1 })
  for (let i = 0; i < 20 && collectibles.length < 26; i++) {
    const pl = pick(PLANTATIONS)
    const x = pl.x + R(-pl.w / 2, pl.w / 2), z = pl.z + R(-pl.d / 2, pl.d / 2)
    if (!free(x, z, 1, 6)) continue
    collectibles.push({ x, y: terrainH(x, z) + 1.1, z })
  }
  return { collectibles, towerTop: { x: tx, y: ty, z: tz } }
}

// ---------------------------------------------------------------------------
// vegetation geometry
function frondGeo(count: number, len: number, droop: number, width: number, lift: number, startAng = 0, yAdd = 0, spread = 1) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let base = 0
  const SEG = 5
  for (let f = 0; f < count; f++) {
    const a = startAng + (f / count) * Math.PI * 2 + (f % 2) * 0.2
    const dx = Math.cos(a), dz = Math.sin(a)
    const px = -dz, pz = dx
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG
      const r = len * t * spread
      const y = yAdd + lift * Math.sin(t * 1.6) - droop * t * t
      const w = width * (1 - Math.pow(t, 1.6) * 0.9) * (0.35 + 0.65 * Math.sin(Math.min(1, t * 3 + 0.2) * 1.5))
      for (const sgn of [-1, 1]) {
        pos.push(dx * r + px * w * sgn, y, dz * r + pz * w * sgn)
        uv.push(sgn < 0 ? 0 : 1, t)
      }
      if (k < SEG) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
      base += 2
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
function bentTrunk(h: number, r0: number, r1: number, bend: number, seg = 6, rad = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, h, rad, seg, false)
  g.translate(0, h / 2, 0)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h
    p.setX(i, p.getX(i) + bend * t * t)
  }
  g.computeVertexNormals()
  return g
}
function blob(r: number, seed: number, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const n = 0.8 + 0.4 * noise2(p.getX(i) * 0.9 + seed, p.getZ(i) * 0.9 + p.getY(i) * 0.7)
    p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.82, p.getZ(i) * n)
  }
  g.computeVertexNormals()
  return g
}
export function registerVegetation(inst: Instancer) {
  const bend = 1.3
  inst.register('cocoTrunk', bentTrunk(9, 0.24, 0.13, bend), T.palmTrunk, true)
  inst.register('cocoCrown', frondGeo(11, 3.6, 1.9, 0.5, 0.9, 0, 0).translate(bend, 9, 0), T.frond, true)
  inst.register('arecaTrunk', bentTrunk(12, 0.1, 0.08, 0.3, 4, 5), T.arecaTrunk, true)
  inst.register('arecaCrown', frondGeo(7, 2.0, 1.0, 0.3, 0.6, 0, 0).translate(0.3, 12, 0), T.frond, true)
  const banana = frondGeo(7, 2.3, 0.6, 0.55, 1.0, 0.3, 0, 0.8)
  const bs = new THREE.CylinderGeometry(0.1, 0.16, 1.6, 5).translate(0, 0.8, 0)
  banana.translate(0, 1.5, 0)
  inst.register('banana', banana, T.bananaLeaf, false)
  inst.register('broadTrunk', bentTrunk(5, 0.38, 0.25, 0.3, 3, 6), T.wood, true)
  const crown = new THREE.BufferGeometry()
  const parts = [blob(3.4, 1), blob(2.6, 5), blob(2.7, 9), blob(2.3, 13)]
  const offs = [[0, 6.5, 0], [2.4, 5.6, 0.6], [-2.2, 5.7, -0.8], [0.4, 8.2, 0.4]]
  parts.forEach((g, i) => g.translate(offs[i][0], offs[i][1], offs[i][2]))
  const merged = mergeGeos(parts)
  inst.register('broadCrown', merged, T.leaves, true)
  inst.register('bush', blob(1, 4, 1), T.leaves, false)
  const fg = new THREE.IcosahedronGeometry(3.2, 0)
  fg.scale(1, 1.5, 1)
  fg.translate(0, 4, 0)
  inst.register('forest', fg, T.forest, false)
  void bs
}
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
function mergeGeos(list: THREE.BufferGeometry[]) {
  const l = list.map((g) => {
    const c = g.index ? g.toNonIndexed() : g
    for (const n of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(n)) c.deleteAttribute(n)
    return c
  })
  return mergeGeometries(l, false)!
}
