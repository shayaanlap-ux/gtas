// @ts-nocheck
// Procedural humanoid with walk / run / talk / sit / jump / work / fallen poses
import * as THREE from 'three'
import { clamp, lerp, damp } from './util'

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
const BOX = new THREE.BoxGeometry(1, 1, 1)
const SPH = new THREE.SphereGeometry(1, 14, 10)
const CONE = new THREE.CylinderGeometry(0.8, 1, 1, 14, 1, true)
const cmats = new Map<number, THREE.MeshStandardMaterial>()
export function cmat(hex: number, rough = 0.85) {
  const k = hex * 10 + Math.round(rough * 9)
  let m = cmats.get(k)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, side: THREE.FrontSide })
    cmats.set(k, m)
  }
  return m
}
const lungiMat = new Map<number, THREE.MeshStandardMaterial>()
function checkMat(hex: number) {
  let m = lungiMat.get(hex)
  if (!m) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const x = c.getContext('2d')!
    x.fillStyle = '#' + hex.toString(16).padStart(6, '0')
    x.fillRect(0, 0, 64, 64)
    x.strokeStyle = 'rgba(255,255,255,0.7)'
    x.lineWidth = 3
    for (let i = 0; i < 64; i += 16) {
      x.beginPath()
      x.moveTo(i, 0)
      x.lineTo(i, 64)
      x.moveTo(0, i)
      x.lineTo(64, i)
      x.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(3, 2)
    t.colorSpace = THREE.SRGBColorSpace
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide })
    lungiMat.set(hex, m)
  }
  return m
}

const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
const _c = new THREE.Color()
const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3()
function vc(geo: THREE.BufferGeometry, hex: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0) {
  const g = geo.clone()
  _ee.set(rx, 0, rz)
  _qq.setFromEuler(_ee)
  _mm.compose(_pp.set(x, y, z), _qq, _ss.set(sx, sy, sz))
  g.applyMatrix4(_mm)
  const n = g.attributes.position.count
  const col = new Float32Array(n * 3)
  _c.setHex(hex)
  for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}
export interface Look {
  skin: number; shirt: number; pants: number; hair: number
  style: 'pants' | 'lungi' | 'saree' | 'uniform'
  female?: boolean; scale?: number; towel?: boolean; cap?: boolean
}
export const SKINS = [0xf1c8a0, 0xd9a577, 0xb77d4f, 0x8d5a36, 0x6b4128]

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat)
  m.scale.set(sx, sy, sz)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

