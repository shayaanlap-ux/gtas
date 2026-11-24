// Visual representation of other online players: interpolated humanoid, held weapon, jetpack flames, name tag, vehicle.
import * as THREE from 'three'
import { Humanoid } from './character'
import { buildVehicleModel } from './vehicles'
import { TEAM_COLORS, type NetPlayer, type WeaponId } from './mpData'
import type { FX } from './fx'

interface Snap { ut: number; x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vz: number }
const INTERP_DELAY = 130 // ms behind server time

function angLerp(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export class RemotePlayer {
  id: string
  data: NetPlayer
  human: Humanoid
  root = new THREE.Group()
  snaps: Snap[] = []
  tag: THREE.Sprite
  tagKey = ''
  vehRoot: THREE.Group | null = null
  vehKey = ''
  x = 0; y = 0; z = 0; yaw = 0
  speed = 0
  dead = false
  visible = true
  private flameT = 0
  constructor(d: NetPlayer, scene: THREE.Scene) {
    this.id = d.id
    this.data = d
    this.human = new Humanoid(this.lookFor(d))
    this.human.gear = true
    this.human.build()
    this.root.add(this.human.root)
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 72
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
    this.tag.scale.set(2.3, 0.65, 1)
    this.tag.renderOrder = 10
    this.root.add(this.tag)
    scene.add(this.root)
    this.push(d)
    const s = this.snaps[0]
    this.x = s.x; this.y = s.y; this.z = s.z; this.yaw = s.yaw
  }
  lookFor(d: NetPlayer) {
    const L = d.look
    const shirt = d.team >= 0 ? TEAM_COLORS[d.team] : L.shirt
    return { skin: L.skin, shirt, pants: L.pants, hair: L.hair, style: 'pants' as const, scale: 1, cap: false, towel: false }
  }
  push(d: NetPlayer) {
    this.data = d
    const last = this.snaps[this.snaps.length - 1]
    if (last && last.ut === d.ut) return
    this.snaps.push({ ut: d.ut, x: d.x, y: d.y, z: d.z, yaw: d.yaw, pitch: d.pitch, vx: d.vx, vz: d.vz })
    if (this.snaps.length > 12) this.snaps.shift()
  }
  private drawTag(dist: number, friendly: boolean) {
    const d = this.data
    const key = `${d.name}|${d.team}|${Math.ceil(d.hp / 5)}|${d.alive}|${friendly}`
    if (key === this.tagKey) return
    this.tagKey = key
    const c = (this.tag.material.map as THREE.CanvasTexture).image as HTMLCanvasElement
    const x = c.getContext('2d')!
    x.clearRect(0, 0, 256, 72)
    x.font = 'bold 30px Segoe UI, sans-serif'
    x.textAlign = 'center'
    x.lineWidth = 6
    x.strokeStyle = 'rgba(0,0,0,0.85)'
    x.fillStyle = d.team >= 0 ? (d.team === 0 ? '#ff7a7a' : '#7ab0ff') : '#ffffff'
    x.strokeText(d.name, 128, 32)
    x.fillText(d.name, 128, 32)
    x.fillStyle = 'rgba(0,0,0,0.7)'
    x.fillRect(48, 46, 160, 12)
    x.fillStyle = d.hp > 50 ? '#3be07a' : d.hp > 25 ? '#f2c230' : '#e8412c'
    x.fillRect(50, 48, Math.max(0, 156 * (d.hp / 100)), 8)
    ;(this.tag.material.map as THREE.CanvasTexture).needsUpdate = true
    void dist
  }
  update(dt: number, serverNow: number, cam: THREE.Camera, fx: FX, friendlyTeam: number) {
    const rt = serverNow - INTERP_DELAY
    const s = this.snaps
    let a = s[0], b = s[0], k = 0
    if (s.length > 1) {
      let i = s.length - 1
      while (i > 0 && s[i - 1].ut > rt) i--
      if (i === 0) {
        a = b = s[0]
      } else if (s[i].ut <= rt) {
        // ahead of newest snapshot: extrapolate briefly
        a = b = s[i]
        const ex = Math.min(0.2, (rt - s[i].ut) / 1000)
        this.x = a.x + a.vx * ex; this.z = a.z + a.vz * ex; this.y = a.y
        this.yaw = angLerp(this.yaw, a.yaw, Math.min(1, dt * 14))
        k = -1
      } else {
        a = s[i - 1]; b = s[i]
        k = Math.max(0, Math.min(1, (rt - a.ut) / Math.max(1, b.ut - a.ut)))
      }
    }
    if (k >= 0) {
      this.x = a.x + (b.x - a.x) * k
      this.y = a.y + (b.y - a.y) * k
      this.z = a.z + (b.z - a.z) * k
      this.yaw = angLerp(a.yaw, b.yaw, k)
    }
    const d = this.data
    const dx = this.x - cam.position.x, dz = this.z - cam.position.z
    const dist = Math.hypot(dx, dz)
    this.visible = dist < 650
    this.root.visible = this.visible
    if (!this.visible) return
    this.root.position.set(this.x, this.y, this.z)
    this.human.root.rotation.y = this.yaw
    const inVeh = !!d.veh
    // vehicle model (Free Roam online)
    if (inVeh) {
      const key = d.veh!.variant + d.veh!.color
      if (key !== this.vehKey) {
        if (this.vehRoot) this.root.remove(this.vehRoot)
        try {
          this.vehRoot = buildVehicleModel(d.veh!.variant, d.veh!.color, 'ONLINE').root
          this.root.add(this.vehRoot)
        } catch {
          this.vehRoot = null
        }
        this.vehKey = key
      }
      if (this.vehRoot) this.vehRoot.rotation.y = d.veh!.h
    } else if (this.vehRoot) {
      this.root.remove(this.vehRoot)
      this.vehRoot = null
      this.vehKey = ''
    }
    this.human.root.visible = !inVeh || !this.vehRoot
    this.human.root.position.y = 0
    // pose
    const sp = Math.hypot(d.vx, d.vz)
    this.speed = sp
    let mode = d.anim
    if (mode === 'walk' || mode === 'run' || mode === 'idle') mode = sp > 5.2 ? 'run' : sp > 0.3 ? 'walk' : 'idle'
    const wid = (d.w || null) as WeaponId | null
    this.human.setGun(d.alive && wid ? wid : null)
    this.human.aim = d.alive && wid ? Math.max(-0.7, Math.min(1.1, -d.pitch)) : null
    const lean = mode === 'fly' ? Math.min(0.9, sp * 0.06) : 0
    if (dist < 160) this.human.pose(mode === 'crouch' && sp > 0.3 ? 'crouch' : mode, sp, dt, lean)
    // jetpack flames
    if (d.jet && d.alive && dist < 140) {
      this.flameT -= dt
      if (this.flameT <= 0) {
        this.flameT = 0.03
        const fl = this.human.jetpack?.userData.flames as THREE.Object3D[] | undefined
        if (fl) {
          const v = new THREE.Vector3()
          for (const f of fl) {
            f.getWorldPosition(v)
            fx.jetFlame(v.x, v.y, v.z, d.vx, d.vy, d.vz, sp > 14)
          }
        }
      }
    }
    // name tag
    const friendly = friendlyTeam >= 0 && d.team === friendlyTeam
    const showTag = d.alive && (friendly || dist < 70 || friendlyTeam < 0 && dist < 90)
    this.tag.visible = showTag
    if (showTag) {
      this.drawTag(dist, friendly)
      this.tag.position.set(0, (d.anim === 'crouch' ? 1.75 : 2.3) + Math.min(1.2, dist * 0.012), 0)
    }
    this.dead = !d.alive
  }
  /** distance along ray to this player's body (client-side prediction for tracers / blood); -1 when missed */
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxD: number) {
    if (!this.data.alive || !this.visible) return -1
    const cx = this.x, cz = this.z
    const ox = o.x - cx, oz = o.z - cz
    const a = d.x * d.x + d.z * d.z
    if (a < 1e-9) return -1
    const bq = ox * d.x + oz * d.z
    const c = ox * ox + oz * oz - 0.45 * 0.45
    const disc = bq * bq - a * c
    if (disc < 0) return -1
    const t = (-bq - Math.sqrt(disc)) / a
    if (t < 0 || t > maxD) return -1
    const y = o.y + d.y * t
    return y >= this.y && y <= this.y + 1.85 ? t : -1
  }
  dispose(scene: THREE.Scene) {
    scene.remove(this.root)
    this.tag.material.map?.dispose()
    this.tag.material.dispose()
  }
}

