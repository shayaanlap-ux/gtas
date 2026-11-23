// @ts-nocheck
// Day/night cycle, weather, lighting, fog, rain, lightning, clouds, birds, lamp glows.
import * as THREE from 'three'
import { clamp, lerp, smoothstep, mulberry32, noise2 } from './util'
import { MATS, wind } from './materials'
import { cloudTexture, glowTexture } from './textures'
import { W } from './world'

export const WEATHER = {
  clear: { cloud: 0.08, rain: 0, label: 'Sunny' },
  cloudy: { cloud: 0.55, rain: 0, label: 'Partly cloudy' },
  overcast: { cloud: 0.92, rain: 0, label: 'Overcast' },
  drizzle: { cloud: 0.92, rain: 0.3, label: 'Monsoon drizzle' },
  rain: { cloud: 0.98, rain: 0.7, label: 'Monsoon rain' },
  storm: { cloud: 1, rain: 1, label: 'Thunderstorm' },
}
export type WeatherName = keyof typeof WEATHER

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; }`
const SKY_FS = `
varying vec3 vDir;
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uMoonDir;
uniform float uStars; uniform float uSunVis; uniform float uFlash; uniform float uCloud;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = pow(clamp(h,0.0,1.0), 0.5);
  vec3 col = mix(uHor, uZen, t);
  col = mix(col, uHor*0.75, smoothstep(0.0,-0.3,h));
  float sd = max(dot(d,uSunDir),0.0);
  float vis = uSunVis*(1.0-uCloud*0.85);
  col += uSunCol*(pow(sd,5.0)*0.22 + pow(sd,48.0)*0.55)*uSunVis*(1.0-uCloud*0.6);
  col += uSunCol*smoothstep(0.99955,0.99985,sd)*9.0*vis;
  float md = max(dot(d,uMoonDir),0.0);
  col += vec3(0.85,0.9,1.0)*smoothstep(0.9994,0.9997,md)*uStars*1.2*(1.0-uCloud*0.9);
  vec3 sp = floor(d*240.0);
  float r = hash(sp);
  col += vec3(1.0,0.95,0.9)*step(0.9962,r)*uStars*smoothstep(0.03,0.35,h)*(0.4+0.6*hash(sp+7.0))*(1.0-uCloud);
  col += uFlash*vec3(0.62,0.68,0.9)*(0.4+0.6*smoothstep(-0.2,0.8,h));
  gl_FragColor = vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const RAIN_VS = `
attribute float aEnd; attribute float aRnd;
uniform float uTime; uniform vec3 uCam; uniform float uInt; uniform vec2 uWindv;
varying float vA;
void main(){
  vec3 size = vec3(46.0,28.0,46.0);
  float speed = 15.0 + aRnd*7.0;
  vec3 p = position;
  p.y -= uTime*speed;
  p.x += uWindv.x*uTime*3.0*0.0;
  vec3 w = mod(p - uCam + size*0.5, size) - size*0.5 + uCam;
  vec3 dir = normalize(vec3(uWindv.x*0.35, 1.0, uWindv.y*0.35));
  vec3 pos = w + dir*aEnd*(0.5+aRnd*0.5);
  vA = step(aRnd, uInt) * (0.22 + 0.3*aRnd);
  gl_Position = projectionMatrix*viewMatrix*vec4(pos,1.0);
}`
const RAIN_FS = `varying float vA; uniform vec3 uCol; void main(){ if(vA<0.01) discard; gl_FragColor = vec4(uCol, vA); }`

