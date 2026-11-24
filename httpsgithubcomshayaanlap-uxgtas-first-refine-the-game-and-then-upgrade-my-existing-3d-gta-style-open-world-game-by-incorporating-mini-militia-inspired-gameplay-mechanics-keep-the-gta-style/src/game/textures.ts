// @ts-nocheck
import * as THREE from 'three'
import { mulberry32 } from './util'

export const KFONT = `'Noto Sans Kannada','Nirmala UI','Tunga','Kohinoor Kannada','Arial Unicode MS','Segoe UI',sans-serif`

export function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}
export function toTex(c: HTMLCanvasElement, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rx, ry)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rng: () => number, lo: number, hi: number, a = 0.25) {
  for (let i = 0; i < n; i++) {
    const v = Math.floor(lo + rng() * (hi - lo))
    ctx.fillStyle = `rgba(${v},${v},${v},${a})`
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2)
  }
}

// kind: main | lane | hwEast (median on left) ...
export function asphaltTexture(kind: 'main' | 'lane' | 'hw' | 'hwL') {
  const [c, x] = cv(256, 512)
  const rng = mulberry32(kind.length * 77 + 5)
  x.fillStyle = kind === 'lane' ? '#4d4b48' : '#3b3b3d'
  x.fillRect(0, 0, 256, 512)
  speckle(x, 256, 512, 9000, rng, 30, 140, 0.35)
  // tyre polish
  const lanes = kind === 'main' ? [0.28, 0.72] : kind === 'lane' ? [0.35, 0.65] : [0.3, 0.7]
  for (const l of lanes) {
    const g = x.createLinearGradient(l * 256 - 26, 0, l * 256 + 26, 0)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(0.5, 'rgba(0,0,0,0.22)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(l * 256 - 26, 0, 52, 512)
  }
  // patches / cracks
  for (let i = 0; i < 9; i++) {
    x.fillStyle = `rgba(20,20,20,${0.2 + rng() * 0.2})`
    x.fillRect(rng() * 220, rng() * 480, 14 + rng() * 40, 10 + rng() * 30)
  }
  x.strokeStyle = 'rgba(15,15,15,0.5)'
  x.lineWidth = 1
  for (let i = 0; i < 14; i++) {
    x.beginPath()
    let px = rng() * 256, py = rng() * 512
    x.moveTo(px, py)
    for (let k = 0; k < 5; k++) {
      px += (rng() - 0.5) * 30
      py += (rng() - 0.5) * 30
      x.lineTo(px, py)
    }
    x.stroke()
  }
  const line = (u: number, w: number, col: string, dash = false) => {
    x.fillStyle = col
    if (!dash) x.fillRect(u * 256 - w / 2, 0, w, 512)
    else for (let k = 0; k < 2; k++) x.fillRect(u * 256 - w / 2, k * 256 + 20, w, 110)
  }
  if (kind === 'main') {
    line(0.5, 5, '#e9e4d0', true)
    line(0.035, 5, '#dcd8c8')
    line(0.965, 5, '#dcd8c8')
  } else if (kind === 'hw') {
    line(0.5, 5, '#e9e4d0', true)
    line(0.97, 6, '#ffffff')
    line(0.03, 6, '#e8c33a')
  } else if (kind === 'hwL') {
    line(0.5, 5, '#e9e4d0', true)
    line(0.03, 6, '#ffffff')
    line(0.97, 6, '#e8c33a')
  } else {
    // lane: dirt edges
    for (const side of [0, 1]) {
      const g = x.createLinearGradient(side ? 256 : 0, 0, side ? 190 : 66, 0)
      g.addColorStop(0, 'rgba(120,70,45,0.95)')
      g.addColorStop(1, 'rgba(120,70,45,0)')
      x.fillStyle = g
      x.fillRect(side ? 190 : 0, 0, 66, 512)
    }
  }
  speckle(x, 256, 512, 2500, rng, 90, 200, 0.18)
  return toTex(c)
}

export function groundTexture() {
  const [c, x] = cv(512, 512)
  const rng = mulberry32(9)
  x.fillStyle = '#c8c8c8'
  x.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 6000; i++) {
    const v = 150 + Math.floor(rng() * 100)
    x.fillStyle = `rgba(${v},${v},${v},0.35)`
    const s = 1 + rng() * 5
    x.fillRect(rng() * 512, rng() * 512, s, s * (0.5 + rng() * 2))
  }
  // grass blades strokes
  for (let i = 0; i < 4000; i++) {
    const v = 110 + Math.floor(rng() * 120)
    x.strokeStyle = `rgba(${v},${v},${v},0.5)`
    x.lineWidth = 1
    const px = rng() * 512, py = rng() * 512
    x.beginPath()
    x.moveTo(px, py)
    x.lineTo(px + (rng() - 0.5) * 4, py - 3 - rng() * 6)
    x.stroke()
  }
  const t = toTex(c, 260, 260)
  return t
}

