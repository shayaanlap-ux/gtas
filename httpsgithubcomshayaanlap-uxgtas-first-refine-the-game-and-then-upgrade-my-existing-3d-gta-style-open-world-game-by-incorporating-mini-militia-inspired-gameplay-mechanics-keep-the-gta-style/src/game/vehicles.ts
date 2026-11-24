// @ts-nocheck
// Vehicle models + arcade-sim physics (grip, inertia, suspension, body roll, collisions)
import * as THREE from 'three'
import { clamp, lerp, damp, mulberry32, angDiff } from './util'
import { std } from './materials'
import { plateTexture, cv, toTex, KFONT, conePulseTexture } from './textures'
import { groundAt, pushOut, hit, roadEdgeDist, terrainH, WATER_Y } from './world'

export type VKind = 'car' | 'moto' | 'scooter' | 'auto' | 'bus'
export interface Spec {
  kind: VKind; label: string
  acc: number; vmax: number; brake: number; steerMax: number; v0: number; grip: number; yawK: number; mass: number
  L: number; Wd: number; wb: number; wheelR: number
  rollK: number; pitchK: number; lean: boolean; gears: number
  cam: { d: number; h: number }; fp: [number, number, number]; seat: [number, number, number] | null
}
const SPECS: Record<string, Spec> = {
  hatch: { kind: 'car', label: 'Hatchback', acc: 5.0, vmax: 38, brake: 10, steerMax: 0.62, v0: 16, grip: 1.05, yawK: 9, mass: 1000, L: 3.8, Wd: 1.7, wb: 2.4, wheelR: 0.3, rollK: 0.04, pitchK: 0.03, lean: false, gears: 5, cam: { d: 6.4, h: 2.5 }, fp: [-0.36, 1.15, 0.1], seat: null },
  sedan: { kind: 'car', label: 'Sedan', acc: 5.4, vmax: 42, brake: 10, steerMax: 0.58, v0: 17, grip: 1.05, yawK: 8.5, mass: 1250, L: 4.5, Wd: 1.78, wb: 2.65, wheelR: 0.32, rollK: 0.04, pitchK: 0.03, lean: false, gears: 5, cam: { d: 7, h: 2.6 }, fp: [-0.38, 1.2, 0.15], seat: null },
  suv: { kind: 'car', label: 'SUV', acc: 5.0, vmax: 40, brake: 9.5, steerMax: 0.55, v0: 16, grip: 1.0, yawK: 7.5, mass: 1700, L: 4.4, Wd: 1.85, wb: 2.7, wheelR: 0.37, rollK: 0.06, pitchK: 0.035, lean: false, gears: 6, cam: { d: 7.4, h: 3 }, fp: [-0.4, 1.4, 0.2], seat: null },
  coupe: { kind: 'car', label: 'Sports coupe', acc: 8.2, vmax: 62, brake: 12, steerMax: 0.5, v0: 22, grip: 1.2, yawK: 10, mass: 1400, L: 4.5, Wd: 1.9, wb: 2.7, wheelR: 0.34, rollK: 0.03, pitchK: 0.03, lean: false, gears: 6, cam: { d: 7, h: 2.3 }, fp: [-0.4, 1.0, 0.1], seat: null },
  moto: { kind: 'moto', label: 'Motorcycle', acc: 6.4, vmax: 44, brake: 8.5, steerMax: 0.62, v0: 14, grip: 0.95, yawK: 11, mass: 190, L: 2.0, Wd: 0.75, wb: 1.35, wheelR: 0.33, rollK: 0, pitchK: 0.05, lean: true, gears: 5, cam: { d: 4.6, h: 2.0 }, fp: [0, 1.5, -0.05], seat: [0, 0.82, -0.25] },
  scooter: { kind: 'scooter', label: 'Scooter', acc: 3.4, vmax: 23, brake: 6.5, steerMax: 0.7, v0: 10, grip: 0.85, yawK: 10, mass: 110, L: 1.8, Wd: 0.7, wb: 1.2, wheelR: 0.22, rollK: 0, pitchK: 0.05, lean: true, gears: 1, cam: { d: 4.4, h: 1.9 }, fp: [0, 1.4, -0.2], seat: [0, 0.7, -0.2] },
  auto: { kind: 'auto', label: 'Auto-rickshaw', acc: 2.5, vmax: 17, brake: 7, steerMax: 0.55, v0: 9, grip: 0.85, yawK: 6.5, mass: 450, L: 2.7, Wd: 1.4, wb: 2.0, wheelR: 0.24, rollK: 0.1, pitchK: 0.05, lean: false, gears: 3, cam: { d: 5.4, h: 2.4 }, fp: [0, 1.35, 0.3], seat: [0, 0.98, 0.3] },
  bus: { kind: 'bus', label: 'KSRTC bus', acc: 2.1, vmax: 25, brake: 7, steerMax: 0.42, v0: 12, grip: 0.95, yawK: 3.6, mass: 9000, L: 10.4, Wd: 2.5, wb: 5.8, wheelR: 0.5, rollK: 0.07, pitchK: 0.04, lean: false, gears: 5, cam: { d: 13, h: 4.6 }, fp: [-0.75, 2.35, 3.9], seat: null },
}
export const VARIANTS = Object.keys(SPECS)

