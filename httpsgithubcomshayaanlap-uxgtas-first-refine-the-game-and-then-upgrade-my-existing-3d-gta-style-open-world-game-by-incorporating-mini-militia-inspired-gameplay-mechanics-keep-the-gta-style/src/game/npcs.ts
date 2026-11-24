// @ts-nocheck
// Pedestrians, shopkeepers, customers, farmers, chatting groups, with simple daily routines.
import * as THREE from 'three'
import { clamp, angDiff, mulberry32, lerp } from './util'
import { Humanoid, SKINS, Look } from './character'
import { W, groundAt, pushOut, ROADS } from './world'
import { posOn } from './build1'

const MALE = ['Ramesh', 'Suresh', 'Manjunath', 'Prakash', 'Shankar', 'Ganapa', 'Raghu', 'Harish', 'Vasanth', 'Shivaram', 'Naveen', 'Dinesh', 'Mohan', 'Ashok']
const FEMALE = ['Lakshmi', 'Savitha', 'Kavitha', 'Padma', 'Gowramma', 'Anitha', 'Shobha', 'Vimala', 'Rekha', 'Sumithra']
const SHIRTS = [0x3b6ea5, 0xc0392b, 0x2f7a4f, 0xf2f2f2, 0xe8c547, 0x6b4a8d, 0x888888, 0x2a2a2a, 0x7fb3d5, 0xd98e4a]
const PANTS = [0x2b3a55, 0x222222, 0x5a4a3a, 0x3a4a5a, 0x4b4b4b]
const LUNGI = [0xf2f2ea, 0x3b5fa0, 0x8a2a2a, 0x2f7a4f, 0x6b3fa0]
const SAREE = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xd81b60, 0x16a085]
const UMB = [0x222233, 0x1b3a6b, 0x8a1c1c, 0x1f6b3a, 0x3a3a3a, 0xc9a227]
const pickR = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]

export function randomLook(r: () => number, role: string): Look {
  const female = role === 'customerF' || (r() < 0.38 && role !== 'keeper' && role !== 'farmer')
  const old = r() < 0.18
  const hair = old ? 0xc9c9c9 : 0x15110e
  const skin = pickR(r, SKINS)
  if (role === 'student') {
    return { skin, shirt: 0xf2f2f2, pants: 0x1d2b64, hair: 0x15110e, style: 'uniform', scale: 0.78 + r() * 0.1, female: r() < 0.5 }
  }
  if (female) {
    const sar = pickR(r, SAREE)
    return { skin, shirt: pickR(r, SAREE), pants: sar, hair, style: r() < 0.7 ? 'saree' : 'pants', female: true, scale: 0.93 + r() * 0.05 }
  }
  const lungi = r() < (role === 'farmer' ? 0.7 : 0.35)
  return {
    skin, shirt: pickR(r, SHIRTS), pants: lungi ? pickR(r, LUNGI) : pickR(r, PANTS), hair, style: lungi ? 'lungi' : 'pants',
    towel: role === 'farmer' || r() < 0.1, cap: old && r() < 0.5, scale: 0.97 + r() * 0.08,
  }
}

export class NPC {
  x = 0; y = 0; z = 0; yaw = 0
  vx = 0; vz = 0
  state = 'idle'
  st = 0
  tx = 0; tz = 0
  poiKind = ''
  speed = 1.4
  visible = false
  name = ''
  hx = 0; hz = 0; hyaw = 0
  sched: [number, number] = [0, 24]
  blocked = 0
  waitT = 0
  umb = false
  umbCol = 0x222233
  gx = 0; gz = 0
  doorX = 0; doorZ = 0
  talkPhase = Math.random() * 6
  constructor(public role: string, public h: Humanoid, public resident: boolean, public id: number) {}
  get hidden() {
    return this.state === 'inside'
  }
}

