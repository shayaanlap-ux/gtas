// Local weapon state, shooting, reloading, recoil, pickups and hit feedback.
import * as THREE from 'three'
import { WEAPONS, WEAPON_ORDER, MODES, PICKUP_RESPAWN, type ModeId, type PickupDef, type PickupKind, type WeaponId } from './mpData'
import { buildPickup } from './gear'
import { groundAt, raycastWorld } from './world'

const CD = new THREE.Vector3(), CO = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3()
const RIGHT = new THREE.Vector3(), UP2 = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), MUZ = new THREE.Vector3(), DIR = new THREE.Vector3()

export class Combat {
  owned: WeaponId[] = ['pistol']
  ammo: Partial<Record<WeaponId, { mag: number; res: number }>> = {}
  cur: WeaponId | null = null
  reloadT = 0
  reloadTot = 1
  swapT = 0
  nextShot = 0
  bloom = 0
  recoilPool = 0
  trigger = false
  fresh = false
  ads = false
  adsAmt = 0
  hitT = 0
  hitHead = false
  killT = 0
  hurtT = 0
  hurtDirs: { rel: number; t: number }[] = []
  crossPx = 20
  // pickups
  root = new THREE.Group()
  defs: PickupDef[] = []
  avail: boolean[] = []
  respawnAt: number[] = []
  objs: THREE.Group[] = []
  ys: number[] = []

  constructor(private g: any) {
    g.scene.add(this.root)
  }