export function facadeTextures() {
  // 12m x 6m tile : 4 columns x 2 floors of 3m cells
  const W = 512, H = 256
  const [c, x] = cv(W, H)
  const [e, ex] = cv(W, H)
  const rng = mulberry32(31)
  x.fillStyle = '#f2f0ec'
  x.fillRect(0, 0, W, H)
  ex.fillStyle = '#000'
  ex.fillRect(0, 0, W, H)
  // grime streaks from top
  for (let i = 0; i < 120; i++) {
    const px = rng() * W
    const g = x.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, `rgba(60,50,40,${0.05 + rng() * 0.12})`)
    g.addColorStop(1, 'rgba(60,50,40,0)')
    x.fillStyle = g
    x.fillRect(px, 0, 1 + rng() * 5, H * (0.4 + rng() * 0.6))
  }
  speckle(x, W, H, 4000, rng, 120, 230, 0.12)
  // moss at base
  const mg = x.createLinearGradient(0, H * 0.8, 0, H)
  mg.addColorStop(0, 'rgba(60,80,40,0)')
  mg.addColorStop(1, 'rgba(60,80,40,0.28)')
  x.fillStyle = mg
  x.fillRect(0, H * 0.8, W, H * 0.2)
  for (let r = 0; r < 2; r++)
    for (let col = 0; col < 4; col++) {
      const cx = col * 128 + 64, cy = r * 128 + 70
      const ww = 52, hh = 62
      // frame & sill
      x.fillStyle = '#b8b2a8'
      x.fillRect(cx - ww / 2 - 5, cy - hh / 2 - 5, ww + 10, hh + 10)
      x.fillStyle = '#d0cbc2'
      x.fillRect(cx - ww / 2 - 9, cy + hh / 2 + 5, ww + 18, 5)
      const lit = rng() < 0.4
      x.fillStyle = '#25343c'
      x.fillRect(cx - ww / 2, cy - hh / 2, ww, hh)
      // shutters / grill
      x.strokeStyle = '#111'
      x.lineWidth = 2
      x.beginPath()
      x.moveTo(cx, cy - hh / 2)
      x.lineTo(cx, cy + hh / 2)
      x.moveTo(cx - ww / 2, cy)
      x.lineTo(cx + ww / 2, cy)
      x.stroke()
      if (lit) {
        ex.fillStyle = rng() < 0.7 ? '#ffc766' : '#cfe6ff'
        ex.fillRect(cx - ww / 2 + 2, cy - hh / 2 + 2, ww - 4, hh - 4)
        ex.strokeStyle = '#000'
        ex.lineWidth = 2
        ex.beginPath()
        ex.moveTo(cx, cy - hh / 2)
        ex.lineTo(cx, cy + hh / 2)
        ex.stroke()
      }
    }
  return { map: toTex(c), emissive: toTex(e) }
}