const BOX = new THREE.BoxGeometry(1, 1, 1)
const CYL = new THREE.CylinderGeometry(1, 1, 1, 16)
const SPH = new THREE.SphereGeometry(1, 12, 8)
const PLANE = new THREE.PlaneGeometry(1, 1)
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 })
const hubMat = new THREE.MeshStandardMaterial({ color: 0x9a9fa6, roughness: 0.35, metalness: 0.8 })
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1a24, roughness: 0.06, metalness: 0.9 })
const blackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.7 })
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.2, metalness: 1 })

function mk(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.scale.set(sx, sy, sz)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}
function wheel(parent: THREE.Object3D, r: number, w: number, x: number, y: number, z: number, steer: boolean) {
  const st = new THREE.Group()
  st.position.set(x, y, z)
  const sp = new THREE.Group()
  st.add(sp)
  mk(sp, CYL, tyreMat, r, w, r, 0, 0, 0, 0, 0, Math.PI / 2)
  mk(sp, CYL, hubMat, r * 0.55, w * 1.04, r * 0.55, 0, 0, 0, 0, 0, Math.PI / 2)
  // a spoke marker so rotation is visible
  mk(sp, BOX, blackMat, w * 1.08, r * 0.15, r * 1.1, 0, 0, 0)
  parent.add(st)
  return { st, sp, steer, r }
}

function cabinGeo(zStart: number, zFrontBase: number, zFrontTop: number, zRearTop: number, y0: number, y1: number, width: number) {
  // side profile in (-z, y); extruded across width
  const s = new THREE.Shape()
  s.moveTo(-zStart, y0)
  s.lineTo(-zRearTop, y1)
  s.lineTo(-zFrontTop, y1)
  s.lineTo(-zFrontBase, y0)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false })
  g.translate(0, 0, -width / 2)
  g.rotateY(Math.PI / 2)
  return g
}

export interface BuiltVehicle {
  root: THREE.Group; body: THREE.Group
  wheels: ReturnType<typeof wheel>[]
  brakeMat: THREE.MeshStandardMaterial; headMat: THREE.MeshStandardMaterial
  cone: THREE.Mesh | null
  steerParts: THREE.Object3D[]
}
let busTex: any
function busSideTexture() {
  if (busTex) return busTex
  const [c, x] = cv(1040, 300)
  x.fillStyle = '#f2efe6'
  x.fillRect(0, 0, 1040, 300)
  // windows band
  x.fillStyle = '#17252f'
  x.fillRect(0, 28, 1040, 100)
  x.fillStyle = '#f2efe6'
  for (let i = 0; i < 12; i++) x.fillRect(80 + i * 78, 28, 8, 100)
  x.fillStyle = 'rgba(255,255,255,0.12)'
  x.fillRect(0, 28, 1040, 24)
  // red body
  x.fillStyle = '#b3131a'
  x.fillRect(0, 138, 1040, 120)
  x.fillStyle = '#7e0b10'
  x.fillRect(0, 246, 1040, 54)
  x.fillStyle = '#f2efe6'
  x.fillRect(0, 128, 1040, 10)
  x.fillStyle = '#fff'
  x.font = `bold 66px ${KFONT}`
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText('KSRTC', 560, 195)
  x.font = `bold 30px ${KFONT}`
  x.fillText('ಕರ್ನಾಟಕ ರಾಜ್ಯ ರಸ್ತೆ ಸಾರಿಗೆ ನಿಗಮ', 560, 235, 600)
  x.fillStyle = '#222'
  x.fillRect(40, 140, 120, 108) // door panel
  x.fillStyle = '#9fc4d8'
  x.fillRect(48, 148, 50, 92)
  x.fillRect(102, 148, 50, 92)
  busTex = toTex(c)
  return busTex
}
function busFrontTexture() {
  const [c, x] = cv(256, 300)
  x.fillStyle = '#b3131a'
  x.fillRect(0, 0, 256, 300)
  x.fillStyle = '#f2efe6'
  x.fillRect(0, 0, 256, 20)
  x.fillStyle = '#17252f'
  x.fillRect(14, 42, 228, 120)
  x.fillStyle = '#b3131a'
  x.fillRect(124, 42, 8, 120)
  x.fillStyle = '#000'
  x.fillRect(40, 20, 176, 22)
  x.fillStyle = '#ffc94a'
  x.font = 'bold 16px sans-serif'
  x.textAlign = 'center'
  x.fillText('MANGALURU ↔ DHARMASTHALA', 128, 36, 170)
  x.fillStyle = '#f2efe6'
  x.fillRect(0, 214, 256, 10)
  x.fillStyle = '#fff'
  x.font = 'bold 28px sans-serif'
  x.fillText('KSRTC', 128, 262)
  return toTex(c)
}

