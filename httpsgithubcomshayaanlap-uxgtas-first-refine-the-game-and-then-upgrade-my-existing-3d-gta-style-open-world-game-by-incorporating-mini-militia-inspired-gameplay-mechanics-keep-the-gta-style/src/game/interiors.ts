// @ts-nocheck
// Enterable interiors (kept far from the open world and swapped in by teleporting)
import * as THREE from 'three'
import { addBox } from './world'
import { Humanoid } from './character'
import { cv, toTex, signTexture, KFONT } from './textures'
import { mulberry32 } from './util'

export interface IItem { x: number; z: number; r: number; label: string; kind: 'shop' | 'sleep' | 'wardrobe' | 'save' | 'exit' | 'sit'; id?: string }
export interface Interior {
  id: string
  name: string
  spawn: { x: number; z: number; yaw: number }
  items: IItem[]
  anim: (dt: number, t: number) => void
  group: THREE.Group
  lights: THREE.PointLight[]
  setVisible: (v: boolean) => void
}

const BOX = new THREE.BoxGeometry(1, 1, 1)
const mats = new Map<string, THREE.MeshStandardMaterial>()
const M = (hex: number, rough = 0.85, extra: any = {}) => {
  const k = hex + '|' + rough + JSON.stringify(extra)
  let m = mats.get(k)
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, ...extra })))
  return m
}
function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = false) {
  const m = new THREE.Mesh(BOX, mat)
  m.scale.set(w, h, d)
  m.position.set(x, y + h / 2, z)
  m.castShadow = false
  m.receiveShadow = true
  g.add(m)
  if (collide) addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, -1, 6, 'int')
  return m
}
function tileTex(a: string, b: string, n = 12) {
  const [c, x] = cv(128, 128)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = (i + j) % 2 ? a : b
    x.fillRect(i * 32, j * 32, 32, 32)
  }
  const t = toTex(c, n, n)
  return t
}
function poster(g: THREE.Object3D, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }))
  m.position.set(x, y, z)
  m.rotation.y = ry
  g.add(m)
}

function shell(g: THREE.Group, cx: number, cz: number, w: number, d: number, h: number, floorTex: THREE.Texture, wallHex: number) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(cx, 0.01, cz)
  floor.receiveShadow = true
  g.add(floor)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(0xe8e4da))
  ceil.rotation.x = Math.PI / 2
  ceil.position.set(cx, h, cz)
  g.add(ceil)
  const wm = M(wallHex, 0.95, { side: THREE.DoubleSide })
  box(g, w + 0.8, h, 0.4, cx, 0, cz - d / 2 - 0.2, wm, true)
  box(g, w + 0.8, h, 0.4, cx, 0, cz + d / 2 + 0.2, wm, true)
  box(g, 0.4, h, d, cx - w / 2 - 0.2, 0, cz, wm, true)
  box(g, 0.4, h, d, cx + w / 2 + 0.2, 0, cz, wm, true)
  // skirting
  box(g, w, 0.12, 0.05, cx, 0, cz - d / 2 + 0.03, M(0x5a4636))
}
function exitDoor(g: THREE.Group, cx: number, cz: number, d: number) {
  const z = cz + d / 2
  box(g, 1.3, 2.3, 0.1, cx, 0, z - 0.04, M(0x5c3a21))
  box(g, 1.6, 0.14, 0.14, cx, 2.3, z - 0.05, M(0x3a2212))
  const t = signTexture([{ t: 'EXIT • ನಿರ್ಗಮನ', s: 40 }], '#0d6b3e', '#fff', 256, 64, false)
  poster(g, t, 1.2, 0.3, cx, 2.65, z - 0.1, Math.PI)
}

function fan(g: THREE.Group, x: number, z: number, h: number) {
  const f = new THREE.Group()
  f.position.set(x, h - 0.4, z)
  box(f, 0.05, 0.4, 0.05, 0, 0, 0, M(0x333333))
  const blades = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(BOX, M(0xdddddd))
    b.scale.set(0.6, 0.015, 0.14)
    const a = (i / 3) * Math.PI * 2
    b.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35)
    b.rotation.y = -a
    blades.add(b)
  }
  f.add(blades)
  g.add(f)
  return blades
}

