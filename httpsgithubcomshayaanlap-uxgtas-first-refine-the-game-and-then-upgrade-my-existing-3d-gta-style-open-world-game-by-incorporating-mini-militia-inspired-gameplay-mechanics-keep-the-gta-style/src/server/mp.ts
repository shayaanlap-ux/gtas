// Authoritative multiplayer game server (runs inside the Next.js Node process).
// Clients stream their own state ~15x/second and get back everyone else's state, events,
// health/kill results and match status. Damage, health, kills, respawns, pickups, teams and
// match flow are all decided here.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchResults, playerStats } from "@/db/schema";
import {
  MODES, WEAPONS, PICKUP_RESPAWN, TEAM_NAMES, pickupsFor, spawnsFor,
  type LookData, type ModeId, type NetEvent, type NetPlayer, type PickupKind, type SyncResponse, type WeaponId,
} from "@/game/mpData";

interface SrvPlayer {
  id: string; token: string; name: string; team: number; look: LookData
  x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vy: number; vz: number
  anim: string; w: WeaponId | ''; stT: number; jet: number; crouch: number; veh: { variant: string; color: number; h: number } | null
  hp: number; alive: boolean; respawnAt: number; spawnSeq: number; spawn: { seq: number; x: number; z: number } | null
  kills: number; deaths: number; lastSeen: number; lastHurt: number; lastTick: number; protUntil: number
  hist: number[][]; bucket: Record<string, number>; bucketAt: Record<string, number>
  grants: { idx: number; kind: PickupKind }[]; hits: SyncResponse["you"]["hits"]; hurt: SyncResponse["you"]["hurt"]
  pKills: number; pDeaths: number; joinedAt: number; ping: number; lastClientT: number; ready: boolean
}
interface Room {
  key: string; mode: ModeId; code: string
  players: Map<string, SrvPlayer>
  events: NetEvent[]; seq: number
  pickups: { avail: boolean; at: number }[]
  phase: "play" | "over"; matchStart: number; overUntil: number; winner: string; no: number
  teamScore: number[]
}
interface Registry { rooms: Map<string, Room>; byId: Map<string, string> }

const g = globalThis as typeof globalThis & { __nellyMP?: Registry };
const REG: Registry = (g.__nellyMP ??= { rooms: new Map(), byId: new Map() });

const rid = () => Math.random().toString(36).slice(2, 10);
const clean = (s: unknown, max: number, fallback: string) => {
  const t = String(s ?? "").replace(/[^\w \-.]/g, "").trim().slice(0, max);
  return t || fallback;
};
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------ persistence
async function persist(rows: { name: string; kills: number; deaths: number; matches: number; wins: number }[]) {
  for (const r of rows) {
    if (!r.kills && !r.deaths && !r.matches) continue;
    try {
      await db
        .insert(playerStats)
        .values({ name: r.name, kills: r.kills, deaths: r.deaths, matches: r.matches, wins: r.wins })
        .onConflictDoUpdate({
          target: playerStats.name,
          set: {
            kills: sql`${playerStats.kills} + ${r.kills}`,
            deaths: sql`${playerStats.deaths} + ${r.deaths}`,
            matches: sql`${playerStats.matches} + ${r.matches}`,
            wins: sql`${playerStats.wins} + ${r.wins}`,
            updatedAt: new Date(),
          },
        });
    } catch (e) {
      console.error("[mp] persist failed", (e as Error).message);
      return;
    }
  }
}
function flushPlayer(p: SrvPlayer, matches = 0, wins = 0) {
  const k = p.kills - p.pKills, d = p.deaths - p.pDeaths;
  p.pKills = p.kills;
  p.pDeaths = p.deaths;
  void persist([{ name: p.name, kills: k, deaths: d, matches, wins }]);
}

