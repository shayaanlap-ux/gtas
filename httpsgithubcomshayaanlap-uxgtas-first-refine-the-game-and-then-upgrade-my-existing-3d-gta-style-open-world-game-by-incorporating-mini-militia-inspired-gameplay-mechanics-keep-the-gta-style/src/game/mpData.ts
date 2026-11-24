// Shared (client + server) game data. Must not import three.js or any browser API.

export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper'
export type PickupKind = WeaponId | 'health' | 'ammo' | 'fuel'
export type ModeId = 'freeroam' | 'dm' | 'tdm' | 'jet'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: number
  dmg: number // per bullet / pellet
  pellets: number
  rpm: number
  auto: boolean
  mag: number
  reserve: number // max reserve ammo
  startReserve: number
  pickupAmmo: number // reserve added when a pickup is collected while already owned
  reload: number // seconds
  range: number
  spread: number // radians (hip)
  adsSpread: number
  recoil: number // camera kick (radians)
  headMult: number
  falloff: number // damage multiplier at max range (1 = none)
  zoom: number // fov multiplier when aiming
  scope: boolean
  moveMul: number
  color: number // tracer colour
  vol: number
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'M9 Pistol', slot: 1, dmg: 24, pellets: 1, rpm: 380, auto: false, mag: 12, reserve: 72, startReserve: 48, pickupAmmo: 24, reload: 1.15, range: 110, spread: 0.014, adsSpread: 0.004, recoil: 0.018, headMult: 2, falloff: 0.6, zoom: 0.8, scope: false, moveMul: 1, color: 0xffe9a8, vol: 0.5 },
  smg: { id: 'smg', name: 'MP7 SMG', slot: 2, dmg: 13, pellets: 1, rpm: 880, auto: true, mag: 35, reserve: 175, startReserve: 70, pickupAmmo: 70, reload: 1.6, range: 90, spread: 0.03, adsSpread: 0.014, recoil: 0.009, headMult: 1.8, falloff: 0.5, zoom: 0.85, scope: false, moveMul: 0.97, color: 0xffd27a, vol: 0.55 },
  rifle: { id: 'rifle', name: 'AK-47 Rifle', slot: 3, dmg: 20, pellets: 1, rpm: 600, auto: true, mag: 30, reserve: 150, startReserve: 60, pickupAmmo: 60, reload: 2.0, range: 220, spread: 0.022, adsSpread: 0.006, recoil: 0.016, headMult: 2, falloff: 0.65, zoom: 0.7, scope: false, moveMul: 0.92, color: 0xffc04a, vol: 0.75 },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', slot: 4, dmg: 11, pellets: 9, rpm: 75, auto: false, mag: 6, reserve: 36, startReserve: 18, pickupAmmo: 12, reload: 2.3, range: 38, spread: 0.065, adsSpread: 0.045, recoil: 0.05, headMult: 1.5, falloff: 0.25, zoom: 0.85, scope: false, moveMul: 0.95, color: 0xffb060, vol: 0.95 },
  sniper: { id: 'sniper', name: 'AWP Sniper', slot: 5, dmg: 92, pellets: 1, rpm: 48, auto: false, mag: 5, reserve: 20, startReserve: 10, pickupAmmo: 5, reload: 2.8, range: 420, spread: 0.04, adsSpread: 0.0004, recoil: 0.07, headMult: 1.6, falloff: 1, zoom: 0.26, scope: true, moveMul: 0.85, color: 0x9fe7ff, vol: 1 },
}
export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper']

export interface ModeDef {
  id: ModeId
  label: string
  blurb: string
  teams: boolean
  online: 'optional' | 'required'
  scoreLimit: number // kills (or team kills); 0 = endless
  timeLimit: number // seconds; 0 = endless
  respawn: number // seconds
  loadout: WeaponId[]
  fuelMul: number // jetpack tank multiplier
  fuelRegenAir: number // fraction of ground regen rate while airborne
  bounds: [number, number] | null // ellipse half-extents (x, z) of the combat area
  pickups: 'ground' | 'air' | 'both'
  allowVehicles: boolean
  maxPlayers: number
}

export const MODES: Record<ModeId, ModeDef> = {
  freeroam: { id: 'freeroam', label: 'Free Roam', blurb: 'The full open world, missions, traffic and weather. Play solo or share the world online with PvP.', teams: false, online: 'optional', scoreLimit: 0, timeLimit: 0, respawn: 4, loadout: ['pistol'], fuelMul: 1, fuelRegenAir: 0, bounds: null, pickups: 'ground', allowVehicles: true, maxPlayers: 16 },
  dm: { id: 'dm', label: 'Deathmatch', blurb: 'Free-for-all through the streets. First to 20 eliminations wins.', teams: false, online: 'required', scoreLimit: 20, timeLimit: 480, respawn: 3, loadout: ['pistol'], fuelMul: 1, fuelRegenAir: 0, bounds: [430, 260], pickups: 'ground', allowVehicles: false, maxPlayers: 16 },
  tdm: { id: 'tdm', label: 'Team Deathmatch', blurb: 'Red vs Blue. Team up, hold the rooftops. First team to 30 eliminations wins.', teams: true, online: 'required', scoreLimit: 30, timeLimit: 600, respawn: 3, loadout: ['pistol'], fuelMul: 1, fuelRegenAir: 0, bounds: [430, 260], pickups: 'ground', allowVehicles: false, maxPlayers: 16 },
  jet: { id: 'jet', label: 'Jetpack Arena', blurb: 'Mini Militia in 3D: big tanks, fast thrust and weapons floating above the town. First to 15.', teams: false, online: 'required', scoreLimit: 15, timeLimit: 420, respawn: 2, loadout: ['pistol', 'smg'], fuelMul: 1.6, fuelRegenAir: 0.18, bounds: [270, 150], pickups: 'both', allowVehicles: false, maxPlayers: 16 },
}
export const MODE_ORDER: ModeId[] = ['freeroam', 'dm', 'tdm', 'jet']