export function buildInteriors(scene: THREE.Scene) {
  const out: Record<string, Interior> = {}
  const rng = mulberry32(2024)
  // ---------------- STORE ----------------
  {
    const g = new THREE.Group()
    const cx = 3000, cz = 3000, w = 10, d = 8, h = 3.2
    shell(g, cx, cz, w, d, h, tileTex('#d9d3c4', '#c4bdae'), 0xe6dccb)
    exitDoor(g, cx, cz, d)
    // light panel
    box(g, 2.5, 0.05, 0.3, cx - 2, h - 0.05, cz, M(0xffffff, 0.3, { emissive: 0xfff4d6, emissiveIntensity: 2 }))
    box(g, 2.5, 0.05, 0.3, cx + 2, h - 0.05, cz, M(0xffffff, 0.3, { emissive: 0xfff4d6, emissiveIntensity: 2 }))
    // counter
    box(g, 5.4, 1.0, 0.9, cx, 0, cz - 1.0, M(0x6b4a2f), true)
    box(g, 5.5, 0.06, 1.0, cx, 1.0, cz - 1.0, M(0x2a1d12))
    box(g, 0.5, 0.35, 0.4, cx + 1.8, 1.06, cz - 1.0, M(0x222222))
    // shelves on back wall and side walls with products
    const prod = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ roughness: 0.6 }), 400)
    let pi = 0
    const o = new THREE.Object3D()
    const cols = [0xe63946, 0xf4a261, 0x2a9d8f, 0xe9c46a, 0x457b9d, 0x9b5de5, 0xf15bb5, 0x90be6d, 0xffffff, 0xff7b00]
    const shelfRun = (x0: number, z0: number, x1: number, z1: number, rot: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0)
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
      const s = new THREE.Mesh(BOX, M(0x7a6a58))
      s.scale.set(len, 2.2, 0.5)
      s.position.set(mx, 1.1, mz)
      s.rotation.y = rot
      g.add(s)
      addBox(Math.min(x0, x1) - 0.3, Math.min(z0, z1) - 0.3, Math.max(x0, x1) + 0.3, Math.max(z0, z1) + 0.3, -1, 6, 'int')
      for (let lvl = 0; lvl < 5; lvl++)
        for (let k = 0; k < len / 0.22 && pi < 400; k++) {
          const t = (k + 0.5) * 0.22 - len / 2
          o.position.set(mx + Math.cos(rot) * t + Math.sin(rot) * 0.3, 0.25 + lvl * 0.42, mz - Math.sin(rot) * t + Math.cos(rot) * 0.3)
          o.rotation.set(0, rot, 0)
          o.scale.set(0.16 + rng() * 0.06, 0.24 + rng() * 0.12, 0.12)
          o.updateMatrix()
          prod.setMatrixAt(pi, o.matrix)
          prod.setColorAt(pi, new THREE.Color(cols[Math.floor(rng() * cols.length)]))
          pi++
        }
    }
    shelfRun(cx - 4.4, cz - 3.4, cx + 4.4, cz - 3.4, 0)
    shelfRun(cx - 4.5, cz - 1.5, cx - 4.5, cz + 2.5, -Math.PI / 2)
    shelfRun(cx - 2.5, cz + 0.8, cx + 1.0, cz + 0.8, Math.PI)
    prod.count = pi
    prod.instanceMatrix.needsUpdate = true
    g.add(prod)
    // fridge
    box(g, 1.0, 1.9, 0.8, cx + 4.1, 0, cz + 1.0, M(0xf2f2f2, 0.3), true)
    box(g, 0.8, 1.5, 0.05, cx + 3.6, 0.2, cz + 1.0, M(0x335566, 0.1, { transparent: true, opacity: 0.6 }))
    // posters
    poster(g, signTexture([{ t: 'ನೆಲ್ಲ್ಯಾಡಿ ಸ್ಟೋರ್ಸ್', s: 40 }, { t: 'NELLYADI STORES', s: 26 }], '#14306e', '#fff', 512, 128), 3.2, 0.8, cx, 2.7, cz - d / 2 + 0.05, 0)
    poster(g, signTexture([{ t: 'BISCUITS • COLD DRINKS', s: 28 }, { t: 'UMBRELLAS • DAILY NEEDS', s: 24 }], '#a4141b', '#fff', 512, 128), 2.4, 0.6, cx + 3, 2.6, cz - d / 2 + 0.05, 0)
    const blades = fan(g, cx, cz + 1, h)
    // shopkeeper
    const keeper = new Humanoid({ skin: 0xb77d4f, shirt: 0xf2f2f2, pants: 0x2b3a55, hair: 0x15110e, style: 'pants', scale: 1.0 })
    keeper.root.position.set(cx - 0.5, 0, cz - 2.0)
    keeper.root.rotation.y = 0
    g.add(keeper.root)
    const pl = new THREE.PointLight(0xffe2b0, 30, 16, 1.6)
    pl.position.set(cx, h - 0.6, cz)
    g.add(pl)
    scene.add(g)
    out.store = {
      id: 'store', name: 'Nellyadi Stores', group: g, lights: [pl],
      spawn: { x: cx, z: cz + d / 2 - 1.4, yaw: Math.PI },
      items: [
        { x: cx, z: cz - 0.2, r: 2.2, label: 'Talk to shopkeeper / Buy', kind: 'shop', id: 'store' },
        { x: cx, z: cz + d / 2 - 0.6, r: 1.4, label: 'Leave shop', kind: 'exit' },
      ],
      anim: (dt, t) => {
        blades.rotation.y += dt * 9
        keeper.pose(Math.sin(t * 0.3) > 0.4 ? 'talk' : 'idle', 0, dt)
      },
      setVisible: (v) => (g.visible = v),
    }
  }
  // ---------------- HOTEL ----------------
  {
    const g = new THREE.Group()
    const cx = 3000, cz = 3100, w = 12, d = 9, h = 3.4
    shell(g, cx, cz, w, d, h, tileTex('#e8e1d0', '#9b8b72'), 0xf0e6c8)
    exitDoor(g, cx, cz, d)
    box(g, 3, 0.05, 0.3, cx - 2.5, h - 0.05, cz, M(0xffffff, 0.3, { emissive: 0xfff4d6, emissiveIntensity: 2 }))
    box(g, 3, 0.05, 0.3, cx + 2.5, h - 0.05, cz, M(0xffffff, 0.3, { emissive: 0xfff4d6, emissiveIntensity: 2 }))
    // cashier counter & kitchen
    box(g, 3.2, 1.0, 0.8, cx + 3.6, 0, cz + 2.2, M(0x7a3a1c), true)
    box(g, 6, 1.0, 0.8, cx - 1.5, 0, cz - 3.2, M(0xcfcfc9, 0.4), true)
    box(g, 1.1, 0.2, 0.9, cx - 3.5, 1.0, cz - 3.2, M(0x555555, 0.3, { metalness: 0.8 }))
    box(g, 0.7, 0.45, 0.7, cx - 1.0, 1.0, cz - 3.2, M(0xb0b0b0, 0.2, { metalness: 0.9 }))
    // tables with chairs
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        const tx = cx - 4 + i * 3.2, tz = cz - 0.6 + j * 2.4
        box(g, 1.2, 0.06, 0.8, tx, 0.74, tz, M(0xb08968), false)
        box(g, 0.1, 0.74, 0.1, tx, 0, tz, M(0x333333))
        addBox(tx - 0.6, tz - 0.4, tx + 0.6, tz + 0.4, -1, 6, 'int')
        for (const s of [-1, 1]) box(g, 0.4, 0.45, 0.4, tx + s * 0.85, 0, tz, M(0x8a5a2b))
        // plates
        box(g, 0.3, 0.02, 0.3, tx - 0.25, 0.8, tz, M(0xdddddd))
        box(g, 0.3, 0.02, 0.3, tx + 0.25, 0.8, tz, M(0xdddddd))
      }
    poster(g, signTexture([{ t: 'ಮೆನು  MENU', s: 40 }, { t: 'ಮಸಾಲೆ ದೋಸೆ  Masala Dosa  ₹60', s: 26 }, { t: 'ಊಟ  Meals  ₹90', s: 26 }, { t: 'ಕಾಫಿ  Filter Coffee  ₹20', s: 26 }], '#1c1c1c', '#ffe9a0', 512, 256), 2.8, 1.4, cx + 3.6, 2.2, cz - d / 2 + 0.05, 0)
    const blades = fan(g, cx - 2, cz, h)
    const blades2 = fan(g, cx + 2.5, cz, h)
    const cook = new Humanoid({ skin: 0x8d5a36, shirt: 0xf2f2f2, pants: 0xf2f2f2, hair: 0x15110e, style: 'pants', cap: true })
    cook.root.position.set(cx - 2.2, 0, cz - 3.9)
    g.add(cook.root)
    const cashier = new Humanoid({ skin: 0xb77d4f, shirt: 0xd98e4a, pants: 0xf2f2ea, hair: 0x15110e, style: 'lungi', towel: true })
    cashier.root.position.set(cx + 3.6, 0, cz + 2.9)
    cashier.root.rotation.y = Math.PI
    g.add(cashier.root)
    const diners: Humanoid[] = []
    for (const [tx, tz] of [[cx - 4.85, cz - 0.6], [cx + 1.55, cz + 1.8]]) {
      const hd = new Humanoid({ skin: 0xd9a577, shirt: 0x3b6ea5, pants: 0x2b3a55, hair: 0x15110e, style: 'pants' })
      hd.root.position.set(tx, 0.0, tz)
      hd.root.rotation.y = Math.PI / 2 * (tx < cx - 3 ? 1 : -1)
      g.add(hd.root)
      diners.push(hd)
    }
    const pl = new THREE.PointLight(0xffe0a8, 34, 18, 1.6)
    pl.position.set(cx, h - 0.6, cz)
    g.add(pl)
    scene.add(g)
    out.hotel = {
      id: 'hotel', name: 'Udupi Hotel', group: g, lights: [pl],
      spawn: { x: cx, z: cz + d / 2 - 1.4, yaw: Math.PI },
      items: [
        { x: cx + 3.6, z: cz + 1.2, r: 2.2, label: 'Order food', kind: 'shop', id: 'hotel' },
        { x: cx, z: cz + d / 2 - 0.6, r: 1.4, label: 'Leave hotel', kind: 'exit' },
      ],
      anim: (dt, t) => {
        blades.rotation.y += dt * 8
        blades2.rotation.y += dt * 8
        cook.pose('work', 0, dt)
        cashier.pose('idle', 0, dt)
        diners.forEach((dn, i) => dn.pose(i ? 'sit' : 'sit', 0, dt))
        void t
      },
      setVisible: (v) => (g.visible = v),
    }
  }
  // ---------------- HOME ----------------
  {
    const g = new THREE.Group()
    const cx = 3000, cz = 3200, w = 9, d = 7, h = 3.0
    shell(g, cx, cz, w, d, h, tileTex('#c9b79c', '#b5a283'), 0xeadfc6)
    exitDoor(g, cx, cz, d)
    box(g, 2.0, 0.05, 0.3, cx, h - 0.05, cz, M(0xffffff, 0.3, { emissive: 0xfff4d6, emissiveIntensity: 2 }))
    // bed
    box(g, 2.0, 0.5, 2.4, cx - 3, 0, cz - 2.2, M(0x6b4a2f), true)
    box(g, 1.9, 0.22, 2.3, cx - 3, 0.5, cz - 2.2, M(0x2e86c1))
    box(g, 0.7, 0.15, 0.4, cx - 3, 0.72, cz - 3.0, M(0xffffff))
    // wardrobe
    box(g, 1.6, 2.0, 0.6, cx + 3, 0, cz - 3.0, M(0x5c3a21), true)
    box(g, 0.04, 1.8, 0.02, cx + 3, 0.1, cz - 2.69, M(0x222222))
    // table + save desk
    box(g, 1.4, 0.06, 0.8, cx + 2.5, 0.74, cz + 0.3, M(0xb08968), false)
    box(g, 0.1, 0.74, 0.1, cx + 2.5, 0, cz + 0.3, M(0x333333))
    addBox(cx + 1.8, cz - 0.1, cx + 3.2, cz + 0.7, -1, 6, 'int')
    box(g, 0.5, 0.35, 0.05, cx + 2.5, 0.8, cz + 0.1, M(0x111111, 0.2, { emissive: 0x335577, emissiveIntensity: 0.6 }))
    // TV unit, altar-less simple living corner, mat
    box(g, 1.2, 0.5, 0.5, cx - 0.5, 0, cz - 3.1, M(0x4a3524), true)
    box(g, 0.9, 0.55, 0.06, cx - 0.5, 0.55, cz - 3.1, M(0x0c0c0c, 0.1, { emissive: 0x223344, emissiveIntensity: 0.5 }))
    box(g, 2.2, 0.02, 1.4, cx - 1.2, 0, cz + 0.8, M(0xb23a3a))
    poster(g, signTexture([{ t: 'ಮನೆ ಸ್ವಾಗತ', s: 44 }, { t: 'HOME • Rest, change, save', s: 26 }], '#2e5d3a', '#fff', 512, 128), 2.4, 0.6, cx + 0.5, 2.2, cz - d / 2 + 0.05, 0)
    const blades = fan(g, cx, cz, h)
    const pl = new THREE.PointLight(0xffe6b8, 22, 14, 1.6)
    pl.position.set(cx, h - 0.6, cz)
    g.add(pl)
    scene.add(g)
    out.home = {
      id: 'home', name: 'Your home', group: g, lights: [pl],
      spawn: { x: cx, z: cz + d / 2 - 1.4, yaw: Math.PI },
      items: [
        { x: cx - 2.6, z: cz - 0.6, r: 1.8, label: 'Sleep until morning', kind: 'sleep' },
        { x: cx + 3, z: cz - 2.0, r: 1.6, label: 'Open wardrobe (customise)', kind: 'wardrobe' },
        { x: cx + 2.5, z: cz + 1.1, r: 1.5, label: 'Save game', kind: 'save' },
        { x: cx, z: cz + d / 2 - 0.6, r: 1.4, label: 'Leave home', kind: 'exit' },
      ],
      anim: (dt) => {
        blades.rotation.y += dt * 7
      },
      setVisible: (v) => (g.visible = v),
    }
  }
  for (const k of Object.keys(out)) out[k].setVisible(false)
  return out
}
void KFONT