export function buildVehicleModel(variant: string, color: number, plateText: string): BuiltVehicle {
  const sp = SPECS[variant]
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.35, clearcoat: sp.kind === 'car' ? 0.7 : 0.2, clearcoatRoughness: 0.2 })
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1010, emissiveIntensity: 0.25, roughness: 0.3 })
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff2cc, emissiveIntensity: 0.0, roughness: 0.2 })
  const wheels: ReturnType<typeof wheel>[] = []
  const steerParts: THREE.Object3D[] = []
  let cone: THREE.Mesh | null = null
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture(plateText), roughness: 0.5 })

  if (sp.kind === 'car') {
    const { L, Wd, wb, wheelR: r } = sp
    const coupe = variant === 'coupe', suv = variant === 'suv', sedan = variant === 'sedan'
    const bodyH = coupe ? 0.5 : 0.62
    const y0 = r * 0.85
    mk(body, BOX, paint, Wd, bodyH, L, 0, y0 + bodyH / 2, 0)
    // hood/trunk shaping
    mk(body, BOX, paint, Wd * 0.96, 0.12, L * 0.3, 0, y0 + bodyH + 0.04, L * 0.33, -0.08)
    mk(body, BOX, paint, Wd * 0.96, 0.12, L * (sedan ? 0.2 : 0.12), 0, y0 + bodyH + 0.04, -L * (sedan ? 0.38 : 0.4), 0.06)
    const top = y0 + bodyH
    const ch = coupe ? 0.42 : suv ? 0.78 : 0.62
    const zs = sedan ? -0.3 : 0.0
    const cab = cabinGeo(L * (suv ? -0.45 : -0.32), L * 0.12 + zs, L * (coupe ? 0.0 : 0.0) + zs, L * (suv ? -0.4 : sedan ? -0.2 : -0.3), top, top + ch, Wd * 0.9)
    const cabM = new THREE.Mesh(cab, glassMat)
    cabM.position.y = 0
    cabM.castShadow = true
    body.add(cabM)
    // roof plate
    const roofZ0 = -L * (suv ? -0.0 : 0.0)
    mk(body, BOX, paint, Wd * 0.88, 0.05, L * (suv ? 0.4 : 0.3) * (sedan ? 0.8 : 1), 0, top + ch + 0.02, (suv ? -0.45 : sedan ? -0.35 : -0.15) + roofZ0)
    // pillars
    for (const sd of [-1, 1]) mk(body, BOX, paint, 0.06, ch, 0.1, sd * Wd * 0.44, top + ch / 2, suv ? -0.5 : -0.1, 0, 0, 0)
    // bumpers
    mk(body, BOX, blackMat, Wd * 1.01, 0.22, 0.2, 0, y0 + 0.14, L / 2 - 0.05)
    mk(body, BOX, blackMat, Wd * 1.01, 0.22, 0.2, 0, y0 + 0.14, -L / 2 + 0.05)
    // lights
    for (const sd of [-1, 1]) {
      mk(body, BOX, headMat, 0.36, 0.13, 0.06, sd * Wd * 0.34, y0 + bodyH * 0.72, L / 2 + 0.01)
      mk(body, BOX, brakeMat, 0.34, 0.12, 0.06, sd * Wd * 0.36, y0 + bodyH * 0.78, -L / 2 - 0.01)
      mk(body, BOX, paint, 0.08, 0.1, 0.16, sd * (Wd / 2 + 0.07), top + 0.2, 0.55)
    }
    mk(body, PLANE, plate, 0.5, 0.12, 1, 0, y0 + 0.25, L / 2 + 0.012)
    const pr = mk(body, PLANE, plate, 0.5, 0.12, 1, 0, y0 + 0.25, -L / 2 - 0.012, 0, Math.PI, 0)
    void pr
    const wy = r
    for (const sd of [-1, 1]) {
      wheels.push(wheel(body, r, 0.24, sd * (Wd / 2 - 0.1), wy, wb / 2, true))
      wheels.push(wheel(body, r, 0.24, sd * (Wd / 2 - 0.1), wy, -wb / 2, false))
    }
    // headlight cone decal (for AI/parked at night)
    cone = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 11).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: conePulseTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }))
    cone.rotation.y = Math.PI
    cone.position.set(0, 0.1, L / 2 + 5.5)
    cone.scale.set(1, 1, -1)
    body.add(cone)
  } else if (sp.kind === 'moto' || sp.kind === 'scooter') {
    const isM = sp.kind === 'moto'
    const r = sp.wheelR
    const front = new THREE.Group()
    front.position.set(0, 0, sp.wb / 2)
    body.add(front)
    const fw = wheel(front, r, isM ? 0.13 : 0.1, 0, r, 0, false)
    wheels.push(fw)
    wheels.push(wheel(body, r, isM ? 0.16 : 0.11, 0, r, -sp.wb / 2, false))
    steerParts.push(front)
    if (isM) {
      mk(front, BOX, chromeMat, 0.05, 0.75, 0.05, 0.09, 0.7, -0.04, -0.3)
      mk(front, BOX, chromeMat, 0.05, 0.75, 0.05, -0.09, 0.7, -0.04, -0.3)
      mk(front, BOX, blackMat, 0.76, 0.04, 0.05, 0, 1.05, -0.16)
      mk(front, SPH, headMat, 0.12, 0.12, 0.1, 0, 0.98, 0.05)
      mk(body, BOX, paint, 0.3, 0.28, 0.55, 0, 0.9, 0.15)
      mk(body, BOX, blackMat, 0.28, 0.1, 0.75, 0, 0.84, -0.38)
      mk(body, BOX, blackMat, 0.32, 0.38, 0.55, 0, 0.5, 0.0)
      mk(body, BOX, chromeMat, 0.1, 0.1, 0.5, 0.22, 0.36, -0.3)
      mk(body, BOX, paint, 0.2, 0.06, 0.45, 0, 0.82, -0.85, 0.2)
      mk(body, BOX, brakeMat, 0.14, 0.06, 0.05, 0, 0.88, -1.0)
    } else {
      mk(front, BOX, paint, 0.38, 0.6, 0.1, 0, 0.6, -0.12, -0.25)
      mk(front, BOX, blackMat, 0.62, 0.04, 0.05, 0, 1.15, -0.28)
      mk(front, BOX, blackMat, 0.05, 0.6, 0.05, 0, 0.85, -0.2)
      mk(front, SPH, headMat, 0.1, 0.1, 0.07, 0, 1.08, -0.12)
      mk(body, BOX, blackMat, 0.38, 0.06, 0.62, 0, 0.26, 0.15)
      mk(body, BOX, paint, 0.4, 0.42, 0.78, 0, 0.55, -0.45)
      mk(body, BOX, blackMat, 0.3, 0.09, 0.55, 0, 0.8, -0.38)
      mk(body, BOX, brakeMat, 0.16, 0.06, 0.05, 0, 0.62, -0.86)
    }
    mk(body, PLANE, plate, 0.28, 0.07, 1, 0, 0.55, -sp.L / 2 + 0.05, 0, Math.PI, 0)
  } else if (sp.kind === 'auto') {
    const r = sp.wheelR
    const front = new THREE.Group()
    front.position.set(0, 0, 1.15)
    body.add(front)
    wheels.push(wheel(front, r, 0.12, 0, r, 0, false))
    steerParts.push(front)
    wheels.push(wheel(body, r, 0.13, 0.6, r, -0.55, false))
    wheels.push(wheel(body, r, 0.13, -0.6, r, -0.55, false))
    const yel = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 })
    const blk = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })
    mk(body, BOX, blk, 1.3, 0.45, 1.35, 0, 0.5, -0.3)
    mk(body, BOX, paint, 1.34, 0.12, 1.4, 0, 0.78, -0.3)
    mk(front, BOX, paint, 0.74, 0.62, 0.55, 0, 0.62, 0.0)
    mk(front, BOX, blk, 0.6, 0.12, 0.3, 0, 0.3, 0.1)
    mk(front, SPH, headMat, 0.12, 0.1, 0.06, 0, 0.9, 0.27)
    mk(body, BOX, blk, 0.9, 0.16, 0.5, 0, 0.82, 0.3)
    // canopy
    mk(body, BOX, yel, 1.45, 0.06, 2.1, 0, 1.78, -0.15, 0.04)
    mk(body, BOX, yel, 1.45, 0.05, 0.5, 0, 1.72, 0.95, 0.35)
    for (const sx of [-0.68, 0.68]) {
      mk(body, BOX, blk, 0.05, 1.0, 0.05, sx, 1.28, 0.7)
      mk(body, BOX, blk, 0.05, 1.0, 0.05, sx, 1.28, -1.0)
    }
    mk(body, BOX, glassMat, 1.2, 0.5, 0.04, 0, 1.45, 0.78, -0.25)
    // rear seat + driver seat
    mk(body, BOX, blk, 1.05, 0.14, 0.45, 0, 0.9, -0.5)
    mk(body, BOX, blk, 1.05, 0.5, 0.1, 0, 1.15, -0.95)
    mk(body, BOX, brakeMat, 0.5, 0.08, 0.05, 0, 0.9, -1.0)
    mk(body, PLANE, plate, 0.3, 0.1, 1, 0, 0.55, -1.0, 0, Math.PI, 0)
    mk(front, BOX, blk, 0.7, 0.04, 0.05, 0, 1.1, -0.1)
    cone = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: conePulseTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    cone.position.set(0, 0.1, sp.L / 2 + 4.5)
    cone.scale.set(1, 1, -1)
    body.add(cone)
  } else {
    // bus
    const { L, Wd, wheelR: r } = sp
    const H = 3.0
    const sideM = new THREE.MeshStandardMaterial({ map: busSideTexture(), roughness: 0.55 })
    const frontM = new THREE.MeshStandardMaterial({ map: busFrontTexture(), roughness: 0.55 })
    const rearM = new THREE.MeshStandardMaterial({ color: 0xb3131a, roughness: 0.6 })
    const roofM = new THREE.MeshStandardMaterial({ color: 0xeeeae0, roughness: 0.7 })
    const botM = blackMat
    // BoxGeometry face order: +x,-x,+y,-y,+z,-z
    const mesh = new THREE.Mesh(BOX, [sideM, sideM, roofM, botM, frontM, rearM])
    mesh.scale.set(Wd, H, L)
    mesh.position.set(0, 0.75 + H / 2, 0)
    mesh.castShadow = true
    mesh.receiveShadow = true
    body.add(mesh)
    for (const sd of [-1, 1]) {
      mk(body, BOX, headMat, 0.4, 0.2, 0.06, sd * 0.85, 1.0, L / 2 + 0.02)
      mk(body, BOX, brakeMat, 0.3, 0.3, 0.06, sd * 0.95, 1.4, -L / 2 - 0.02)
      mk(body, BOX, blackMat, 0.1, 0.5, 0.3, sd * (Wd / 2 + 0.05), 2.7, L / 2 - 0.9)
      wheels.push(wheel(body, r, 0.3, sd * (Wd / 2 - 0.2), r, 3.3, true))
      wheels.push(wheel(body, r, 0.3, sd * (Wd / 2 - 0.2), r, -2.5, false))
      wheels.push(wheel(body, r, 0.3, sd * (Wd / 2 - 0.2 - 0.55), r, -2.5, false))
    }
    mk(body, BOX, blackMat, Wd * 1.0, 0.3, 0.3, 0, 0.5, L / 2)
    mk(body, BOX, blackMat, Wd * 1.0, 0.3, 0.3, 0, 0.5, -L / 2)
    mk(body, PLANE, plate, 0.5, 0.14, 1, 0, 0.62, -L / 2 - 0.15, 0, Math.PI, 0)
    mk(body, PLANE, plate, 0.5, 0.14, 1, 0, 0.62, L / 2 + 0.17)
    cone = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: conePulseTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    cone.position.set(0, 0.1, L / 2 + 6)
    cone.scale.set(1, 1, -1)
    body.add(cone)
  }
  root.userData.own = [paint, brakeMat, headMat, plate]
  return { root, body, wheels, brakeMat, headMat, cone, steerParts }
}

