// Client side of the online protocol: join, stream state, receive world snapshots.
import type { ModeId, SyncResponse } from './mpData'

export interface JoinInfo { id: string; token: string; name: string; team: number; mode: ModeId; room: string; since: number; pickupCount: number }

export class NetClient {
  info: JoinInfo
  since: number
  rtt = 40
  offset = 0 // serverTime - localTime
  haveOffset = false
  alive = true
  last: SyncResponse | null = null
  shots: Record<string, unknown>[] = []
  claim: number | null = null
  suicide = false
  getState: () => Record<string, unknown> = () => ({})
  onSync: (r: SyncResponse) => void = () => {}
  onLost: (why: string) => void = () => {}
  private timer = 0
  private fails = 0
  private inflight = false
  private beat = () => {}

  private constructor(info: JoinInfo) {
    this.info = info
    this.since = info.since
  }

  static async join(mode: ModeId, name: string, room: string, look: unknown): Promise<NetClient> {
    const res = await fetch('/api/mp/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, name, room, look }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.error) throw new Error(j.error || 'Could not join the server')
    const n = new NetClient(j as JoinInfo)
    n.start()
    return n
  }

  /** server clock estimate in ms (epoch) */
  now() {
    return Date.now() + this.offset
  }

  private start() {
    this.beat = () => {
      if (!this.alive) return
      void this.tick()
      this.timer = window.setTimeout(this.beat, 66)
    }
    this.beat()
    window.addEventListener('pagehide', this.leaveBeacon)
  }
  private leaveBeacon = () => {
    try {
      navigator.sendBeacon('/api/mp/leave', JSON.stringify({ id: this.info.id, token: this.info.token }))
    } catch {
      /* ignore */
    }
  }

  private async tick() {
    if (this.inflight || !this.alive) return
    this.inflight = true
    const shots = this.shots.splice(0, 8)
    const claim = this.claim
    const suicide = this.suicide
    this.suicide = false
    const t0 = performance.now()
    try {
      const res = await fetch('/api/mp/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.info.id, token: this.info.token, since: this.since, st: this.getState(), shots, claim, suicide, ct: Date.now(), rtt: Math.round(this.rtt) }),
        keepalive: false,
      })
      if (res.status === 410) {
        this.fail('You were disconnected from the match')
        return
      }
      const r = (await res.json()) as SyncResponse
      const dt = performance.now() - t0
      this.rtt = this.rtt * 0.8 + dt * 0.2
      const off = r.t + dt / 2 - Date.now()
      this.offset = this.haveOffset ? this.offset * 0.9 + off * 0.1 : off
      this.haveOffset = true
      this.fails = 0
      if (claim !== null && this.claim === claim) this.claim = null
      for (const e of r.events) this.since = Math.max(this.since, e.s)
      this.last = r
      this.onSync(r)
    } catch {
      // requeue shots so they are not lost on a transient failure
      this.shots.unshift(...shots)
      if (++this.fails > 40) this.fail('Connection to the server was lost')
    } finally {
      this.inflight = false
    }
  }
  private fail(why: string) {
    this.stop(false)
    this.onLost(why)
  }
  stop(notify = true) {
    if (!this.alive) return
    this.alive = false
    clearTimeout(this.timer)
    window.removeEventListener('pagehide', this.leaveBeacon)
    if (notify) this.leaveBeacon()
  }
}
