// @ts-nocheck
import * as THREE from 'three'
import { clamp, lerp, damp, angDiff, mulberry32, ChunkSet, Batch, Instancer } from './util'
import { buildSharedMaterials } from './materials'
import { buildTerrain, buildInfra } from './build1'
import { buildTown, registerVegetation } from './build2'
import { buildInteriors, Interior } from './interiors'
import { Atmosphere, WEATHER } from './sky'
import { AudioSys } from './audio'
import { Traffic } from './traffic'
import { NPCManager } from './npcs'
import { Humanoid, Look, SKINS } from './character'
import { Vehicle, CAR_COLORS } from './vehicles'
import { MISSIONS } from './missions'
import { buildMapCanvas, mapPx } from './minimap'
import { W, groundAt, roofAt, pushOut, hit, terrainH, roadEdgeDist, nearestRoad, PLAY_LIMIT, WATER_Y, PLANTATIONS, PADDIES, FLY_Z } from './world'
import { FX } from './fx'
import { Combat } from './combat'
import { RemoteManager } from './remote'
import { NetClient } from './net'
import { JET, MODES, WEAPONS, pickupsFor, TEAM_COLORS, type ModeId, type NetPlayer, type SyncResponse, type WeaponId } from './mpData'

const SAVE_KEY = 'nellyadi-save-v1'

export const SHOPS = {
  store: {
    title: 'Nellyadi Stores', kn: 'ನೆಲ್ಲ್ಯಾಡಿ ಸ್ಟೋರ್ಸ್',
    items: [
      { id: 'biscuit', name: 'Biscuits & snack', price: 20, desc: 'Quick energy for 60 s', buff: 60 },
      { id: 'cola', name: 'Cold drink', price: 30, desc: 'Refreshing, energy for 40 s', buff: 40 },
      { id: 'water', name: 'Mineral water', price: 15, desc: 'Refills stamina', buff: 20 },
      { id: 'umbrella', name: 'Umbrella', price: 150, desc: 'Stay dry on foot in the monsoon', umbrella: true },
    ],
  },
  hotel: {
    title: 'Udupi Hotel', kn: 'ಉಡುಪಿ ಹೋಟೆಲ್',
    items: [
      { id: 'dosa', name: 'Masala dosa', price: 60, desc: 'Energy for 2 minutes', buff: 120 },
      { id: 'meals', name: 'Full meals', price: 90, desc: 'Energy for 4 minutes', buff: 240 },
      { id: 'coffee', name: 'Filter coffee', price: 20, desc: 'Energy for 1 minute', buff: 60 },
    ],
  },
}
const STALL_BUY = {
  coconut: { name: 'tender coconut', price: 30 },
  tea: { name: 'chai', price: 10 },
  veg: { name: 'vegetables', price: 25 },
  fruit: { name: 'bananas', price: 20 },
  flower: { name: 'marigold garland', price: 15 },
}
export const PALETTE_SHIRT = [0x3b6ea5, 0xc0392b, 0x2f7a4f, 0xf2f2f2, 0xe8c547, 0x6b4a8d, 0x2a2a2a, 0xd98e4a]
export const PALETTE_PANTS = [0x2b3a55, 0x222222, 0x5a4a3a, 0x3a4a5a, 0xf2f2ea, 0x3b5fa0, 0x8a2a2a]

const DEFAULT_LOOK: Look = { skin: SKINS[1], shirt: 0x3b6ea5, pants: 0x2b3a55, hair: 0x15110e, style: 'pants', scale: 1, cap: false, towel: false }