export const CAR_COLORS = [0xf2f2f0, 0xc9ccd1, 0x1d1f23, 0xb02a2a, 0x2f5fa3, 0x7a8b99, 0xe6e0d0, 0x2f6b4f]
export const SCOOTER_COLORS = [0xd62828, 0xf2f2f0, 0x2b6cb0, 0x111111, 0xffb703, 0x2a9d8f]

export interface Input { throttle: number; brake: number; steer: number; hand: number }

let vid = 0
export class Vehicle {
  id = vid++
  spec: Spec
  variant: string
  built: BuiltVehicle
  x = 0; y = 0; z = 0
  h = 0
  vx = 0; vz = 0; vy = 0
  yawRate = 0
  steer = 0
  roll = 0; rollV = 0; pitch = 0; pitchV = 0; bounce = 0; bounceV = 0
  throttle = 0; brake = 0; hand = 0
  driver: 'none' | 'player' | 'ai' = 'none'
  lightsOn = false
  horn = false
  air = false
  rpm = 0.15
  gear = 1
  slip = 0
  speedKmh = 0
  vf = 0
  latAcc = 0
  longAcc = 0
  color: number
  plate: string
  asleep = true
  radius: number
  offs: number[]
  mass: number
  onRoadCached = true
  roadT = 0
  ai: any = null
  ghost = 0
  wetGrip = 1
  crashCb: ((p: number) => void) | null = null
  private prevVf = 0
  private wheelSpin = 0
  private gy = 0
  seatPos: THREE.Vector3 | null = null
  inWater = false