export class RemoteManager {
  map = new Map<string, RemotePlayer>()
  constructor(private scene: THREE.Scene) {}
  sync(list: NetPlayer[]) {
    const seen = new Set<string>()
    for (const d of list) {
      seen.add(d.id)
      let r = this.map.get(d.id)
      if (!r) {
        r = new RemotePlayer(d, this.scene)
        this.map.set(d.id, r)
      } else {
        if (r.data.team !== d.team) {
          r.human.look = r.lookFor(d)
          r.human.build()
        }
        r.push(d)
      }
    }
    for (const [id, r] of this.map) {
      if (!seen.has(id)) {
        r.dispose(this.scene)
        this.map.delete(id)
      }
    }
  }
  update(dt: number, serverNow: number, cam: THREE.Camera, fx: FX, team: number) {
    for (const r of this.map.values()) r.update(dt, serverNow, cam, fx, team)
  }
  rayHit(o: THREE.Vector3, d: THREE.Vector3, maxD: number, myTeam: number) {
    let best = -1
    for (const r of this.map.values()) {
      if (myTeam >= 0 && r.data.team === myTeam) continue
      const t = r.rayHit(o, d, maxD)
      if (t >= 0 && (best < 0 || t < best)) best = t
    }
    return best
  }
  clear() {
    for (const r of this.map.values()) r.dispose(this.scene)
    this.map.clear()
  }
}