// ------------------------------------------------------------------ rooms
function getRoom(mode: ModeId, code: string): Room {
  const key = `${mode}:${code}`;
  let r = REG.rooms.get(key);
  if (!r) {
    const defs = pickupsFor(mode);
    r = {
      key, mode, code, players: new Map(), events: [], seq: 1,
      pickups: defs.map(() => ({ avail: true, at: 0 })),
      phase: "play", matchStart: Date.now(), overUntil: 0, winner: "", no: 1, teamScore: [0, 0],
    };
    REG.rooms.set(key, r);
  }
  return r;
}
function emit(room: Room, ev: Omit<NetEvent, "s" | "t">) {
  room.events.push({ ...ev, s: room.seq++, t: Date.now() } as NetEvent);
  if (room.events.length > 160) room.events.splice(0, room.events.length - 160);
}
function pickSpawn(room: Room, self: SrvPlayer) {
  const list = spawnsFor(room.mode);
  const others = [...room.players.values()].filter((o) => o !== self && o.alive);
  let best: { x: number; z: number; s: number }[] = [];
  for (const sp of list) {
    let md = 1e9;
    for (const o of others) {
      const d = Math.hypot(o.x - sp.x, o.z - sp.z);
      if (MODES[room.mode].teams && o.team === self.team) continue;
      md = Math.min(md, d);
    }
    best.push({ ...sp, s: md });
  }
  best.sort((a, b) => b.s - a.s);
  best = best.slice(0, 4);
  return best[Math.floor(Math.random() * best.length)] ?? { x: 0, z: 2, s: 0 };
}
function spawnPlayer(room: Room, p: SrvPlayer, now: number) {
  const sp = pickSpawn(room, p);
  p.alive = true;
  p.hp = 100;
  p.protUntil = now + 2500;
  p.spawnSeq++;
  p.spawn = { seq: p.spawnSeq, x: sp.x, z: sp.z };
  p.x = sp.x;
  p.z = sp.z;
  p.hist.length = 0;
  p.lastHurt = 0;
  emit(room, { k: "spawn", id: p.id });
}
function assignTeam(room: Room) {
  if (!MODES[room.mode].teams) return -1;
  const c = [0, 0];
  for (const p of room.players.values()) if (p.team >= 0) c[p.team]++;
  if (c[0] !== c[1]) return c[0] < c[1] ? 0 : 1;
  return room.teamScore[0] === room.teamScore[1] ? Math.floor(Math.random() * 2) : room.teamScore[0] < room.teamScore[1] ? 0 : 1;
}

function endMatch(room: Room, now: number) {
  const m = MODES[room.mode];
  const list = [...room.players.values()];
  let winner = "Draw";
  let winnerTeam = -2;
  if (m.teams) {
    if (room.teamScore[0] !== room.teamScore[1]) winnerTeam = room.teamScore[0] > room.teamScore[1] ? 0 : 1;
    winner = winnerTeam >= 0 ? `${TEAM_NAMES[winnerTeam]} team` : "Draw";
  } else {
    const top = [...list].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    if (top && top.kills > 0) winner = top.name;
  }
  room.phase = "over";
  room.winner = winner;
  room.overUntil = now + 12000;
  emit(room, { k: "match", what: "over", winner });
  const rows = list.map((p) => ({
    name: p.name, kills: p.kills - p.pKills, deaths: p.deaths - p.pDeaths, matches: 1,
    wins: m.teams ? (p.team === winnerTeam ? 1 : 0) : p.name === winner ? 1 : 0,
  }));
  list.forEach((p) => { p.pKills = p.kills; p.pDeaths = p.deaths; });
  void persist(rows);
  if (list.length) {
    void db
      .insert(matchResults)
      .values({
        mode: room.mode, room: room.code, winner,
        scores: list.map((p) => ({ name: p.name, team: p.team, kills: p.kills, deaths: p.deaths })).concat([]),
      })
      .catch((e: Error) => console.error("[mp] match save failed", e.message));
  }
}
function newMatch(room: Room, now: number) {
  room.phase = "play";
  room.no++;
  room.matchStart = now;
  room.winner = "";
  room.teamScore = [0, 0];
  room.pickups.forEach((p) => { p.avail = true; p.at = 0; });
  for (const p of room.players.values()) {
    p.kills = p.deaths = p.pKills = p.pDeaths = 0;
    spawnPlayer(room, p, now);
  }
  emit(room, { k: "match", what: "start", no: room.no });
}