export class Atmosphere {
  hour = 17.4
  wet = 0.55
  cloud = 0.6
  rain = 0.0
  targetCloud = 0.6
  targetRain = 0
  weatherName: WeatherName = 'cloudy'
  auto = true
  monsoon = true
  dayMinutes = 24
  night = 0
  sunDir = new THREE.Vector3(1, 0.5, 0)
  flash = 0
  onThunder: ((delay: number, power: number) => void) | null = null
  weatherTimer = 90
  lightningTimer = 8
  flashQueue: number[] = []
  inside = false
  windVal = 0.3
  private sky: THREE.Mesh
  private skyMat: THREE.ShaderMaterial
  private sun: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private clouds: THREE.Sprite[] = []
  private rainMesh: THREE.LineSegments
  private rainMat: THREE.ShaderMaterial
  private pmrem: THREE.PMREMGenerator
  private envRT: THREE.WebGLRenderTarget | null = null
  private envSig = ''
  private envT = 0
  private skyScene = new THREE.Scene()
  private pointLights: THREE.PointLight[] = []
  private glow: THREE.Points[] = []
  private glowMats: THREE.PointsMaterial[] = []
  private plTimer = 0
  private matTimer = 0
  private birdsL: THREE.InstancedMesh
  private birdsR: THREE.InstancedMesh
  private birdState: { a: number; r: number; h: number; sp: number; ph: number; cx: number; cz: number }[] = []
  private beaconIdx = -1
  private fog: THREE.FogExp2
  private tmp = new THREE.Object3D()
  private t = 0
  private rng = mulberry32(99)