  constructor(variant: string, color: number, seed = 1) {
    this.variant = variant
    this.spec = SPECS[variant]
    this.color = color
    const rng = mulberry32(seed * 977 + vid)
    this.plate = `KA ${rng() < 0.7 ? '19' : '21'} ${['M', 'N', 'P', 'Q', 'A', 'B', 'E'][Math.floor(rng() * 7)]}${['A', 'B', 'C', 'D', 'E', 'H'][Math.floor(rng() * 6)]} ${1000 + Math.floor(rng() * 8999)}`
    if (variant === 'coupe') this.plate = 'KA 19 MF 5742'
    this.built = buildVehicleModel(variant, color, this.plate)
    const s = this.spec
    this.radius = (s.Wd / 2) * 0.95
    const n = Math.max(2, Math.round(s.L / (this.radius * 2)))
    this.offs = []
    for (let i = 0; i < n; i++) this.offs.push(lerp(-(s.L / 2 - this.radius), s.L / 2 - this.radius, n === 1 ? 0.5 : i / (n - 1)))
    this.mass = s.mass
    if (s.seat) this.seatPos = new THREE.Vector3(...s.seat)
  }
  get root() {
    return this.built.root
  }
  place(x: number, z: number, h: number, y?: number) {
    this.x = x
    this.z = z
    this.h = h
    this.y = y ?? groundAt(x, z, 50, 50)
    this.vx = this.vz = this.vy = 0
    this.yawRate = 0
    this.steer = 0
    this.asleep = false
    this.syncVisual(0)
  }
  fwd(): [number, number] {
    return [Math.sin(this.h), Math.cos(this.h)]
  }
  setInput(i: Input) {
    this.throttle = i.throttle
    this.brake = i.brake
    this.hand = i.hand
    this.steerIn = i.steer
  }
  steerIn = 0