function tickRoom(room: Room, now: number) {
  const m = MODES[room.mode];
  // drop stale players
  for (const p of [...room.players.values()]) {
    if (now - p.lastSeen > 9000) removePlayer(room, p, "timeout");
  }
  // pickups
  room.pickups.forEach((pk) => { if (!pk.avail && now >= pk.at) pk.avail = true; });
  // match flow
  if (room.phase === "play" && (m.scoreLimit || m.timeLimit)) {
    const best = m.teams ? Math.max(...room.teamScore) : Math.max(0, ...[...room.players.values()].map((p) => p.kills));
    const timeUp = m.timeLimit > 0 && now - room.matchStart >= m.timeLimit * 1000;
    if ((m.scoreLimit && best >= m.scoreLimit) || (timeUp && room.players.size > 0)) endMatch(room, now);
    else if (timeUp) room.matchStart = now;
  } else if (room.phase === "over" && now >= room.overUntil) newMatch(room, now);
  // players: respawn + regen
  for (const p of room.players.values()) {
    const dt = Math.min(1, (now - p.lastTick) / 1000);
    p.lastTick = now;
    if (!p.alive && room.phase === "play" && now >= p.respawnAt) spawnPlayer(room, p, now);
    else if (p.alive && p.hp < 100 && p.lastHurt && now - p.lastHurt > 6000) p.hp = Math.min(100, p.hp + 6 * dt);
  }
  // prune old events
  const cutoff = now - 20000;
  while (room.events.length && room.events[0].t < cutoff) room.events.shift();
}
function removePlayer(room: Room, p: SrvPlayer, why: string) {
  room.players.delete(p.id);
  REG.byId.delete(p.id);
  flushPlayer(p);
  emit(room, { k: "leave", id: p.id, name: p.name, why });
  if (room.players.size === 0) REG.rooms.delete(room.key);
}