  constructor(public scene: THREE.Scene, public renderer: THREE.WebGLRenderer) {
    this.fog = new THREE.FogExp2(0x9fb4c8, 0.0013)
    scene.fog = this.fog
    // sky
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
        uMoonDir: { value: new THREE.Vector3() }, uStars: { value: 0 }, uSunVis: { value: 1 }, uFlash: { value: 0 }, uCloud: { value: 0 },
      },
    })
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 20), this.skyMat)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -10
    scene.add(this.sky)
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 16), this.skyMat)
    this.skyScene.add(envSky)
    this.pmrem = new THREE.PMREMGenerator(renderer)

    this.sun = new THREE.DirectionalLight(0xffffff, 3)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 600
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.06
    scene.add(this.sun, this.sun.target)
    this.hemi = new THREE.HemisphereLight(0xaaccff, 0x554433, 0.6)
    scene.add(this.hemi)

    // clouds
    const ct = cloudTexture()
    for (let i = 0; i < 44; i++) {
      const m = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.8 })
      const s = new THREE.Sprite(m)
      const a = this.rng() * Math.PI * 2
      const r = 450 + this.rng() * 900
      s.userData = { a, r, h: 130 + this.rng() * 260, sc: 380 + this.rng() * 520, sp: 0.0003 + this.rng() * 0.0004, k: this.rng() }
      s.scale.set(s.userData.sc, s.userData.sc * 0.38, 1)
      s.renderOrder = -5
      scene.add(s)
      this.clouds.push(s)
    }
    // rain
    const N = 7000
    const pos = new Float32Array(N * 6), aEnd = new Float32Array(N * 2), aRnd = new Float32Array(N * 2)
    for (let i = 0; i < N; i++) {
      const x = this.rng() * 46, y = this.rng() * 28, z = this.rng() * 46, r = this.rng()
      pos.set([x, y, z, x, y, z], i * 6)
      aEnd[i * 2] = 0
      aEnd[i * 2 + 1] = 1
      aRnd[i * 2] = r
      aRnd[i * 2 + 1] = r
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    rg.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1))
    rg.setAttribute('aRnd', new THREE.BufferAttribute(aRnd, 1))
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uInt: { value: 0 }, uWindv: { value: new THREE.Vector2(0.3, 0.1) }, uCol: { value: new THREE.Color(0.8, 0.86, 0.95) } },
    })
    this.rainMesh = new THREE.LineSegments(rg, this.rainMat)
    this.rainMesh.frustumCulled = false
    this.rainMesh.renderOrder = 10
    scene.add(this.rainMesh)

    // lamp glows
    const gt = glowTexture('255,215,150')
    const mk = (kind: string, size: number) => {
      const list = W.lights.filter((l) => l.kind === kind)
      const g = new THREE.BufferGeometry()
      const p = new Float32Array(list.length * 3), c = new Float32Array(list.length * 3)
      list.forEach((l, i) => {
        p.set([l.x, l.y, l.z], i * 3)
        c.set([l.r, l.g, l.b], i * 3)
      })
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      g.setAttribute('color', new THREE.BufferAttribute(c, 3))
      const m = new THREE.PointsMaterial({ size, map: gt, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true })
      const pts = new THREE.Points(g, m)
      pts.frustumCulled = false
      scene.add(pts)
      this.glow.push(pts)
      this.glowMats.push(m)
    }
    mk('street', 5.5)
    mk('shop', 3.4)
    mk('beacon', 4)
    for (let i = 0; i < 7; i++) {
      const pl = new THREE.PointLight(0xffc27a, 0, 24, 1.6)
      scene.add(pl)
      this.pointLights.push(pl)
    }
    // birds
    const wing = new THREE.BufferGeometry()
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.1, 1.1, 0, 0.35, 0.9, 0, -0.3], 3))
    wing.computeVertexNormals()
    const bm = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide })
    this.birdsR = new THREE.InstancedMesh(wing, bm, 18)
    this.birdsL = new THREE.InstancedMesh(wing, bm, 18)
    this.birdsR.frustumCulled = this.birdsL.frustumCulled = false
    scene.add(this.birdsR, this.birdsL)
    for (let i = 0; i < 18; i++) this.birdState.push({ a: this.rng() * 6.28, r: 70 + this.rng() * 90, h: 35 + this.rng() * 40, sp: 0.05 + this.rng() * 0.05, ph: this.rng() * 6, cx: (this.rng() - 0.5) * 300, cz: (this.rng() - 0.5) * 300 })
  }

  setWeather(n: WeatherName) {
    this.weatherName = n
    this.targetCloud = WEATHER[n].cloud
    this.targetRain = WEATHER[n].rain
  }
  get rainNow() {
    return this.inside ? 0 : this.rain
  }
  get timeLabel() {
    const h = Math.floor(this.hour) % 24
    const m = Math.floor((this.hour % 1) * 60)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  get phase() {
    const h = this.hour
    if (h < 5) return 'Night'
    if (h < 7.5) return 'Sunrise'
    if (h < 11) return 'Morning'
    if (h < 15.5) return 'Afternoon'
    if (h < 17.5) return 'Late afternoon'
    if (h < 19.5) return 'Sunset'
    return 'Night'
  }
  private pickWeather() {
    const w: [WeatherName, number][] = this.monsoon
      ? [['clear', 0.1], ['cloudy', 0.2], ['overcast', 0.2], ['drizzle', 0.22], ['rain', 0.2], ['storm', 0.08]]
      : [['clear', 0.5], ['cloudy', 0.3], ['overcast', 0.12], ['drizzle', 0.05], ['rain', 0.02], ['storm', 0.01]]
    let r = Math.random() * w.reduce((a, b) => a + b[1], 0)
    for (const [n, p] of w) {
      r -= p
      if (r <= 0) return n
    }
    return 'cloudy' as WeatherName
  }

  update(dt: number, cam: THREE.Camera, focus: THREE.Vector3, inside: boolean) {
    this.t += dt
    this.inside = inside
    this.hour = (this.hour + (dt * 24) / (this.dayMinutes * 60)) % 24
    if (this.auto) {
      this.weatherTimer -= dt
      if (this.weatherTimer <= 0) {
        this.setWeather(this.pickWeather())
        this.weatherTimer = 110 + Math.random() * 160
      }
    }
    this.cloud += (this.targetCloud - this.cloud) * Math.min(1, dt * 0.08)
    this.rain += (this.targetRain - this.rain) * Math.min(1, dt * 0.12)
    if (Math.abs(this.rain - this.targetRain) < 0.01) this.rain = this.targetRain
    if (this.rain > 0.08) this.wet = Math.min(1, this.wet + dt * 0.06 * this.rain)
    else this.wet = Math.max(0, this.wet - dt * 0.004)

    // sun
    const a = ((this.hour - 6) / 24) * Math.PI * 2
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.93, 0.3 * Math.sin(a)).normalize()
    const e = this.sunDir.y
    const dayF = smoothstep(-0.07, 0.28, e)
    this.night = 1 - smoothstep(-0.14, 0.04, e)
    const tw = Math.exp(-Math.pow((e - 0.0) / 0.17, 2))
    const cl = this.cloud, rn = this.rain

    const zenDay = new THREE.Color(0.13, 0.33, 0.75), horDay = new THREE.Color(0.66, 0.8, 0.94)
    const zenNight = new THREE.Color(0.006, 0.01, 0.03), horNight = new THREE.Color(0.02, 0.028, 0.06)
    const zen = zenNight.clone().lerp(zenDay, dayF)
    const hor = horNight.clone().lerp(horDay, dayF)
    zen.lerp(new THREE.Color(0.2, 0.22, 0.5), tw * 0.55)
    hor.lerp(new THREE.Color(1.0, 0.46, 0.22), tw * 0.8)
    const bright = lerp(0.05, 1, dayF) + tw * 0.35
    const grayZ = new THREE.Color(0.42, 0.46, 0.52).multiplyScalar(bright * (1 - 0.4 * rn))
    const grayH = new THREE.Color(0.6, 0.63, 0.67).multiplyScalar(bright * (1 - 0.35 * rn))
    // tint overcast sky with sunset glow
    grayH.lerp(new THREE.Color(0.85, 0.5, 0.38).multiplyScalar(bright), tw * 0.45 * (1 - rn * 0.5))
    zen.lerp(grayZ, cl * 0.88)
    hor.lerp(grayH, cl * 0.85)
    const sunCol = new THREE.Color(1, 0.5, 0.25).lerp(new THREE.Color(1, 0.96, 0.9), smoothstep(0.02, 0.5, e))
    const u = this.skyMat.uniforms
    u.uZen.value.copy(zen)
    u.uHor.value.copy(hor)
    u.uSunDir.value.copy(this.sunDir)
    u.uSunCol.value.copy(sunCol)
    u.uMoonDir.value.copy(this.sunDir).negate()
    u.uStars.value = this.night
    u.uSunVis.value = smoothstep(-0.06, 0.02, e)
    u.uCloud.value = cl

    // lightning
    if (this.rain > 0.85 && !this.inside) {
      this.lightningTimer -= dt
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + Math.random() * 14
        this.flashQueue = [1, 0.2, 0.8, 0.1, 0.5]
        this.flashTick = 0
        const dist = 0.4 + Math.random() * 4.5
        this.onThunder?.(dist, 1 - dist / 6)
      }
    } else if (this.rain > 0.85) this.lightningTimer -= dt
    if (this.flashQueue.length) {
      this.flashTick += dt
      if (this.flashTick > 0.07) {
        this.flashTick = 0
        this.flash = this.flashQueue.shift()!
      }
    } else this.flash = Math.max(0, this.flash - dt * 6)
    u.uFlash.value = this.flash * 0.7

    // fog
    const fogCol = hor.clone().multiplyScalar(0.92)
    this.fog.color.copy(fogCol)
    this.fog.density = lerp(0.00115, 0.0019, cl) + rn * 0.0016 + this.night * 0.0003
    this.scene.background = fogCol
    this.skyMat.uniforms.uHor.value.copy(hor)

    // lights
    const useSun = e > -0.03
    const L = useSun ? this.sunDir : this.sunDir.clone().negate()
    const snap = 3
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap
    this.sun.target.position.set(fx, 0, fz)
    this.sun.position.set(fx + L.x * 220, L.y * 220 + 0, fz + L.z * 220)
    this.sun.color.copy(useSun ? sunCol : new THREE.Color(0.55, 0.65, 1))
    const sunI = useSun ? 3.4 * smoothstep(-0.03, 0.32, e) * (1 - 0.82 * cl) : 0.35 * (1 - 0.7 * cl)
    this.sun.intensity = sunI * (this.inside ? 0.5 : 1)
    this.sun.castShadow = sunI > 0.12
    const hemiSky = zen.clone().lerp(new THREE.Color(1, 1, 1), 0.35)
    this.hemi.color.copy(hemiSky)
    this.hemi.groundColor.set(0x4a4030).multiplyScalar(0.3 + 0.7 * dayF)
    this.hemi.intensity = lerp(0.12, 0.85, dayF) * (1 + cl * 0.35) + this.flash * 2.2 + 0.05
    if (this.inside) {
      this.hemi.intensity *= 0.3
      this.sun.intensity *= 0.2
    }
    this.renderer.toneMappingExposure = 1.0 + this.night * 0.15
    this.scene.environmentIntensity = (lerp(0.12, 0.55, dayF) * (1 - 0.25 * cl) + this.flash * 0.4) * (this.inside ? 0.25 : 1)

    // environment map refresh
    this.envT += dt
    const sig = `${Math.round(this.hour * 3)}|${Math.round(cl * 4)}|${Math.round(rn * 3)}`
    if (sig !== this.envSig && (this.envT > 3 || !this.envRT)) {
      this.envSig = sig
      this.envT = 0
      const old = this.envRT
      this.envRT = this.pmrem.fromScene(this.skyScene, 0, 1, 500)
      this.scene.environment = this.envRT.texture
      for (const m of MATS.envMats) m.envMap = this.envRT.texture
      old?.dispose()
    }

    // clouds
    const cp = cam.position
    for (let i = 0; i < this.clouds.length; i++) {
      const s = this.clouds[i]
      const d = s.userData
      d.a += d.sp * dt * (0.4 + this.windVal)
      s.position.set(cp.x + Math.cos(d.a) * d.r, d.h, cp.z + Math.sin(d.a) * d.r)
      const vis = i / this.clouds.length < cl + 0.1
      s.visible = vis
      const m = s.material as THREE.SpriteMaterial
      const base = new THREE.Color().setScalar(lerp(1, 0.3 + 0.1 * (1 - cl), cl * (0.65 + 0.35 * rn)) * (0.12 + 0.88 * bright))
      base.lerp(new THREE.Color(1, 0.6, 0.42), tw * 0.5 * (1 - cl * 0.5))
      m.color.copy(base).add(new THREE.Color().setScalar(this.flash * 0.7))
      m.opacity = clamp(0.25 + cl * 0.6, 0, 0.85)
    }

    // rain
    this.rainMat.uniforms.uTime.value = this.t
    this.rainMat.uniforms.uCam.value.copy(cp)
    this.rainMat.uniforms.uInt.value = this.inside ? 0 : clamp(rn * 1.15, 0, 1)
    this.windVal = 0.25 + 0.55 * rn + 0.2 * (noise2(this.t * 0.15, 3.3) - 0.5) + (this.weatherName === 'storm' ? 0.3 : 0)
    this.rainMat.uniforms.uWindv.value.set(this.windVal * 0.9, this.windVal * 0.3)
    this.rainMat.uniforms.uCol.value.setScalar(lerp(0.55, 0.9, dayF) + 0.1)
    wind.uTime.value = this.t
    wind.uWind.value = this.windVal

    this.sky.position.copy(cp)

    // glows & point lights
    const nightF = clamp(this.night + (1 - dayF) * 0.4 + cl * rn * 0.55 + (1 - smoothstep(0.0, 0.2, e)) * 0.3, 0, 1)
    this.glowMats[0].opacity = nightF * 0.85
    this.glowMats[1].opacity = nightF * 0.8
    this.glowMats[2].opacity = this.night > 0.1 ? (Math.sin(this.t * 3) > 0.2 ? 1 : 0.1) : 0.25
    this.plTimer -= dt
    if (this.plTimer <= 0) {
      this.plTimer = 0.3
      const near: { l: any; d: number }[] = []
      for (const l of W.lights) {
        if (l.kind === 'beacon') continue
        const d = Math.hypot(l.x - focus.x, l.z - focus.z)
        if (d < 55) near.push({ l, d })
      }
      near.sort((p, q) => p.d - q.d)
      this.pointLights.forEach((pl, i) => {
        const n = near[i]
        if (n) {
          pl.position.set(n.l.x, n.l.y, n.l.z)
          pl.color.setRGB(n.l.r, n.l.g * 0.9, n.l.b * 0.8)
          pl.userData.on = true
        } else pl.userData.on = false
      })
    }
    for (const pl of this.pointLights) pl.intensity = pl.userData.on ? 24 * nightF : 0

    // materials
    this.matTimer -= dt
    if (this.matTimer <= 0) {
      this.matTimer = 0.4
      const w = smoothstep(0.1, 0.8, this.wet)
      for (const e2 of MATS.wet) {
        const m = e2.mat
        if (!e2.base) e2.base = m.color.clone()
        m.roughness = lerp(e2.dryR, e2.wetR, w)
        m.color.copy(e2.base).multiplyScalar(lerp(1, e2.wetDark, w))
        m.envMapIntensity = 0.25 + w * 1.4
      }
      if (MATS.puddle) MATS.puddle.opacity = smoothstep(0.3, 0.85, this.wet) * 0.8
      if (MATS.water) MATS.water.color.setRGB(lerp(0.28, 0.42, rn), lerp(0.4, 0.34, rn), lerp(0.33, 0.24, rn))
      for (const n of MATS.night) {
        const base = n.mat.userData.base || 0
        n.mat.emissiveIntensity = Math.max(base * (1 - nightF), n.max * nightF)
      }
    }

    // birds
    const birdOn = e > 0.08 && rn < 0.2 && !this.inside
    const nb = birdOn ? Math.round(18 * (1 - cl * 0.6)) : 0
    const o = this.tmp
    for (let i = 0; i < 18; i++) {
      const b = this.birdState[i]
      if (i >= nb) {
        o.position.set(0, -500, 0)
        o.scale.set(0, 0, 0)
        o.updateMatrix()
        this.birdsR.setMatrixAt(i, o.matrix)
        this.birdsL.setMatrixAt(i, o.matrix)
        continue
      }
      b.a += b.sp * dt
      const x = focus.x + b.cx + Math.cos(b.a) * b.r, z = focus.z + b.cz + Math.sin(b.a) * b.r
      const y = b.h + Math.sin(this.t * 0.3 + b.ph) * 4
      const yaw = -b.a + Math.PI
      const flap = Math.sin(this.t * 9 + b.ph * 3) * 0.6
      for (const side of [1, -1]) {
        o.position.set(x, y, z)
        o.rotation.set(0, yaw, side * flap)
        o.rotation.order = 'YXZ'
        o.scale.set(side * 0.9, 1, 0.9)
        o.updateMatrix()
        ;(side === 1 ? this.birdsR : this.birdsL).setMatrixAt(i, o.matrix)
      }
    }
    this.birdsR.instanceMatrix.needsUpdate = true
    this.birdsL.instanceMatrix.needsUpdate = true
  }
  flashTick = 0

  serialize() {
    return { hour: this.hour, wet: this.wet, weather: this.weatherName, auto: this.auto, monsoon: this.monsoon, cloud: this.cloud, rain: this.rain }
  }
  restore(s: any) {
    if (!s) return
    this.hour = s.hour ?? this.hour
    this.wet = s.wet ?? this.wet
    this.auto = s.auto ?? true
    this.monsoon = s.monsoon ?? true
    if (s.weather) this.setWeather(s.weather)
    this.cloud = s.cloud ?? this.targetCloud
    this.rain = s.rain ?? this.targetRain
  }
  get nightFactor() {
    return this.night
  }
  get darkness() {
    const e = this.sunDir.y
    return clamp(this.night + (1 - smoothstep(-0.07, 0.28, e)) * 0.4 + this.cloud * this.rain * 0.45, 0, 1)
  }
}