  step(dt: number, wet: number, others: Vehicle[]) {
    const s = this.spec
    const sinH = Math.sin(this.h), cosH = Math.cos(this.h)
    const fx = sinH, fz = cosH, lx = cosH, lz = -sinH
    let vf = this.vx * fx + this.vz * fz
    let vl = this.vx * lx + this.vz * lz
    // surface
    this.roadT -= dt
    if (this.roadT <= 0) {
      this.roadT = 0.12
      this.onRoadCached = roadEdgeDist(this.x, this.z) < 0.6 || this.y > 1.5
      this.inWater = terrainH(this.x, this.z) < WATER_Y - 0.2 && this.y < 0.2 && Math.abs(this.y - terrainH(this.x, this.z)) < 0.5
    }
    const mu = s.grip * (this.onRoadCached ? 1 - 0.34 * wet : 0.64 - 0.2 * wet) * (this.inWater ? 0.5 : 1)
    const muG = mu * 9.81
    const occupied = this.driver !== 'none'
    let a = 0
    const thr = occupied ? this.throttle : 0
    const spd = Math.abs(vf)
    if (thr > 0.01) {
      if (vf < -0.4) a += s.brake * 0.9
      else a += thr * s.acc * Math.max(0.0, 1 - Math.pow(Math.max(0, vf) / s.vmax, 2.2))
    } else if (thr < -0.01) {
      if (vf > 0.4) a -= s.brake * 0.5 * -thr
      else a -= -thr * s.acc * 0.55 * Math.max(0, 1 - Math.pow(spd / 8, 2))
    }
    a = clamp(a, -muG * 0.95, muG * 0.95)
    // braking
    let brk = occupied ? this.brake : 0
    if (!occupied) brk = 1
    if (brk > 0.01) {
      const bf = Math.min(s.brake, muG * 0.97) * brk
      const dv = bf * dt
      if (Math.abs(vf) <= dv) vf = 0
      else vf -= Math.sign(vf) * dv
    }
    const hb = occupied ? this.hand : 0
    if (hb > 0.5) {
      const dv = 4.5 * dt
      if (Math.abs(vf) <= dv) vf = 0
      else vf -= Math.sign(vf) * dv
    }
    // drag / rolling resistance / engine braking
    const roll = (this.onRoadCached ? 0.18 : 1.1) + (this.inWater ? 3 : 0)
    const coast = Math.abs(thr) < 0.05 ? 0.55 : 0
    const drag = roll + coast + 0.0012 * vf * vf * (s.kind === 'bus' ? 2 : 1)
    if (Math.abs(vf) > 0.02) {
      const dv = drag * dt
      if (Math.abs(vf) <= dv) vf = 0
      else vf -= Math.sign(vf) * dv
    }
    vf += a * dt
    // lateral grip (tyre force saturates at mu*g, reduced by longitudinal demand & handbrake)
    const demand = Math.min(1, Math.abs(a) / (muG * 0.95 + 1e-6)) * 0.55 + (brk * 0.25)
    const coupling = Math.sqrt(Math.max(0.2, 1 - demand * demand))
    const rearGrip = hb > 0.5 ? 0.32 : 1
    const maxDv = muG * dt * coupling * rearGrip
    const dvl = clamp(-vl, -maxDv, maxDv)
    vl += dvl
    // steering
    const sIn = occupied ? this.steerIn : 0
    const maxS = s.steerMax / (1 + Math.pow(spd / s.v0, 2))
    const target = sIn * maxS
    const rate = Math.abs(sIn) > 0.01 ? (s.kind === 'bus' ? 1.2 : 2.6) : 3.8
    this.steer += clamp(target - this.steer, -rate * dt * (1 + 0.5 * (spd < 3 ? 1 : 0)), rate * dt)
    let ytarget = (vf * Math.tan(this.steer)) / s.wb
    const maxYaw = (muG * (hb > 0.5 ? 1.5 : 0.92)) / Math.max(4, spd)
    if (hb > 0.5) ytarget *= 1.4
    ytarget = clamp(ytarget, -maxYaw, maxYaw)
    this.yawRate += (ytarget - this.yawRate) * Math.min(1, dt * s.yawK)
    if (spd < 0.3) this.yawRate *= 0.5
    this.h += this.yawRate * dt
    this.vx = fx * vf + lx * vl
    this.vz = fz * vf + lz * vl
    this.vf = vf
    const lastX = this.x, lastZ = this.z
    this.x += this.vx * dt
    this.z += this.vz * dt
    this.longAcc = (vf - this.prevVf) / Math.max(dt, 1e-4)
    this.prevVf = vf
    this.latAcc = this.yawRate * vf
    const sp2 = Math.hypot(this.vx, this.vz)
    this.slip = sp2 > 3 ? clamp(Math.abs(vl) / 3.2 + (brk > 0.9 && sp2 > 12 ? 0.35 : 0) + (a > muG * 0.85 ? 0.3 : 0), 0, 1) : 0
    this.speedKmh = sp2 * 3.6
    // gears / rpm (for audio)
    const gs = s.gears
    const fr = clamp(Math.abs(vf) / s.vmax, 0, 1)
    const g = Math.min(gs - 1, Math.floor(fr * gs * 1.05))
    const within = clamp((fr * gs * 1.05 - g), 0, 1)
    const rpmT = gs === 1 ? 0.2 + fr * 0.8 : 0.22 + within * 0.7 + Math.max(0, thr) * 0.08
    this.gear = g + 1
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 8)