export function roofTileTexture() {
  const [c, x] = cv(256, 256)
  const rng = mulberry32(12)
  x.fillStyle = '#a4472a'
  x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 32; i++) {
    const g = x.createLinearGradient(i * 8, 0, i * 8 + 8, 0)
    g.addColorStop(0, 'rgba(0,0,0,0.35)')
    g.addColorStop(0.5, 'rgba(255,170,120,0.18)')
    g.addColorStop(1, 'rgba(0,0,0,0.3)')
    x.fillStyle = g
    x.fillRect(i * 8, 0, 8, 256)
  }
  for (let r = 0; r < 16; r++) {
    x.fillStyle = 'rgba(0,0,0,0.25)'
    x.fillRect(0, r * 16, 256, 2)
  }
  for (let i = 0; i < 1200; i++) {
    x.fillStyle = `rgba(${40 + rng() * 40},${60 + rng() * 40},${30},${0.1 + rng() * 0.2})`
    x.fillRect(rng() * 256, rng() * 256, 3, 2)
  }
  return toTex(c, 3, 3)
}

export function shopfrontTexture(variant: number) {
  const [c, x] = cv(256, 128)
  const rng = mulberry32(variant * 91 + 3)
  x.fillStyle = '#1b1612'
  x.fillRect(0, 0, 256, 128)
  const cols = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#457b9d', '#9b5de5', '#f15bb5', '#90be6d', '#ffffff']
  // shelves
  for (let s = 0; s < 4; s++) {
    x.fillStyle = '#6b5236'
    x.fillRect(0, 20 + s * 26, 256, 3)
    for (let i = 0; i < 26; i++) {
      x.fillStyle = cols[Math.floor(rng() * cols.length)]
      const w = 5 + rng() * 6, h = 8 + rng() * 12
      x.fillRect(4 + i * 9.6, 20 + s * 26 - h, w, h)
    }
  }
  // hanging items
  for (let i = 0; i < 24; i++) {
    x.fillStyle = cols[Math.floor(rng() * cols.length)]
    x.fillRect(rng() * 250, rng() * 12, 4, 10 + rng() * 14)
  }
  // warm glow
  const g = x.createRadialGradient(128, 40, 5, 128, 60, 150)
  g.addColorStop(0, 'rgba(255,200,110,0.55)')
  g.addColorStop(1, 'rgba(255,200,110,0.05)')
  x.fillStyle = g
  x.fillRect(0, 0, 256, 128)
  return toTex(c)
}

export function signTexture(lines: { t: string; s: number; col?: string; kn?: boolean; bold?: boolean }[], bg: string, fg = '#fff', w = 512, h = 160, border = true, border2 = '#fff') {
  const [c, x] = cv(w, h)
  x.fillStyle = bg
  x.fillRect(0, 0, w, h)
  if (border) {
    x.strokeStyle = border2
    x.lineWidth = Math.max(3, h / 30)
    x.strokeRect(h / 25, h / 25, w - h / 12.5, h - h / 12.5)
  }
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  const total = lines.reduce((a, l) => a + l.s * 1.15, 0)
  let y = (h - total) / 2
  for (const l of lines) {
    y += (l.s * 1.15) / 2
    x.fillStyle = l.col || fg
    x.font = `${l.bold === false ? '' : 'bold '}${l.s}px ${KFONT}`
    x.fillText(l.t, w / 2, y, w - 30)
    y += (l.s * 1.15) / 2
  }
  const t = toTex(c)
  return t
}

