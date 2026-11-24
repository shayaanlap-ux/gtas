// Procedural weapon, pickup and jetpack models (barrels point along +Z).
import * as THREE from 'three'
import type { PickupKind, WeaponId } from './mpData'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10)
const mats: Record<string, THREE.MeshStandardMaterial> = {}
function mat(hex: number, metal = 0.6, rough = 0.45, emissive = 0) {
  const k = `${hex}-${metal}-${rough}-${emissive}`
  return (mats[k] ??= new THREE.MeshStandardMaterial({ color: hex, metalness: metal, roughness: rough, emissive: emissive ? hex : 0x000000, emissiveIntensity: emissive }))
}
function box(g: THREE.Group, hex: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, metal = 0.6) {
  const m = new THREE.Mesh(BOX, mat(hex, metal))
  m.scale.set(sx, sy, sz)
  m.position.set(x, y, z)
  m.rotation.x = rx
  m.castShadow = false
  g.add(m)
  return m
}
function cyl(g: THREE.Group, hex: number, r: number, len: number, x: number, y: number, z: number, axis: 'z' | 'y' = 'z', metal = 0.6, emissive = 0) {
  const m = new THREE.Mesh(CYL, mat(hex, metal, 0.4, emissive))
  m.scale.set(r, len, r)
  m.position.set(x, y, z)
  if (axis === 'z') m.rotation.x = Math.PI / 2
  g.add(m)
  return m
}

const GUN = 0x24262b, WOOD = 0x6b4a2e, STEEL = 0x555a63

export function buildGun(id: WeaponId): THREE.Group {
  const g = new THREE.Group()
  let muzzleZ = 0.3
  switch (id) {
    case 'pistol':
      box(g, STEEL, 0.045, 0.06, 0.2, 0, 0.03, 0.08)
      box(g, GUN, 0.045, 0.11, 0.055, 0, -0.04, 0.0, -0.2)
      muzzleZ = 0.19
      break
    case 'smg':
      box(g, GUN, 0.055, 0.085, 0.32, 0, 0.02, 0.1)
      box(g, GUN, 0.035, 0.17, 0.045, 0, -0.1, 0.1)
      box(g, GUN, 0.045, 0.1, 0.05, 0, -0.07, -0.02, -0.2)
      cyl(g, STEEL, 0.014, 0.12, 0, 0.03, 0.33)
      muzzleZ = 0.4
      break
    case 'rifle':
      box(g, GUN, 0.06, 0.09, 0.42, 0, 0.02, 0.12)
      box(g, WOOD, 0.055, 0.07, 0.24, 0, 0.0, 0.42)
      box(g, WOOD, 0.05, 0.1, 0.24, 0, -0.02, -0.18)
      box(g, GUN, 0.04, 0.18, 0.06, 0, -0.12, 0.14, 0.25)
      cyl(g, STEEL, 0.014, 0.3, 0, 0.04, 0.52)
      muzzleZ = 0.68
      break
    case 'shotgun':
      cyl(g, STEEL, 0.02, 0.62, 0, 0.035, 0.38)
      cyl(g, GUN, 0.017, 0.5, 0, -0.01, 0.36)
      box(g, GUN, 0.06, 0.09, 0.3, 0, 0.0, 0.0)
      box(g, WOOD, 0.065, 0.06, 0.16, 0, -0.03, 0.3)
      box(g, WOOD, 0.05, 0.1, 0.26, 0, -0.03, -0.25)
      muzzleZ = 0.7
      break
    case 'sniper':
      box(g, GUN, 0.055, 0.09, 0.5, 0, 0.0, 0.05)
      cyl(g, STEEL, 0.013, 0.7, 0, 0.03, 0.62)
      box(g, 0x2c3a2a, 0.06, 0.11, 0.28, 0, -0.01, -0.32)
      cyl(g, 0x111111, 0.03, 0.26, 0, 0.1, 0.1)
      cyl(g, 0x66ccff, 0.026, 0.01, 0, 0.1, 0.235, 'z', 0.2, 1)
      box(g, GUN, 0.03, 0.14, 0.04, 0, -0.1, 0.0, 0.1)
      muzzleZ = 0.98
      break
  }
  const mz = new THREE.Object3D()
  mz.position.set(0, 0.03, muzzleZ)
  g.add(mz)
  g.userData.muzzle = mz
  return g
}

export function buildJetpack() {
  const g = new THREE.Group()
  for (const sx of [-1, 1]) {
    cyl(g, 0x39414d, 0.075, 0.5, sx * 0.12, 0, 0, 'y', 0.7)
    cyl(g, 0xd9772b, 0.06, 0.08, sx * 0.12, -0.28, 0, 'y', 0.5, 0.5)
    cyl(g, 0xb8bec8, 0.08, 0.05, sx * 0.12, 0.27, 0, 'y', 0.8)
  }
  box(g, 0x2a2f38, 0.3, 0.12, 0.1, 0, 0.1, 0.0)
  box(g, 0x44ff88, 0.05, 0.03, 0.02, 0, 0.1, 0.055, 0, 0.1).material = mat(0x44ff88, 0, 0.3, 1)
  const fl = new THREE.Object3D(); fl.position.set(-0.12, -0.34, 0); g.add(fl)
  const fr = new THREE.Object3D(); fr.position.set(0.12, -0.34, 0); g.add(fr)
  g.userData.flames = [fl, fr]
  return g
}

const PU_COL: Record<string, number> = { health: 0x31e07a, ammo: 0xffc233, fuel: 0xff7a1f, pistol: 0xd7dbe0, smg: 0xffd27a, rifle: 0xff9d3b, shotgun: 0xff6a3b, sniper: 0x66d9ff }
export const pickupColor = (k: PickupKind) => PU_COL[k] ?? 0xffffff

export function buildPickup(kind: PickupKind) {
  const g = new THREE.Group()
  const col = pickupColor(kind)
  const item = new THREE.Group()
  if (kind === 'health') {
    box(item, 0xf5f5f5, 0.6, 0.45, 0.3, 0, 0, 0, 0, 0.1)
    box(item, 0xd8212c, 0.38, 0.12, 0.32, 0, 0, 0, 0, 0.1)
    box(item, 0xd8212c, 0.12, 0.38, 0.32, 0, 0, 0, 0, 0.1)
  } else if (kind === 'ammo') {
    box(item, 0x4a5a3a, 0.55, 0.32, 0.34, 0, 0, 0, 0, 0.2)
    box(item, 0xffc233, 0.4, 0.06, 0.36, 0, 0.06, 0, 0, 0.2)
    for (let i = -1; i <= 1; i++) cyl(item, 0xd9a441, 0.05, 0.22, i * 0.12, 0.2, 0, 'y', 0.8)
  } else if (kind === 'fuel') {
    cyl(item, 0xff7a1f, 0.2, 0.55, 0, 0, 0, 'y', 0.3, 0.25)
    cyl(item, 0x222222, 0.08, 0.1, 0, 0.32, 0, 'y')
    box(item, 0xffffff, 0.12, 0.2, 0.01, 0, 0, 0.2)
  } else {
    const gun = buildGun(kind)
    gun.scale.setScalar(1.5)
    gun.position.z = -0.25
    item.add(gun)
    item.rotation.y = Math.PI / 2
    const holder = new THREE.Group()
    holder.add(item)
    g.userData.item = holder
    g.add(holder)
  }
  if (!g.userData.item) {
    g.userData.item = item
    g.add(item)
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }))
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.45
  g.add(ring)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  beam.position.y = 6.5
  g.add(beam)
  return g
}