export class Humanoid {
  root = new THREE.Group()
  body = new THREE.Group()
  legL!: THREE.Group; legR!: THREE.Group; armL!: THREE.Group; armR!: THREE.Group; head!: THREE.Group
  umbrella: THREE.Group | null = null
  look: Look
  phase = Math.random() * 6
  mode = 'idle'
  t = 0
  fall = 0
  private lastMode = ''
  sitOffset = 0
  constructor(look: Look) {
    this.look = look
    this.root.add(this.body)
    this.build()
  }
  build() {
    const L = this.look
    this.body.clear()
    const s = L.scale ?? 1
    this.root.scale.setScalar(s)
    const f = !!L.female
    const sleeveCol = L.style === 'saree' ? L.shirt : L.shirt
    const mesh = (list: THREE.BufferGeometry[]) => {
      const m = new THREE.Mesh(mergeGeometries(list, false), charMat)
      m.castShadow = true
      m.receiveShadow = true
      return m
    }
    const torso = new THREE.Group()
    torso.position.y = 1.18
    this.body.add(torso)
    this.torso = torso
    const tl = [vc(BOX, L.shirt, f ? 0.38 : 0.46, 0.58, f ? 0.22 : 0.26, 0, 0, 0)]
    if (L.style === 'saree') tl.push(vc(BOX, L.pants, 0.1, 0.62, 0.3, -0.12, 0, 0.01, 0, 0.35))
    if (L.style === 'uniform') tl.push(vc(BOX, 0x1d2b64, 0.47, 0.06, 0.27, 0, 0.24, 0))
    if (L.towel) tl.push(vc(BOX, 0xf0e8d0, 0.5, 0.1, 0.3, 0, 0.27, 0, 0, 0.15))
    tl.push(vc(BOX, L.skin, 0.09, 0.07, 0.09, 0, 0.3, 0))
    torso.add(mesh(tl))
    const head = new THREE.Group()
    head.position.set(0, 0.46, 0)
    torso.add(head)
    this.head = head
    const hl = [vc(SPH, L.skin, 0.115, 0.14, 0.125, 0, 0.12, 0)]
    if (L.cap) hl.push(vc(SPH, 0xf0f0f0, 0.125, 0.09, 0.135, 0, 0.2, 0))
    else {
      hl.push(vc(SPH, L.hair, 0.125, 0.11, 0.132, 0, 0.17, -0.01))
      if (f) hl.push(vc(BOX, L.hair, 0.22, 0.4, 0.1, 0, 0.0, -0.1))
    }
    hl.push(vc(SPH, 0x111111, 0.014, 0.014, 0.01, -0.045, 0.13, 0.115))
    hl.push(vc(SPH, 0x111111, 0.014, 0.014, 0.01, 0.045, 0.13, 0.115))
    head.add(mesh(hl))
    const arm = (sx: number) => {
      const g = new THREE.Group()
      g.position.set(sx * (f ? 0.23 : 0.29), 0.24, 0)
      torso.add(g)
      g.add(mesh([vc(BOX, sleeveCol, 0.13, 0.3, 0.13, 0, -0.14, 0), vc(BOX, L.skin, 0.1, 0.3, 0.1, 0, -0.42, 0)]))
      return g
    }
    this.armL = arm(1)
    this.armR = arm(-1)
    const leg = (sx: number) => {
      const g = new THREE.Group()
      g.position.set(sx * 0.11, 0.85, 0)
      this.body.add(g)
      if (L.style === 'lungi' || L.style === 'saree') g.add(mesh([vc(BOX, L.skin, 0.13, 0.5, 0.13, 0, -0.55, 0), vc(BOX, 0x1a1a1a, 0.15, 0.08, 0.26, 0, -0.82, 0.04)]))
      else g.add(mesh([vc(BOX, L.pants, 0.17, 0.78, 0.17, 0, -0.39, 0), vc(BOX, 0x1a1a1a, 0.18, 0.09, 0.29, 0, -0.82, 0.05)]))
      return g
    }
    this.legL = leg(1)
    this.legR = leg(-1)
    if (L.style === 'lungi' || L.style === 'saree') {
      const tall = L.style === 'saree' ? 0.85 : 0.72
      const c = mesh([vc(CONE, L.pants, 0.3, tall, 0.27, 0, 0.5, 0), vc(CONE, L.style === 'saree' ? L.shirt : 0xf2f2ea, 0.31, 0.1, 0.28, 0, 0.12, 0)])
      this.body.add(c)
      this.skirt = c
    } else this.skirt = null
    const u = new THREE.Group()
    const pole = new THREE.Mesh(BOX, new THREE.MeshStandardMaterial({ color: 0x222222 }))
    pole.scale.set(0.015, 0.9, 0.015)
    pole.position.y = 0.3
    u.add(pole)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8, side: THREE.DoubleSide }))
    dome.position.y = 0.72
    dome.scale.y = 0.55
    dome.castShadow = true
    u.add(dome)
    u.position.set(0, -0.58, 0.05)
    u.visible = false
    this.armR.add(u)
    this.umbrella = u
    this.umbrellaDome = dome
  }
  torso!: THREE.Group
  skirt: THREE.Mesh | null = null
  umbrellaDome!: THREE.Mesh
  setUmbrella(on: boolean, color = 0x222233) {
    if (!this.umbrella) return
    this.umbrella.visible = on
    if (on) this.umbrellaDome.material.color.setHex(color)
  }
  /** mode: idle | walk | run | talk | sit | jump | work | down | ride | wave | drink */
  pose(mode: string, speed: number, dt: number, extra = 0) {
    this.t += dt
    const body = this.body
    let ll = 0, lr = 0, al = 0, ar = 0, lean = 0, bob = 0, headY = 0, headX = 0, sink = 0, armZ = 0, torsoX = 0
    let kneeL = 0
    void kneeL
    const holding = this.umbrella?.visible
    if (mode === 'walk' || mode === 'run') {
      this.phase += dt * (speed * (mode === 'run' ? 2.3 : 2.9) + 1.2)
      const amp = clamp(0.35 + speed * 0.12, 0.3, mode === 'run' ? 1.1 : 0.7)
      const sw = Math.sin(this.phase)
      ll = sw * amp
      lr = -sw * amp
      al = -sw * amp * 0.85
      ar = sw * amp * 0.85
      bob = Math.abs(Math.cos(this.phase)) * 0.045 * (mode === 'run' ? 1.5 : 1)
      lean = mode === 'run' ? 0.22 : 0.05
    } else if (mode === 'idle') {
      bob = Math.sin(this.t * 1.8) * 0.006
      al = Math.sin(this.t * 1.3) * 0.04
      ar = -Math.sin(this.t * 1.3) * 0.04
      headY = Math.sin(this.t * 0.4 + this.phase) * 0.25
    } else if (mode === 'talk') {
      bob = Math.sin(this.t * 1.8) * 0.006
      const g = Math.sin(this.t * 3.2 + this.phase)
      ar = -0.9 + g * 0.5
      al = Math.sin(this.t * 2.1) * 0.3
      armZ = 0.1
      headX = Math.sin(this.t * 4 + this.phase) * 0.08
      headY = Math.sin(this.t * 0.9 + this.phase) * 0.3
    } else if (mode === 'sit') {
      ll = -1.45
      lr = -1.45
      al = -0.3
      ar = -0.3
      sink = 0.42
    } else if (mode === 'ride') {
      ll = -1.0
      lr = -1.0
      al = -1.15
      ar = -1.15
      sink = 0.32
      lean = 0.12
    } else if (mode === 'jump') {
      ll = -0.5
      lr = 0.25
      al = -2.4
      ar = -2.4
      armZ = 0.2
    } else if (mode === 'work') {
      lean = 0.9 + Math.sin(this.t * 2.2 + this.phase) * 0.1
      al = -1.2
      ar = -1.3
      bob = -0.1
    } else if (mode === 'wave') {
      ar = -2.7 + Math.sin(this.t * 9) * 0.4
      al = 0.05
    } else if (mode === 'drink') {
      ar = -2.0
      al = 0.05
    }
    if (holding) ar = Math.min(ar, -0.3) * 0.5 - 0.35
    const k = 1 - Math.exp(-18 * dt)
    const s = this
    const st = (g: THREE.Object3D, p: 'x' | 'y' | 'z', v: number) => (g.rotation[p] += (v - g.rotation[p]) * k)
    st(this.legL, 'x', ll)
    st(this.legR, 'x', lr)
    st(this.armL, 'x', al)
    st(this.armR, 'x', ar)
    st(this.armL, 'z', -armZ - 0.05)
    st(this.armR, 'z', armZ + 0.05)
    st(this.torso, 'x', lean)
    st(this.head, 'y', headY)
    st(this.head, 'x', headX - lean * 0.6)
    // falling
    if (mode === 'down') this.fall = Math.min(1, this.fall + dt * 3.5)
    else this.fall = Math.max(0, this.fall - dt * 2)
    body.rotation.x = -this.fall * 1.5
    body.position.y = bob - sink + this.fall * 0.12
    body.position.z = -this.fall * 0.5
    if (this.skirt) {
      this.skirt.rotation.x = (mode === 'sit' || mode === 'ride') ? -0.5 : 0
      this.skirt.position.y = 0.52 - sink * 0.6
    }
    void s
    void lerp
    void damp
    void extra
  }
}