export class NPCManager {
  npcs: NPC[] = []
  scene: THREE.Scene
  rng = mulberry32(555)
  walkNodes: { x: number; z: number; kind: string }[] = []
  poolSize = 26
  respawnT = 0
  hornT = 0
  nextId = 1

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.init()
  }
  private add(role: string, look: Look, resident: boolean) {
    const n = new NPC(role, new Humanoid(look), resident, this.nextId++)
    n.name = look.female ? pickR(this.rng, FEMALE) : pickR(this.rng, MALE)
    n.umbCol = pickR(this.rng, UMB)
    n.umb = this.rng() < 0.75
    n.h.root.visible = false
    this.scene.add(n.h.root)
    this.npcs.push(n)
    return n
  }
  private place(n: NPC, x: number, z: number, yaw: number, state = 'idle') {
    n.x = x
    n.z = z
    n.yaw = yaw
    n.y = groundAt(x, z, 50, 50)
    n.state = state
    n.hx = x
    n.hz = z
    n.hyaw = yaw
  }

  init() {
    const r = this.rng
    // walk nodes along pavements and lanes
    for (let x = -170; x <= 170; x += 12) for (const s of [-1, 1]) if (Math.abs(x) > 9) this.walkNodes.push({ x: x + (r() - 0.5) * 3, z: s * (5.9 + r() * 0.5), kind: 'walk' })
    for (let z = -108; z <= 108; z += 12) for (const s of [-1, 1]) if (Math.abs(z) > 10) this.walkNodes.push({ x: s * (5.9 + r() * 0.5), z, kind: 'walk' })
    for (const l of ROADS.filter((q) => q.kind === 'lane'))
      for (let s = 10; s < l.len - 5; s += 24) {
        const p = posOn(l, s)
        const side = r() < 0.5 ? -1 : 1
        this.walkNodes.push({ x: p.x + -p.tz * side * (l.half + 0.9), z: p.z + p.tx * side * (l.half + 0.9), kind: 'lane' })
      }
    for (const rd of ROADS.filter((q) => q.id === 'main')) {
      for (let s = 0; s < rd.len; s += 30) {
        const p = posOn(rd, s)
        if (Math.abs(p.x) < 180) continue
        this.walkNodes.push({ x: p.x + -p.tz * 5.4, z: p.z + p.tx * 5.4, kind: 'lane' })
      }
    }
    // stalls: keeper + customers
    for (const st of W.stalls) {
      const k = this.add('keeper', randomLook(r, 'keeper'), true)
      this.place(k, st.x, st.z, st.face)
      k.sched = [7, 21]
      k.poiKind = 'stall'
      k.doorX = st.x
      k.doorZ = st.z
      const nc = 1 + Math.floor(r() * 2)
      for (let i = 0; i < nc; i++) {
        const c = this.add('customer', randomLook(r, 'customer'), true)
        const side = i === 0 ? -0.8 : 0.9
        const ox = Math.cos(st.face) * side, oz = -Math.sin(st.face) * side
        this.place(c, st.fx + ox, st.fz + oz, st.face + Math.PI)
        c.sched = [8, 20]
        c.state = 'talk'
      }
    }
    // chat groups on pavements
    const spots = [[-28, -6.3], [15, 6.4], [60, -6.2], [-110, 6.3], [105, 6.1], [-6.3, -45], [6.3, 60], [-150, -6.2]]
    for (const [cx, cz] of spots) {
      const cnt = 2 + Math.floor(r() * 2)
      for (let i = 0; i < cnt; i++) {
        const a = (i / cnt) * Math.PI * 2 + r()
        const c = this.add('chatter', randomLook(r, 'chatter'), true)
        this.place(c, cx + Math.cos(a) * 0.9, cz + Math.sin(a) * 0.9, Math.atan2(-Math.cos(a), -Math.sin(a)), 'talk')
        c.sched = [6.5, 22]
        c.gx = cx
        c.gz = cz
      }
    }
    // bus stop waiters
    const stops = W.pois.filter((p) => p.kind === 'busstop')
    stops.forEach((p, i) => {
      if (i % 3 === 2) return
      const c = this.add('waiter', randomLook(r, 'waiter'), true)
      this.place(c, p.x, p.z, p.face ?? 0, 'idle')
      c.sched = [5.5, 20.5]
    })
    // benches
    for (const b of W.benches) {
      const c = this.add('sitter', randomLook(r, 'sitter'), true)
      this.place(c, b.x + (r() - 0.5) * 1.2, b.z + 0.1, b.face, 'sit')
      c.sched = [8, 21]
    }
    // farmers
    for (const p of W.pois.filter((q) => q.kind === 'farm')) {
      for (let i = 0; i < 2; i++) {
        const c = this.add('farmer', randomLook(r, 'farmer'), true)
        this.place(c, p.x + (r() - 0.5) * 30, p.z + (r() - 0.5) * 25, r() * 6, 'work')
        c.sched = [6.5, 17.5]
      }
    }
    // roaming pool
    for (let i = 0; i < 34; i++) {
      const role = i < 5 ? 'student' : 'walker'
      const c = this.add(role, randomLook(r, role), false)
      c.state = 'inside'
      c.speed = 1.2 + r() * 0.5
      c.h.root.visible = false
    }
  }

  private nearestPoi(x: number, z: number, kind: string, maxD = 60) {
    let best: any = null, bd = maxD
    for (const p of W.pois) {
      if (p.kind !== kind) continue
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  private pickTarget(n: NPC, hour: number, rain: number) {
    const r = Math.random
    const night = hour >= 22 || hour < 5
    const pools: { w: number; kind: string }[] = []
    if (night) {
      const home = W.houses.length ? W.houses[Math.floor(r() * W.houses.length)] : null
      if (home || true) {
        // head for the nearest door (home) and go inside for the night
        const d = this.nearestPoi(n.x, n.z, 'door', 120)
        if (d) {
          n.tx = d.x
          n.tz = d.z
          n.poiKind = 'home'
          n.state = 'walk'
          return
        }
      }
    }
    const busyBus = (hour > 6 && hour < 9.5) || (hour > 16 && hour < 19) ? 0.35 : 0.1
    pools.push({ w: 0.3, kind: 'walk' }, { w: 0.22, kind: 'door' }, { w: busyBus, kind: 'busstop' }, { w: 0.18, kind: 'stall' }, { w: 0.05, kind: 'bench' }, { w: 0.15, kind: 'lane' })
    if (rain > 0.3) {
      pools[1].w += 0.3
      pools[2].w += 0.2
      pools[0].w *= 0.4
    }
    let tot = pools.reduce((a, b) => a + b.w, 0)
    let rr = r() * tot
    let kind = 'walk'
    for (const p of pools) {
      rr -= p.w
      if (rr <= 0) {
        kind = p.kind
        break
      }
    }
    // candidates within 110 m
    const cands: { x: number; z: number; face?: number }[] = []
    const src = kind === 'walk' || kind === 'lane' ? this.walkNodes.filter((q) => q.kind === kind) : kind === 'bench' ? W.benches.map((b) => ({ x: b.x, z: b.z, face: b.face })) : W.pois.filter((p) => p.kind === kind)
    for (const p of src) {
      const d = Math.hypot(p.x - n.x, p.z - n.z)
      if (d > 12 && d < 110) cands.push(p)
    }
    if (!cands.length) {
      const q = this.walkNodes[Math.floor(r() * this.walkNodes.length)]
      n.tx = q.x
      n.tz = q.z
      n.poiKind = 'walk'
    } else {
      const c = cands[Math.floor(r() * cands.length)]
      n.tx = c.x + (r() - 0.5) * (kind === 'walk' ? 2 : 0.6)
      n.tz = c.z + (r() - 0.5) * (kind === 'walk' ? 2 : 0.6)
      n.poiKind = kind
      n.hyaw = c.face ?? 0
    }
    n.state = 'walk'
    n.blocked = 0
  }

  private spawnWalker(n: NPC, px: number, pz: number, hour: number, rain: number) {
    for (let t = 0; t < 14; t++) {
      const kinds = ['walk', 'door', 'busstop', 'lane']
      const k = kinds[Math.floor(Math.random() * kinds.length)]
      const src = k === 'walk' || k === 'lane' ? this.walkNodes.filter((q) => q.kind === k) : W.pois.filter((p) => p.kind === k)
      if (!src.length) continue
      const p = src[Math.floor(Math.random() * src.length)]
      const d = Math.hypot(p.x - px, p.z - pz)
      if (d < 45 || d > 150) continue
      n.x = p.x + (Math.random() - 0.5) * 2
      n.z = p.z + (Math.random() - 0.5) * 2
      n.y = groundAt(n.x, n.z, 50, 50)
      n.yaw = Math.random() * 6.28
      n.state = 'walk'
      n.waitT = 0
      n.doorX = 0
      this.pickTarget(n, hour, rain)
      return true
    }
    return false
  }

  update(dt: number, ctx: { px: number; pz: number; py: number; hour: number; rain: number; vehicles: any[]; playerVeh: any; horn: boolean; playerSprint: boolean }) {
    const { px, pz, hour, rain } = ctx
    // walker population by time of day
    const night = hour >= 22 || hour < 5
    let target = night ? 4 : hour < 7 ? 14 : hour < 20 ? 26 : 14
    if (rain > 0.5) target = Math.round(target * 0.6)
    const pool = this.npcs.filter((n) => !n.resident)
    let active = pool.filter((n) => n.state !== 'inside').length
    this.respawnT -= dt
    if (this.respawnT <= 0) {
      this.respawnT = 0.6
      if (active < Math.min(target, this.poolSize)) {
        const free = pool.find((n) => n.state === 'inside' && !n.doorX)
        if (free) {
          // students only in school hours
          if (free.role === 'student' && !((hour > 7.5 && hour < 9.2) || (hour > 16 && hour < 17.6))) {
            // use another
          } else if (this.spawnWalker(free, px, pz, hour, rain)) active++
        }
      }
    }
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - px, n.z - pz)
      // resident schedules
      if (n.resident) {
        const [a, b] = n.sched
        let on = hour >= a && hour < b
        if (n.role === 'farmer' && rain > 0.65) on = false
        if (n.role === 'chatter' && rain > 0.85) on = false
        if (on && n.state === 'inside') {
          n.state = n.role === 'sitter' ? 'sit' : n.role === 'farmer' ? 'work' : n.role === 'waiter' ? 'idle' : n.role === 'keeper' ? 'idle' : 'talk'
          n.x = n.hx
          n.z = n.hz
          n.yaw = n.hyaw
          n.y = groundAt(n.x, n.z, 50, 50)
        } else if (!on && n.state !== 'inside' && n.state !== 'leave') {
          if (d < 60) {
            const door = this.nearestPoi(n.x, n.z, 'door', 40)
            if (door) {
              n.tx = door.x
              n.tz = door.z
              n.state = 'leave'
            } else n.state = 'inside'
          } else n.state = 'inside'
        }
      } else if (n.state !== 'inside' && d > 200) {
        n.state = 'inside'
        n.doorX = 0
        n.waitT = 0
      }
      const near = d < 150
      const show = n.state !== 'inside' && d < 105
      n.visible = show
      n.h.root.visible = show
      if (!near || n.state === 'inside') {
        if (n.state === 'inside' && !n.resident && n.waitT > 0) {
          // building stay timer
          n.waitT -= dt
          if (n.waitT <= 0 && n.doorX) {
            n.state = 'walk'
            n.x = n.doorX
            n.z = n.doorZ
            n.doorX = 0
            this.pickTarget(n, hour, rain)
          }
        }
        continue
      }
      this.updateOne(n, dt, d, ctx)
    }
    // soft separation between visible NPCs
    const vis = this.npcs.filter((n) => n.visible && n.state === 'walk')
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i], b = vis[j]
        const dx = b.x - a.x, dz = b.z - a.z
        const dd = dx * dx + dz * dz
        if (dd < 0.5 && dd > 1e-4) {
          const k = (0.7 - Math.sqrt(dd)) * 0.5
          const l = Math.sqrt(dd)
          a.x -= (dx / l) * k * dt * 4
          a.z -= (dz / l) * k * dt * 4
          b.x += (dx / l) * k * dt * 4
          b.z += (dz / l) * k * dt * 4
        }
      }
  }

  private updateOne(n: NPC, dt: number, dist: number, ctx: any) {
    const { px, pz, hour, rain } = ctx
    const h = n.h
    // umbrella in rain
    h.setUmbrella(rain > 0.22 && n.umb && n.state !== 'down' && n.state !== 'work', n.umbCol)
    let mode = 'idle'
    let moving = 0
    // vehicle hazard / being hit
    if (n.state !== 'down' && n.state !== 'inside') {
      for (const v of ctx.vehicles) {
        const sp = Math.hypot(v.vx, v.vz)
        if (sp < 2) continue
        const dx = n.x - v.x, dz = n.z - v.z
        if (Math.abs(dx) > 25 || Math.abs(dz) > 25) continue
        const fx = Math.sin(v.h), fz = Math.cos(v.h)
        const along = dx * fx + dz * fz
        const lat = dx * fz - dz * fx
        if (Math.abs(n.y - v.y) > 2.5) continue
        // hit test
        if (sp > 3 && Math.abs(along) < v.spec.L / 2 + 0.3 && Math.abs(lat) < v.spec.Wd / 2 + 0.3) {
          n.state = 'down'
          n.st = 4.5
          n.vx = v.vx * 0.5 + fz * Math.sign(lat || 1) * 2
          n.vz = v.vz * 0.5 - fx * Math.sign(lat || 1) * 2
          ctx.onHit?.(n, sp)
          break
        }
        // evasive action
        if (along > 0 && along < sp * 1.6 + 5 && Math.abs(lat) < v.spec.Wd / 2 + 1.0 && n.state !== 'flee') {
          if (along < 9 || sp > 8) {
            n.state = 'flee'
            n.st = 1.4
            const s = Math.sign(lat || (Math.random() < 0.5 ? 1 : -1))
            n.vx = fz * s * 4.2
            n.vz = -fx * s * 4.2
            n.yaw = Math.atan2(n.vx, n.vz)
          } else n.waitT = 0.6
        }
      }
    }
    switch (n.state) {
      case 'walk':
      case 'leave': {
        if (n.waitT > 0 && n.state === 'walk') {
          n.waitT -= dt
          mode = 'idle'
          break
        }
        const dx = n.tx - n.x, dz = n.tz - n.z
        const dd = Math.hypot(dx, dz)
        const sp = n.speed * (rain > 0.3 ? 1.25 : 1) * (n.role === 'student' ? 1.15 : 1)
        if (dd < 0.7) {
          if (n.state === 'leave') {
            n.state = 'inside'
            break
          }
          if (n.poiKind === 'door' || n.poiKind === 'home') {
            n.state = 'inside'
            n.doorX = n.x
            n.doorZ = n.z
            n.waitT = n.poiKind === 'home' ? 9999 : 12 + Math.random() * 40
            if (n.poiKind === 'home') n.doorX = 0
            break
          }
          n.state = n.poiKind === 'bench' ? 'sit' : n.poiKind === 'stall' ? 'talk' : 'idle'
          n.st = 6 + Math.random() * 14
          n.yaw = n.hyaw || n.yaw
          break
        }
        const want = Math.atan2(dx, dz)
        n.yaw += angDiff(n.yaw, want) * Math.min(1, dt * 7)
        const nx = n.x + Math.sin(n.yaw) * sp * dt
        const nz = n.z + Math.cos(n.yaw) * sp * dt
        const tmp = { x: nx, z: nz }
        const hitIt = pushOut(tmp, 0.3, n.y)
        n.blocked = hitIt ? n.blocked + dt : Math.max(0, n.blocked - dt)
        // slide around obstacles
        n.x = tmp.x
        n.z = tmp.z
        if (n.blocked > 2.5) {
          this.pickTarget(n, hour, rain)
          n.blocked = 0
        }
        moving = sp
        mode = 'walk'
        break
      }
      case 'flee': {
        n.st -= dt
        n.x += n.vx * dt
        n.z += n.vz * dt
        const tmp = { x: n.x, z: n.z }
        pushOut(tmp, 0.3, n.y)
        n.x = tmp.x
        n.z = tmp.z
        moving = 4.2
        mode = 'run'
        if (n.st <= 0) {
          n.state = 'react'
          n.st = 1.6
        }
        break
      }
      case 'react': {
        n.st -= dt
        mode = 'wave'
        const dx = px - n.x, dz = pz - n.z
        n.yaw += angDiff(n.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 5)
        if (n.st <= 0) {
          if (n.resident) {
            n.state = n.role === 'sitter' ? 'sit' : 'idle'
            n.tx = n.hx
            n.tz = n.hz
            n.state = 'walk'
            n.poiKind = 'return'
            n.hyaw = n.hyaw
          } else this.pickTarget(n, hour, rain)
        }
        break
      }
      case 'down': {
        n.st -= dt
        n.x += n.vx * dt
        n.z += n.vz * dt
        n.vx *= 0.9
        n.vz *= 0.9
        mode = 'down'
        if (n.st <= 0) {
          n.state = 'react'
          n.st = 2
        }
        break
      }
      case 'talk': {
        mode = 'talk'
        if (n.role === 'chatter') {
          // face the group
        }
        if (dist < 5 && n.role !== 'chatter') n.yaw += angDiff(n.yaw, Math.atan2(px - n.x, pz - n.z)) * Math.min(1, dt * 2)
        if (!n.resident) {
          n.st -= dt
          if (n.st <= 0) this.pickTarget(n, hour, rain)
        } else {
          // talkers alternate silence
          if (Math.sin(h.t * 0.5 + n.talkPhase) < -0.5) mode = 'idle'
        }
        break
      }
      case 'idle': {
        mode = 'idle'
        if (dist < 4 && !n.resident) n.yaw += angDiff(n.yaw, Math.atan2(px - n.x, pz - n.z)) * Math.min(1, dt * 2)
        if (dist < 4 && n.resident) n.yaw += angDiff(n.yaw, Math.atan2(px - n.x, pz - n.z)) * Math.min(1, dt * 1.5)
        if (!n.resident) {
          n.st -= dt
          if (n.st <= 0) this.pickTarget(n, hour, rain)
        } else if (n.role === 'keeper' && Math.sin(h.t * 0.4 + n.talkPhase) > 0.55) mode = 'talk'
        break
      }
      case 'sit': {
        mode = 'sit'
        if (!n.resident) {
          n.st -= dt
          if (n.st <= 0) this.pickTarget(n, hour, rain)
        }
        break
      }
      case 'work': {
        mode = 'work'
        break
      }
      default:
        break
    }
    // hits by moving vehicles when the NPC is idle are handled above; return-to-post for residents
    if (n.state === 'walk' && n.poiKind === 'return' && Math.hypot(n.tx - n.x, n.tz - n.z) < 0.8) {
      n.state = n.role === 'sitter' ? 'sit' : n.role === 'farmer' ? 'work' : n.role === 'keeper' || n.role === 'waiter' ? 'idle' : 'talk'
      n.yaw = n.hyaw
    }
    n.y = groundAt(n.x, n.z, n.y, 0.7)
    h.root.position.set(n.x, n.y, n.z)
    h.root.rotation.y = n.yaw
    h.pose(mode, moving, dt)
  }

  nearestTalkable(px: number, pz: number) {
    let best: NPC | null = null, bd = 2.4
    for (const n of this.npcs) {
      if (!n.visible || n.state === 'down' || n.state === 'inside') continue
      const d = Math.hypot(n.x - px, n.z - pz)
      if (d < bd) {
        bd = d
        best = n
      }
    }
    return best
  }
  lineFor(n: NPC, rain: number, hour: number) {
    const r = Math.random
    const pickL = (a: string[]) => a[Math.floor(r() * a.length)]
    const gen = [
      'ನಮಸ್ಕಾರ! Namaskara — welcome to Nellyadi.',
      'Mangaluru bus comes every half hour or so, if the road is clear.',
      rain > 0.25 ? 'This monsoon rain just does not stop! Keep an umbrella.' : 'Good weather today. Rain may come in the evening, you never know.',
      'The areca harvest is keeping everybody busy this season.',
      hour > 18 ? 'It is getting dark. Be careful on the highway.' : 'Go and see the new flyover on the bypass. Good view from the top!',
      'Drive slowly near the market, too many scooters.',
    ]
    let lines = gen
    if (n.role === 'keeper') lines = ['ಬನ್ನಿ ಸ್ವಾಮಿ! Come, come — fresh stock today.', 'Prices are fixed, sir. Very fresh, straight from the farm.', rain > 0.25 ? 'Stay under the tarpaulin, rain is heavy.' : 'Tea, snacks, tender coconut — whatever you need.']
    if (n.role === 'farmer') lines = ['Areca nuts need dry days to dry on the mats. This rain...', 'The stream is rising near the bridge. Careful there.', 'Coconut, areca, banana — that is our life here.']
    if (n.role === 'student') lines = ['School bus is late again!', 'Hello! Are you new in Nellyadi?']
    if (n.role === 'waiter') lines = ['Waiting for the KSRTC bus to Mangaluru.', 'Bus is late today. Always late in the monsoon.']
    return { name: n.name, text: pickL(lines) }
  }
}
void lerp
void clamp