// ------------------------------------------------------------------ hit detection
function posAt(p: SrvPlayer, t: number): [number, number, number] {
  const h = p.hist;
  if (h.length < 2 || t >= h[h.length - 1][0]) return [p.x, p.y, p.z];
  if (t <= h[0][0]) return [h[0][1], h[0][2], h[0][3]];
  for (let i = h.length - 1; i > 0; i--) {
    if (h[i - 1][0] <= t) {
      const a = h[i - 1], b = h[i];
      const k = (t - a[0]) / Math.max(1, b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [p.x, p.y, p.z];
}
function raySphere(o: number[], d: number[], cx: number, cy: number, cz: number, r: number) {
  const ox = o[0] - cx, oy = o[1] - cy, oz = o[2] - cz;
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : c < 0 ? 0 : -1;
}
function rayCyl(o: number[], d: number[], cx: number, y0: number, cz: number, h: number, r: number) {
  const ox = o[0] - cx, oz = o[2] - cz;
  const a = d[0] * d[0] + d[2] * d[2];
  let t0 = 0, t1 = 1e9;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > r * r) return -1;
  } else {
    const b = ox * d[0] + oz * d[2];
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    t0 = (-b - s) / a;
    t1 = (-b + s) / a;
    if (t1 < 0) return -1;
    t0 = Math.max(0, t0);
  }
  // clip by height slab
  if (Math.abs(d[1]) < 1e-9) {
    if (o[1] < y0 || o[1] > y0 + h) return -1;
  } else {
    let ta = (y0 - o[1]) / d[1], tb = (y0 + h - o[1]) / d[1];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1 ? t0 : -1;
}

function processShot(room: Room, p: SrvPlayer, shot: Record<string, unknown>, now: number) {
  if (!p.alive || room.phase !== "play") return;
  const wid = String(shot.w) as WeaponId;
  const def = WEAPONS[wid];
  if (!def) return;
  // fire-rate limiter (leaky bucket, tolerant of batching)
  const interval = 60000 / def.rpm;
  const last = p.bucketAt[wid] ?? now - interval * 3;
  p.bucket[wid] = Math.min(3, (p.bucket[wid] ?? 1) + (now - last) / interval);
  p.bucketAt[wid] = now;
  if (p.bucket[wid] < 0.85) return;
  p.bucket[wid] -= 1;

  const oRaw = Array.isArray(shot.o) ? (shot.o as unknown[]).map((v) => num(v)) : [p.x, p.y + 1.4, p.z];
  let o = [oRaw[0] ?? p.x, oRaw[1] ?? p.y + 1.4, oRaw[2] ?? p.z];
  if (Math.hypot(o[0] - p.x, o[1] - (p.y + 1.4), o[2] - p.z) > 5) o = [p.x, p.y + 1.4, p.z];
  const rays = Array.isArray(shot.rays) ? (shot.rays as unknown[][]).slice(0, def.pellets) : [];
  const m = MODES[room.mode];
  const tShot = now - 130;
  const dmgBy = new Map<string, { dmg: number; head: boolean; p: SrvPlayer }>();
  const ends: number[][] = [];
  for (const r of rays) {
    let dx = num(r[0]), dy = num(r[1]), dz = num(r[2]);
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) continue;
    dx /= L; dy /= L; dz /= L;
    const d = [dx, dy, dz];
    const range = Math.max(1, Math.min(def.range, num(r[3], def.range)));
    let bestT = range, bestQ: SrvPlayer | null = null, bestHead = false;
    for (const q of room.players.values()) {
      if (q === p || !q.alive || now < q.protUntil) continue;
      if (m.teams && q.team === p.team) continue;
      const [qx, qy, qz] = posAt(q, tShot);
      const hc = q.crouch ? 1.12 : 1.58;
      const th = raySphere(o, d, qx, qy + hc, qz, 0.24);
      const tb = rayCyl(o, d, qx, qy, qz, q.crouch ? 1.3 : 1.78, 0.42);
      if (th >= 0 && th <= bestT && (tb < 0 || th <= tb + 0.4)) { bestT = th; bestQ = q; bestHead = true; }
      else if (tb >= 0 && tb < bestT) { bestT = tb; bestQ = q; bestHead = false; }
    }
    ends.push([o[0] + dx * bestT, o[1] + dy * bestT, o[2] + dz * bestT, bestQ ? 1 : 0]);
    if (bestQ) {
      const f = 1 - (1 - def.falloff) * Math.min(1, Math.max(0, (bestT - def.range * 0.25) / (def.range * 0.75)));
      const dmg = def.dmg * f * (bestHead ? def.headMult : 1);
      const e = dmgBy.get(bestQ.id) ?? { dmg: 0, head: false, p: bestQ };
      e.dmg += dmg;
      e.head = e.head || bestHead;
      dmgBy.set(bestQ.id, e);
    }
  }
  emit(room, { k: "shot", id: p.id, w: wid, o, e: ends });
  for (const e of dmgBy.values()) {
    const q = e.p;
    const dmg = Math.round(e.dmg);
    q.hp -= dmg;
    q.lastHurt = now;
    q.hurt.push({ x: p.x, z: p.z, dmg });
    const kill = q.hp <= 0;
    p.hits.push({ id: q.id, dmg, head: e.head, kill });
    if (kill) {
      q.hp = 0;
      q.alive = false;
      q.deaths++;
      q.respawnAt = now + m.respawn * 1000;
      p.kills++;
      if (m.teams && p.team >= 0) room.teamScore[p.team]++;
      emit(room, { k: "kill", killer: p.id, victim: q.id, kn: p.name, vn: q.name, kt: p.team, vt: q.team, w: wid, head: e.head });
    }
  }
}

// ------------------------------------------------------------------ public API
export function joinRoom(body: Record<string, unknown>) {
  const mode = String(body.mode) as ModeId;
  if (!MODES[mode]) return { error: "Unknown mode" };
  const code = clean(body.room, 12, "public").toLowerCase();
  const room = getRoom(mode, code);
  const now = Date.now();
  tickRoom(room, now);
  if (room.players.size >= MODES[mode].maxPlayers) return { error: "Room is full" };
  let name = clean(body.name, 16, "Player");
  const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  if (taken.has(name.toLowerCase())) {
    let n = 2;
    while (taken.has(`${name}${n}`.toLowerCase())) n++;
    name = `${name}${n}`;
  }
  const lk = (body.look ?? {}) as Record<string, unknown>;
  const look: LookData = { skin: num(lk.skin, 0xd9a577), shirt: num(lk.shirt, 0x3b6ea5), pants: num(lk.pants, 0x2b3a55), hair: num(lk.hair, 0x15110e) };
  const p: SrvPlayer = {
    id: rid(), token: rid() + rid(), name, team: assignTeam(room), look,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, anim: "idle", w: "", stT: now, jet: 0, crouch: 0, veh: null,
    hp: 100, alive: false, respawnAt: 0, spawnSeq: 0, spawn: null, kills: 0, deaths: 0, lastSeen: now, lastHurt: 0, lastTick: now, protUntil: 0,
    hist: [], bucket: {}, bucketAt: {}, grants: [], hits: [], hurt: [], pKills: 0, pDeaths: 0, joinedAt: now, ping: 0, lastClientT: 0, ready: false,
  };
  room.players.set(p.id, p);
  REG.byId.set(p.id, room.key);
  spawnPlayer(room, p, now);
  emit(room, { k: "join", id: p.id, name: p.name, team: p.team });
  return { id: p.id, token: p.token, name: p.name, team: p.team, mode, room: code, since: room.seq - 1, pickupCount: room.pickups.length };
}

export function syncRoom(body: Record<string, unknown>): SyncResponse | { error: string } {
  const id = String(body.id ?? "");
  const key = REG.byId.get(id);
  const room = key ? REG.rooms.get(key) : undefined;
  const p = room?.players.get(id);
  if (!room || !p || p.token !== body.token) return { error: "gone" };
  const now = Date.now();
  p.lastSeen = now;
  const m = MODES[room.mode];

  // state from client (trusted for movement; combat results are server-side)
  const st = (body.st ?? {}) as Record<string, unknown>;
  if (p.alive && room.phase === "play") {
    p.x = num(st.x, p.x); p.y = num(st.y, p.y); p.z = num(st.z, p.z)
    p.vx = num(st.vx); p.vy = num(st.vy); p.vz = num(st.vz)
    p.yaw = num(st.yaw, p.yaw); p.pitch = num(st.pitch, p.pitch)
    p.anim = String(st.anim ?? "idle").slice(0, 10)
    const w = String(st.w) as WeaponId
    p.w = WEAPONS[w] ? w : ""
    p.stT = now
    p.jet = num(st.jet) > 0 ? 1 : 0
    p.crouch = num(st.crouch) > 0 ? 1 : 0
    const v = st.veh as { variant?: unknown; color?: unknown; h?: unknown } | null
    p.veh = m.allowVehicles && v && typeof v === "object" ? { variant: String(v.variant ?? "sedan").slice(0, 12), color: num(v.color, 0xffffff), h: num(v.h) } : null
    p.hist.push([now, p.x, p.y, p.z]);
    if (p.hist.length > 24) p.hist.shift();
  }
  const ct = num(body.ct);
  if (ct) p.ping = Math.min(999, Math.max(0, num(body.rtt, p.ping)));
  p.lastClientT = ct;

  // suicide / stuck respawn
  if (body.suicide && p.alive && room.phase === "play") {
    p.alive = false; p.hp = 0; p.deaths++; p.respawnAt = now + m.respawn * 1000;
    emit(room, { k: "kill", killer: "", victim: p.id, kn: "", vn: p.name, kt: -1, vt: p.team, w: "pistol", head: false, suicide: true });
  }
  // shots
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]).slice(0, 8) : [];
  for (const s of shots) processShot(room, p, s, now);
  // pickup claim
  const claim = body.claim;
  if (typeof claim === "number" && p.alive && room.phase === "play") {
    const defs = pickupsFor(room.mode);
    const pk = room.pickups[claim], def = defs[claim];
    if (pk && def && pk.avail) {
      const near = Math.hypot(def.x - p.x, def.z - p.z) < 5 && (def.y === undefined || Math.abs(def.y - (p.y + 1)) < 5);
      const needs = def.kind !== "health" || p.hp < 100;
      if (near && needs) {
        pk.avail = false;
        pk.at = now + (PICKUP_RESPAWN[def.kind] ?? 20) * 1000;
        if (def.kind === "health") p.hp = Math.min(100, p.hp + 50);
        p.grants.push({ idx: claim, kind: def.kind });
        emit(room, { k: "pickup", id: p.id, idx: claim });
      }
    }
  }

  tickRoom(room, now);

  const since = num(body.since);
  const players: NetPlayer[] = [];
  for (const q of room.players.values()) {
    if (q === p) continue;
    players.push({
      id: q.id, name: q.name, team: q.team, x: q.x, y: q.y, z: q.z, yaw: q.yaw, pitch: q.pitch, vx: q.vx, vy: q.vy, vz: q.vz,
      anim: q.alive ? q.anim : "down", w: q.w, ut: q.stT, jet: q.jet, crouch: q.crouch, veh: q.veh, alive: q.alive, hp: Math.round(q.hp),
      k: q.kills, d: q.deaths, ping: q.ping, look: q.look,
    });
  }
  const grants = p.grants, hits = p.hits, hurt = p.hurt;
  p.grants = []; p.hits = []; p.hurt = [];
  const spawn = p.spawn;
  p.spawn = null;
  return {
    t: now,
    you: {
      hp: Math.round(p.hp), alive: p.alive, respawnIn: p.alive ? 0 : Math.max(0, (p.respawnAt - now) / 1000), team: p.team,
      kills: p.kills, deaths: p.deaths, spawn, grants, hits, hurt,
    },
    players,
    events: room.events.filter((e) => e.s > since),
    pu: room.pickups.map((x) => (x.avail ? "1" : "0")).join(""),
    match: {
      phase: room.phase, left: m.timeLimit ? Math.max(0, m.timeLimit - (now - room.matchStart) / 1000) : 0, limit: m.timeLimit, scoreLimit: m.scoreLimit,
      teamScore: room.teamScore, winner: room.winner, no: room.no, overLeft: room.phase === "over" ? Math.max(0, (room.overUntil - now) / 1000) : 0,
    },
  };
}

export function leaveRoom(body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const key = REG.byId.get(id);
  const room = key ? REG.rooms.get(key) : undefined;
  const p = room?.players.get(id);
  if (room && p && p.token === body.token) removePlayer(room, p, "left");
  return { ok: true };
}

export function roomSummary() {
  const out: Record<string, { players: number; rooms: number }> = {};
  for (const m of Object.keys(MODES)) out[m] = { players: 0, rooms: 0 };
  for (const r of REG.rooms.values()) {
    out[r.mode].players += r.players.size;
    out[r.mode].rooms++;
  }
  return out;
}