    // static collisions
    this.collide(lastX, lastZ)
    // other vehicles
    for (const o of others) if (o !== this) this.collideVehicle(o)

    // ground & suspension
    const wb2 = s.wb / 2, tw = s.Wd / 2
    const yRef = this.y
    const step = 1.0
    const hF = groundAt(this.x + fx * wb2, this.z + fz * wb2, yRef, step)
    const hB = groundAt(this.x - fx * wb2, this.z - fz * wb2, yRef, step)
    const hL = groundAt(this.x + lx * tw, this.z + lz * tw, yRef, step)
    const hR = groundAt(this.x - lx * tw, this.z - lz * tw, yRef, step)
    const gnd = (hF + hB + hL + hR) / 4
    this.gy = gnd
    if (this.air) {
      this.vy -= 9.81 * dt
      this.y += this.vy * dt
      if (this.y <= gnd) {
        this.y = gnd
        this.bounceV -= this.vy * 0.12
        if (this.vy < -4) this.crashCb?.(-this.vy * 0.6)
        this.vy = 0
        this.air = false
      }
    } else {
      const dy = gnd - this.y
      if (dy < -0.22 && sp2 > 7) {
        this.air = true
      } else {
        // ride the surface; vertical speed feeds suspension
        const ny = damp(this.y, gnd, 40, dt)
        this.bounceV += ((ny - this.y) / Math.max(dt, 1e-4)) * -0.01
        this.y = ny
      }
    }
    // suspension springs
    const rollT = s.lean ? clamp(Math.atan2(-this.latAcc, 9.81) * 0.85, -0.75, 0.75) : clamp(this.latAcc * s.rollK, -0.14, 0.14)
    const pitchT = clamp(-this.longAcc * s.pitchK * 0.2, -0.1, 0.1)
    const kk = s.lean ? 40 : 55, cc = s.lean ? 9 : 7
    this.rollV += (-kk * (this.roll - rollT) - cc * this.rollV) * dt
    this.roll += this.rollV * dt
    this.pitchV += (-kk * (this.pitch - pitchT) - cc * this.pitchV) * dt
    this.pitch += this.pitchV * dt
    this.bounceV += (-90 * this.bounce - 9 * this.bounceV) * dt
    this.bounce += this.bounceV * dt
    this.bounce = clamp(this.bounce, -0.12, 0.12)
    this.tiltPitch = -Math.atan2(hF - hB, s.wb)
    this.tiltRoll = Math.atan2(hL - hR, s.Wd)
    this.wheelSpin += (vf * dt) / s.wheelR
    this.syncVisual(dt)
  }
  tiltPitch = 0
  tiltRoll = 0

  collide(lastX: number, lastZ: number) {
    const sinH = Math.sin(this.h), cosH = Math.cos(this.h)
    const tmp = { x: 0, z: 0 }
    let dx = 0, dz = 0
    let worst = 0, nxs = 0, nzs = 0
    for (const o of this.offs) {
      tmp.x = this.x + sinH * o + dx
      tmp.z = this.z + cosH * o + dz
      if (pushOut(tmp, this.radius, this.y)) {
        dx = tmp.x - (this.x + sinH * o)
        dz = tmp.z - (this.z + cosH * o)
        const vn = this.vx * hit.nx + this.vz * hit.nz
        if (vn < 0 && -vn > worst) {
          worst = -vn
          nxs = hit.nx
          nzs = hit.nz
          // torque from off-centre hit
          const lever = o
          this.yawRate += (-lever * 0.05 * vn) * (hit.nx * cosH - hit.nz * sinH) * 0.0 + (lever * -vn * 0.04 * (nxs * cosH - nzs * sinH))
        }
      }
    }
    if (dx || dz) {
      this.x += dx
      this.z += dz
      if (worst > 0) {
        const vn = this.vx * nxs + this.vz * nzs
        const e = 0.18
        this.vx -= (1 + e) * vn * nxs
        this.vz -= (1 + e) * vn * nzs
        this.vx *= 0.985
        this.vz *= 0.985
        this.yawRate *= 0.8
        this.bounceV += worst * 0.3
        if (worst > 2.2) this.crashCb?.(worst)
      }
    }
    void lastX
    void lastZ
  }
  collideVehicle(o: Vehicle) {
    if (o.driver === 'none' && o.asleep && this.driver === 'ai') {
      // still collide with parked ones
    }
    const dd = Math.hypot(o.x - this.x, o.z - this.z)
    const reach = (this.spec.L + o.spec.L) / 2 + 0.5
    if (dd > reach) return
    if (this.ghost > 0 || o.ghost > 0) return
    if (Math.abs(o.y - this.y) > 2.2) return
    const sA = Math.sin(this.h), cA = Math.cos(this.h), sB = Math.sin(o.h), cB = Math.cos(o.h)
    for (const oa of this.offs)
      for (const ob of o.offs) {
        const ax = this.x + sA * oa, az = this.z + cA * oa, bx = o.x + sB * ob, bz = o.z + cB * ob
        let dx = bx - ax, dz = bz - az
        const d = Math.hypot(dx, dz)
        const rr = this.radius + o.radius
        if (d < rr && d > 1e-4) {
          dx /= d
          dz /= d
          const pen = rr - d
          const mA = this.mass, mB = o.mass
          const wA = mB / (mA + mB), wB = mA / (mA + mB)
          this.x -= dx * pen * wA
          this.z -= dz * pen * wA
          o.x += dx * pen * wB
          o.z += dz * pen * wB
          const rvn = (this.vx - o.vx) * dx + (this.vz - o.vz) * dz
          if (rvn > 0) {
            const j = ((1 + 0.25) * rvn) / (1 / mA + 1 / mB)
            this.vx -= (j / mA) * dx
            this.vz -= (j / mA) * dz
            o.vx += (j / mB) * dx
            o.vz += (j / mB) * dz
            o.asleep = false
            if (rvn > 2.5) {
              this.crashCb?.(rvn)
              o.yawRate += (Math.random() - 0.5) * rvn * 0.15
            }
          }
        }
      }
  }

  syncVisual(dt: number) {
    const b = this.built
    b.root.position.set(this.x, this.y, this.z)
    b.root.rotation.y = this.h
    b.body.rotation.set(this.pitch + this.tiltPitch, 0, this.roll + this.tiltRoll, 'ZXY')
    b.body.position.y = this.bounce
    for (const w of b.wheels) {
      w.sp.rotation.x = this.wheelSpin
      if (w.steer) w.st.rotation.y = this.steer
    }
    for (const sp of b.steerParts) sp.rotation.y = this.steer
    void dt
  }
  updateLights(dark: number, brakeOn: boolean) {
    const b = this.built
    const on = this.lightsOn || (this.driver === 'ai' && dark > 0.4)
    b.headMat.emissiveIntensity = on ? 2.2 : 0
    const braking = brakeOn || this.brake > 0.1 || this.hand > 0.5 || (this.throttle < -0.1 && this.vf > 0.5)
    b.brakeMat.emissiveIntensity = braking ? 3 : on ? 0.9 : 0.1
    if (b.cone) b.cone.material.opacity = on && this.driver === 'ai' ? clamp(dark * 0.5, 0, 0.45) : 0
  }
  /** eye position for first-person driving, in world coordinates */
  eyeWorld(out: THREE.Vector3) {
    const f = this.spec.fp
    const v = new THREE.Vector3(f[0], f[1], f[2])
    this.built.body.updateMatrixWorld()
    return out.copy(v).applyMatrix4(this.built.body.matrixWorld)
  }
}
