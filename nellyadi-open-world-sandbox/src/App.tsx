// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { Game, PALETTE_SHIRT, PALETTE_PANTS } from './game/game'
import { SKINS } from './game/character'

let gamePromise: Promise<Game> | null = null
const listeners = new Set<(p: number, m: string) => void>()
let lastProg = { p: 0, m: 'Starting' }

function getGame(canvas: HTMLCanvasElement) {
  if (!gamePromise) {
    gamePromise = Game.create(canvas, (p, m) => {
      lastProg = { p, m }
      listeners.forEach((l) => l(p, m))
    })
  }
  return gamePromise
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const WEATHER_ICON: Record<string, string> = { clear: '☀️', cloudy: '⛅', overcast: '☁️', drizzle: '🌦️', rain: '🌧️', storm: '⛈️' }

function Key({ k }: { k: string }) {
  return <span className="inline-block min-w-[1.6rem] text-center px-1.5 py-0.5 rounded bg-white/90 text-black text-xs font-bold shadow">{k}</span>
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move / drive'],
  ['Mouse', 'Look (click the game to capture the mouse)'],
  ['Shift', 'Sprint (uses stamina)'],
  ['Ctrl', 'Walk slowly'],
  ['Space', 'Jump  •  handbrake in vehicles'],
  ['E', 'Interact: enter/exit vehicles & buildings, buy, sit'],
  ['F', 'Talk to a nearby person'],
  ['V', 'Toggle first-person (on foot)'],
  ['C', 'Cycle driving camera (chase / first-person / far)'],
  ['H', 'Horn'],
  ['L', 'Headlights'],
  ['Q', 'Stand up from a bench'],
  ['Wheel', 'Zoom the third-person camera'],
  ['Esc', 'Pause menu'],
]

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mmRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [phase, setPhase] = useState<'loading' | 'title' | 'play'>('loading')
  const [prog, setProg] = useState(lastProg)
  const [hud, setHud] = useState<any>(null)
  const [tab, setTab] = useState('main')
  const [err, setErr] = useState('')

  useEffect(() => {
    const l = (p: number, m: string) => setProg({ p, m })
    listeners.add(l)
    let alive = true
    getGame(canvasRef.current!)
      .then((g) => {
        if (!alive) return
        gameRef.current = g
        g.attachMinimap(mmRef.current)
        setHud(g.snapshot())
        setPhase((ph) => (ph === 'loading' ? 'title' : ph))
      })
      .catch((e) => {
        console.error(e)
        setErr(String(e && e.message ? e.message : e))
      })
    return () => {
      alive = false
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'play') return
    const id = setInterval(() => {
      const g = gameRef.current
      if (g) {
        g.attachMinimap(mmRef.current)
        setHud(g.snapshot())
      }
    }, 100)
    return () => clearInterval(id)
  }, [phase])

  const g = gameRef.current
  const play = (load: boolean) => {
    if (!g) return
    g.start(load)
    setTab('main')
    setPhase('play')
  }

  const paused = phase === 'play' && hud?.paused && hud.menu === 'pause'
  const shop = phase === 'play' && hud?.menu === 'shop'
  const custom = phase === 'play' && hud?.menu === 'customise'

  return (
    <div className="fixed inset-0 bg-black text-white select-none overflow-hidden" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, 'Noto Sans Kannada', sans-serif" }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* ---------- HUD ---------- */}
      <div className={`absolute inset-0 pointer-events-none ${phase === 'play' ? '' : 'hidden'}`}>
        {hud && (
          <>
            {/* objective */}
            <div className="absolute top-4 left-4 max-w-sm">
              {hud.objective ? (
                <div className="bg-black/55 backdrop-blur-sm rounded px-3 py-2 border-l-4 border-purple-400">
                  <div className="text-[11px] uppercase tracking-widest text-purple-300">New Objective · {hud.objective.mission}</div>
                  <div className="text-sm font-semibold">✦ {hud.objective.text}</div>
                  <div className="text-xs text-white/70 flex gap-3 mt-0.5">
                    {hud.objective.dist > 0 && <span>{hud.objective.dist} m</span>}
                    {hud.objective.progress && <span>Progress {hud.objective.progress}</span>}
                    {hud.objective.timer != null && <span className="text-amber-300 font-bold">⏱ {hud.objective.timer}s</span>}
                  </div>
                </div>
              ) : (
                <div className="bg-black/50 rounded px-3 py-2 text-sm">✦ Free roam — explore Nellyadi</div>
              )}
              <div className="mt-2 space-y-1">
                {hud.toasts.map((t: string, i: number) => (
                  <div key={i} className="bg-black/55 rounded px-3 py-1 text-xs w-fit max-w-sm">{t}</div>
                ))}
              </div>
            </div>

            {/* top right */}
            <div className="absolute top-4 right-4 text-right drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]">
              <div className="text-3xl font-black text-green-400 tracking-wider" style={{ fontFamily: 'ui-monospace, monospace' }}>₹{String(hud.money).padStart(8, '0')}</div>
              <div className="text-lg font-bold mt-1">{hud.time} <span className="text-sm font-normal text-white/80">· {hud.phase}</span></div>
              <div className="text-sm text-white/90">{WEATHER_ICON[hud.weatherName]} {hud.weather}</div>
              <div className="text-xs text-amber-300 mt-1">✦ Areca nuts {hud.collected}/{hud.totalCollect}</div>
              {hud.buff > 0 && <div className="text-xs text-green-300">⚡ Energy boost {Math.ceil(hud.buff)}s</div>}
              {hud.hasUmbrella && <div className="text-xs text-sky-300">☂ Umbrella</div>}
            </div>

            {/* minimap */}
            <div className="absolute bottom-6 left-5">
              <canvas ref={mmRef} width={380} height={380} className="w-[190px] h-[190px] rounded-full shadow-[0_0_18px_rgba(0,0,0,0.7)]" />
              <div className="mt-1 text-center text-xs font-semibold bg-black/55 rounded px-2 py-0.5 w-[190px] truncate">{hud.location}</div>
              <div className="mt-1 w-[190px] h-2 rounded bg-black/60 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-yellow-400" style={{ width: `${Math.round(hud.stamina * 100)}%` }} />
              </div>
              <div className="text-[10px] text-white/60 text-center">NELLYADI • 574229</div>
            </div>

            {/* speedometer */}
            {hud.inVehicle && (
              <div className="absolute bottom-6 right-6 text-right drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                <div className="text-6xl font-black leading-none" style={{ fontFamily: 'ui-monospace, monospace' }}>{hud.speed}<span className="text-lg ml-1 font-semibold">km/h</span></div>
                <div className="text-sm mt-1">{hud.vehicle} · gear {hud.gear}</div>
                <div className="text-xs text-white/70">{hud.plate} · {hud.camMode} cam · {hud.lights ? '💡 lights on' : 'lights off'}</div>
              </div>
            )}

            {/* prompt */}
            {hud.prompt && !hud.paused && (
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/65 rounded-full px-5 py-2 text-sm flex items-center gap-3">
                <Key k="E" /> <span>{hud.prompt}</span>
              </div>
            )}
            {hud.subtitle && (
              <div className="absolute bottom-40 left-1/2 -translate-x-1/2 max-w-xl text-center bg-black/65 rounded px-4 py-2">
                <div className="text-xs text-amber-300 font-bold">{hud.subtitle.name}</div>
                <div className="text-sm">{hud.subtitle.text}</div>
              </div>
            )}
            {!hud.paused && !hud.inVehicle && <div className="absolute bottom-3 right-4 text-[11px] text-white/50">F talk · V camera · Shift sprint · Esc menu</div>}
            {!hud.paused && <div className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full bg-white/0" />}
          </>
        )}
      </div>

      {/* ---------- loading ---------- */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#1d2b22] to-[#0b1410]">
          <div className="text-5xl font-black tracking-widest">NELLYADI</div>
          <div className="text-white/70 mt-1 tracking-[0.3em] text-sm">ನೆಲ್ಲ್ಯಾಡಿ • 574229</div>
          <div className="mt-8 w-80 h-2 bg-white/15 rounded overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.round(prog.p * 100)}%` }} />
          </div>
          <div className="mt-3 text-sm text-white/70">{err ? <span className="text-red-400">Error: {err}</span> : prog.m + '…'}</div>
        </div>
      )}

      {/* ---------- title ---------- */}
      {phase === 'title' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="w-[min(920px,94vw)] max-h-[94vh] overflow-auto rounded-xl bg-[#0f1713]/95 border border-white/10 p-6 md:p-8 shadow-2xl">
            <div className="flex flex-col md:flex-row gap-8">
              <div className="flex-1">
                <div className="text-5xl md:text-6xl font-black tracking-widest bg-gradient-to-r from-amber-300 to-pink-400 bg-clip-text text-transparent">NELLYADI</div>
                <div className="text-white/70 tracking-[0.35em] text-xs mt-1">OPEN-WORLD SANDBOX · KARNATAKA · PIN 574229</div>
                <p className="text-sm text-white/75 mt-5 leading-relaxed">
                  Walk, run and drive through a monsoon-soaked Karnataka town: a main road lined with shops and roadside vendors, a bypass highway with a flyover,
                  areca and coconut plantations, paddy fields, a stream, forested hills, KSRTC buses, autos and scooters.
                </p>
                <div className="mt-6 flex gap-3 flex-wrap">
                  <button onClick={() => play(false)} className="px-6 py-3 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold">New game</button>
                  <button disabled={!hud?.hasSave} onClick={() => play(true)} className="px-6 py-3 rounded bg-white/15 hover:bg-white/25 disabled:opacity-30 font-bold">Continue</button>
                </div>
                <p className="text-[11px] text-white/45 mt-6 leading-relaxed">
                  Honest note: the town layout, signs and street furniture are modelled from the reference screenshots (KSRTC bus, auto-rickshaws, Mangaluru/Dharmasthala
                  gantry, flyover, palms, hills). It is <b>not</b> a surveyed map of the real place — distances and building positions are approximations.
                  Kannada text needs a Kannada-capable system font to render.
                </p>
              </div>
              <div className="md:w-72">
                <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Controls</div>
                <div className="space-y-1.5">
                  {CONTROLS.slice(0, 11).map(([k, d]) => (
                    <div key={k} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 w-16 text-right"><Key k={k} /></span>
                      <span className="text-white/75">{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- pause menu ---------- */}
      {paused && g && (
        <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
          <div className="w-[min(820px,95vw)] max-h-[92vh] overflow-auto rounded-xl bg-[#101814]/95 border border-white/10 shadow-2xl">
            <div className="flex items-center gap-1 px-3 pt-3 border-b border-white/10 flex-wrap">
              {[['main', 'Paused'], ['missions', 'Missions'], ['custom', 'Customise'], ['weather', 'Weather & time'], ['settings', 'Settings'], ['save', 'Save / Load'], ['controls', 'Controls']].map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => (k === 'custom' ? g.openMenu('customise') : setTab(k))}
                  className={`px-3 py-2 text-sm rounded-t ${tab === k ? 'bg-white/15 font-bold' : 'text-white/60 hover:text-white'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="p-5 text-sm">
              {tab === 'main' && (
                <div className="space-y-3">
                  <div className="text-2xl font-black">Paused</div>
                  <div className="text-white/60">{hud.location} · {hud.time} · {hud.weather}</div>
                  <button onClick={() => g.resume()} className="px-6 py-3 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold">Resume</button>
                  <div className="text-xs text-white/50">Press Esc to open this menu at any time. Autosave runs every two minutes.</div>
                </div>
              )}
              {tab === 'missions' && (
                <div className="space-y-2">
                  {hud.missionList.map((m: any, i: number) => (
                    <div key={i} className={`p-3 rounded border ${m.state === 'active' ? 'border-purple-400 bg-purple-500/10' : 'border-white/10'} ${m.state === 'locked' ? 'opacity-50' : ''}`}>
                      <div className="font-bold">{m.state === 'done' ? '✔ ' : m.state === 'active' ? '▶ ' : '🔒 '}{m.title} <span className="text-green-400 text-xs ml-2">₹{m.reward}</span></div>
                      <div className="text-xs text-white/60">{m.desc}</div>
                    </div>
                  ))}
                  <div className="text-xs text-white/40">Missions are data-driven (src/game/missions.ts) so new ones can be added easily.</div>
                </div>
              )}
              {tab === 'weather' && (
                <div className="space-y-4">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={hud.auto} onChange={(e) => g.setAutoWeather(e.target.checked)} /> Automatic weather changes</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={hud.monsoon} onChange={(e) => g.setMonsoon(e.target.checked)} /> Monsoon season (more rain)</label>
                  <div className="flex flex-wrap gap-2">
                    {['clear', 'cloudy', 'overcast', 'drizzle', 'rain', 'storm'].map((w) => (
                      <button key={w} onClick={() => g.setWeather(w)} className={`px-3 py-2 rounded ${hud.weatherName === w ? 'bg-emerald-500 text-black font-bold' : 'bg-white/10 hover:bg-white/20'}`}>
                        {WEATHER_ICON[w]} {w}
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="text-xs text-white/60 mb-1">Time of day: {hud.time} ({hud.phase})</div>
                    <input type="range" min={0} max={24} step={0.25} value={hud.hour} onChange={(e) => g.setHour(parseFloat(e.target.value))} className="w-full" />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {[[6.2, 'Sunrise'], [12.5, 'Noon'], [16, 'Afternoon'], [18.3, 'Sunset'], [22, 'Night']].map(([h, l]) => (
                        <button key={l} onClick={() => g.setHour(h)} className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-xs">{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">Day length:
                    {[6, 12, 24, 48].map((m) => (
                      <button key={m} onClick={() => g.setDayMinutes(m)} className={`px-2 py-1 rounded ${hud.dayMinutes === m ? 'bg-emerald-500 text-black' : 'bg-white/10'}`}>{m} min</button>
                    ))}
                  </div>
                  <div className="text-xs text-white/50">Road wetness: {Math.round(hud.wetLevel * 100)}% — it builds up in rain and dries slowly. Wet roads reduce tyre grip.</div>
                </div>
              )}
              {tab === 'settings' && (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-white/60 mb-1">Graphics quality</div>
                    <div className="flex gap-2">
                      {['low', 'medium', 'high'].map((q) => (
                        <button key={q} onClick={() => g.applyQuality(q)} className={`px-4 py-2 rounded ${hud.quality === q ? 'bg-emerald-500 text-black font-bold' : 'bg-white/10 hover:bg-white/20'}`}>{q}</button>
                      ))}
                    </div>
                    <div className="text-[11px] text-white/40 mt-1">Quality changes resolution, shadow map size, view distance, traffic and pedestrian counts.</div>
                  </div>
                  <div>
                    <div className="text-xs text-white/60 mb-1">Volume</div>
                    <input type="range" min={0} max={1} step={0.05} value={hud.volume} onChange={(e) => g.setVolume(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="text-xs text-white/60 mb-1">Mouse sensitivity</div>
                    <input type="range" min={0.0008} max={0.006} step={0.0002} value={hud.sens} onChange={(e) => g.setSens(parseFloat(e.target.value))} className="w-full" />
                  </div>
                </div>
              )}
              {tab === 'save' && (
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <button onClick={() => g.save(false)} className="px-5 py-3 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-bold">Save game</button>
                    <button disabled={!hud.hasSave} onClick={() => { g.load(); g.resume() }} className="px-5 py-3 rounded bg-white/15 hover:bg-white/25 disabled:opacity-30 font-bold">Load game</button>
                  </div>
                  <div className="text-xs text-white/50">Saves position, vehicle, parked vehicles, money, collectibles, appearance, mission progress, time and weather in this browser (localStorage). You can also save at the desk in your home.</div>
                </div>
              )}
              {tab === 'controls' && (
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                  {CONTROLS.map(([k, d]) => (
                    <div key={k} className="flex items-start gap-2 text-xs"><span className="shrink-0 w-20 text-right"><Key k={k} /></span><span className="text-white/75">{d}</span></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- customise ---------- */}
      {custom && g && (
        <div className="absolute inset-y-0 right-0 w-[min(380px,100vw)] bg-[#101814]/95 border-l border-white/10 p-5 overflow-auto">
          <div className="text-xl font-black mb-4">Customise character</div>
          <Swatches title="Skin tone" options={SKINS} value={hud.look.skin} onPick={(c) => g.setLook({ skin: c })} />
          <Swatches title="Shirt" options={PALETTE_SHIRT} value={hud.look.shirt} onPick={(c) => g.setLook({ shirt: c })} />
          <Swatches title={hud.look.style === 'lungi' ? 'Lungi' : 'Trousers'} options={PALETTE_PANTS} value={hud.look.pants} onPick={(c) => g.setLook({ pants: c })} />
          <Swatches title="Hair" options={[0x15110e, 0x3b2a1a, 0x8a8a8a, 0xc9c9c9]} value={hud.look.hair} onPick={(c) => g.setLook({ hair: c })} />
          <div className="mb-3">
            <div className="text-xs text-white/60 mb-1">Outfit</div>
            <div className="flex gap-2">
              {[['pants', 'Shirt & trousers'], ['lungi', 'Shirt & lungi']].map(([k, l]) => (
                <button key={k} onClick={() => g.setLook({ style: k })} className={`px-3 py-2 rounded text-sm ${hud.look.style === k ? 'bg-emerald-500 text-black font-bold' : 'bg-white/10'}`}>{l}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm mb-2"><input type="checkbox" checked={!!hud.look.cap} onChange={(e) => g.setLook({ cap: e.target.checked })} /> White cap</label>
          <label className="flex items-center gap-2 text-sm mb-4"><input type="checkbox" checked={!!hud.look.towel} onChange={(e) => g.setLook({ towel: e.target.checked })} /> Towel (gamcha) on shoulder</label>
          <div className="flex gap-2">
            <button onClick={() => g.resume()} className="px-5 py-2 rounded bg-emerald-500 text-black font-bold">Done</button>
            <button onClick={() => { g.openMenu('pause'); setTab('main') }} className="px-5 py-2 rounded bg-white/15">Menu</button>
          </div>
        </div>
      )}

      {/* ---------- shop ---------- */}
      {shop && g && hud.shop && (
        <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
          <div className="w-[min(520px,94vw)] rounded-xl bg-[#17120d]/95 border border-amber-200/20 p-5 shadow-2xl">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-2xl font-black">{hud.shop.title}</div>
                <div className="text-sm text-amber-200/80">{hud.shop.kn}</div>
              </div>
              <div className="text-green-400 font-bold">₹{hud.money}</div>
            </div>
            <div className="mt-4 space-y-2">
              {hud.shop.items.map((it: any) => (
                <div key={it.id} className="flex items-center justify-between bg-white/5 rounded p-3">
                  <div>
                    <div className="font-semibold">{it.name}</div>
                    <div className="text-xs text-white/55">{it.desc}</div>
                  </div>
                  <button
                    onClick={() => g.buy(it.id)}
                    disabled={hud.money < it.price || (it.umbrella && hud.hasUmbrella)}
                    className="px-4 py-2 rounded bg-amber-400 text-black font-bold disabled:opacity-30"
                  >
                    {it.umbrella && hud.hasUmbrella ? 'Owned' : `₹${it.price}`}
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => g.closeShop()} className="mt-4 px-5 py-2 rounded bg-white/15 hover:bg-white/25">Leave counter</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Swatches({ title, options, value, onPick }: { title: string; options: number[]; value: number; onPick: (c: number) => void }) {
  return (
    <div className="mb-3">
      <div className="text-xs text-white/60 mb-1">{title}</div>
      <div className="flex gap-2 flex-wrap">
        {options.map((c) => (
          <button key={c} onClick={() => onPick(c)} className={`w-8 h-8 rounded-full border-2 ${value === c ? 'border-white' : 'border-white/20'}`} style={{ background: hex(c) }} />
        ))}
      </div>
    </div>
  )
}
