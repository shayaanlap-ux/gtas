// @ts-nocheck
// AI traffic + parked vehicles management
import * as THREE from 'three'
import { clamp, angDiff, mulberry32 } from './util'
import { Vehicle, CAR_COLORS, SCOOTER_COLORS } from './vehicles'
import { ROUTES, routePos, Route } from './world'

const rng = mulberry32(4242)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export class Traffic {
  all: Vehicle[] = []
  ai: Vehicle[] = []
  maxAI = 16
  spawnT = 0
  hornCb: ((dist: number, pitch: number) => void) | null = null
  crashCb: ((p: number, v: Vehicle) => void) | null = null
  constructor(public scene: THREE.Scene) {}

  addParked(variant: string, color: number, x: number, z: number, h: number) {
    const v = new Vehicle(variant, color, this.all.length + 1)
    v.crashCb = (p) => this.crashCb?.(p, v)
    v.place(x, z, h)
    v.asleep = true
    this.scene.add(v.root)
    this.all.push(v)
    return v
  }
  remove(v: Vehicle) {
    this.scene.remove(v.root)
    this.all = this.all.filter((a) => a !== v)
    this.ai = this.ai.filter((a) => a !== v)
    const own = v.root.userData.own || []
    for (const m of own) {
      m.map?.dispose?.()
      m.dispose?.()
    }
    v.root.traverse((o: any) => {
      if (o.isMesh && o.userData?.ownGeo) o.geometry.dispose()
    })
  }

  private chooseVariant(rt: Route) {
    const r = Math.random()
    if (rt.kind === 'hw') {
      if (r < 0.62) return pick(['hatch', 'sedan', 'suv', 'hatch', 'sedan'])
      if (r < 0.8) return 'bus'
      if (r < 0.93) return 'moto'
      return 'scooter'
    }
    if (rt.kind === 'lane') return r < 0.5 ? 'scooter' : r < 0.8 ? 'moto' : r < 0.93 ? 'auto' : 'hatch'
    if (r < 0.26) return pick(['hatch', 'sedan', 'suv'])
    if (r < 0.46) return 'auto'
    if (r < 0.7) return 'scooter'
    if (r < 0.88) return 'moto'
    return 'bus'
  }
  private colorFor(variant: string) {
    if (variant === 'scooter' || variant === 'moto') return pick(SCOOTER_COLORS)
    if (variant === 'auto') return pick([0xf2c200, 0x1d6b35, 0xf2c200])
    if (variant === 'bus') return 0xb3131a
    return pick(CAR_COLORS)
  }

  spawnAI(px: number, pz: number, minD = 120, maxD = 260) {
    for (let t = 0; t < 14; t++) {
      const rt = ROUTES[Math.floor(Math.random() * ROUTES.length)]
      const s = Math.random() * rt.len
      const p = routePos(rt, s)
      const d = Math.hypot(p.x - px, p.z - pz)
      if (d < minD || d > maxD) continue
      let clear = true
      for (const o of this.all) if (Math.hypot(o.x - p.x, o.z - p.z) < 14 && Math.abs(o.y - p.y) < 3) clear = false
      if (!clear) continue
      const variant = this.chooseVariant(rt)
      const v = new Vehicle(variant, this.colorFor(variant), Math.floor(Math.random() * 1e6))
      v.driver = 'ai'
      const p2 = routePos(rt, s + 3)
      const h = Math.atan2(p2.x - p.x, p2.z - p.z)
      v.place(p.x, p.z, h, p.y)
      let cruise = rt.speed * (0.78 + Math.random() * 0.3)
      if (variant === 'bus') cruise = Math.min(cruise, 15)
      if (variant === 'auto') cruise = Math.min(cruise, 11)
      if (variant === 'scooter') cruise = Math.min(cruise, 13)
      v.vx = Math.sin(h) * cruise * 0.7
      v.vz = Math.cos(h) * cruise * 0.7
      v.ai = { rt, s, i: Math.max(0, p.i), cruise, stuck: 0, honkT: 4 + Math.random() * 10, life: 0 }
      v.crashCb = (pw) => this.crashCb?.(pw, v)
      this.scene.add(v.root)
      this.all.push(v)
      this.ai.push(v)
      return
    }
  }

  /** nearest obstacle ahead of vehicle v: {gap, speed, ped} */
  private obstacle(v: Vehicle, look: number, npcs: any[], player: any, ignoreVeh: boolean) {
    const sh = Math.sin(v.h), ch = Math.cos(v.h)
    let gap = Infinity, speed = 0, ped = false
    const hw0 = v.spec.Wd / 2 + 0.35
    if (!ignoreVeh) {
      for (const o of this.all) {
        if (o === v) continue
        const dx = o.x - v.x, dz = o.z - v.z
        const fz = dx * sh + dz * ch
        if (fz < -1 || fz > look + o.spec.L) continue
        const lx = dx * ch - dz * sh
        if (Math.abs(o.y - v.y) > 2.5) continue
        const hw = hw0 + o.spec.Wd / 2
        const oncoming = Math.sin(o.h) * sh + Math.cos(o.h) * ch < -0.5
        if (Math.abs(lx) < (oncoming ? hw * 0.55 : hw)) {
          const g = fz - (v.spec.L + o.spec.L) * 0.5
          if (g < gap) {
            gap = g
            speed = Math.max(0, o.vx * sh + o.vz * ch)
          }
        }
      }
    }
    const check = (x: number, z: number, y: number) => {
      const dx = x - v.x, dz = z - v.z
      const fz = dx * sh + dz * ch
      if (fz < 0 || fz > look) return
      if (Math.abs(y - v.y) > 2.5) return
      const lx = dx * ch - dz * sh
      if (Math.abs(lx) < hw0 + 0.55) {
        const g = fz - v.spec.L * 0.5 - 0.3
        if (g < gap) {
          gap = g
          speed = 0
          ped = true
        }
      }
    }
    for (const n of npcs) if (n.visible && n.state !== 'inside') check(n.x, n.z, n.y)
    if (player && !player.inVehicle) check(player.x, player.z, player.y)
    return { gap, speed, ped }
  }

  update(dt: number, ctx: { px: number; pz: number; player: any; npcs: any[]; wet: number; dark: number; hour: number; playerVeh: Vehicle | null }) {
    const { px, pz } = ctx
    // spawn control
    const hourF = ctx.hour > 22 || ctx.hour < 5 ? 0.35 : ctx.hour < 7 ? 0.7 : 1
    const target = Math.round(this.maxAI * hourF)
    this.spawnT -= dt
    if (this.spawnT <= 0) {
      this.spawnT = 0.7
      if (this.ai.length < target) this.spawnAI(px, pz)
    }
    // update AI
    const toRemove: Vehicle[] = []
    for (const v of this.ai) {
      if (v.driver !== 'ai') continue
      const ai = v.ai
      const rt: Route = ai.rt
      const pts = rt.pts
      let i = ai.i
      while (i < pts.length - 2 && Math.hypot(pts[i + 1].x - v.x, pts[i + 1].z - v.z) < Math.hypot(pts[i].x - v.x, pts[i].z - v.z)) i++
      ai.i = i
      ai.s = rt.cum[i]
      const spd = Math.abs(v.vf)
      const ld = 5 + spd * 0.7
      const tp = routePos(rt, ai.s + ld)
      const tp2 = routePos(rt, ai.s + ld * 2.4)
      const bearing = Math.atan2(tp.x - v.x, tp.z - v.z)
      const alpha = angDiff(v.h, bearing)
      const maxS = v.spec.steerMax / (1 + Math.pow(spd / v.spec.v0, 2))
      const steerWanted = Math.atan2(2 * v.spec.wb * Math.sin(alpha), ld)
      const steerIn = clamp(steerWanted / Math.max(0.05, maxS), -1, 1)
      let cruise = ai.cruise * (ctx.wet > 0.4 ? 0.85 : 1)
      const curve = Math.abs(angDiff(v.h, Math.atan2(tp2.x - v.x, tp2.z - v.z)))
      cruise = cruise / (1 + curve * 3.2)
      const look = 7 + spd * 1.8 + (spd * spd) / (2 * 6)
      ai.life += dt
      const ob = this.obstacle(v, look, ctx.npcs, ctx.player, v.ghost > 0)
      let desired = cruise
      if (ob.gap < Infinity) {
        desired = clamp((ob.gap - 3.2) * 0.8 + ob.speed * 0.85, 0, cruise)
        if (ob.ped && ob.gap < 9) {
          ai.honkT -= dt * 2
        }
      }
      const err = desired - v.vf
      const inp = { throttle: 0, brake: 0, steer: steerIn, hand: 0 }
      if (err > 0.15) inp.throttle = clamp(err * 0.45, 0.05, 1)
      else if (err < -0.25) inp.brake = clamp(-err * 0.3, 0, 1)
      if (desired < 0.3 && spd < 0.5) inp.brake = 1
      v.setInput(inp)
      // stuck handling
      if (spd < 0.4 && desired < 0.5) ai.stuck += dt
      else ai.stuck = Math.max(0, ai.stuck - dt)
      if (ai.stuck > 7 && v.ghost <= 0) {
        v.ghost = 4
        ai.stuck = 0
      }
      if (v.ghost > 0) v.ghost -= dt
      // horn
      ai.honkT -= dt * 0.1
      if (ai.honkT <= 0) {
        ai.honkT = 8 + Math.random() * 18
        const d = Math.hypot(v.x - px, v.z - pz)
        if (d < 110) this.hornCb?.(d, v.spec.kind === 'bus' ? 0.7 : v.spec.kind === 'auto' ? 1.3 : 1)
      }
      const d = Math.hypot(v.x - px, v.z - pz)
      if (d > 340 || ai.s > rt.len - 6 || ai.life > 400) toRemove.push(v)
    }
    for (const v of toRemove) this.remove(v)

    // physics step
    for (const v of this.all) {
      const d = Math.hypot(v.x - px, v.z - pz)
      v.root.visible = d < 300
      const active = v.driver !== 'none' || !v.asleep
      if (!active) continue
      if (v.driver === 'none') {
        // free-rolling parked/abandoned vehicle
        if (Math.hypot(v.vx, v.vz) < 0.06 && Math.abs(v.yawRate) < 0.02 && !v.air) {
          v.asleep = true
          v.vx = v.vz = 0
          continue
        }
      }
      const near: Vehicle[] = []
      for (const o of this.all) if (o !== v && Math.abs(o.x - v.x) < 13 && Math.abs(o.z - v.z) < 13) near.push(o)
      v.step(dt, ctx.wet, near)
    }
    for (const v of this.all) if (v.root.visible) v.updateLights(ctx.dark, false)
  }
  nearest(x: number, z: number, r: number, filter?: (v: Vehicle) => boolean) {
    let best: Vehicle | null = null, bd = r
    for (const v of this.all) {
      const d = Math.hypot(v.x - x, v.z - z) - v.spec.L * 0.3
      if (d < bd && (!filter || filter(v))) {
        best = v
        bd = d
      }
    }
    return best
  }
}
void rng
