// @ts-nocheck
// Fully procedural WebAudio: ambience (wind, rain, birds, crickets, traffic), engines, horns, footsteps, thunder.
import { clamp, lerp } from './util'

export class AudioSys {
  ctx: AudioContext | null = null
  master!: GainNode
  noiseBuf!: AudioBuffer
  volume = 0.7
  private wind!: { g: GainNode; f: BiquadFilterNode }
  private rain!: { g: GainNode; f: BiquadFilterNode; lp: BiquadFilterNode }
  private traffic!: { g: GainNode }
  private cricket!: { g: GainNode }
  private eng!: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; g: GainNode; f: BiquadFilterNode }
  private skid!: { g: GainNode }
  private hornNodes: { o: OscillatorNode[]; g: GainNode } | null = null
  private birdT = 2
  private muffle!: BiquadFilterNode
  private engineOn = false

  init() {
    if (this.ctx) {
      this.ctx.resume()
      return
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.volume
    this.muffle = ctx.createBiquadFilter()
    this.muffle.type = 'lowpass'
    this.muffle.frequency.value = 20000
    this.master.connect(this.muffle)
    this.muffle.connect(ctx.destination)
    // noise buffer
    const len = ctx.sampleRate * 3
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let b0 = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.97 * b0 + 0.03 * w
      d[i] = w * 0.6 + b0 * 4
    }
    this.noiseBuf = buf
    const loop = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource()
      s.buffer = buf
      s.loop = true
      s.loopStart = Math.random() * 1.5
      s.start()
      return s
    }
    // wind
    {
      const s = loop(), f = ctx.createBiquadFilter(), g = ctx.createGain()
      f.type = 'lowpass'
      f.frequency.value = 500
      g.gain.value = 0
      s.connect(f).connect(g).connect(this.master)
      this.wind = { g, f }
    }
    // rain
    {
      const s = loop(), f = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain()
      f.type = 'bandpass'
      f.frequency.value = 4200
      f.Q.value = 0.5
      hp.type = 'highpass'
      hp.frequency.value = 900
      g.gain.value = 0
      s.connect(f).connect(hp).connect(g).connect(this.master)
      this.rain = { g, f, lp: hp }
    }
    // traffic rumble
    {
      const s = loop(), f = ctx.createBiquadFilter(), g = ctx.createGain()
      f.type = 'lowpass'
      f.frequency.value = 260
      g.gain.value = 0
      s.connect(f).connect(g).connect(this.master)
      this.traffic = { g }
    }
    // crickets
    {
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain()
      o.frequency.value = 4300
      lfo.frequency.value = 17
      lg.gain.value = 0.5
      g.gain.value = 0
      const am = ctx.createGain()
      am.gain.value = 0.5
      lfo.connect(lg).connect(am.gain)
      o.connect(am).connect(g).connect(this.master)
      o.start()
      lfo.start()
      this.cricket = { g }
    }
    // engine
    {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator()
      const f = ctx.createBiquadFilter(), g = ctx.createGain()
      o1.type = 'sawtooth'
      o2.type = 'square'
      o3.type = 'triangle'
      f.type = 'lowpass'
      f.frequency.value = 600
      g.gain.value = 0
      const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain()
      g1.gain.value = 0.5
      g2.gain.value = 0.25
      g3.gain.value = 0.4
      o1.connect(g1).connect(f)
      o2.connect(g2).connect(f)
      o3.connect(g3).connect(f)
      f.connect(g).connect(this.master)
      o1.start()
      o2.start()
      o3.start()
      this.eng = { o1, o2, o3, g, f }
    }
    // skid
    {
      const s = loop(), f = ctx.createBiquadFilter(), g = ctx.createGain()
      f.type = 'bandpass'
      f.frequency.value = 1500
      f.Q.value = 3
      g.gain.value = 0
      s.connect(f).connect(g).connect(this.master)
      this.skid = { g }
    }
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  private noiseBurst(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', dest?: AudioNode, when = 0, sweepTo?: number) {
    const ctx = this.ctx!
    const s = ctx.createBufferSource()
    s.buffer = this.noiseBuf
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    const t = ctx.currentTime + when
    if (sweepTo) {
      f.frequency.setValueAtTime(freq, t)
      f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    }
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(dest || this.master)
    s.start(t, Math.random() * 2, dur + 0.1)
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', when = 0, sweepTo?: number, dest?: AudioNode) {
    const ctx = this.ctx!
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type
    const t = ctx.currentTime + when
    o.frequency.setValueAtTime(freq, t)
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(dest || this.master)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  // ---- combat sounds
  gun(id: string, vol = 1, far = false) {
    if (!this.ctx) return
    const v = vol * (far ? 0.55 : 1)
    const pw: Record<string, [number, number, number]> = { pistol: [0.12, 2600, 0.5], smg: [0.09, 3000, 0.45], rifle: [0.16, 1700, 0.8], shotgun: [0.3, 900, 1], sniper: [0.45, 700, 1] }
    const [dur, f, a] = pw[id] || pw.pistol
    this.noiseBurst(dur, f, 0.6, a * v, 'bandpass', undefined, 0, f * 0.3)
    this.tone(id === 'sniper' ? 70 : 140, dur * 0.8, 0.5 * a * v, 'square', 0, 40)
    if (id === 'sniper' || id === 'shotgun') this.noiseBurst(dur * 2.5, 300, 0.5, 0.25 * v, 'lowpass', undefined, 0.05, 80)
  }
  reload() {
    if (!this.ctx) return
    this.tone(900, 0.04, 0.12, 'square')
    this.tone(500, 0.05, 0.12, 'square', 0.45)
    this.tone(1100, 0.04, 0.14, 'square', 1.0)
  }
  empty() {
    if (!this.ctx) return
    this.tone(1400, 0.03, 0.1, 'square')
  }
  hitMark(kill = false, head = false) {
    if (!this.ctx) return
    this.tone(kill ? 1500 : head ? 1900 : 1200, 0.06, 0.18, 'triangle', 0, kill ? 700 : undefined)
    if (kill) this.tone(1000, 0.1, 0.15, 'triangle', 0.08)
  }
  hurt() {
    if (!this.ctx) return
    this.noiseBurst(0.18, 400, 0.7, 0.35, 'lowpass')
    this.tone(160, 0.15, 0.3, 'sine', 0, 70)
  }
  pickup() {
    if (!this.ctx) return
    this.tone(660, 0.07, 0.15, 'triangle')
    this.tone(990, 0.1, 0.15, 'triangle', 0.07)
  }
  private jetNode: { g: GainNode; f: BiquadFilterNode } | null = null
  jetLevel(level: number, boost = false) {
    if (!this.ctx) return
    if (!this.jetNode) {
      const s = this.ctx.createBufferSource()
      s.buffer = this.noiseBuf
      s.loop = true
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 500
      const g = this.ctx.createGain()
      g.gain.value = 0
      s.connect(f).connect(g).connect(this.master)
      s.start()
      this.jetNode = { g, f }
    }
    const t = this.ctx.currentTime
    this.jetNode.g.gain.setTargetAtTime(level * 0.32, t, 0.06)
    this.jetNode.f.frequency.setTargetAtTime(boost ? 1100 : 600, t, 0.1)
  }

  footstep(surface: 'road' | 'grass' | 'wet' | 'water' | 'indoor', sprint = false) {
    if (!this.ctx) return
    const v = sprint ? 0.2 : 0.12
    if (surface === 'grass') this.noiseBurst(0.12, 900, 0.7, v * 0.8)
    else if (surface === 'wet') this.noiseBurst(0.14, 1800, 0.6, v * 0.9, 'bandpass', undefined, 0, 700)
    else if (surface === 'water') this.noiseBurst(0.25, 1200, 0.4, v * 1.4, 'bandpass', undefined, 0, 400)
    else if (surface === 'indoor') this.noiseBurst(0.07, 500, 1, v)
    else this.noiseBurst(0.07, 1500, 1.5, v)
  }
  thunder(delay: number, power: number) {
    if (!this.ctx) return
    this.noiseBurst(3 + power * 3, 260, 0.6, 0.6 * clamp(power, 0.2, 1), 'lowpass', undefined, delay, 60)
    this.noiseBurst(1.2, 120, 1, 0.5 * clamp(power, 0.2, 1), 'lowpass', undefined, delay + 0.2)
  }
  crash(power: number) {
    if (!this.ctx) return
    const v = clamp(power / 12, 0.1, 1)
    this.noiseBurst(0.4, 700, 0.5, 0.7 * v, 'lowpass', undefined, 0, 120)
    this.tone(90, 0.25, 0.5 * v, 'square', 0, 40)
  }
  splash() {
    if (!this.ctx) return
    this.noiseBurst(0.4, 2200, 0.5, 0.25, 'bandpass', undefined, 0, 600)
  }
  chime() {
    if (!this.ctx) return
    this.tone(880, 0.25, 0.25, 'sine')
    this.tone(1320, 0.4, 0.2, 'sine', 0.1)
  }
  coin() {
    if (!this.ctx) return
    this.tone(1200, 0.12, 0.2, 'square')
    this.tone(1800, 0.3, 0.18, 'square', 0.08)
  }
  click() {
    if (!this.ctx) return
    this.tone(600, 0.05, 0.12, 'triangle')
  }
  door() {
    if (!this.ctx) return
    this.noiseBurst(0.18, 220, 1, 0.5, 'lowpass')
    this.tone(120, 0.15, 0.3, 'sine', 0, 60)
  }
  carDoor() {
    if (!this.ctx) return
    this.noiseBurst(0.12, 400, 1.2, 0.4, 'lowpass')
    this.tone(160, 0.1, 0.3, 'square', 0, 90)
  }
  // 3D-ish horn: gain falls with distance
  horn(dist = 0, pitch = 1, dur = 0.35) {
    if (!this.ctx) return
    const v = clamp(1 - dist / 120, 0, 1) * 0.28
    if (v < 0.01) return
    const ctx = this.ctx
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(v, t + 0.02)
    g.gain.setValueAtTime(v, t + dur)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 2400
    for (const fr of [410 * pitch, 515 * pitch]) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = fr
      o.connect(f)
      o.start(t)
      o.stop(t + dur + 0.1)
    }
    f.connect(g).connect(this.master)
  }
  playerHorn(on: boolean) {
    if (!this.ctx) return
    if (on && !this.hornNodes) {
      const ctx = this.ctx
      const g = ctx.createGain()
      g.gain.value = 0.0001
      g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.02)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 2400
      const os = [420, 525].map((fr) => {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = fr
        o.connect(f)
        o.start()
        return o
      })
      f.connect(g).connect(this.master)
      this.hornNodes = { o: os, g }
    } else if (!on && this.hornNodes) {
      const h = this.hornNodes
      this.hornNodes = null
      h.g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.06)
      h.o.forEach((o) => o.stop(this.ctx!.currentTime + 0.1))
    }
  }

  update(dt: number, s: any) {
    if (!this.ctx) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const set = (p: AudioParam, v: number, k = 0.15) => p.setTargetAtTime(v, t, k)
    this.muffle.frequency.setTargetAtTime(s.inside ? 1400 : s.inVehicle ? 5200 : 20000, t, 0.1)
    set(this.wind.g.gain, 0.05 + s.wind * 0.22 + s.rain * 0.05)
    set(this.wind.f.frequency, 300 + s.wind * 700)
    set(this.rain.g.gain, s.rainAudible * 0.42)
    set(this.rain.f.frequency, 3500 + s.rainAudible * 1600)
    set(this.traffic.g.gain, clamp(s.traffic, 0, 1) * 0.35)
    const day = 1 - s.night
    set(this.cricket.g.gain, s.night * (1 - s.rainAudible) * (s.inside ? 0.01 : 0.035))
    // birds
    this.birdT -= dt
    if (this.birdT <= 0 && day > 0.5 && s.rainAudible < 0.2 && !s.inside) {
      this.birdT = 1.5 + Math.random() * 5
      const base = 2200 + Math.random() * 1800
      const n = 2 + Math.floor(Math.random() * 4)
      const vol = 0.04 + Math.random() * 0.05
      for (let i = 0; i < n; i++) this.tone(base * (1 + i * 0.06), 0.09, vol, 'sine', i * 0.12, base * (1.3 + Math.random() * 0.4))
    } else if (this.birdT <= 0) this.birdT = 3
    // engine
    const v = s.veh
    if (v && v.on) {
      const e = this.eng
      const targetGain = (0.05 + v.throttle * 0.1 + v.rpm * 0.08) * v.vol
      set(e.g.gain, targetGain, 0.08)
      const base = v.kind === 'bus' ? 28 : v.kind === 'auto' ? 38 : v.kind === 'bike' ? 52 : 34
      const f = base + v.rpm * (v.kind === 'bike' ? 190 : v.kind === 'bus' ? 70 : 110)
      set(e.o1.frequency, f, 0.05)
      set(e.o2.frequency, f * 0.5, 0.05)
      set(e.o3.frequency, f * 2.01, 0.05)
      set(e.f.frequency, 250 + v.rpm * 900 + v.throttle * 400, 0.08)
      set(this.skid.g.gain, clamp(v.slip, 0, 1) * 0.12, 0.05)
      this.engineOn = true
    } else if (this.engineOn) {
      set(this.eng.g.gain, 0, 0.1)
      set(this.skid.g.gain, 0, 0.05)
      this.engineOn = false
    }
  }
}