export const TEAM_NAMES = ['Red', 'Blue']
export const TEAM_COLORS = [0xd23a3a, 0x2f6fe0]

export interface PickupDef { x: number; z: number; y?: number; kind: PickupKind }
export const PICKUP_RESPAWN: Record<string, number> = { health: 20, ammo: 15, fuel: 15, pistol: 20, smg: 25, rifle: 30, shotgun: 30, sniper: 40 }

export const JET = {
  fuelMax: 100,
  drain: 24, // per second while thrusting
  boostDrain: 48,
  regen: 38, // per second on the ground
  regenDelay: 0.5,
  accel: 34, // vertical thrust acceleration (gravity is 20)
  maxUp: 9.5,
  maxUpBoost: 14,
  hSpeed: 11,
  hSpeedBoost: 21,
  maxY: 110,
}

// ---------------------------------------------------------------- spawn + pickup layout (town core)
function buildSpawns() {
  const out: { x: number; z: number }[] = []
  for (let x = -240; x <= 240; x += 30) out.push({ x: x + (Math.abs(x) % 60 === 0 ? 4 : -4), z: x % 60 === 0 ? 1.6 : -1.6 })
  for (let z = -90; z <= 120; z += 30) if (z !== 0) out.push({ x: z % 60 === 0 ? 2 : -2, z })
  for (let x = -60; x <= 120; x += 60) out.push({ x, z: 300 }) // fillers on the north road end are cut by bounds in small modes
  return out
}
export const SPAWNS = buildSpawns().filter((p) => !(p.z === 300))

function buildGroundPickups(): PickupDef[] {
  const kinds: PickupKind[] = ['rifle', 'health', 'ammo', 'shotgun', 'health', 'smg', 'ammo', 'sniper', 'pistol', 'health', 'fuel', 'rifle', 'ammo', 'shotgun', 'smg', 'health']
  const out: PickupDef[] = []
  let i = 0
  for (let x = -225; x <= 225; x += 36) {
    const side = i % 2 === 0 ? -1 : 1
    out.push({ x: x + (i % 3) * 3, z: side * 2.6, kind: kinds[i % kinds.length] })
    i++
  }
  for (let z = -80; z <= 110; z += 38) {
    if (Math.abs(z) < 12) continue
    out.push({ x: (i % 2 ? 1 : -1) * 2.6, z, kind: kinds[(i * 3) % kinds.length] })
    i++
  }
  // a few out in the wider valley for Free Roam explorers / bigger maps
  out.push({ x: -300, z: 8, kind: 'rifle' }, { x: 300, z: 6, kind: 'health' }, { x: 0, z: 220, kind: 'sniper' }, { x: 0, z: -90, kind: 'ammo' })
  return out
}
function buildAirPickups(): PickupDef[] {
  const kinds: PickupKind[] = ['sniper', 'fuel', 'health', 'rifle', 'ammo', 'shotgun', 'fuel', 'smg', 'health', 'ammo']
  const out: PickupDef[] = []
  let i = 0
  for (let x = -210; x <= 210; x += 42) {
    for (const z of [-46, 50]) {
      const y = [17, 26, 35, 22][i % 4]
      out.push({ x: x + (z > 0 ? 14 : -10), z, y, kind: kinds[i % kinds.length] })
      i++
    }
  }
  return out
}
const GROUND = buildGroundPickups()
const AIR = buildAirPickups()
const cache: Partial<Record<ModeId, PickupDef[]>> = {}
export function pickupsFor(mode: ModeId): PickupDef[] {
  const c = cache[mode]
  if (c) return c
  const m = MODES[mode]
  let list: PickupDef[] = m.pickups === 'ground' ? GROUND : m.pickups === 'air' ? AIR : [...GROUND.filter((_, i) => i % 2 === 0), ...AIR]
  if (m.bounds) {
    const [bx, bz] = m.bounds
    list = list.filter((p) => (p.x / bx) ** 2 + (p.z / bz) ** 2 < 0.95)
  }
  cache[mode] = list
  return list
}
export function spawnsFor(mode: ModeId) {
  const m = MODES[mode]
  if (!m.bounds) return SPAWNS
  const [bx, bz] = m.bounds
  return SPAWNS.filter((p) => (p.x / bx) ** 2 + (p.z / bz) ** 2 < 0.9)
}

export interface LookData { skin: number; shirt: number; pants: number; hair: number }

// ---------------------------------------------------------------- wire types
export interface NetPlayer {
  id: string; name: string; team: number
  x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vy: number; vz: number
  anim: string; w: WeaponId | ''; ut: number; jet: number; crouch: number; veh: { variant: string; color: number; h: number } | null
  alive: boolean; hp: number; k: number; d: number; ping: number
  look: LookData
}
export interface NetEvent {
  s: number; t: number; k: 'shot' | 'kill' | 'join' | 'leave' | 'pickup' | 'match' | 'spawn'
  [key: string]: unknown
}
export interface SyncResponse {
  t: number
  you: {
    hp: number; alive: boolean; respawnIn: number; team: number; kills: number; deaths: number
    spawn: { seq: number; x: number; z: number } | null
    grants: { idx: number; kind: PickupKind }[]
    hits: { id: string; dmg: number; head: boolean; kill: boolean }[]
    hurt: { x: number; z: number; dmg: number }[]
  }
  players: NetPlayer[]
  events: NetEvent[]
  pu: string
  match: { phase: 'play' | 'over'; left: number; limit: number; scoreLimit: number; teamScore: number[]; winner: string; no: number; overLeft: number }
}
