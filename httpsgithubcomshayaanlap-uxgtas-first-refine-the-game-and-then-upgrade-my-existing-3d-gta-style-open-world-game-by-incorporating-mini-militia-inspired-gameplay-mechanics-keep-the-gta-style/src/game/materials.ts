// @ts-nocheck
import * as THREE from 'three'
import { facadeTextures, roofTileTexture, groundTexture, asphaltTexture, frondTexture, trunkTexture, barkTexture, shopfrontTexture, paddyTexture } from './textures'

export const wind = { uTime: { value: 0 }, uWind: { value: 0.4 } }

interface WetEntry { mat: THREE.MeshStandardMaterial; dryR: number; wetR: number; wetDark: number }
export const MATS = {
  wet: [] as WetEntry[],
  night: [] as { mat: THREE.MeshStandardMaterial; max: number }[],
  facades: new Map<string, THREE.MeshStandardMaterial>(),
  std: new Map<string, THREE.MeshStandardMaterial>(),
  envMats: [] as THREE.Material[],
  puddle: null as any,
  water: null as any,
}

export function std(hex: number | string, rough = 0.85, metal = 0, extra: any = {}) {
  const key = String(hex) + '|' + rough + '|' + metal + JSON.stringify(extra)
  let m = MATS.std.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex as any, roughness: rough, metalness: metal, ...extra })
    MATS.std.set(key, m)
  }
  return m
}
export function addWet(mat: THREE.MeshStandardMaterial, dryR: number, wetR: number, wetDark: number) {
  MATS.wet.push({ mat, dryR, wetR, wetDark })
  MATS.envMats.push(mat)
}
export function emissiveMat(hex: number, max = 2) {
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: hex, emissiveIntensity: 0, roughness: 0.4 })
  MATS.night.push({ mat: m, max })
  return m
}

let _fac: any
export function facadeMat(color: number) {
  const k = 'f' + color
  let m = MATS.facades.get(k)
  if (!m) {
    _fac = _fac || facadeTextures()
    m = new THREE.MeshStandardMaterial({ map: _fac.map, emissiveMap: _fac.emissive, emissive: 0xffffff, emissiveIntensity: 0, color, roughness: 0.9 })
    MATS.facades.set(k, m)
    MATS.night.push({ mat: m, max: 1.6 })
    addWet(m, 0.9, 0.6, 0.8)
  }
  return m
}

const shopMats: THREE.MeshStandardMaterial[] = []
export function shopfrontMat(i: number) {
  const k = i % 4
  if (!shopMats[k]) {
    const t = shopfrontTexture(k + 1)
    const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.7 })
    MATS.night.push({ mat: m, max: 1.1 })
    m.userData.base = 0.15
    shopMats[k] = m
  }
  return shopMats[k]
}

export function swayMaterial(m: THREE.Material, amp = 0.35, heightFactor = true) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime
    sh.uniforms.uWind = wind.uWind
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.21 + instanceMatrix[3].z * 0.17;
        #else
          float ph = 0.0;
        #endif
        float sw = sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.4;
        float gust = (0.25 + uWind * 1.4);
        transformed.x += sw * ${amp.toFixed(2)} * gust * ${heightFactor ? 'clamp(length(position.xz) * 0.25, 0.1, 1.5)' : '1.0'};
        transformed.z += sw * ${(amp * 0.6).toFixed(2)} * gust * ${heightFactor ? 'clamp(length(position.xz) * 0.25, 0.1, 1.5)' : '1.0'};`
      )
  }
  return m
}

let built = false
export const T: any = {}
export function buildSharedMaterials() {
  if (built) return
  built = true
  // terrain
  T.terrain = new THREE.MeshStandardMaterial({ map: groundTexture(), vertexColors: true, roughness: 0.96 })
  addWet(T.terrain, 0.96, 0.7, 0.72)
  // roads
  const road = (kind: string, layer: number) => {
    const m = new THREE.MeshStandardMaterial({ map: asphaltTexture(kind), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 2 })
    addWet(m, 0.9, 0.22, 0.55)
    return m
  }
  T.roadMain = road('main', 4)
  T.roadMarket = road('main', 3)
  T.roadLane = road('lane', 1)
  T.roadHwL = road('hwL', 5)
  T.roadHw = road('hw', 5)
  T.roadConn = road('main', 6)
  T.roadMarket.polygonOffsetFactor = -3
  // facades & misc
  T.roof = new THREE.MeshStandardMaterial({ map: roofTileTexture(), roughness: 0.85 })
  addWet(T.roof, 0.85, 0.45, 0.7)
  T.concrete = std(0xa8a49c, 0.95)
  T.concreteDark = std(0x7d7a74, 0.95)
  T.whitewash = std(0xefe9dc, 0.95)
  T.sidewalk = std(0x9a958c, 0.95)
  addWet(T.sidewalk, 0.95, 0.5, 0.75)
  T.tank = std(0x151515, 0.5)
  T.wood = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 })
  T.metal = std(0x555a5e, 0.5, 0.6)
  T.pole = std(0x8c8c88, 0.9)
  T.lamp = emissiveMat(0xffe2a8, 3)
  T.shrub = std(0x3c6e2a, 0.95)
  T.grass = std(0x4f8a2e, 1)
  T.curb = std(0xbdb7a8, 0.9)
  // vegetation
  T.frond = swayMaterial(new THREE.MeshStandardMaterial({ map: frondTexture(false), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xffffff }), 0.5)
  T.bananaLeaf = swayMaterial(new THREE.MeshStandardMaterial({ map: frondTexture(true), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }), 0.35)
  T.palmTrunk = new THREE.MeshStandardMaterial({ map: trunkTexture(false), roughness: 0.95 })
  T.arecaTrunk = new THREE.MeshStandardMaterial({ map: trunkTexture(true), roughness: 0.9 })
  T.leaves = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: false }), 0.18, true)
  T.forest = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), 0.1, true)
  // paddy
  T.paddy = new THREE.MeshStandardMaterial({ map: paddyTexture(), roughness: 0.55, color: 0xffffff })
  addWet(T.paddy, 0.7, 0.2, 0.8)
  // water + puddles
  T.water = new THREE.MeshStandardMaterial({ color: 0x4d6a58, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82 })
  MATS.envMats.push(T.water)
  MATS.water = T.water
  T.puddle = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -20, depthWrite: false })
  MATS.envMats.push(T.puddle)
  MATS.puddle = T.puddle
  T.glass = new THREE.MeshStandardMaterial({ color: 0x0f1a22, roughness: 0.05, metalness: 0.8 })
  MATS.envMats.push(T.glass)
}