export class Game {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  worldRoot = new THREE.Group()
  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3200)
  chunks!: ChunkSet
  atmo!: Atmosphere
  audio = new AudioSys()
  traffic!: Traffic
  npcs!: NPCManager
  interiors: Record<string, Interior> = {}
  mapCanvas!: HTMLCanvasElement
  mm: HTMLCanvasElement | null = null
  collectibles: { x: number; y: number; z: number; mesh?: THREE.Group; got?: boolean }[] = []
  beacon!: THREE.Mesh
  headlights: THREE.SpotLight[] = []
  keys: Record<string, boolean> = {}
  running = false
  paused = true
  menu: 'none' | 'pause' | 'shop' | 'customise' = 'pause'
  started = false
  locked = false
  raf = 0
  last = 0
  acc = 0
  time = 0
  quality = 'high'
  viewDist = 760
  fpMode = false
  camMode = 0 // vehicles: 0 chase 1 first-person 2 far
  camYaw = Math.PI / 2
  camPitch = 0.25
  camDist = 3.6
  camOffYaw = 0
  camOffT = 0
  smoothHead = 0
  shake = 0
  fovBase = 65
  camPos = new THREE.Vector3()
  hudTimer = 0
  chunkT = 0
  toasts: { text: string; t: number }[] = []
  subtitle: { name: string; text: string; t: number } | null = null
  shopId: string | null = null
  prompt: { text: string; act: () => void } | null = null
  hornHeld = false
  autoSave = 0
  edgeWarn = 0
  mouseSens = 0.0023
  volume = 0.7
  // ---- combat / movement / multiplayer state
  mode: ModeId = 'freeroam'
  net: NetClient | null = null
  netError = ''
  fx!: FX
  combat!: Combat
  remotes!: RemoteManager
  mp = this.freshMp()
  hp = 100
  alive = true
  spawnSeq = 0
  jet = { fuel: JET.fuelMax, max: JET.fuelMax, active: false, boost: false, delay: 0 }
  spaceHeld = false
  crouchPressed = false
  crouching = false
  slideT = 0
  slideDir = new THREE.Vector3()
  airT = 0
  shoulder = 0
  animName = 'idle'
  showScore = false
  lastFire = -10
  flameT = 0
  camSnap = false
  camTmp = { x: 0, z: 0 }
  _v = new THREE.Vector3()
  mmT = 0

  player: any = {
    x: 9, y: 0, z: 6.4, vx: 0, vz: 0, vy: 0, yaw: Math.PI / 2, onGround: true, stamina: 1, sprinting: false, inWater: false,
    buff: 0, money: 500, collected: new Set<number>(), look: { ...DEFAULT_LOOK }, hasUmbrella: false, vehicle: null as Vehicle | null,
    interior: null as string | null, outside: null as any, sitting: null as any, stepPhase: 0, lastVehicle: null,
  }
  human!: Humanoid
  mission = { idx: 0, step: 0, t: 0, base: 0, route: 0, failed: 0 }
  missionDone = false
  objective: { x: number; z: number; y: number; r: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.scene.add(this.worldRoot)
    this.scene.add(this.camera)
  }

  // ------------------------------------------------------------------ setup
  static async create(canvas: HTMLCanvasElement, onProgress: (p: number, msg: string) => void) {
    const g = new Game(canvas)
    await g.init(onProgress)
    return g
  }
  private async init(prog: (p: number, m: string) => void) {
    const tick = () => new Promise((r) => setTimeout(r, 16))
    prog(0.02, 'Preparing materials')
    await tick()
    buildSharedMaterials()
    this.chunks = new ChunkSet(this.worldRoot)
    const batch = new Batch(this.chunks)
    const inst = new Instancer(this.chunks)
    registerVegetation(inst)
    const rng = mulberry32(574229)
    prog(0.08, 'Shaping the terrain, hills and stream')
    await tick()
    buildTerrain(this.worldRoot)
    prog(0.3, 'Laying roads, flyover, signs and poles')
    await tick()
    buildInfra(this.worldRoot, this.chunks, batch, rng)
    prog(0.45, 'Building shops, houses and plantations')
    await tick()
    const town = buildTown(this.worldRoot, this.chunks, batch, inst, rng)
    prog(0.7, 'Merging geometry')
    await tick()
    batch.build()
    inst.build()
    prog(0.78, 'Furnishing interiors')
    await tick()
    this.interiors = buildInteriors(this.scene)
    this.mapCanvas = buildMapCanvas()
    prog(0.85, 'Starting weather and sky')
    await tick()
    this.atmo = new Atmosphere(this.scene, this.renderer)
    this.atmo.onThunder = (d, p) => this.audio.thunder(d, p)
    prog(0.9, 'Populating roads and streets')
    await tick()
    this.traffic = new Traffic(this.worldRoot)
    this.traffic.hornCb = (d, p) => this.audio.horn(d, p)
    this.traffic.crashCb = (p, v) => {
      const d = Math.hypot(v.x - this.player.x, v.z - this.player.z)
      if (v.driver === 'player') {
        this.shake = Math.min(1, this.shake + p * 0.04)
        this.audio.crash(p)
      } else if (d < 45) this.audio.crash(p * 0.5)
    }
    this.npcs = new NPCManager(this.worldRoot)
    // player
    this.human = new Humanoid(this.player.look)
    this.human.gear = true
    this.human.build()
    this.scene.add(this.human.root)
    this.fx = new FX(this.scene)
    this.combat = new Combat(this)
    this.remotes = new RemoteManager(this.scene)
    this.combat.resetLoadout('freeroam', false)
    this.combat.setPickups(pickupsFor('freeroam'))
    // collectibles
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc233, emissive: 0xff9a00, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 })
    const glowTex = new THREE.SpriteMaterial({ color: 0xffd25a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
    town.collectibles.forEach((c, i) => {
      const gr = new THREE.Group()
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0).scale(0.8, 1.25, 0.8), gold)
      gr.add(m)
      const s = new THREE.Sprite(glowTex)
      s.scale.setScalar(2.2)
      gr.add(s)
      gr.position.set(c.x, c.y, c.z)
      this.worldRoot.add(gr)
      this.collectibles.push({ ...c, mesh: gr })
      void i
    })
    // objective beacon
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 90, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xb36bff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    )
    this.beacon.visible = false
    this.scene.add(this.beacon)
    // headlights
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xfff0d0, 0, 75, 0.5, 0.55, 1.5)
      s.castShadow = false
      const t = new THREE.Object3D()
      s.add(t)
      s.target = t
      this.headlights.push(s)
    }
    prog(0.95, 'Parking vehicles')
    await tick()
    this.spawnParked()
    // initial traffic
    for (let i = 0; i < 9; i++) this.traffic.spawnAI(this.player.x, this.player.z, 60, 260)
    this.resize()
    window.addEventListener('resize', this.resize)
    this.bindInput()
    this.setMission(0, 0)
    this.applyQuality(this.quality)
    // pre-warm one frame
    this.updateCamera(0.016, true)
    this.atmo.update(0.016, this.camera, new THREE.Vector3(this.player.x, 0, this.player.z), false)
    this.renderer.render(this.scene, this.camera)
    prog(1, 'Ready')
    window.__game = this
  }

  spawnParked() {
    const T = this.traffic
    const E = Math.PI / 2, Wd = -Math.PI / 2
    const list: [string, number, number, number, number][] = [
      ['scooter', 0xd62828, 14.2, -6.3, E], ['scooter', 0xf2f2f0, 17.4, -6.4, E + 0.15], ['moto', 0x111111, -12.5, 6.4, Wd], ['moto', 0x2b6cb0, -15.6, 6.3, Wd - 0.1],
      ['auto', 0xf2c200, -52.5, 5.9, Wd], ['auto', 0xf2c200, -57.8, 5.9, Wd + 0.05], ['hatch', 0xf2f2f0, 36, -6.2, E], ['coupe', 0x15161a, 24.5, 5.9, Wd],
      ['bus', 0xb3131a, -72, -6.4, E], ['sedan', 0x2f5fa3, 92, 5.9, Wd], ['scooter', 0xffb703, -122, -6.3, E], ['moto', 0x7a8b99, 140, 6.3, Wd],
      ['suv', 0xc9ccd1, 4.0, -6.2, Math.PI / 2 + 0.05], ['auto', 0x1d6b35, 70, 5.9, Wd], ['scooter', 0x2a9d8f, -32, 6.3, Wd + 0.1],
    ]
    for (const [v, c, x, z, h] of list) T.addParked(v, c, x, z, h)
  }

  attachMinimap(c: HTMLCanvasElement | null) {
    this.mm = c
  }

  resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  applyQuality(q: string) {
    this.quality = q
    const dpr = window.devicePixelRatio || 1
    if (q === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 0.85))
      this.renderer.shadowMap.enabled = false
      this.viewDist = 480
      this.traffic.maxAI = 8
      this.npcs.poolSize = 14
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1))
      this.renderer.shadowMap.enabled = true
      this.atmo.sun.shadow.mapSize.set(1024, 1024)
      this.viewDist = 620
      this.traffic.maxAI = 12
      this.npcs.poolSize = 20
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5))
      this.renderer.shadowMap.enabled = true
      this.atmo.sun.shadow.mapSize.set(2048, 2048)
      this.viewDist = 780
      this.traffic.maxAI = 16
      this.npcs.poolSize = 26
    }
    this.atmo.sun.shadow.map?.dispose()
    this.atmo.sun.shadow.map = null
    this.scene.traverse((o: any) => {
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material]
        ms.forEach((m) => (m.needsUpdate = true))
      }
    })
    if (this.mode !== 'freeroam') {
      this.traffic.maxAI = 0
      this.npcs.poolSize = 4
    }
    this.resize()
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouse)
    document.addEventListener('pointerlockchange', this.onLock)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true })
    document.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('blur', () => {
      this.keys = {}
      this.spaceHeld = false
      this.combat.trigger = false
      this.combat.ads = false
      this.showScore = false
    })
  }
  dispose() {
    this.running = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouse)
    document.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    this.net?.stop()
    document.removeEventListener('pointerlockchange', this.onLock)
    window.removeEventListener('resize', this.resize)
    this.renderer.dispose()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }
  onLock = () => {
    this.locked = document.pointerLockElement === this.canvas
    if (!this.locked && this.started && this.menu === 'none') this.openMenu('pause')
  }
  onMouse = (e: MouseEvent) => {
    if (!this.locked || this.paused) return
    const zk = this.combat.cur && !this.player.vehicle ? 1 + (WEAPONS[this.combat.cur].zoom - 1) * this.combat.adsAmt : 1
    const dx = e.movementX * this.mouseSens * zk, dy = e.movementY * this.mouseSens * zk
    const p = this.player
    if (p.vehicle && this.camMode !== 1) {
      this.camOffYaw = clamp(this.camOffYaw - dx, -Math.PI, Math.PI)
      this.camPitch = clamp(this.camPitch + dy * 0.8, -0.2, 0.9)
      this.camOffT = 1.6
    } else if (p.vehicle) {
      this.camOffYaw = clamp(this.camOffYaw - dx, -1.9, 1.9)
      this.camPitch = clamp(this.camPitch + dy, -0.8, 0.8)
      this.camOffT = 1.6
    } else {
      this.camYaw -= dx
      this.camPitch = clamp(this.camPitch + dy, this.fpMode || this.scoped ? -1.45 : -1.2, this.fpMode || this.scoped ? 1.45 : 1.3)
    }
  }
  onMouseDown = (e: MouseEvent) => {
    if (!this.locked || this.paused || !this.started) return
    if (e.button === 0) {
      this.combat.trigger = true
      this.combat.fresh = true
    } else if (e.button === 2) this.combat.ads = !!this.combat.cur && !this.player.vehicle
  }
  onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.combat.trigger = false
    else if (e.button === 2) this.combat.ads = false
  }
  onWheel = (e: WheelEvent) => {
    if (this.paused) return
    if (this.combat.cur && !this.player.vehicle && this.alive) {
      this.combat.cycle(e.deltaY > 0 ? 1 : -1)
      return
    }
    this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.4, 1.8, 8)
  }
  onKeyDown = (e: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault()
    if (e.code === 'Space') this.spaceHeld = true
    if (e.repeat) return
    this.keys[e.code] = true
    if (this.paused || !this.started) return
    const p = this.player
    if (e.code === 'Tab') this.showScore = true
    if (!p.vehicle && this.alive) {
      if ((e.code === 'KeyC' || e.code === 'ControlLeft') && !p.sitting) this.crouchPressed = true
      const dm = /^Digit([0-5])$/.exec(e.code)
      if (dm) {
        const n = +dm[1]
        if (n === 0) this.combat.select(null)
        else this.combat.select(Object.values(WEAPONS).find((w) => w.slot === n)!.id)
      }
      if (e.code === 'KeyR') this.combat.reload()
      if (e.code === 'KeyG') this.combat.select(this.combat.cur ? null : this.combat.owned[this.combat.owned.length - 1])
    }
    switch (e.code) {
      case 'KeyE':
        this.prompt?.act()
        break
      case 'KeyF': {
        const n = this.npcs.nearestTalkable(p.x, p.z)
        if (n && !p.vehicle) {
          const l = this.npcs.lineFor(n, this.atmo.rain, this.atmo.hour)
          this.subtitle = { ...l, t: 6 }
          n.yaw = Math.atan2(p.x - n.x, p.z - n.z)
          this.audio.click()
        }
        break
      }
      case 'KeyV':
        if (!p.vehicle) {
          this.fpMode = !this.fpMode
          this.camPitch = this.fpMode ? 0 : 0.25
        }
        break
      case 'KeyC':
        if (p.vehicle) {
          this.camMode = (this.camMode + 1) % 3
          this.camOffYaw = 0
          this.camPitch = this.camMode === 1 ? 0 : 0.2
          this.toast(['Chase camera', 'First-person camera', 'Far camera'][this.camMode])
        }
        break
      case 'KeyL':
        if (p.vehicle) {
          p.vehicle.lightsOn = !p.vehicle.lightsOn
          this.toast(p.vehicle.lightsOn ? 'Headlights on' : 'Headlights off')
          this.audio.click()
        }
        break
      case 'KeyH':
        if (p.vehicle) {
          this.hornHeld = true
          this.audio.playerHorn(true)
        }
        break
      case 'KeyQ':
        if (p.sitting) this.standUp()
        break
    }
  }
  onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false
    if (e.code === 'Space') this.spaceHeld = false
    if (e.code === 'Tab') this.showScore = false
    if (e.code === 'KeyH') {
      this.hornHeld = false
      this.audio.playerHorn(false)
    }
  }
  k(...codes: string[]) {
    return codes.some((c) => this.keys[c])
  }

  // ------------------------------------------------------------------ lifecycle
  start(loadSave = false) {
    this.audio.init()
    this.audio.setVolume(this.volume)
    if (loadSave) this.load()
    else {
      this.atmo.hour = 17.3
      this.atmo.setWeather('drizzle')
      this.atmo.cloud = 0.9
      this.atmo.rain = 0.25
      this.atmo.wet = 0.7
    }
    this.started = true
    this.resume()
    if (!this.running) {
      this.running = true
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.loop)
    }
    this.toast('Welcome to Nellyadi — 574229')
  }
  openMenu(m: 'pause' | 'shop' | 'customise') {
    this.menu = m
    this.paused = true
    this.audio.playerHorn(false)
    this.keys = {}
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }
  resume() {
    this.menu = 'none'
    this.paused = false
    this.shopId = null
    this.audio.init()
    try {
      const r: any = this.canvas.requestPointerLock()
      if (r && r.catch) r.catch(() => {})
    } catch (e) {
      /* ignore */
    }
  }
  toast(text: string) {
    this.toasts.push({ text, t: 4.5 })
    if (this.toasts.length > 4) this.toasts.shift()
  }

  loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (!this.paused) this.update(dt)
    else {
      // keep rendering the frozen world (camera still updates for menus)
      this.updateCamera(0, false)
      this.fx.update(dt)
      if (this.net) this.remotes.update(dt, this.net.now(), this.camera, this.fx, this.mp.team)
    }
    this.renderer.render(this.scene, this.camera)
    this.mmT += dt
    if (this.mmT >= 0.033) {
      this.mmT = 0
      this.drawMinimap()
    }
  }

  // ------------------------------------------------------------------ simulation
  update(dt: number) {
    this.time += dt
    const p = this.player
    // fixed-step vehicle physics + traffic
    const veh: Vehicle | null = p.vehicle
    if (veh) this.driveInput(veh)
    this.acc += dt
    let n = 0
    const wet = this.atmo.wet * (this.atmo.rain > 0.1 || this.atmo.wet > 0.35 ? 1 : 0.6)
    while (this.acc >= 1 / 60 && n < 4) {
      this.acc -= 1 / 60
      n++
      this.traffic.update(1 / 60, {
        px: p.x, pz: p.z, player: { x: p.x, y: p.y, z: p.z, inVehicle: !!p.vehicle }, npcs: this.npcs.npcs, wet,
        dark: this.atmo.darkness, hour: this.atmo.hour, playerVeh: veh,
      })
    }
    if (this.acc > 0.1) this.acc = 0
    if (p.interior) {
      this.interiors[p.interior].anim(dt, this.time)
    } else {
      this.npcs.update(dt, {
        px: p.x, pz: p.z, py: p.y, hour: this.atmo.hour, rain: this.atmo.rain, vehicles: this.traffic.all.filter((v) => Math.abs(v.x - p.x) < 140 && Math.abs(v.z - p.z) < 140),
        playerVeh: veh, horn: this.hornHeld, playerSprint: p.sprinting,
        onHit: (npc: any, sp: number) => {
          this.audio.crash(sp * 0.4)
          this.toast(`You knocked ${npc.name} over! Drive carefully.`)
        },
      })
    }
    // player
    if (veh) this.updateInVehicle(dt, veh)
    else this.updateOnFoot(dt)
    // timers
    if (p.buff > 0) p.buff -= dt
    for (const t of this.toasts) t.t -= dt
    this.toasts = this.toasts.filter((t) => t.t > 0)
    if (this.subtitle) {
      this.subtitle.t -= dt
      if (this.subtitle.t <= 0) this.subtitle = null
    }
    this.shake = Math.max(0, this.shake - dt * 1.5)
    // atmosphere
    this.atmo.update(dt, this.camera, new THREE.Vector3(p.x, p.y, p.z), !!p.interior)
    // world streaming/visibility
    this.chunkT -= dt
    if (this.chunkT <= 0 && !p.interior) {
      this.chunkT = 0.4
      this.chunks.updateVisibility(p.x, p.z, this.viewDist)
    }
    this.updateInteractions()
    this.updateCollectibles(dt)
    this.updateCombat(dt)
    if (this.mode === 'freeroam') this.updateMission(dt)
    this.updateCamera(dt, false)
    this.updateAudio(dt)
    this.autoSave += dt
    if (this.autoSave > 120 && this.mode === 'freeroam') {
      this.autoSave = 0
      this.save(true)
    }
  }

  private surface(): 'road' | 'grass' | 'wet' | 'water' | 'indoor' {
    const p = this.player
    if (p.interior) return 'indoor'
    if (p.inWater) return 'water'
    const road = roadEdgeDist(p.x, p.z) < 0.3
    if (road) return this.atmo.wet > 0.4 ? 'wet' : 'road'
    return this.atmo.wet > 0.5 ? 'wet' : 'grass'
  }

  updateOnFoot(dt: number) {
    const p = this.player
    const h = this.human
    const J = this.jet
    const cb = this.combat
    if (!this.alive) {
      this.updateDead(dt)
      return
    }
    if (p.sitting) {
      const moveKey = this.k('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space')
      if (moveKey) this.standUp()
      else {
        p.stamina = Math.min(1, p.stamina + dt * 0.35)
        h.root.position.set(p.x, p.y, p.z)
        h.root.rotation.y = p.yaw
        h.pose('sit', 0, dt)
        h.setUmbrella(false)
        h.setGun(null)
        return
      }
    }
    const w = cb.cur ? WEAPONS[cb.cur] : null
    const fwd = (this.k('KeyW', 'ArrowUp') ? 1 : 0) - (this.k('KeyS', 'ArrowDown') ? 1 : 0)
    const str = (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0)
    const cy = this.camYaw
    const fx = Math.sin(cy), fz = Math.cos(cy)
    const rx = -fz, rz = fx
    let ix = fx * fwd + rx * str, iz = fz * fwd + rz * str
    const il = Math.hypot(ix, iz)
    if (il > 0) {
      ix /= il
      iz /= il
    }
    const moving = il > 0
    const buff = p.buff > 0
    const sprintKey = this.k('ShiftLeft', 'ShiftRight')
    const crouchKey = this.k('KeyC', 'ControlLeft', 'ControlRight')
    const spaceHeld = this.spaceHeld
    const hSpeed0 = Math.hypot(p.vx, p.vz)
    // ---- crouch / slide
    if (this.crouchPressed) {
      this.crouchPressed = false
      if (p.onGround && p.sprinting && hSpeed0 > 5.5 && this.slideT <= 0 && !p.inWater && !p.interior && p.stamina > 0.12) {
        this.slideT = 0.85
        this.slideDir.set(p.vx / hSpeed0, 0, p.vz / hSpeed0)
        p.stamina = Math.max(0, p.stamina - 0.1)
        this.audio.footstep('road', true)
      }
    }
    if (this.slideT > 0) this.slideT -= dt
    const sliding = this.slideT > 0 && p.onGround
    if (!p.onGround) this.slideT = 0
    this.crouching = crouchKey && p.onGround && !sliding && !p.inWater
    // ---- jetpack state
    const airborne = !p.onGround && !p.inWater
    this.airT = airborne ? this.airT + dt : 0
    const jm = MODES[this.mode]
    const wantJet = spaceHeld && airborne && J.fuel > 0 && this.airT > 0.16 && !p.interior && !p.sitting
    const boost = wantJet && sprintKey
    J.active = wantJet
    J.boost = boost
    const wantSprint = sprintKey && moving && p.stamina > 0.04 && !p.interior && !sliding && !this.crouching && cb.adsAmt < 0.3 && p.onGround
    p.sprinting = wantSprint
    let speed = 3.9
    if (this.crouching) speed = 2.0
    if (wantSprint) speed = 7.2 * (buff ? 1.1 : 1)
    if (w) speed *= w.moveMul * (1 - 0.35 * cb.adsAmt)
    if (p.inWater) speed *= 0.55
    if (p.interior) speed = Math.min(speed, 3.4)
    let tx = ix * speed, tz = iz * speed
    let acc = p.onGround ? (moving ? 13 : 14) : 2.5
    if (sliding) {
      const k = Math.max(0, this.slideT / 0.85)
      const sv = 2.2 + 8.6 * Math.pow(k, 0.8)
      tx = this.slideDir.x * sv
      tz = this.slideDir.z * sv
      acc = 40
    }
    if (wantJet) {
      const top = boost ? JET.hSpeedBoost : JET.hSpeed
      let jx = ix, jz = iz
      if (boost && !moving) {
        jx = fx
        jz = fz
      }
      tx = jx * top
      tz = jz * top
      if (!boost && !moving) {
        tx = p.vx * 0.985
        tz = p.vz * 0.985
      }
      acc = boost ? 30 : 17
    }
    const dvx = tx - p.vx, dvz = tz - p.vz
    const dl = Math.hypot(dvx, dvz)
    const mx = acc * dt
    if (dl > mx) {
      p.vx += (dvx / dl) * mx
      p.vz += (dvz / dl) * mx
    } else {
      p.vx = tx
      p.vz = tz
    }
    if (wantSprint) p.stamina = Math.max(0, p.stamina - dt * (buff ? 0.08 : 0.17))
    else p.stamina = Math.min(1, p.stamina + dt * (buff ? 0.34 : 0.13))
    // ---- jump
    if (this.k('Space') && p.onGround && !p.inWater) {
      p.vy = wantSprint || sliding ? 6.9 : 6.2
      if (sliding) {
        this.slideT = 0
        p.vx *= 1.1
        p.vz *= 1.1
      }
      p.onGround = false
      this.keys['Space'] = false
    } else if (this.k('Space') && p.onGround && p.inWater) {
      p.vy = 3.5
      p.onGround = false
      this.keys['Space'] = false
    }
    // ---- jetpack vertical thrust + fuel
    const maxFuel = J.max
    if (wantJet) {
      p.vy += JET.accel * dt
      const cap = boost ? JET.maxUpBoost : JET.maxUp
      const aimUp = boost ? clamp(-this.camPitch, -1, 1) * 6 : 0
      if (p.vy > cap + aimUp) p.vy = Math.max(cap + aimUp, p.vy - 40 * dt)
      J.fuel = Math.max(0, J.fuel - (boost ? JET.boostDrain : JET.drain) * dt)
      J.delay = JET.regenDelay
      if (J.fuel <= 0) this.toast('Jetpack out of fuel!')
    } else {
      J.delay -= dt
      if (J.delay <= 0 && J.fuel < maxFuel) {
        const rate = p.onGround ? JET.regen : JET.regen * jm.fuelRegenAir
        J.fuel = Math.min(maxFuel, J.fuel + rate * dt)
      }
      if (airborne && crouchKey) p.vy = Math.max(p.vy - 26 * dt, -18) // dive
    }
    // ---- integrate horizontally
    p.x += p.vx * dt
    p.z += p.vz * dt
    const tmp = { x: p.x, z: p.z }
    if (pushOut(tmp, 0.32, p.y + 0.7)) {
      const vn = p.vx * hit.nx + p.vz * hit.nz
      if (vn < 0) {
        p.vx -= vn * hit.nx
        p.vz -= vn * hit.nz
      }
      p.x = tmp.x
      p.z = tmp.z
      if (sliding) this.slideT = 0
    }
    // ---- world limits (open world edge / combat arena boundary)
    if (!p.interior) {
      if (Math.abs(p.x) > PLAY_LIMIT || Math.abs(p.z) > PLAY_LIMIT) {
        p.x = clamp(p.x, -PLAY_LIMIT, PLAY_LIMIT)
        p.z = clamp(p.z, -PLAY_LIMIT, PLAY_LIMIT)
        if (this.time - this.edgeWarn > 5) {
          this.edgeWarn = this.time
          this.toast('You have reached the edge of the playable area')
        }
      }
      if (jm.bounds) {
        const [bx, bz] = jm.bounds
        const n = (p.x / bx) ** 2 + (p.z / bz) ** 2
        if (n > 1) {
          const s = 1 / Math.sqrt(n)
          const ox = p.x, oz = p.z
          p.x *= s
          p.z *= s
          const nx = ox / bx ** 2, nz = oz / bz ** 2, nl = Math.hypot(nx, nz) || 1
          const vn = (p.vx * nx + p.vz * nz) / nl
          if (vn > 0) {
            p.vx -= (vn * nx) / nl
            p.vz -= (vn * nz) / nl
          }
          if (this.time - this.edgeWarn > 3) {
            this.edgeWarn = this.time
            this.toast('Combat area boundary — turn back')
          }
        }
      }
    }
    // ---- vertical
    const gyT = groundAt(p.x, p.z, p.y, 0.65)
    const gyR = roofAt(p.x, p.z, p.y, 0.65)
    const gy = Math.max(gyT, gyR)
    if (p.onGround) {
      if (p.y - gy > 0.12) p.onGround = false
      else p.y = gy
    }
    if (!p.onGround) {
      p.vy -= 20 * dt
      if (p.vy < -34) p.vy = -34
      p.y += p.vy * dt
      if (p.y > JET.maxY && p.vy > 0) {
        p.y = JET.maxY
        p.vy = 0
      }
      if (p.y <= gy) {
        if (p.vy < -6) p.stamina = Math.max(0, p.stamina - 0.1)
        if (p.vy < -9) this.audio.footstep('road', true)
        p.y = gy
        p.vy = 0
        p.onGround = true
      }
    } else p.vy = 0
    const th = terrainH(p.x, p.z)
    const inW = !p.interior && th < WATER_Y - 0.1 && Math.abs(gyT - th) < 0.3 && gyR < -1e8
    if (inW && !p.inWater) this.audio.splash()
    p.inWater = inW
    // ---- facing
    const spd = Math.hypot(p.vx, p.vz)
    const armed = !!w
    if (this.fpMode || this.scoped || (armed && !sliding) || (cb.trigger && armed)) p.yaw += angDiff(p.yaw, this.camYaw) * Math.min(1, dt * 16)
    else if (wantJet && spd > 1) p.yaw += angDiff(p.yaw, Math.atan2(p.vx, p.vz)) * Math.min(1, dt * 8)
    else if (spd > 0.4) p.yaw += angDiff(p.yaw, Math.atan2(p.vx, p.vz)) * Math.min(1, dt * 12)
    // ---- animate
    let mode = 'idle'
    if (sliding) mode = 'slide'
    else if (wantJet || (airborne && J.fuel < maxFuel && spaceHeld)) mode = 'fly'
    else if (!p.onGround && p.vy !== 0 && !p.inWater) mode = 'jump'
    else if (this.crouching) mode = 'crouch'
    else if (spd > 5.2) mode = 'run'
    else if (spd > 0.3) mode = 'walk'
    this.animName = mode
    h.root.position.set(p.x, p.y - (p.inWater ? 0.55 : 0), p.z)
    h.root.rotation.y = p.yaw
    const raining = this.atmo.rain > 0.2 && !p.interior
    h.setUmbrella(raining && p.hasUmbrella && mode !== 'jump' && !armed, 0x1b3a6b)
    h.setGun(cb.cur)
    h.aim = cb.cur ? clamp(-this.camPitch * 0.9, -0.7, 1.15) : null
    const prePhase = h.phase
    h.pose(mode, spd, dt, clamp(spd * 0.045, 0, 0.8))
    h.root.visible = !((this.fpMode || this.scoped) && !p.interior)
    // jet flames
    if (wantJet) {
      this.flameT -= dt
      if (this.flameT <= 0) {
        this.flameT = 0.025
        h.root.updateMatrixWorld(true)
        const fl = h.jetpack?.userData.flames as THREE.Object3D[] | undefined
        if (fl) for (const f of fl) {
          f.getWorldPosition(this._v)
          this.fx.jetFlame(this._v.x, this._v.y, this._v.z, p.vx, p.vy, p.vz, boost)
        }
      }
    }
    // footsteps
    if ((mode === 'walk' || mode === 'run') && p.onGround) {
      const a = Math.floor(prePhase / Math.PI), b = Math.floor(h.phase / Math.PI)
      if (a !== b) this.audio.footstep(this.surface(), mode === 'run')
    }
  }

  updateDead(dt: number) {
    const p = this.player
    const h = this.human
    p.vx *= Math.exp(-4 * dt)
    p.vz *= Math.exp(-4 * dt)
    p.x += p.vx * dt
    p.z += p.vz * dt
    const gy = Math.max(groundAt(p.x, p.z, p.y, 0.65), roofAt(p.x, p.z, p.y, 0.65))
    if (!p.onGround) {
      p.vy -= 20 * dt
      p.y += p.vy * dt
      if (p.y <= gy) {
        p.y = gy
        p.vy = 0
        p.onGround = true
      }
    } else p.y = gy
    this.jet.active = false
    this.animName = 'down'
    h.setGun(null)
    h.aim = null
    h.root.visible = true
    h.root.position.set(p.x, p.y, p.z)
    h.root.rotation.y = p.yaw
    h.pose('down', 0, dt)
    this.camYaw += dt * 0.25
  }

  standUp() {
    const p = this.player
    p.sitting = null
  }

  // ------------------------------------------------------------------ vehicles
  driveInput(v: Vehicle) {
    const up = this.k('KeyW', 'ArrowUp'), down = this.k('KeyS', 'ArrowDown')
    let throttle = 0, brake = 0
    if (up && !down) throttle = 1
    else if (down && !up) {
      if (v.vf > 0.8) brake = 1
      else throttle = -1
    } else if (up && down) brake = 1
    if (up && v.vf < -0.8) {
      brake = 1
      throttle = 0
    }
    const steer = (this.k('KeyA', 'ArrowLeft') ? 1 : 0) - (this.k('KeyD', 'ArrowRight') ? 1 : 0)
    v.setInput({ throttle, brake, steer, hand: this.k('Space') ? 1 : 0 })
    v.horn = this.hornHeld
  }
  updateInVehicle(dt: number, v: Vehicle) {
    const p = this.player
    p.x = v.x
    p.y = v.y
    p.z = v.z
    p.yaw = v.h
    p.vx = v.vx
    p.vz = v.vz
    p.stamina = Math.min(1, p.stamina + dt * 0.1)
    // rider pose
    if (v.seatPos) {
      this.human.pose(v.spec.kind === 'auto' ? 'sit' : 'ride', 0, dt)
      this.human.setUmbrella(false)
    }
    // headlights follow the vehicle & night auto
    const on = v.lightsOn
    const spec = v.spec
    const wide = spec.kind === 'car' || spec.kind === 'bus' ? spec.Wd * 0.28 : spec.kind === 'auto' ? 0.0 : 0
    this.headlights.forEach((s, i) => {
      const x = (i === 0 ? 1 : -1) * wide
      s.position.set(x, spec.kind === 'bus' ? 1.1 : spec.kind === 'car' ? 0.75 : 0.9, spec.L / 2 - 0.1)
      s.target.position.set(x * 0.5, -0.8, 28)
      s.intensity = on ? (spec.kind === 'car' || spec.kind === 'bus' ? 260 : i === 0 ? 420 : 0) : 0
    })
    // leaving guards
    if (v.y < -8) this.respawnVehicle(v)
  }
  respawnVehicle(v: Vehicle) {
    v.place(0, 4, Math.PI / 2, 0)
    this.toast('Vehicle recovered')
  }
  enterVehicle(v: Vehicle) {
    const p = this.player
    if (!MODES[this.mode].allowVehicles) {
      this.toast('No vehicles in this mode — use your jetpack!')
      return
    }
    this.combat.ads = false
    this.combat.trigger = false
    if (v.driver === 'ai') {
      this.traffic.ai = this.traffic.ai.filter((a) => a !== v)
      v.ai = null
      this.toast('The driver steps out and shakes a fist!')
    }
    v.driver = 'player'
    v.asleep = false
    p.vehicle = v
    p.lastVehicle = v
    p.sitting = null
    v.lightsOn = this.atmo.darkness > 0.45
    this.audio.carDoor()
    const h = this.human
    h.setUmbrella(false)
    if (v.seatPos) {
      v.built.body.add(h.root)
      h.root.position.set(v.seatPos.x, v.seatPos.y - 0.45, v.seatPos.z)
      h.root.rotation.set(0, 0, 0)
      h.root.visible = true
    } else h.root.visible = false
    this.headlights.forEach((s) => v.built.body.add(s))
    this.camMode = 0
    this.camOffYaw = 0
    this.camPitch = 0.2
    this.smoothHead = v.h
    this.camSnap = true
    this.fpMode = false
    this.toast(`${v.spec.label} — W/S drive, A/D steer, Space handbrake, H horn, L lights, C camera`)
    this.missionEvent('vehicle', v.spec.kind)
  }
  exitVehicle() {
    const p = this.player
    const v: Vehicle = p.vehicle
    if (!v) return
    if (Math.hypot(v.vx, v.vz) > 6.5) {
      this.toast('Slow down first!')
      return
    }
    const sp = v.spec
    const sh = Math.sin(v.h), ch = Math.cos(v.h)
    const lx = ch, lz = -sh
    const off = sp.Wd / 2 + 0.95
    const cands = [
      [v.x + lx * off, v.z + lz * off], [v.x - lx * off, v.z - lz * off],
      [v.x - sh * (sp.L / 2 + 1), v.z - ch * (sp.L / 2 + 1)], [v.x + sh * (sp.L / 2 + 1), v.z + ch * (sp.L / 2 + 1)],
    ]
    let spot = cands[0]
    for (const c of cands) {
      const t = { x: c[0], z: c[1] }
      if (!pushOut(t, 0.4, v.y)) {
        spot = c
        break
      }
    }
    v.driver = 'none'
    v.setInput({ throttle: 0, brake: 0, steer: 0, hand: 0 })
    v.asleep = false
    this.headlights.forEach((s) => {
      s.intensity = 0
      this.scene.add(s)
    })
    if (this.hornHeld) {
      this.hornHeld = false
      this.audio.playerHorn(false)
    }
    this.scene.add(this.human.root)
    p.vehicle = null
    p.x = spot[0]
    p.z = spot[1]
    p.y = groundAt(p.x, p.z, v.y + 1, 1)
    p.vx = p.vz = 0
    p.onGround = true
    this.camYaw = v.h
    this.camPitch = 0.25
    this.camSnap = true
    this.human.root.visible = true
    this.human.root.position.set(p.x, p.y, p.z)
    this.audio.carDoor()
  }

  // ------------------------------------------------------------------ interactions
  isOpen(d: any) {
    const h = this.atmo.hour
    return h >= d.open[0] && h < d.open[1]
  }
  enterInterior(d: any) {
    if (this.mode !== 'freeroam') {
      this.toast('Interiors are closed during matches')
      return
    }
    const p = this.player
    const it = this.interiors[d.interior]
    p.outside = { x: d.x + Math.sin(d.face) * 1.4, z: d.z + Math.cos(d.face) * 1.4, yaw: d.face }
    p.interior = d.interior
    it.setVisible(true)
    this.worldRoot.visible = false
    p.x = it.spawn.x
    p.z = it.spawn.z
    p.y = 0
    p.vx = p.vz = 0
    p.yaw = it.spawn.yaw
    this.camYaw = it.spawn.yaw
    this.camPitch = 0.3
    this.camDist = Math.min(this.camDist, 3.0)
    this.camSnap = true
    this.audio.door()
    this.toast(`Entered ${it.name}`)
    this.missionEvent('door', d.id)
  }
  exitInterior() {
    const p = this.player
    this.interiors[p.interior].setVisible(false)
    this.worldRoot.visible = true
    p.interior = null
    p.x = p.outside.x
    p.z = p.outside.z
    p.y = groundAt(p.x, p.z, 5, 5)
    p.yaw = p.outside.yaw
    this.camYaw = p.outside.yaw
    this.camSnap = true
    this.audio.door()
    this.chunks.updateVisibility(p.x, p.z, this.viewDist)
  }
  buy(id: string) {
    const p = this.player
    const shop = SHOPS[this.shopId || '']
    if (!shop) return
    const item: any = shop.items.find((i) => i.id === id)
    if (!item) return
    if (item.umbrella && p.hasUmbrella) {
      this.toast('You already own an umbrella')
      return
    }
    if (p.money < item.price) {
      this.toast('Not enough money')
      return
    }
    p.money -= item.price
    this.audio.coin()
    if (item.umbrella) {
      p.hasUmbrella = true
      this.toast('Umbrella bought — it opens automatically in the rain')
    } else {
      p.stamina = 1
      p.buff = Math.max(p.buff, item.buff)
      this.toast(`${item.name} — energy boost for ${item.buff}s (−₹${item.price})`)
    }
    this.missionEvent('buy', this.shopId)
  }
  closeShop() {
    this.shopId = null
    this.resume()
  }
  sleep() {
    const a = this.atmo
    a.hour = 6.2
    this.player.stamina = 1
    this.toast('You slept until morning')
    this.audio.click()
  }

  updateInteractions() {
    const p = this.player
    let best: { d: number; text: string; act: () => void } | null = null
    const consider = (d: number, text: string, act: () => void) => {
      if (!best || d < best.d) best = { d, text, act }
    }
    if (p.vehicle) {
      consider(0, 'Exit vehicle', () => this.exitVehicle())
    } else if (p.interior) {
      const it = this.interiors[p.interior]
      for (const i of it.items) {
        const d = Math.hypot(p.x - i.x, p.z - i.z)
        if (d < i.r) {
          const act = () => {
            if (i.kind === 'exit') this.exitInterior()
            else if (i.kind === 'shop') {
              this.shopId = i.id!
              this.openMenu('shop')
            } else if (i.kind === 'sleep') this.sleep()
            else if (i.kind === 'wardrobe') this.openMenu('customise')
            else if (i.kind === 'save') {
              this.save(false)
            }
          }
          consider(d, i.label, act)
        }
      }
    } else {
      for (const v of this.traffic.all) {
        if (v.driver === 'player') continue
        const d = Math.hypot(v.x - p.x, v.z - p.z) - v.spec.L * 0.25
        if (d < 3.4 && Math.abs(v.y - p.y) < 2.2) {
          const sp = Math.hypot(v.vx, v.vz)
          if (v.driver === 'none' || sp < 3) consider(d + 0.5, v.driver === 'ai' ? `Take over ${v.spec.label}` : `Get on / in ${v.spec.label}`, () => this.enterVehicle(v))
        }
      }
      for (const d of W.doors) {
        const dd = Math.hypot(d.x - p.x, d.z - p.z)
        if (dd < 2.3) {
          if (this.isOpen(d)) consider(dd, `Enter ${d.label}`, () => this.enterInterior(d))
          else consider(dd, `${d.label} is closed (opens ${String(d.open[0]).padStart(2, '0')}:00)`, () => this.toast(`${d.label} is closed right now`))
        }
      }
      for (const s of W.stalls) {
        const dd = Math.hypot(s.fx - p.x, s.fz - p.z)
        if (dd < 2.0) {
          const info = STALL_BUY[s.kind]
          const open = this.atmo.hour >= 7 && this.atmo.hour < 21
          if (open)
            consider(dd, `Buy ${info.name} (₹${info.price})`, () => {
              if (p.money < info.price) return this.toast('Not enough money')
              p.money -= info.price
              p.stamina = 1
              p.buff = Math.max(p.buff, 30)
              this.audio.coin()
              this.toast(`Bought ${info.name} (−₹${info.price})`)
              this.missionEvent('buy', 'stall')
            })
        }
      }
      for (const b of W.benches) {
        const dd = Math.hypot(b.x - p.x, b.z - p.z)
        if (dd < 1.6) {
          consider(dd, 'Sit on the bench (Q to stand)', () => {
            p.sitting = b
            p.x = b.x + (p.x > b.x ? 0.5 : -0.5)
            p.z = b.z + 0.15
            p.yaw = b.face
            p.vx = p.vz = 0
            this.toast('Resting… stamina recovers faster')
            this.missionEvent('sit', 'bench')
          })
        }
      }
      const n = this.npcs.nearestTalkable(p.x, p.z)
      if (n && !best) consider(Math.hypot(n.x - p.x, n.z - p.z) + 1, `Talk to ${n.name} (F)`, () => {
        const l = this.npcs.lineFor(n, this.atmo.rain, this.atmo.hour)
        this.subtitle = { ...l, t: 6 }
      })
    }
    this.prompt = best ? { text: best.text, act: best.act } : null
  }

  updateCollectibles(dt: number) {
    const p = this.player
    const r = p.vehicle ? 3.2 : 1.7
    this.collectibles.forEach((c, i) => {
      if (c.got || !c.mesh) return
      const d = Math.hypot(c.x - p.x, c.z - p.z)
      c.mesh.visible = d < 260 && !p.interior
      if (!c.mesh.visible) return
      c.mesh.rotation.y += dt * 2
      c.mesh.position.y = c.y + Math.sin(this.time * 2 + i) * 0.12
      if (d < r && Math.abs(c.y - p.y) < 3) {
        c.got = true
        c.mesh.visible = false
        p.collected.add(i)
        p.money += 50
        this.audio.chime()
        this.toast(`Golden areca nut ${p.collected.size}/${this.collectibles.length}  (+₹50)`)
      }
    })
  }

  // ------------------------------------------------------------------ missions
  resolveAnchor(a?: string): { x: number; z: number; y: number } | null {
    if (!a) return null
    if (a === 'flyover') return { x: 300, z: FLY_Z, y: 7.5 }
    if (a.startsWith('pos:')) {
      const [x, z, y] = a.slice(4).split(',').map(Number)
      return { x, z, y: y ?? 0 }
    }
    if (a.startsWith('door:')) {
      const d = W.doors.find((q) => q.id === a.slice(5))
      return d ? { x: d.x, z: d.z, y: 0 } : null
    }
    if (a.startsWith('stall:')) {
      const s = W.stalls.find((q) => q.kind === a.slice(6))
      return s ? { x: s.fx, z: s.fz, y: 0 } : null
    }
    return null
  }
  currentStep() {
    const m = MISSIONS[this.mission.idx]
    return m ? m.steps[this.mission.step] : null
  }
  setMission(idx: number, step: number) {
    this.mission.idx = idx
    this.mission.step = step
    this.mission.t = 0
    this.mission.route = 0
    this.mission.base = this.player.collected.size
    this.missionDone = idx >= MISSIONS.length
    const st = this.currentStep()
    this.mission.t = st && st.time ? st.time : 0
  }
  advanceStep() {
    const m = MISSIONS[this.mission.idx]
    this.audio.chime()
    this.toast(`✔ ${m.steps[this.mission.step].text}`)
    if (this.mission.step + 1 >= m.steps.length) {
      this.player.money += m.reward
      this.toast(`Mission complete: ${m.title}  +₹${m.reward}`)
      this.audio.coin()
      this.setMission(this.mission.idx + 1, 0)
      if (this.missionDone) this.toast('All missions complete — free roam!')
    } else {
      this.setMission(this.mission.idx, this.mission.step + 1)
      const s = this.currentStep()
      if (s?.time) this.mission.t = s.time
    }
  }
  missionEvent(type: string, id?: string) {
    const s = this.currentStep()
    if (!s || this.missionDone) return
    if (type === 'door' && s.type === 'door' && s.target === `door:${id}`) this.advanceStep()
    else if (type === 'buy' && s.type === 'buy') this.advanceStep()
    else if (type === 'sit' && s.type === 'sit') this.advanceStep()
    else if (type === 'vehicle' && s.type === 'vehicle' && (!s.vkind || s.vkind === id)) this.advanceStep()
  }
  updateMission(dt: number) {
    const s = this.currentStep()
    const p = this.player
    this.objective = null
    if (!s || this.missionDone) {
      this.beacon.visible = false
      return
    }
    // timers
    if (s.time) {
      this.mission.t -= dt
      if (this.mission.t <= 0) {
        this.toast('Time is up! The step restarts.')
        this.mission.t = s.time
        this.mission.route = 0
      }
    }
    let tgt: any = null
    if (s.type === 'goto' || s.type === 'door' || s.type === 'sit') tgt = this.resolveAnchor(s.target)
    if (s.type === 'route') {
      const a = this.resolveAnchor(s.route![this.mission.route])
      tgt = a
    }
    if (tgt) {
      const r = s.r ?? (s.type === 'route' ? 9 : 2.5)
      this.objective = { x: tgt.x, z: tgt.z, y: tgt.y, r }
      const d = Math.hypot(tgt.x - p.x, tgt.z - p.z)
      if (s.type === 'goto' && d < r && (!s.needVehicle || p.vehicle) && (s.minY == null || p.y >= s.minY) && !p.interior) this.advanceStep()
      else if (s.type === 'route' && d < r && !p.interior && p.vehicle) {
        this.mission.route++
        this.audio.chime()
        if (this.mission.route >= s.route!.length) this.advanceStep()
        else this.toast(`Checkpoint ${this.mission.route}/${s.route!.length}`)
      }
    }
    if (s.type === 'collect') {
      const got = this.player.collected.size - this.mission.base
      if (got >= (s.count || 1)) this.advanceStep()
    }
    // beacon
    if (this.objective && !p.interior) {
      this.beacon.visible = true
      this.beacon.position.set(this.objective.x, this.objective.y + 40, this.objective.z)
      this.beacon.scale.set(1 + Math.sin(this.time * 3) * 0.08, 1, 1 + Math.sin(this.time * 3) * 0.08)
    } else this.beacon.visible = false
  }

  // ------------------------------------------------------------------ camera
  private camTmp = { x: 0, z: 0 }
  camSnap = false
  updateCamera(dt: number, snap: boolean) {
    if (this.camSnap) {
      snap = true
      this.camSnap = false
    }
    const p = this.player
    const cam = this.camera
    const v: Vehicle | null = p.vehicle
    let targetFov = this.fovBase
    if (v) {
      const spd = Math.hypot(v.vx, v.vz)
      targetFov = this.fovBase + clamp(spd / 55, 0, 1) * 16 * (this.camMode === 1 ? 0.5 : 1)
      if (this.camOffT > 0) this.camOffT -= dt
      else this.camOffYaw *= Math.exp(-2.2 * dt)
      if (this.camMode === 1) {
        const eye = v.eyeWorld(new THREE.Vector3())
        cam.position.copy(eye)
        cam.rotation.order = 'YXZ'
        cam.rotation.set(-(v.pitch + v.tiltPitch) - this.camPitch, v.h + Math.PI + this.camOffYaw, -(v.roll + v.tiltRoll) * 0.6)
        this.human.root.visible = false
      } else {
        // chase
        const spd2 = Math.hypot(v.vx, v.vz)
        let tgtHead = v.h
        if (spd2 > 6 && v.vf > 0) tgtHead = v.h + angDiff(v.h, Math.atan2(v.vx, v.vz)) * clamp((spd2 - 6) / 25, 0, 0.4)
        if (snap) this.smoothHead = tgtHead
        this.smoothHead += angDiff(this.smoothHead, tgtHead) * (1 - Math.exp(-4.2 * dt))
        const yaw = this.smoothHead + this.camOffYaw
        const mult = this.camMode === 2 ? 1.7 : 1
        const dist = v.spec.cam.d * mult
        const hgt = v.spec.cam.h * mult + this.camPitch * 3
        const bx = -Math.sin(yaw), bz = -Math.cos(yaw)
        const tx = v.x, ty = v.y + 1.3, tz = v.z
        let d = dist
        // collision shortening
        const tmp = this.camTmp
        for (let t = 1.5; t <= dist; t += 0.7) {
          tmp.x = tx + bx * t
          tmp.z = tz + bz * t
          if (pushOut(tmp, 0.35, v.y + hgt * (t / dist) + 0.5)) {
            d = Math.max(1.8, t - 0.8)
            break
          }
        }
        const dx = tx + bx * d, dz = tz + bz * d
        let dy = ty + hgt * (d / dist) + 0.2
        dy = Math.max(dy, groundAt(dx, dz, v.y + 3, 3) + 0.5)
        const k = snap ? 1 : 1 - Math.exp(-16 * dt)
        cam.position.x = lerp(cam.position.x, dx, k)
        cam.position.y = lerp(cam.position.y, dy, k)
        cam.position.z = lerp(cam.position.z, dz, k)
        cam.lookAt(tx - bx * -2.0 * 0 + Math.sin(v.h) * 3, ty + 0.4, tz + Math.cos(v.h) * 3)
        this.human.root.visible = !!v.seatPos
      }
    } else if (this.fpMode || this.scoped) {
      cam.position.set(p.x, p.y + (p.inWater ? 1.0 : 1.62) + (p.sitting ? -0.45 : 0) + (this.crouching ? -0.5 : 0), p.z)
      cam.rotation.order = 'YXZ'
      cam.rotation.set(-this.camPitch, this.camYaw + Math.PI, 0)
      this.human.root.visible = false
      targetFov = this.fovBase - 5
    } else {
      const sit = p.sitting ? 0.55 : 0
      const armedView = this.alive && (!!this.combat.cur || this.jet.active)
      this.shoulder += ((armedView ? 0.55 : 0) - this.shoulder) * Math.min(1, (dt || 0.016) * 8)
      const sh = snap ? (armedView ? 0.55 : 0) : this.shoulder
      const yaw = this.camYaw
      const tx = p.x - Math.cos(yaw) * sh, ty = p.y + 1.55 - sit - (this.crouching ? 0.45 : 0) - (this.slideT > 0 ? 0.7 : 0), tz = p.z + Math.sin(yaw) * sh
      const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch)
      const bx = -Math.sin(yaw) * cp, by = sp, bz = -Math.cos(yaw) * cp
      let dist = this.camDist * (1 - 0.4 * this.combat.adsAmt) * (this.alive ? 1 : 1.7)
      if (p.interior) dist = Math.min(dist, 3.0)
      let d = dist
      const tmp = this.camTmp
      for (let t = 0.5; t <= dist; t += 0.35) {
        tmp.x = tx + bx * t
        tmp.z = tz + bz * t
        if (pushOut(tmp, 0.28, ty + by * t - 0.6)) {
          d = Math.max(0.6, t - 0.4)
          break
        }
      }
      let dx = tx + bx * d, dy = ty + by * d + 0.25, dz = tz + bz * d
      if (!p.interior) dy = Math.max(dy, groundAt(dx, dz, ty + 2, 2) + 0.35)
      else dy = Math.max(dy, 0.4)
      const k = snap ? 1 : 1 - Math.exp(-22 * dt)
      cam.position.x = lerp(cam.position.x, dx, k)
      cam.position.y = lerp(cam.position.y, dy, k)
      cam.position.z = lerp(cam.position.z, dz, k)
      // slight shoulder offset
      cam.lookAt(tx + Math.cos(yaw) * -0.35 * 0, ty + 0.05, tz)
      this.human.root.visible = d > 1.1 || true
    }
    // shake
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.25
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.25
    }
    if (v && this.camMode !== 1 && v.slip > 0.3) {
      cam.position.x += (Math.random() - 0.5) * 0.02
    }
    if (!v && this.combat.cur && this.alive) {
      const zm = WEAPONS[this.combat.cur].zoom
      targetFov *= 1 + (zm - 1) * this.combat.adsAmt
    }
    if (this.jet.active && !v) targetFov += this.jet.boost ? 14 : 5
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = damp(cam.fov, targetFov, this.combat.cur || this.jet.active ? 12 : 4, dt || 1)
      cam.updateProjectionMatrix()
    }
    cam.updateMatrixWorld()
  }

  // ------------------------------------------------------------------ combat + multiplayer
  get scoped() {
    return this.combat.cur !== null && WEAPONS[this.combat.cur].scope && this.combat.adsAmt > 0.85 && !this.player.vehicle && this.alive
  }
  myTeam() {
    return this.net ? this.mp.team : -1
  }
  canShoot() {
    const p = this.player
    return this.alive && !p.vehicle && !p.sitting && !this.paused && this.mp.match.phase === 'play'
  }
  netState() {
    const p = this.player
    const v: Vehicle | null = p.vehicle
    return {
      x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw,
      pitch: this.human.aim !== null ? -this.human.aim : 0,
      anim: v ? 'ride' : this.animName,
      w: v ? '' : this.combat.cur ?? '',
      jet: this.jet.active ? 1 : 0,
      crouch: this.crouching || this.slideT > 0 ? 1 : 0,
      veh: v ? { variant: v.variant, color: v.color, h: v.h } : null,
    }
  }
  /** Start a game mode. Online modes connect to the server first. */
  async startMode(mode: ModeId, online: boolean, name: string, room: string, loadSave = false) {
    this.leaveMatch(false)
    const m = MODES[mode]
    if (online || m.online === 'required') {
      const net = await NetClient.join(mode, name, room, { skin: this.player.look.skin, shirt: this.player.look.shirt, pants: this.player.look.pants, hair: this.player.look.hair })
      this.net = net
      net.getState = () => this.netState()
      net.onSync = (r) => this.onNetSync(r)
      net.onLost = (why) => {
        this.toast(why)
        this.leaveMatch(true)
        this.netError = why
      }
      this.mp.team = net.info.team
      this.mp.name = net.info.name
      this.mp.room = net.info.room
    }
    this.mode = mode
    this.netError = ''
    this.start(loadSave && mode === 'freeroam')
    this.hp = 100
    this.alive = true
    if (mode !== 'freeroam') {
      this.atmo.hour = 13.5
      this.atmo.setWeather('clear')
      this.setAutoWeather(false)
      this.atmo.cloud = 0.25
      this.atmo.rain = 0
      this.atmo.wet = 0
      this.traffic.maxAI = 0
      this.npcs.poolSize = 4
      this.player.collected = new Set(this.player.collected)
    }
    this.combat.resetLoadout(mode, mode !== 'freeroam')
    this.combat.setPickups(pickupsFor(mode))
    this.jet.max = JET.fuelMax * m.fuelMul
    this.jet.fuel = this.jet.max
    if (mode !== 'freeroam' && !this.net) return
    if (this.net) this.toast(`${m.label} — ${this.net.info.room} · playing as ${this.net.info.name}`)
  }
  leaveMatch(resetPos = true) {
    if (this.net) {
      this.net.stop()
      this.net = null
    }
    this.remotes.clear()
    this.mp = this.freshMp()
    const wasMatch = this.mode !== 'freeroam'
    this.mode = 'freeroam'
    this.hp = 100
    this.alive = true
    this.jet.max = JET.fuelMax
    this.jet.fuel = this.jet.max
    this.combat.resetLoadout('freeroam', false)
    this.combat.setPickups(pickupsFor('freeroam'))
    this.slideT = 0
    if (wasMatch && this.started) {
      this.applyQuality(this.quality)
      this.setAutoWeather(true)
    }
    if (resetPos && this.started) {
      const p = this.player
      p.x = 9
      p.z = 6.4
      p.y = groundAt(p.x, p.z, 50, 50)
      p.vx = p.vy = p.vz = 0
      p.onGround = true
      this.camSnap = true
    }
  }
  freshMp() {
    return {
      team: -1, name: '', room: '', kills: 0, deaths: 0, respawnIn: 0,
      players: [] as NetPlayer[],
      feed: [] as { t: number; killer: string; victim: string; w: string; head: boolean; kt: number; vt: number; me: boolean; died: boolean }[],
      match: { phase: 'play' as 'play' | 'over', left: 0, limit: 0, scoreLimit: 0, teamScore: [0, 0], winner: '', no: 1, overLeft: 0 },
    }
  }
  respawnAt(x: number, z: number) {
    const p = this.player
    if (p.vehicle) this.exitVehicleSilently()
    if (p.interior) this.exitInterior()
    p.sitting = null
    p.x = x
    p.z = z
    p.y = groundAt(x, z, 60, 60) + 0.05
    p.vx = p.vy = p.vz = 0
    p.onGround = true
    p.yaw = Math.atan2(-x, -z)
    this.camYaw = p.yaw
    this.camPitch = 0.2
    this.camSnap = true
    this.alive = true
    this.slideT = 0
    this.jet.max = JET.fuelMax * MODES[this.mode].fuelMul
    this.jet.fuel = this.jet.max
    this.combat.resetLoadout(this.mode, this.mode !== 'freeroam')
    this.human.fall = 0
    this.chunks.updateVisibility(p.x, p.z, this.viewDist)
  }
  exitVehicleSilently() {
    const p = this.player
    const v: Vehicle | null = p.vehicle
    if (!v) return
    v.driver = 'none'
    this.headlights.forEach((s) => this.scene.add(s))
    this.scene.add(this.human.root)
    p.vehicle = null
    this.audio.playerHorn(false)
  }
  die() {
    this.alive = false
    this.combat.trigger = false
    this.combat.ads = false
    this.jet.active = false
    this.audio.jetLevel(0)
    const p = this.player
    if (p.vehicle) this.exitVehicleSilently()
    p.onGround = false
    p.vy = Math.max(p.vy, 0)
  }
  onNetSync(r: SyncResponse) {
    if (!this.net) return
    const mp = this.mp
    this.remotes.sync(r.players)
    this.combat.applyAvail(r.pu)
    mp.players = r.players
    mp.match = r.match
    mp.team = r.you.team
    mp.kills = r.you.kills
    mp.deaths = r.you.deaths
    mp.respawnIn = r.you.respawnIn
    this.hp = r.you.hp
    if (r.you.spawn && r.you.spawn.seq !== this.spawnSeq) {
      this.spawnSeq = r.you.spawn.seq
      this.respawnAt(r.you.spawn.x, r.you.spawn.z)
    } else if (!r.you.alive && this.alive) this.die()
    for (const gr of r.you.grants) this.combat.applyGrant(gr.kind)
    if (r.you.hits.length) this.combat.onHits(r.you.hits)
    if (r.you.hurt.length) this.combat.onHurt(r.you.hurt)
    const me = this.net.info.id
    const p = this.player
    for (const e of r.events) {
      if (e.k === 'shot') {
        if (e.id === me) continue
        const o = e.o as number[]
        const ends = e.e as number[][]
        const w = WEAPONS[e.w as WeaponId]
        const d = Math.hypot(o[0] - p.x, o[2] - p.z)
        for (const en of ends) {
          this.fx.tracer(o[0], o[1], o[2], en[0], en[1], en[2], w.color)
          if (d < 140) {
            if (en[3]) this.fx.blood(en[0], en[1], en[2])
            else this.fx.impact(en[0], en[1], en[2])
          }
        }
        if (d < 160) this.fx.muzzle(o[0], o[1], o[2], 0, 0.2, 0)
        if (d < 260) this.audio.gun(w.id, w.vol * Math.max(0.15, 1 - d / 260), d > 60)
      } else if (e.k === 'kill') {
        const mine = e.killer === me, died = e.victim === me
        mp.feed.push({ t: this.time, killer: String(e.kn), victim: String(e.vn), w: String(e.w), head: !!e.head, kt: e.kt as number, vt: e.vt as number, me: mine, died })
        if (mp.feed.length > 6) mp.feed.shift()
        if (mine) this.toast(`You eliminated ${e.vn}${e.head ? ' (headshot)' : ''}`)
        if (died) this.toast(e.suicide ? 'You respawned' : `Eliminated by ${e.kn}`)
      } else if (e.k === 'join' && e.id !== me) this.toast(`${e.name} joined`)
      else if (e.k === 'leave') this.toast(`${e.name} left`)
      else if (e.k === 'match') {
        if (e.what === 'over') this.toast(`Match over — ${e.winner} wins!`)
        if (e.what === 'start') this.toast('New match started!')
      }
    }
  }

  updateCombat(dt: number) {
    const p = this.player
    this.combat.update(dt, this.canShoot() && !p.interior)
    this.combat.updatePickups(dt, this.alive && !p.vehicle && !p.interior)
    this.fx.update(dt)
    if (this.net) this.remotes.update(dt, this.net.now(), this.camera, this.fx, this.mp.team)
    this.audio.jetLevel(this.jet.active ? 1 : 0, this.jet.boost)
    if (this.mp.feed.length) this.mp.feed = this.mp.feed.filter((f) => this.time - f.t < 7)
    if (p.vehicle) {
      this.human.setGun(null)
      this.human.aim = null
    }
    if (p.y < -30 && this.alive) {
      p.y = groundAt(p.x, p.z, 60, 60)
      p.vy = 0
    }
  }

  // ------------------------------------------------------------------ audio
  updateAudio(dt: number) {
    const p = this.player
    const v: Vehicle | null = p.vehicle
    // traffic ambience: moving vehicles within ~70 m
    let tr = 0
    for (const o of this.traffic.all) {
      if (o === v) continue
      const d = Math.hypot(o.x - p.x, o.z - p.z)
      if (d < 70) tr += (1 - d / 70) * Math.min(1, Math.hypot(o.vx, o.vz) / 8)
    }
    const kind = v ? (v.spec.kind === 'moto' || v.spec.kind === 'scooter' ? 'bike' : v.spec.kind) : ''
    this.audio.update(dt, {
      rain: this.atmo.rain, rainAudible: this.atmo.rainNow * (v && this.camMode === 1 ? 0.6 : 1), wind: this.atmo.windVal, night: this.atmo.night, inside: !!p.interior,
      inVehicle: !!v && this.camMode === 1 && (v.spec.kind === 'car' || v.spec.kind === 'bus'),
      traffic: p.interior ? 0 : tr * 0.35,
      veh: v ? { on: true, throttle: Math.max(0, v.throttle), rpm: v.rpm, slip: v.slip, kind, vol: this.camMode === 1 ? 1.2 : 1 } : null,
    })
  }

  // ------------------------------------------------------------------ minimap
  drawMinimap() {
    const c = this.mm
    if (!c || !this.mapCanvas) return
    const ctx = c.getContext('2d')!
    const S = c.width
    const p = this.player
    ctx.save()
    ctx.clearRect(0, 0, S, S)
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#1d2530'
    ctx.fillRect(0, 0, S, S)
    const K = 1024 / 1800
    const spd = p.vehicle ? Math.hypot(p.vehicle.vx, p.vehicle.vz) : 0
    const radiusM = 130 + spd * 3.5
    const zoom = (S / 2) / (radiusM * K)
    let cyaw = this.camYaw
    if (p.vehicle) cyaw = this.smoothHead + this.camOffYaw
    const [mx, mz] = mapPx(p.interior ? p.outside?.x ?? 0 : p.x, p.interior ? p.outside?.z ?? 0 : p.z)
    const phi = Math.atan2(Math.cos(cyaw), Math.sin(cyaw))
    ctx.translate(S / 2, S / 2)
    ctx.rotate(-Math.PI / 2 - phi)
    ctx.scale(zoom, zoom)
    ctx.translate(-mx, -mz)
    ctx.drawImage(this.mapCanvas, 0, 0)
    const px1 = 1 / zoom
    // doors
    for (const d of W.doors) {
      const [x, z] = mapPx(d.x, d.z)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#111'
      ctx.lineWidth = px1
      ctx.beginPath()
      ctx.moveTo(x, z - 6 * px1)
      ctx.lineTo(x + 5 * px1, z)
      ctx.lineTo(x + 3 * px1, z)
      ctx.lineTo(x + 3 * px1, z + 4 * px1)
      ctx.lineTo(x - 3 * px1, z + 4 * px1)
      ctx.lineTo(x - 3 * px1, z)
      ctx.lineTo(x - 5 * px1, z)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    // collectibles
    ctx.fillStyle = '#ffc233'
    for (const cl of this.collectibles) {
      if (cl.got) continue
      if (Math.hypot(cl.x - p.x, cl.z - p.z) > 160) continue
      const [x, z] = mapPx(cl.x, cl.z)
      ctx.beginPath()
      ctx.arc(x, z, 2.2 * px1, 0, 7)
      ctx.fill()
    }
    // traffic blips
    for (const v of this.traffic.all) {
      if (v === p.vehicle || Math.hypot(v.x - p.x, v.z - p.z) > radiusM * 1.2) continue
      const [x, z] = mapPx(v.x, v.z)
      ctx.fillStyle = v.driver === 'ai' ? 'rgba(255,255,255,0.55)' : 'rgba(120,200,255,0.9)'
      ctx.fillRect(x - 1.5 * px1, z - 1.5 * px1, 3 * px1, 3 * px1)
    }
    // arena boundary
    const bnd = MODES[this.mode].bounds
    if (bnd) {
      const [cx0, cz0] = mapPx(0, 0)
      ctx.strokeStyle = 'rgba(255,80,80,0.9)'
      ctx.lineWidth = 2.5 * px1
      ctx.setLineDash([8 * px1, 6 * px1])
      ctx.beginPath()
      ctx.ellipse(cx0, cz0, bnd[0] * K, bnd[1] * K, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // pickups
    const cmb = this.combat
    for (let i = 0; i < cmb.defs.length; i++) {
      if (!cmb.avail[i]) continue
      const d = cmb.defs[i]
      if (Math.abs(d.x - p.x) > radiusM * 1.2 || Math.abs(d.z - p.z) > radiusM * 1.2) continue
      const [x, z] = mapPx(d.x, d.z)
      ctx.fillStyle = d.kind === 'health' ? '#31e07a' : d.kind === 'ammo' ? '#ffc233' : d.kind === 'fuel' ? '#ff7a1f' : '#ffffff'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = px1
      ctx.beginPath()
      ctx.rect(x - 2.6 * px1, z - 2.6 * px1, 5.2 * px1, 5.2 * px1)
      ctx.fill()
      ctx.stroke()
    }
    // other players
    if (this.net) {
      for (const r of this.remotes.map.values()) {
        if (!r.data.alive) continue
        const team = r.data.team
        const friendly = team >= 0 && team === this.mp.team
        const far = Math.hypot(r.x - p.x, r.z - p.z)
        if (far > radiusM * 1.3) continue
        const [x, z] = mapPx(r.x, r.z)
        ctx.fillStyle = team >= 0 ? (friendly ? '#4aa3ff' : '#ff4a4a') : '#ff5a3c'
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.2 * px1
        ctx.beginPath()
        ctx.arc(x, z, 4.2 * px1, 0, 7)
        ctx.fill()
        ctx.stroke()
        const dy = r.y - p.y
        if (Math.abs(dy) > 5) {
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          const s = dy > 0 ? -1 : 1
          ctx.moveTo(x, z + s * 8.5 * px1)
          ctx.lineTo(x - 3 * px1, z + s * 5.2 * px1)
          ctx.lineTo(x + 3 * px1, z + s * 5.2 * px1)
          ctx.fill()
        }
      }
    }
    // objective
    if (this.objective) {
      const [x, z] = mapPx(this.objective.x, this.objective.z)
      const dx = x - mx, dz = z - mz
      const dd = Math.hypot(dx, dz)
      const lim = (S / 2 - 16) / zoom
      let ox = x, oz = z
      if (dd > lim) {
        ox = mx + (dx / dd) * lim
        oz = mz + (dz / dd) * lim
      }
      ctx.fillStyle = '#b36bff'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5 * px1
      ctx.beginPath()
      ctx.arc(ox, oz, 6 * px1, 0, 7)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, z, this.objective.r * K, 0, 7)
      ctx.strokeStyle = 'rgba(179,107,255,0.8)'
      ctx.stroke()
    }
    ctx.restore()
    // player arrow
    ctx.save()
    ctx.translate(S / 2, S / 2)
    const yaw = p.vehicle ? p.vehicle.h : p.yaw
    ctx.rotate(-(yaw - cyaw))
    // forward is up when yaw==cyaw ; screen y negative
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, -11)
    ctx.lineTo(8, 9)
    ctx.lineTo(0, 4)
    ctx.lineTo(-8, 9)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    // ring + north marker
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, 7)
    ctx.stroke()
    {
      const th = -Math.PI / 2 - phi
      const r = S / 2 - 16
      ctx.fillStyle = '#ff5050'
      ctx.font = 'bold 20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', S / 2 + r * Math.sin(th), S / 2 - r * Math.cos(th))
    }
  }

  // ------------------------------------------------------------------ HUD
  locationName() {
    const p = this.player
    if (p.interior) return this.interiors[p.interior].name
    const r = nearestRoad(p.x, p.z)
    if (r && r.edge < 3.5) {
      const id = r.road.id
      if (id === 'main') return Math.abs(p.x) < 200 ? 'Nellyadi — Main Road' : 'Main Road (Mangaluru ↔ Dharmasthala)'
      if (id === 'market') return 'Market Road'
      if (id === 'bypass') return 'Bypass Highway'
      if (id === 'conn') return p.y > 3 ? 'Nellyadi Flyover' : 'Flyover Road'
      return 'Village lane'
    }
    for (const pl of PLANTATIONS) if (Math.abs(p.x - pl.x) < pl.w / 2 && Math.abs(p.z - pl.z) < pl.d / 2) return pl.kind === 'areca' ? 'Areca plantation' : 'Coconut grove'
    for (const pd of PADDIES) if (Math.abs(p.x - pd.x) < pd.w / 2 && Math.abs(p.z - pd.z) < pd.d / 2) return 'Paddy field'
    if (p.inWater) return 'Stream'
    if (Math.abs(p.x) < 200 && Math.abs(p.z) < 60) return 'Nellyadi town centre'
    if (terrainH(p.x, p.z) > 14) return 'Forested hills'
    return 'Nellyadi countryside'
  }
  snapshot() {
    const p = this.player
    const v: Vehicle | null = p.vehicle
    const step = this.currentStep()
    const m = MISSIONS[this.mission.idx]
    let dist = 0
    if (this.objective) dist = Math.hypot(this.objective.x - p.x, this.objective.z - p.z)
    const J = this.jet
    let rows: any[] = []
    if (this.net) {
      rows = [{ id: 'me', name: this.mp.name, team: this.mp.team, k: this.mp.kills, d: this.mp.deaths, ping: Math.round(this.net.rtt), me: true }]
      for (const q of this.mp.players) rows.push({ id: q.id, name: q.name, team: q.team, k: q.k, d: q.d, ping: q.ping, me: false })
      rows.sort((a, b) => b.k - a.k || a.d - b.d)
    }
    return {
      mode: this.mode,
      online: !!this.net,
      netError: this.netError,
      hp: Math.round(this.hp),
      alive: this.alive,
      jet: { fuel: J.fuel / J.max, active: J.active, boost: J.boost },
      stance: this.slideT > 0 ? 'Sliding' : this.crouching ? 'Crouching' : J.active ? 'Flying' : '',
      altitude: Math.max(0, Math.round(p.y - groundAt(p.x, p.z, p.y, 0.7))),
      combat: this.combat.snap(),
      showScore: this.showScore,
      mp: { ...this.mp, rows, feed: this.mp.feed.map((f) => ({ ...f })), ping: this.net ? Math.round(this.net.rtt) : 0, serverNow: 0 },
      time: this.atmo?.timeLabel,
      phase: this.atmo?.phase,
      weather: WEATHER[this.atmo.weatherName].label,
      rain: this.atmo.rain,
      wet: this.atmo.wet,
      money: p.money,
      stamina: p.stamina,
      buff: p.buff,
      speed: v ? Math.round(v.speedKmh) : 0,
      gear: v ? v.gear : 0,
      vehicle: v ? v.spec.label : '',
      plate: v ? v.plate : '',
      lights: v ? v.lightsOn : false,
      camMode: v ? ['Chase', 'First person', 'Far'][this.camMode] : this.fpMode ? 'First person' : 'Third person',
      inVehicle: !!v,
      objective: step ? { mission: m.title, text: step.text, dist: Math.round(dist), timer: step.time ? Math.max(0, Math.ceil(this.mission.t)) : null, progress: step.type === 'route' ? `${this.mission.route}/${step.route!.length}` : step.type === 'collect' ? `${Math.min(step.count!, p.collected.size - this.mission.base)}/${step.count}` : null } : null,
      prompt: this.prompt ? this.prompt.text : null,
      toasts: this.toasts.map((t) => t.text),
      subtitle: this.subtitle ? { name: this.subtitle.name, text: this.subtitle.text } : null,
      collected: p.collected.size,
      totalCollect: this.collectibles.length,
      location: this.locationName(),
      paused: this.paused,
      menu: this.menu,
      shop: this.shopId ? { id: this.shopId, ...SHOPS[this.shopId] } : null,
      look: p.look,
      hasUmbrella: p.hasUmbrella,
      auto: this.atmo.auto,
      monsoon: this.atmo.monsoon,
      weatherName: this.atmo.weatherName,
      hour: this.atmo.hour,
      dayMinutes: this.atmo.dayMinutes,
      quality: this.quality,
      volume: this.volume,
      sens: this.mouseSens,
      hasSave: !!localStorage.getItem(SAVE_KEY),
      missionsDone: this.mission.idx,
      missionsTotal: MISSIONS.length,
      sprint: p.sprinting,
      edgeLimited: false,
      wetLevel: this.atmo.wet,
      missionList: MISSIONS.map((q, i) => ({ title: q.title, desc: q.desc, reward: q.reward, state: i < this.mission.idx ? 'done' : i === this.mission.idx ? 'active' : 'locked' })),
    }
  }

  // ------------------------------------------------------------------ settings & customisation
  setLook(patch: Partial<Look>) {
    const p = this.player
    p.look = { ...p.look, ...patch }
    this.human.look = p.look
    this.human.build()
    if (p.vehicle && p.vehicle.seatPos) {
      /* rider remains parented */
    }
  }
  setWeather(n: string) {
    this.atmo.auto = false
    this.atmo.setWeather(n)
  }
  setAutoWeather(on: boolean) {
    this.atmo.auto = on
  }
  setMonsoon(on: boolean) {
    this.atmo.monsoon = on
  }
  setHour(h: number) {
    this.atmo.hour = h
  }
  setDayMinutes(m: number) {
    this.atmo.dayMinutes = m
  }
  setVolume(v: number) {
    this.volume = v
    this.audio.setVolume(v)
  }
  setSens(v: number) {
    this.mouseSens = v
  }

  // ------------------------------------------------------------------ save / load
  save(auto = false) {
    const p = this.player
    const base = p.interior ? p.outside : { x: p.x, z: p.z, yaw: p.yaw }
    const v: Vehicle | null = p.vehicle
    const data = {
      v: 1,
      savedAt: Date.now(),
      player: {
        x: base.x, z: base.z, yaw: base.yaw, money: p.money, stamina: p.stamina, look: p.look, hasUmbrella: p.hasUmbrella,
        collected: [...p.collected], vehicle: v ? { variant: v.variant, color: v.color, x: v.x, z: v.z, h: v.h, y: v.y } : null,
      },
      atmo: this.atmo.serialize(),
      mission: { idx: this.mission.idx, step: this.mission.step },
      parked: this.traffic.all.filter((o) => o.driver === 'none').map((o) => ({ variant: o.variant, color: o.color, x: o.x, z: o.z, h: o.h })),
      settings: { quality: this.quality, volume: this.volume, sens: this.mouseSens },
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data))
      this.toast(auto ? 'Game autosaved' : 'Game saved')
      if (!auto) this.audio.chime()
      return true
    } catch (e) {
      this.toast('Could not save (storage unavailable)')
      return false
    }
  }
  load() {
    let data: any
    try {
      data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')
    } catch (e) {
      data = null
    }
    if (!data) {
      this.toast('No saved game found')
      return false
    }
    const p = this.player
    // leave current state
    if (p.vehicle) {
      p.vehicle.driver = 'none'
      this.headlights.forEach((s) => this.scene.add(s))
      this.scene.add(this.human.root)
      p.vehicle = null
    }
    if (p.interior) {
      this.interiors[p.interior].setVisible(false)
      this.worldRoot.visible = true
      p.interior = null
    }
    p.sitting = null
    // restore parked vehicles
    for (const v of this.traffic.all.filter((o) => o.driver === 'none')) this.traffic.remove(v)
    for (const o of data.parked || []) this.traffic.addParked(o.variant, o.color, o.x, o.z, o.h)
    const d = data.player
    p.x = d.x
    p.z = d.z
    p.y = groundAt(p.x, p.z, 50, 50)
    p.yaw = d.yaw
    p.vx = p.vz = p.vy = 0
    p.money = d.money
    p.stamina = d.stamina ?? 1
    p.hasUmbrella = !!d.hasUmbrella
    p.look = { ...DEFAULT_LOOK, ...d.look }
    this.human.look = p.look
    this.human.build()
    p.collected = new Set(d.collected || [])
    this.collectibles.forEach((c, i) => {
      c.got = p.collected.has(i)
      if (c.mesh) c.mesh.visible = !c.got
    })
    this.camYaw = d.yaw
    this.atmo.restore(data.atmo)
    this.setMission(data.mission?.idx ?? 0, data.mission?.step ?? 0)
    if (data.settings) {
      this.volume = data.settings.volume ?? this.volume
      this.mouseSens = data.settings.sens ?? this.mouseSens
      this.audio.setVolume(this.volume)
      if (data.settings.quality && data.settings.quality !== this.quality) this.applyQuality(data.settings.quality)
    }
    if (d.vehicle) {
      const v = this.traffic.addParked(d.vehicle.variant, d.vehicle.color, d.vehicle.x, d.vehicle.z, d.vehicle.h)
      this.enterVehicle(v)
    }
    this.chunks.updateVisibility(p.x, p.z, this.viewDist)
    this.updateCamera(0.016, true)
    this.toast('Game loaded')
    return true
  }
  newGameReset() {
    this.keys = {}
  }
}
void CAR_COLORS
void PALETTE_SHIRT