export function frondTexture(wide = false) {
  const [c, x] = cv(128, 256)
  x.clearRect(0, 0, 128, 256)
  if (wide) {
    // banana leaf
    x.fillStyle = '#4f9a2c'
    x.beginPath()
    x.moveTo(64, 255)
    x.bezierCurveTo(0, 200, 0, 60, 64, 2)
    x.bezierCurveTo(128, 60, 128, 200, 64, 255)
    x.fill()
    x.strokeStyle = '#2d6a17'
    x.lineWidth = 3
    x.beginPath()
    x.moveTo(64, 255)
    x.lineTo(64, 4)
    x.stroke()
    x.lineWidth = 1
    for (let i = 0; i < 40; i++) {
      x.beginPath()
      x.moveTo(64, 250 - i * 6)
      x.lineTo(64 + (i % 2 ? 60 : -60), 230 - i * 6)
      x.stroke()
    }
  } else {
    x.strokeStyle = '#2e6a1c'
    x.lineWidth = 3
    x.beginPath()
    x.moveTo(64, 256)
    x.lineTo(64, 0)
    x.stroke()
    for (let i = 0; i < 62; i++) {
      const y = 250 - i * 4
      const len = 8 + Math.sin((i / 62) * Math.PI) * 52
      for (const s of [-1, 1]) {
        x.strokeStyle = i % 3 ? '#3f8a25' : '#4d9b2c'
        x.lineWidth = 2.4
        x.beginPath()
        x.moveTo(64, y)
        x.lineTo(64 + s * len, y - 12)
        x.stroke()
      }
    }
  }
  return toTex(c, 1, 1)
}

export function trunkTexture(light = false) {
  const [c, x] = cv(64, 256)
  x.fillStyle = light ? '#a9a98a' : '#7d6a52'
  x.fillRect(0, 0, 64, 256)
  for (let i = 0; i < 32; i++) {
    x.fillStyle = 'rgba(30,25,15,0.35)'
    x.fillRect(0, i * 8, 64, 2)
    x.fillStyle = 'rgba(255,255,255,0.08)'
    x.fillRect(0, i * 8 + 2, 64, 2)
  }
  const rng = mulberry32(4)
  speckle(x, 64, 256, 500, rng, 40, 160, 0.25)
  return toTex(c)
}

export function barkTexture() {
  const [c, x] = cv(64, 128)
  x.fillStyle = '#5b4a3a'
  x.fillRect(0, 0, 64, 128)
  const rng = mulberry32(8)
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(20,15,10,${0.2 + rng() * 0.3})`
    x.fillRect(rng() * 64, 0, 1 + rng() * 3, 128)
  }
  return toTex(c)
}

export function cloudTexture() {
  const [c, x] = cv(256, 128)
  const rng = mulberry32(21)
  x.clearRect(0, 0, 256, 128)
  for (let i = 0; i < 70; i++) {
    const px = 40 + rng() * 176, py = 40 + rng() * 48
    const r = 18 + rng() * 34
    const g = x.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(px - r, py - r, r * 2, r * 2)
  }
  return toTex(c)
}

export function glowTexture(col = '255,230,170') {
  const [c, x] = cv(64, 64)
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, `rgba(${col},1)`)
  g.addColorStop(0.2, `rgba(${col},0.55)`)
  g.addColorStop(1, `rgba(${col},0)`)
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  return toTex(c)
}

export function paddyTexture() {
  const [c, x] = cv(256, 256)
  const rng = mulberry32(55)
  x.fillStyle = '#7fb347'
  x.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 16; i++) {
    x.fillStyle = i % 2 ? 'rgba(40,100,20,0.35)' : 'rgba(180,220,100,0.3)'
    x.fillRect(0, i * 16, 256, 8)
  }
  for (let i = 0; i < 3000; i++) {
    x.fillStyle = `rgba(${30 + rng() * 60},${100 + rng() * 80},${20},0.5)`
    x.fillRect(rng() * 256, rng() * 256, 2, 5)
  }
  return toTex(c, 1, 1)
}

export function plateTexture(text: string) {
  const [c, x] = cv(128, 32)
  x.fillStyle = '#f4f4ee'
  x.fillRect(0, 0, 128, 32)
  x.fillStyle = '#111'
  x.font = 'bold 22px monospace'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillText(text, 64, 17)
  return toTex(c)
}

export function conePulseTexture() {
  const [c, x] = cv(64, 128)
  const g = x.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,240,200,0.8)')
  g.addColorStop(1, 'rgba(255,240,200,0)')
  x.fillStyle = g
  x.beginPath()
  x.moveTo(26, 0)
  x.lineTo(38, 0)
  x.lineTo(64, 128)
  x.lineTo(0, 128)
  x.closePath()
  x.fill()
  return toTex(c)
}