  // ------------------------------------------------------------ loadout
  resetLoadout(mode: ModeId, drawn: boolean) {
    const m = MODES[mode]
    this.owned = [...m.loadout]
    this.ammo = {}
    for (const id of this.owned) this.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].startReserve }
    this.cur = drawn ? m.loadout[m.loadout.length - 1] : null
    this.reloadT = 0
    this.swapT = 0
    this.ads = false
    this.bloom = 0
    this.recoilPool = 0
  }
  select(id: WeaponId | null) {
    if (id && !this.owned.includes(id)) return
    if (id === this.cur) return
    this.cur = id
    this.reloadT = 0
    this.swapT = id ? 0.3 : 0
    this.ads = false
    this.g.audio.click()
  }
  cycle(dir: number) {
    const list = WEAPON_ORDER.filter((w) => this.owned.includes(w))
    if (!list.length) return
    const i = this.cur ? list.indexOf(this.cur) : -1
    this.select(list[(i + dir + list.length * 2) % list.length])
  }
  reload() {
    if (!this.cur || this.reloadT > 0) return
    const w = WEAPONS[this.cur], a = this.ammo[this.cur]!
    if (a.mag >= w.mag || a.res <= 0) return
    this.reloadT = this.reloadTot = w.reload
    this.ads = false
    this.g.audio.reload()
  }
  private finishReload() {
    const a = this.ammo[this.cur!]!
    const w = WEAPONS[this.cur!]
    const take = Math.min(w.mag - a.mag, a.res)
    a.mag += take
    a.res -= take
  }
  applyGrant(kind: PickupKind) {
    const g = this.g
    if (kind in WEAPONS) {
      const id = kind as WeaponId, w = WEAPONS[id]
      if (!this.owned.includes(id)) {
        this.owned = WEAPON_ORDER.filter((x) => x === id || this.owned.includes(x))
        this.ammo[id] = { mag: w.mag, res: Math.round(w.startReserve * 0.6) }
        this.select(id)
        g.toast(`Picked up ${w.name}`)
      } else {
        const a = this.ammo[id]!
        a.res = Math.min(w.reserve, a.res + w.pickupAmmo)
        g.toast(`${w.name} ammo +${w.pickupAmmo}`)
      }
    } else if (kind === 'ammo') {
      for (const id of this.owned) {
        const a = this.ammo[id]!, w = WEAPONS[id]
        a.res = Math.min(w.reserve, a.res + Math.ceil(w.pickupAmmo * 0.6))
      }
      g.toast('Ammo restocked')
    } else if (kind === 'fuel') {
      g.jet.fuel = g.jet.max
      g.toast('Jetpack refuelled')
    } else if (kind === 'health') {
      if (!g.net) g.hp = Math.min(100, g.hp + 50)
      g.toast('Medkit: +50 health')
    }
    g.audio.pickup()
  }

  // ------------------------------------------------------------ feedback from server
  onHits(hits: { id: string; dmg: number; head: boolean; kill: boolean }[]) {
    for (const h of hits) {
      this.hitT = 0.28
      this.hitHead = h.head
      if (h.kill) this.killT = 0.8
      this.g.audio.hitMark(h.kill, h.head)
    }
  }
  onHurt(list: { x: number; z: number; dmg: number }[]) {
    const p = this.g.player
    for (const h of list) {
      const ang = Math.atan2(h.x - p.x, h.z - p.z)
      let rel = ang - this.g.camYaw
      rel = Math.atan2(Math.sin(rel), Math.cos(rel))
      this.hurtDirs.push({ rel, t: 1.4 })
      this.hurtT = 0.6
      this.g.audio.hurt()
    }
    if (this.hurtDirs.length > 4) this.hurtDirs.splice(0, this.hurtDirs.length - 4)
  }

  // ------------------------------------------------------------ shooting
  update(dt: number, canShoot: boolean) {
    const g = this.g
    this.bloom = Math.max(0, this.bloom - dt * 2.4)
    this.swapT -= dt
    this.hitT -= dt
    this.killT -= dt
    this.hurtT -= dt
    for (const h of this.hurtDirs) h.t -= dt
    if (this.hurtDirs.length && this.hurtDirs[0].t <= 0) this.hurtDirs = this.hurtDirs.filter((h) => h.t > 0)
    if (this.reloadT > 0) {
      this.reloadT -= dt
      if (this.reloadT <= 0) this.finishReload()
    }
    const w = this.cur ? WEAPONS[this.cur] : null
    const want = !!w && this.ads && canShoot && this.reloadT <= 0
    this.adsAmt += ((want ? 1 : 0) - this.adsAmt) * Math.min(1, dt * 11)
    if (Math.abs(this.recoilPool) > 1e-4) {
      const r = this.recoilPool * (1 - Math.exp(-7 * dt))
      g.camPitch += r * 0.55
      this.recoilPool -= r
    }
    if (!w) {
      this.fresh = false
      return
    }
    // crosshair size
    const p = g.player
    const spd = Math.hypot(p.vx, p.vz)
    const sp = this.spread(w, spd)
    this.crossPx += (Math.tan(sp) * (window.innerHeight / 2) / Math.tan((g.camera.fov * Math.PI) / 360) - this.crossPx) * Math.min(1, dt * 14)
    if (!canShoot) {
      this.fresh = false
      return
    }
    if (this.trigger && g.time >= this.nextShot && this.reloadT <= 0 && this.swapT <= 0 && (w.auto || this.fresh)) {
      const a = this.ammo[w.id]!
      this.fresh = false
      if (a.mag > 0) this.fire(w, a, spd)
      else if (a.res > 0) this.reload()
      else {
        g.audio.empty()
        this.nextShot = g.time + 0.35
        g.toast(`${w.name}: out of ammo`)
      }
    }
  }
  spread(w: (typeof WEAPONS)[WeaponId], spd: number) {
    const p = this.g.player
    const base = w.spread + (w.adsSpread - w.spread) * this.adsAmt
    return base * (1 + this.bloom * 0.8 + (spd > 3 ? 0.5 : 0) + (!p.onGround ? 0.6 : 0) - (this.g.crouching ? 0.25 : 0))
  }
  private fire(w: (typeof WEAPONS)[WeaponId], a: { mag: number; res: number }, spd: number) {
    const g = this.g
    const p = g.player
    this.nextShot = g.time + 60 / w.rpm
    a.mag--
    const cam: THREE.Camera = g.camera
    cam.getWorldDirection(CD)
    CO.copy(cam.position)
    const eyeY = p.y + (g.crouching ? 1.15 : 1.55)
    // start the aim ray at the point of the camera ray nearest the player (so walls behind us don't block)
    const s0 = Math.max(0, Math.min(14, V1.set(p.x - CO.x, eyeY - CO.y, p.z - CO.z).dot(CD)))
    V2.copy(CO).addScaledVector(CD, s0)
    const tw = raycastWorld(V2.x, V2.y, V2.z, CD.x, CD.y, CD.z, 260)
    const tp = g.remotes.rayHit(V2, CD, tw, g.myTeam())
    let t = tp >= 0 ? Math.min(tw, tp) : tw
    t = Math.min(t, 200)
    V3.copy(V2).addScaledVector(CD, t) // aim point
    // muzzle
    const fy = g.camYaw
    const fx = Math.sin(fy), fz = Math.cos(fy)
    if (g.fpMode || g.scoped) MUZ.set(CO.x, CO.y - 0.12, CO.z)
    else MUZ.set(p.x - fz * 0.26 + fx * 0.5, p.y + (g.crouching ? 0.95 : 1.38), p.z + fx * 0.26 + fz * 0.5)
    DIR.copy(V3).sub(MUZ)
    const len = DIR.length()
    if (len < 1.5 || DIR.dot(CD) < 0.5 * len) DIR.copy(CD)
    else DIR.divideScalar(len)
    // visual muzzle position (the real gun barrel when visible)
    const vm = new THREE.Vector3()
    const mz = g.human.gunMesh?.userData.muzzle as THREE.Object3D | undefined
    if (mz && g.human.root.visible) mz.getWorldPosition(vm)
    else vm.copy(MUZ)
    const sp = this.spread(w, spd)
    RIGHT.crossVectors(DIR, UPV)
    if (RIGHT.lengthSq() < 1e-6) RIGHT.set(1, 0, 0)
    RIGHT.normalize()
    UP2.crossVectors(RIGHT, DIR).normalize()
    const rays: number[][] = []
    for (let i = 0; i < w.pellets; i++) {
      const ang = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * sp * (w.pellets > 1 ? 1 : 0.6)
      const dx = DIR.x + RIGHT.x * Math.cos(ang) * r + UP2.x * Math.sin(ang) * r
      const dy = DIR.y + RIGHT.y * Math.cos(ang) * r + UP2.y * Math.sin(ang) * r
      const dz = DIR.z + RIGHT.z * Math.cos(ang) * r + UP2.z * Math.sin(ang) * r
      const l = Math.hypot(dx, dy, dz)
      const d = DIR.set(dx / l, dy / l, dz / l).clone()
      const dw = raycastWorld(MUZ.x, MUZ.y, MUZ.z, d.x, d.y, d.z, w.range)
      const tpl = g.remotes.rayHit(MUZ, d, dw, g.myTeam())
      const te = tpl >= 0 ? tpl : dw
      const ex = MUZ.x + d.x * te, ey = MUZ.y + d.y * te, ez = MUZ.z + d.z * te
      g.fx.tracer(vm.x, vm.y, vm.z, ex, ey, ez, w.color)
      if (tpl >= 0) g.fx.blood(ex, ey, ez)
      else if (dw < w.range - 0.5) g.fx.impact(ex, ey, ez, -d.x * 0.5, 0.6, -d.z * 0.5)
      rays.push([d.x, d.y, d.z, dw])
      DIR.copy(V3).sub(MUZ).normalize()
      if (DIR.dot(CD) < 0.5) DIR.copy(CD)
    }
    g.fx.muzzle(vm.x, vm.y, vm.z, CD.x, CD.y, CD.z)
    g.audio.gun(w.id, w.vol)
    g.net?.shots.push({ w: w.id, o: [MUZ.x, MUZ.y, MUZ.z], rays })
    const kick = w.recoil * (1 - 0.35 * this.adsAmt)
    g.camPitch -= kick
    g.camYaw += (Math.random() - 0.5) * kick * 0.7
    this.recoilPool += kick
    this.bloom = Math.min(1.5, this.bloom + 0.12 + w.recoil * 3)
    g.shake = Math.min(1, g.shake + (w.id === 'shotgun' ? 0.35 : w.id === 'sniper' ? 0.45 : 0.04))
    g.lastFire = g.time
    if (a.mag === 0 && a.res > 0) this.nextShot = Math.max(this.nextShot, g.time + 0.2), setTimeout(() => this.reload(), 200)
  }

  // ------------------------------------------------------------ pickups
  setPickups(defs: PickupDef[]) {
    for (const o of this.objs) this.root.remove(o)
    this.objs = []
    this.defs = defs
    this.avail = defs.map(() => true)
    this.respawnAt = defs.map(() => 0)
    this.ys = defs.map((d) => d.y ?? groundAt(d.x, d.z, 40, 40) + 0.05)
    defs.forEach((d, i) => {
      const o = buildPickup(d.kind)
      o.position.set(d.x, this.ys[i], d.z)
      o.visible = false
      this.root.add(o)
      this.objs.push(o)
    })
  }
  applyAvail(pu: string) {
    const n = Math.min(pu.length, this.avail.length)
    for (let i = 0; i < n; i++) this.avail[i] = pu[i] === '1'
  }
  updatePickups(dt: number, collect: boolean) {
    const g = this.g
    const p = g.player
    for (let i = 0; i < this.objs.length; i++) {
      const o = this.objs[i], d = this.defs[i]
      if (!g.net && !this.avail[i] && g.time >= this.respawnAt[i]) this.avail[i] = true
      const dist = Math.hypot(d.x - p.x, d.z - p.z)
      const vis = this.avail[i] && dist < 240 && !p.interior
      o.visible = vis
      if (!vis) continue
      const item = o.userData.item as THREE.Object3D
      item.rotation.y += dt * 1.8
      item.position.y = 0.95 + Math.sin(g.time * 2 + i) * 0.12
      if (!collect || dist > 1.9) continue
      if (Math.abs(this.ys[i] + 0.9 - (p.y + 0.9)) > 2.4) continue
      if (g.net) {
        if (g.net.claim === null && (d.kind !== 'health' || g.hp < 100)) g.net.claim = i
      } else {
        if (d.kind === 'health' && g.hp >= 100) continue
        this.avail[i] = false
        this.respawnAt[i] = g.time + (PICKUP_RESPAWN[d.kind] ?? 20)
        this.applyGrant(d.kind)
      }
    }
  }

  // ------------------------------------------------------------ HUD
  snap() {
    const w = this.cur ? WEAPONS[this.cur] : null
    const a = this.cur ? this.ammo[this.cur] : null
    return {
      cur: this.cur,
      name: w?.name ?? '',
      mag: a?.mag ?? 0,
      res: a?.res ?? 0,
      reload: this.reloadT > 0 ? 1 - this.reloadT / this.reloadTot : -1,
      ads: this.adsAmt,
      scope: !!w?.scope && this.adsAmt > 0.85,
      cross: Math.round(this.crossPx),
      hit: this.hitT > 0 ? { head: this.hitHead } : null,
      kill: this.killT > 0,
      hurt: Math.max(0, this.hurtT / 0.6),
      hurtDirs: this.hurtDirs.map((h) => h.rel),
      slots: WEAPON_ORDER.map((id) => ({ id, name: WEAPONS[id].name, slot: WEAPONS[id].slot, owned: this.owned.includes(id), mag: this.ammo[id]?.mag ?? 0, res: this.ammo[id]?.res ?? 0, cur: id === this.cur })),
    }
  }
}
