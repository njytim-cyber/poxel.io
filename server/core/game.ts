// Authoritative game simulation. Environment-agnostic: runs in Node (multiplayer) and in a Web Worker
// (single player). Transports hand it decoded messages and deliver what it sends.
import { BLOCKS, BLOCK_ID, WATER, LAVA, isFacingBlock, isPlant, isSolid, itemDef, miningInfo } from '../../shared/blocks.ts';
import { makeBody, moveBody, boxIntersectsSolid, boxTouchesBlock, PLAYER_EYE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Body } from '../../shared/physics.ts';
import {
  newInv, sanitizeInv, addItem, applyAction, closeScreen, removeFromSlot, armorPoints, attackBonus,
  type Inv, type Screen, type InvAction,
} from '../../shared/inventory.ts';
import { newFurnace, tickFurnace, isFurnaceEmpty, type FurnaceState } from '../../shared/furnace.ts';
import { MOB_SPECS, MOB_KINDS } from '../../shared/mobs.ts';
import { DAY_LENGTH, daylight } from '../../shared/time.ts';
import { MIN_Y, MAX_Y } from '../../shared/worldgen.ts';
import {
  PROTOCOL_VERSION, MAX_PLAYERS, sanitizeName, sanitizeLook, isNum, isInt,
  MF_GROUND, MF_SNEAK, MF_WATER, EF_SNEAK, EF_HURT, EF_DYING, EF_GROUND, EF_SWING,
  type ClientMsg, type ServerMsg, type Look, type MobKind, type SpawnInfo, type InvState,
} from '../../shared/protocol.ts';
import { ServerWorld } from './world.ts';

export const MAX_HEALTH = 20;
const VIEW_DIST = 72;
const REACH = 6.5;          // server allows a little more than the client's 5 for latency
const ATTACK_REACH = 4.8;

// ------------------------------------------------------------------ Persistence contracts

export interface WorldSave {
  v: 1; seed: number; time: number; edits: number[]; facing: number[];
  furnaces: Record<string, FurnaceState>; spawn: [number, number, number];
}
export interface PlayerSave {
  x: number; y: number; z: number; yaw: number; pitch: number; health: number;
  inv: InvState; spawn?: [number, number, number]; homes?: { x: number; y: number; z: number; name: string }[];
  token?: string; // proves ownership of the name
}
export interface Storage {
  loadWorld(): WorldSave | null;
  saveWorld(s: WorldSave): void;
  loadPlayer(name: string): PlayerSave | null;
  savePlayer(name: string, s: PlayerSave): void;
}
export interface Conn { send(msg: ServerMsg): void; close(reason: string): void }

// ------------------------------------------------------------------ Entities

interface Player {
  kind: 'player';
  eid: number; name: string; look: Look; conn: Conn;
  body: Body; yaw: number; pitch: number; flags: number;
  lastMove: number;          // game time of last accepted move
  health: number; dead: boolean; invuln: number; sinceDamage: number; regen: number;
  lavaT: number; cactusT: number; fallStart: number;
  inv: Inv; screen: Screen | null; furnaceKey: string | null;
  spawn: [number, number, number]; homes: { x: number; y: number; z: number; name: string }[];
  attackCd: number; digCredit: number; swingUntil: number; invSeq: number;
  moveBudget: number; climbBudget: number; dropCredit: number; chatCredit: number; token: string;
  seen: Set<number>;         // entity ids this client currently knows about
  ping: number;
}
interface Mob {
  kind: MobKind; eid: number; body: Body; yaw: number; targetYaw: number; health: number;
  wander: number; moving: boolean; hurt: number; flee: number; attackCd: number; dying: number; burnT: number; lavaT: number;
}
interface Item { kind: 'item'; eid: number; type: string; count: number; body: Body; age: number; pickupDelay: number }

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const MOB_DROPS: Record<MobKind, () => [string, number][]> = {
  pig: () => [['porkchop', rnd(1, 3)]],
  cow: () => [['beef', rnd(1, 3)]],
  chicken: () => [['chicken', 1], ['feather', rnd(0, 2)]],
  zombie: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.3 ? [['bone', 1] as [string, number]] : [])],
};

export interface GameOptions { seed?: number; log?: (msg: string) => void; maxPlayers?: number }

function sanitizeFurnace(f: any): FurnaceState | null {
  if (!f || typeof f !== 'object') return null;
  const stack = (s: any) => (s && typeof s.type === 'string' && Number.isInteger(s.count) && s.count > 0 ? { type: s.type, count: Math.min(64, s.count) } : null);
  const num = (v: any) => (isNum(v) && v >= 0 ? Math.min(v, 1000) : 0);
  return { input: stack(f.input), fuel: stack(f.fuel), output: stack(f.output), burnLeft: num(f.burnLeft), burnTotal: num(f.burnTotal), progress: num(f.progress) };
}

export class Game {
  readonly world: ServerWorld;
  time = 0.3;
  paused = false;
  private storage: Storage;
  private log: (msg: string) => void;
  private maxPlayers: number;
  private players = new Map<number, Player>();
  private mobs = new Map<number, Mob>();
  private items = new Map<number, Item>();
  private furnaces = new Map<string, FurnaceState>();
  private spawnPoint: [number, number, number];
  private nextEid = 1;
  private clock = 0;          // seconds of game time
  private pendingBlocks: number[] = [];
  private tickCount = 0;
  private spawnTimer = 0;
  private dirty = false;

  constructor(storage: Storage, opts: GameOptions = {}) {
    this.storage = storage;
    this.log = opts.log || (() => {});
    this.maxPlayers = opts.maxPlayers || MAX_PLAYERS;
    const save = storage.loadWorld();
    const seed = save?.seed ?? opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    this.world = new ServerWorld(seed);
    if (save) {
      this.world.importEdits(save.edits || []);
      this.world.importFacing(save.facing || []);
      this.time = isNum(save.time) ? save.time : 0.3;
      for (const [k, f] of Object.entries(save.furnaces || {})) { const clean = sanitizeFurnace(f); if (clean) this.furnaces.set(k, clean); }
    }
    const sp = save?.spawn;
    this.spawnPoint = Array.isArray(sp) && sp.length === 3 && sp.every(isNum) ? sp : this.world.findSpawn();
    this.log(`World seed ${seed}, spawn ${this.spawnPoint.map(v => v.toFixed(1)).join(', ')}`);
  }

  get playerCount() { return this.players.size; }

  // ---------------------------------------------------------------- Join / leave

  join(conn: Conn, hello: any): Player | null {
    if (!hello || hello.t !== 'hello' || hello.v !== PROTOCOL_VERSION) { conn.close('Version mismatch: please refresh the page'); return null; }
    if (this.players.size >= this.maxPlayers) { conn.close('Server is full'); return null; }
    const name = sanitizeName(hello.name);
    const token = typeof hello.token === 'string' ? hello.token.slice(0, 64) : '';
    const online = [...this.players.values()].find(o => o.name.toLowerCase() === name.toLowerCase());
    if (online) {
      // Same person reconnecting before their old connection timed out: replace the stale one
      if (token && online.token === token) { online.conn.close('Connected again from somewhere else'); this.leave(online); }
      else { conn.close(`The name "${name}" is already playing. Pick another name.`); return null; }
    }
    const saved = this.storage.loadPlayer(name);
    if (saved?.token && saved.token !== token) { conn.close(`The name "${name}" belongs to another player. Pick another name.`); return null; }
    const spawn = saved?.spawn || this.spawnPoint;
    const pos = saved && [saved.x, saved.y, saved.z].every(isNum) ? { x: saved.x, y: saved.y, z: saved.z } : { x: spawn[0], y: spawn[1], z: spawn[2] };
    // Don't start inside blocks (terrain may have changed)
    if (boxIntersectsSolid(this.world.get, pos.x, pos.y, pos.z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) pos.y = this.world.surfaceHeight(Math.floor(pos.x), Math.floor(pos.z)) + 1;

    const p: Player = {
      kind: 'player', eid: this.nextEid++, name, look: sanitizeLook(hello.look), conn,
      body: makeBody(PLAYER_HALF_WIDTH, PLAYER_HEIGHT, pos), yaw: saved?.yaw || 0, pitch: saved?.pitch || 0, flags: MF_GROUND,
      lastMove: this.clock, health: Math.max(1, Math.min(MAX_HEALTH, saved?.health ?? MAX_HEALTH)), dead: false,
      invuln: 2, sinceDamage: 99, regen: 0, lavaT: 0, cactusT: 0, fallStart: pos.y,
      inv: saved ? sanitizeInv(saved.inv) : newInv(), screen: null, furnaceKey: null,
      spawn: [...spawn] as [number, number, number], homes: Array.isArray(saved?.homes) ? saved!.homes!.slice(0, 4) : [],
      attackCd: 0, digCredit: 1, swingUntil: 0, invSeq: 0, seen: new Set(), ping: 0,
      moveBudget: 3, climbBudget: 3, dropCredit: 8, chatCredit: 5, token,
    };
    this.players.set(p.eid, p);
    conn.send({
      t: 'welcome', eid: p.eid, seed: this.world.seed, time: this.time,
      edits: this.world.exportEdits(), facing: this.world.exportFacing(),
      you: { ...pos, yaw: p.yaw, pitch: p.pitch, health: p.health, inv: this.invState(p), spawn: p.spawn },
    });
    this.sendHomes(p);
    if (this.maxPlayers > 1) this.broadcast({ t: 'chat', from: null, text: `${name} joined the game` });
    this.log(`${name} joined (${this.players.size} online)`);
    this.sendPlayerList();
    return p;
  }

  leave(p: Player) {
    if (!this.players.has(p.eid)) return;
    // Remove first so a failing save can never leave a ghost player occupying a slot
    this.players.delete(p.eid);
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    this.safe(() => this.savePlayer(p), `saving ${p.name}`);
    // Save the world too, so nothing a player took can reappear if the server dies before the next autosave
    if (this.dirty) this.safe(() => { this.storage.saveWorld(this.worldSave()); this.dirty = false; }, 'saving world');
    for (const o of this.players.values()) if (o.seen.delete(p.eid)) o.conn.send({ t: 'despawn', eids: [p.eid] });
    if (this.maxPlayers > 1) this.broadcast({ t: 'chat', from: null, text: `${p.name} left the game` });
    this.log(`${p.name} left (${this.players.size} online)`);
    this.sendPlayerList();
  }

  // ---------------------------------------------------------------- Messages

  handle(p: Player, msg: ClientMsg) {
    if (!msg || typeof msg !== 'object' || !this.players.has(p.eid)) return;
    switch (msg.t) {
      case 'move': return this.onMove(p, msg);
      case 'dig': return this.onDig(p, msg);
      case 'place': return this.onPlace(p, msg);
      case 'open': return this.onOpen(p, msg);
      case 'screen': return this.onScreen(p, msg.mode);
      case 'inv': if (isInt(msg.seq)) p.invSeq = msg.seq; return this.onInv(p, msg.action);
      case 'select':
        if (isInt(msg.slot) && msg.slot >= 0 && msg.slot < 9) { p.inv.selected = msg.slot; this.broadcastEquip(p); }
        return;
      case 'eat': return this.onEat(p);
      case 'drop': return this.onDrop(p, !!msg.all);
      case 'attack': return this.onAttack(p, msg.eid);
      case 'swing': p.swingUntil = this.clock + 0.25; return;
      case 'chat': return this.onChat(p, msg.text);
      case 'respawn': return this.onRespawn(p);
      case 'sethome': return this.onSetHome(p);
      case 'gohome': if (isInt(msg.i)) this.onGoHome(p, msg.i); return;
      case 'ping': if (isNum(msg.ts)) p.conn.send({ t: 'pong', ts: msg.ts }); return;
    }
  }

  private onMove(p: Player, m: Extract<ClientMsg, { t: 'move' }>) {
    if (p.dead || ![m.x, m.y, m.z, m.yaw, m.pitch].every(isNum)) return;
    const b = p.body;
    const dx = m.x - b.pos.x, dy = m.y - b.pos.y, dz = m.z - b.pos.z;
    const horiz = Math.hypot(dx, dz);
    // Movement budget refills with time (see updatePlayer), so batching or holding back moves can't
    // buy extra speed. Generous enough for sprinting, knockback and lag bursts.
    if (horiz > p.moveBudget || dy > p.climbBudget || m.y < MIN_Y - 60 || m.y > 400) {
      p.conn.send({ t: 'pos', x: b.pos.x, y: b.pos.y, z: b.pos.z });
      p.lastMove = this.clock;
      return;
    }
    p.moveBudget -= horiz;
    if (dy > 0) p.climbBudget -= dy;
    b.pos.x = m.x; b.pos.y = m.y; b.pos.z = m.z;
    p.yaw = m.yaw; p.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
    p.lastMove = this.clock;
    const wasGround = !!(p.flags & MF_GROUND);
    p.flags = m.flags | 0;
    const ground = !!(p.flags & MF_GROUND), water = !!(p.flags & MF_WATER);

    // Fall damage from the movement stream
    if (!ground && !water) p.fallStart = Math.max(p.fallStart, b.pos.y);
    if (ground && !wasGround) {
      const fell = p.fallStart - b.pos.y;
      if (fell > 3.5) this.damagePlayer(p, Math.floor(fell - 3), null, 'fall');
    }
    if (ground || water) p.fallStart = b.pos.y;
  }

  private eye(p: Player) { return { x: p.body.pos.x, y: p.body.pos.y + PLAYER_EYE, z: p.body.pos.z }; }
  private inReach(p: Player, x: number, y: number, z: number, reach: number) {
    const e = this.eye(p);
    return Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y, z + 0.5 - e.z) <= reach + 0.9;
  }

  private rejectBlock(p: Player, x: number, y: number, z: number) {
    if (!this.inReach(p, x, y, z, 16)) return; // never generate terrain far from the player on request
    const f = this.world.facing.get(`${x},${y},${z}`);
    p.conn.send({ t: 'blocks', list: [x, y, z, this.world.get(x, y, z), f ?? -1] });
  }

  private setBlock(x: number, y: number, z: number, id: number, facing = -1) {
    this.world.set(x, y, z, id, facing);
    this.pendingBlocks.push(x, y, z, id, isFacingBlock(id) ? facing : -1);
    this.dirty = true;
  }

  private onDig(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt) || !this.inReach(p, x, y, z, REACH)) return;
    const id = this.world.get(x, y, z);
    const heldType = p.inv.slots[p.inv.selected]?.type || null;
    const info = miningInfo(id, heldType);
    // Mining speed check: each break spends credit proportional to how long it should take
    const cost = Math.min(1, info.time * 0.6);
    if (p.dead || id === 0 || id === WATER || id === LAVA || info.time === Infinity || !this.inReach(p, x, y, z, REACH) || p.digCredit < cost) {
      this.rejectBlock(p, x, y, z);
      return;
    }
    p.digCredit -= cost;
    this.setBlock(x, y, z, 0);
    const cx = x + 0.5, cy = y + 0.3, cz = z + 0.5;
    const key = `${x},${y},${z}`;
    if (id === BLOCK_ID.furnace) {
      const f = this.furnaces.get(key);
      if (f) for (const s of [f.input, f.fuel, f.output]) if (s) this.spawnItem(s.type, s.count, cx, cy, cz);
      this.furnaces.delete(key);
      for (const o of this.players.values()) if (o.furnaceKey === key) this.forceCloseScreen(o);
    }
    if (info.drops) {
      let drop = BLOCKS[id].drop;
      if (id === BLOCK_ID.gravel && Math.random() < 0.1) drop = 'flint';
      if (id === BLOCK_ID.leaves) drop = Math.random() < 0.05 ? 'apple' : Math.random() < 0.05 ? 'stick' : null;
      if (drop) this.spawnItem(drop, 1, cx, cy, cz);
    } else if (BLOCKS[id].harvestTier >= 0) {
      p.conn.send({ t: 'toast', text: 'You need a better pickaxe to get anything from this' });
    }
    // Plants lose their support
    const above = this.world.get(x, y + 1, z);
    if (isPlant(above)) {
      this.setBlock(x, y + 1, z, 0);
      const d = BLOCKS[above].drop;
      if (d) this.spawnItem(d, 1, cx, cy + 1, cz);
    }
    this.flowInto(x, y, z);
  }

  // Neighbouring water/lava flows into a new hole and keeps falling
  private flowInto(x: number, y: number, z: number) {
    const g = this.world.get;
    const nbs = [g(x, y + 1, z), g(x + 1, y, z), g(x - 1, y, z), g(x, y, z + 1), g(x, y, z - 1)];
    const liquid = nbs.includes(LAVA) ? LAVA : nbs.includes(WATER) ? WATER : 0;
    if (!liquid) return;
    for (let i = 0, yy = y; i < 24 && g(x, yy, z) === 0; i++, yy--) this.setBlock(x, yy, z, liquid);
  }

  private onPlace(p: Player, m: Extract<ClientMsg, { t: 'place' }>) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt) || y < MIN_Y || y > MAX_Y || !this.inReach(p, x, y, z, REACH + 0.5)) { this.sendInv(p); return; }
    const slot = p.inv.slots[p.inv.selected];
    const def = slot ? itemDef(slot.type) : null;
    const existing = this.world.get(x, y, z);
    const ok = !p.dead && def && def.block !== undefined && this.inReach(p, x, y, z, REACH + 0.5) &&
      (existing === 0 || existing === WATER || existing === LAVA || isPlant(existing)) &&
      !this.entityInBlock(x, y, z) && this.hasSupport(x, y, z) &&
      (!BLOCKS[def.block].plant || [BLOCK_ID.grass, BLOCK_ID.dirt, BLOCK_ID.snowy_grass].includes(this.world.get(x, y - 1, z)));
    if (!ok) { this.rejectBlock(p, x, y, z); this.sendInv(p); return; }
    this.setBlock(x, y, z, def!.block!, isInt(m.facing) ? m.facing & 3 : 0);
    removeFromSlot(p.inv, p.inv.selected, 1);
    this.sendInv(p);
    this.broadcastEquip(p);
  }

  private hasSupport(x: number, y: number, z: number) {
    const g = this.world.get;
    return [g(x + 1, y, z), g(x - 1, y, z), g(x, y + 1, z), g(x, y - 1, z), g(x, y, z + 1), g(x, y, z - 1)].some(id => id !== 0 && id !== WATER && id !== LAVA);
  }

  private entityInBlock(x: number, y: number, z: number): boolean {
    const hit = (b: Body) => b.pos.x + b.halfW > x && b.pos.x - b.halfW < x + 1 && b.pos.z + b.halfW > z && b.pos.z - b.halfW < z + 1 &&
      b.pos.y + b.height > y && b.pos.y < y + 1;
    for (const p of this.players.values()) if (!p.dead && hit(p.body)) return true;
    for (const m of this.mobs.values()) if (m.dying < 0 && hit(m.body)) return true;
    return false;
  }

  private onOpen(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (p.dead || ![x, y, z].every(isInt) || !this.inReach(p, x, y, z, REACH)) { p.conn.send({ t: 'screen', mode: null }); return; }
    const id = this.world.get(x, y, z);
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    if (id === BLOCK_ID.crafting_table) {
      p.screen = { mode: 'table', furnace: null }; p.furnaceKey = null;
      p.conn.send({ t: 'screen', mode: 'table' });
    } else if (id === BLOCK_ID.furnace) {
      const key = `${x},${y},${z}`;
      let f = this.furnaces.get(key);
      if (!f) { f = newFurnace(); this.furnaces.set(key, f); }
      p.screen = { mode: 'furnace', furnace: f }; p.furnaceKey = key;
      p.conn.send({ t: 'screen', mode: 'furnace', furnace: f });
    } else {
      p.screen = null; p.furnaceKey = null;
      p.conn.send({ t: 'screen', mode: null });
    }
    this.sendInv(p);
  }

  private onScreen(p: Player, mode: 'inventory' | null) {
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    p.screen = mode === 'inventory' && !p.dead ? { mode: 'inventory', furnace: null } : null;
    p.furnaceKey = null;
    this.sendInv(p);
    this.broadcastEquip(p);
  }

  private forceCloseScreen(p: Player) {
    if (!p.screen) return;
    closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    p.screen = null; p.furnaceKey = null;
    p.conn.send({ t: 'screen', mode: null });
    this.sendInv(p);
  }

  private onInv(p: Player, action: InvAction) {
    if (!p.screen || !action || typeof action !== 'object') { this.sendInv(p); return; }
    applyAction(p.inv, p.screen, action, (t, n) => this.dropFrom(p, t, n));
    if (action.a === 'close') { p.screen = null; p.furnaceKey = null; }
    this.sendInv(p);
    this.broadcastEquip(p);
    if (p.furnaceKey) this.sendFurnace(p.furnaceKey);
    this.dirty = true;
  }

  private onEat(p: Player) {
    const it = p.inv.slots[p.inv.selected];
    const food = it ? itemDef(it.type).food : 0;
    if (p.dead || !food || p.health >= MAX_HEALTH) return;
    p.health = Math.min(MAX_HEALTH, p.health + food);
    removeFromSlot(p.inv, p.inv.selected, 1);
    p.conn.send({ t: 'health', hp: p.health });
    p.conn.send({ t: 'toast', text: `Ate ${itemDef(it!.type).name} (+${food / 2} ♥)` });
    this.sendInv(p);
  }

  private onDrop(p: Player, all: boolean) {
    const it = p.inv.slots[p.inv.selected];
    if (p.dead || !it) return;
    const n = all ? it.count : 1;
    const type = it.type;
    removeFromSlot(p.inv, p.inv.selected, n);
    this.dropFrom(p, type, n);
    this.sendInv(p);
    this.broadcastEquip(p);
  }

  // Throws items forward from the player's eyes
  private dropFrom(p: Player, type: string, count: number) {
    if (p.dropCredit < 1 && this.players.has(p.eid)) {
      // Dropping too fast: keep the items instead (nothing is lost)
      const left = addItem(p.inv, type, count);
      if (left <= 0) return;
      count = left;
    }
    p.dropCredit = Math.max(0, p.dropCredit - 1);
    const e = this.eye(p);
    const dx = -Math.sin(p.yaw) * Math.cos(p.pitch), dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
    this.spawnItem(type, count, e.x + dx * 0.4, e.y - 0.3, e.z + dz * 0.4, { x: dx * 6, y: dy * 6 + 2, z: dz * 6 }, 1.5);
  }

  private onAttack(p: Player, eid: number) {
    if (p.dead || !isInt(eid) || p.attackCd > 0) return;
    const target = this.mobs.get(eid) || this.players.get(eid);
    if (!target || target === p) return;
    const b = target.body, e = this.eye(p);
    const cx = Math.max(b.pos.x - b.halfW, Math.min(e.x, b.pos.x + b.halfW));
    const cy = Math.max(b.pos.y, Math.min(e.y, b.pos.y + b.height));
    const cz = Math.max(b.pos.z - b.halfW, Math.min(e.z, b.pos.z + b.halfW));
    if (Math.hypot(cx - e.x, cy - e.y, cz - e.z) > ATTACK_REACH) return;
    p.attackCd = 0.3;
    p.swingUntil = this.clock + 0.25;
    const held = p.inv.slots[p.inv.selected];
    const dmg = (held ? itemDef(held.type).damage || 1 : 1) + attackBonus(p.inv);
    if (target.kind === 'player') this.damagePlayer(target, dmg, p.body.pos, 'player', p.name);
    else this.damageMob(target, dmg, p.body.pos);
  }

  private onChat(p: Player, raw: unknown) {
    const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    if (!text) return;
    if (p.chatCredit < 1) { p.conn.send({ t: 'chat', from: null, text: 'You are sending messages too fast.' }); return; }
    p.chatCredit--;
    if (text === '/players' || text === '/list') {
      p.conn.send({ t: 'chat', from: null, text: `Online (${this.players.size}): ${[...this.players.values()].map(o => o.name).join(', ')}` });
      return;
    }
    if (text === '/help') {
      p.conn.send({ t: 'chat', from: null, text: 'Commands: /players, /spawn, /kill' });
      return;
    }
    if (text === '/kill') { if (!p.dead) { p.health = 0; p.conn.send({ t: 'health', hp: 0 }); this.killPlayer(p, 'kill'); } return; }
    if (text === '/spawn') { this.teleport(p, p.spawn[0], p.spawn[1], p.spawn[2]); return; }
    this.broadcast({ t: 'chat', from: p.name, text });
    this.log(`<${p.name}> ${text}`);
  }

  private onRespawn(p: Player) {
    if (!p.dead) return;
    p.dead = false;
    p.health = MAX_HEALTH;
    p.invuln = 2;
    this.teleport(p, p.spawn[0], p.spawn[1], p.spawn[2]);
    p.conn.send({ t: 'health', hp: p.health });
  }

  private teleport(p: Player, x: number, y: number, z: number) {
    p.body.pos.x = x; p.body.pos.y = y; p.body.pos.z = z;
    p.fallStart = y;
    p.moveBudget = p.climbBudget = 3;
    p.lastMove = this.clock;
    p.conn.send({ t: 'pos', x, y, z });
  }

  private etheritePieces(p: Player) {
    let n = 0;
    for (let i = 55; i <= 58; i++) if (p.inv.slots[i]?.type.startsWith('etherite_')) n++;
    return n;
  }

  private onSetHome(p: Player) {
    const slots = this.etheritePieces(p);
    if (p.dead || slots <= 0) return;
    const h = { x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, name: '' };
    if (p.homes.length < slots) p.homes.push(h); else p.homes[p.homes.length - 1] = h;
    p.homes.forEach((home, i) => { home.name = `Home ${i + 1}`; });
    p.conn.send({ t: 'toast', text: 'Home set!' });
    this.sendHomes(p);
  }

  private onGoHome(p: Player, i: number) {
    const h = p.homes[i];
    if (!h || p.dead || i >= this.etheritePieces(p)) return;
    this.teleport(p, h.x, h.y, h.z);
  }

  private sendHomes(p: Player) {
    p.conn.send({ t: 'homes', list: p.homes, slots: this.etheritePieces(p) });
  }

  // ---------------------------------------------------------------- Health

  damagePlayer(p: Player, amount: number, from: { x: number; y: number; z: number } | null, cause: string, by?: string) {
    if (p.dead || p.invuln > 0 || amount <= 0) return;
    let dmg = amount;
    if (cause !== 'fall' && cause !== 'lava' && cause !== 'void') dmg *= 1 - Math.min(20, armorPoints(p.inv)) * 0.04;
    dmg = Math.max(1, Math.round(dmg));
    p.health = Math.max(0, p.health - dmg);
    p.invuln = 0.5;
    p.sinceDamage = 0;
    p.conn.send({ t: 'health', hp: p.health });
    p.conn.send({ t: 'hurt', from: from ? [from.x, from.y, from.z] : null, knock: from ? 7 : 0 });
    this.broadcastAnim(p.eid, 'hurt');
    if (p.health <= 0) this.killPlayer(p, cause, by);
  }

  private killPlayer(p: Player, cause: string, by?: string) {
    p.dead = true;
    if (p.screen) { closeScreen(p.inv, () => {}); p.screen = null; p.furnaceKey = null; }
    const { x, y, z } = p.body.pos;
    for (let i = 0; i < p.inv.slots.length; i++) {
      const it = p.inv.slots[i];
      if (it && i !== 54) this.spawnItem(it.type, it.count, x, y + 1, z, { x: (Math.random() - 0.5) * 6, y: 4, z: (Math.random() - 0.5) * 6 }, 1);
    }
    p.inv = newInv();
    this.sendInv(p);
    const messages: Record<string, string> = {
      fall: 'hit the ground too hard', lava: 'tried to swim in lava', zombie: 'was slain by a Zombie',
      cactus: 'was pricked to death', void: 'fell out of the world', player: `was slain by ${by || 'a player'}`, kill: 'died',
    };
    const msg = messages[cause] || 'died';
    p.conn.send({ t: 'death', msg: `You ${msg.replace(/^was /, 'were ')}` });
    this.broadcast({ t: 'chat', from: null, text: `${p.name} ${msg}` });
  }

  private damageMob(m: Mob, amount: number, from: { x: number; y: number; z: number }) {
    if (m.dying >= 0 || m.hurt > 0.35) return;
    m.health -= amount;
    m.hurt = 0.5;
    const dx = m.body.pos.x - from.x, dz = m.body.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    m.body.vel.x = (dx / d) * 6; m.body.vel.z = (dz / d) * 6; m.body.vel.y = 5;
    if (!MOB_SPECS[m.kind].hostile) m.flee = 4;
    if (m.health <= 0) m.dying = 0;
  }

  // ---------------------------------------------------------------- Items

  spawnItem(type: string, count: number, x: number, y: number, z: number, vel?: { x: number; y: number; z: number }, pickupDelay = 0.5) {
    if (count <= 0 || !itemDef(type)) return;
    // Merge into an identical item lying right there instead of adding another entity
    const max = itemDef(type).stack;
    for (const o of this.items.values()) {
      if (o.type === type && o.count + count <= max && Math.abs(o.body.pos.x - x) < 1 && Math.abs(o.body.pos.y - y) < 1 && Math.abs(o.body.pos.z - z) < 1) {
        o.count += count; o.age = Math.min(o.age, 5);
        return;
      }
    }
    if (this.items.size > 600) { const oldest = this.items.keys().next().value!; this.items.delete(oldest); }
    const body = makeBody(0.125, 0.25, { x, y, z }, vel ? { ...vel } : { x: (Math.random() - 0.5) * 3, y: 3.5, z: (Math.random() - 0.5) * 3 });
    const it: Item = { kind: 'item', eid: this.nextEid++, type, count, body, age: 0, pickupDelay };
    this.items.set(it.eid, it);
  }

  private updateItems(dt: number) {
    for (const it of this.items.values()) {
      it.age += dt;
      const b = it.body;
      if (it.age > 300) { this.items.delete(it.eid); continue; }
      if (b.inWater) b.vel.y = Math.min(b.vel.y + 12 * dt, 1.5);
      else b.vel.y = Math.max(b.vel.y - 22 * dt, -30);
      const drag = b.onGround ? 8 : 1;
      b.vel.x -= b.vel.x * Math.min(1, drag * dt);
      b.vel.z -= b.vel.z * Math.min(1, drag * dt);

      // Pull toward the nearest living player within 2.5 blocks, pick up within 1.1
      if (it.age > it.pickupDelay) {
        let best: Player | null = null, bestD = 2.5;
        for (const p of this.players.values()) {
          if (p.dead) continue;
          const d = Math.hypot(p.body.pos.x - b.pos.x, p.body.pos.y + 0.9 - b.pos.y, p.body.pos.z - b.pos.z);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) {
          const dx = best.body.pos.x - b.pos.x, dy = best.body.pos.y + 0.9 - b.pos.y, dz = best.body.pos.z - b.pos.z;
          b.vel.x += (dx / bestD) * 30 * dt; b.vel.y += (dy / bestD) * 30 * dt; b.vel.z += (dz / bestD) * 30 * dt;
          if (bestD < 1.1) {
            const left = addItem(best.inv, it.type, it.count);
            if (left !== it.count) { this.sendInv(best); this.broadcastEquip(best); }
            if (left <= 0) { this.items.delete(it.eid); continue; }
            it.count = left;
          }
        }
      }
      moveBody(this.world.get, b, dt);
      if (b.inLava || b.pos.y < MIN_Y - 20) this.items.delete(it.eid);
    }
  }

  // ---------------------------------------------------------------- Mobs

  private spawnMob(kind: MobKind, x: number, y: number, z: number) {
    const s = MOB_SPECS[kind];
    const yaw = Math.random() * Math.PI * 2;
    const m: Mob = { kind, eid: this.nextEid++, body: makeBody(s.halfW, s.height, { x, y, z }), yaw, targetYaw: yaw, health: s.health,
      wander: 0, moving: false, hurt: 0, flee: 0, attackCd: 0, dying: -1, burnT: 0, lavaT: 0 };
    this.mobs.set(m.eid, m);
  }

  private trySpawnMobs(daylightNow: number) {
    const players = [...this.players.values()].filter(p => !p.dead);
    if (!players.length) return;
    const p = players[Math.floor(Math.random() * players.length)];
    let passive = 0, hostile = 0;
    for (const m of this.mobs.values()) { if (MOB_SPECS[m.kind].hostile) hostile++; else passive++; }
    const cap = Math.min(4, players.length);
    const w = this.world;

    if (passive < 10 * cap && daylightNow > 0.3) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 28;
      const x = Math.floor(p.body.pos.x + Math.cos(a) * r), z = Math.floor(p.body.pos.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z)) return;
      const h = w.surfaceHeight(x, z);
      const top = w.get(x, h, z);
      if (top === BLOCK_ID.grass || top === BLOCK_ID.snowy_grass) {
        const kind = (['pig', 'cow', 'chicken'] as MobKind[])[Math.floor(Math.random() * 3)];
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          const sx = x + 0.5 + (Math.random() - 0.5) * 2, sz = z + 0.5 + (Math.random() - 0.5) * 2;
          if (!boxIntersectsSolid(w.get, sx, h + 1, sz, MOB_SPECS[kind].halfW, MOB_SPECS[kind].height)) this.spawnMob(kind, sx, h + 1, sz);
        }
      }
    }
    if (hostile < 8 * cap) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 22;
        const x = Math.floor(p.body.pos.x + Math.cos(a) * r), z = Math.floor(p.body.pos.z + Math.sin(a) * r);
        if (!w.isLoaded(x, z)) continue;
        const top = w.surfaceHeight(x, z);
        let y: number;
        if (daylightNow < 0.35 && Math.random() < 0.5) y = top + 1; // night: on the surface
        else {
          y = Math.floor(p.body.pos.y + (Math.random() - 0.5) * 20); // dark cave spot near the player's depth
          if (y > top - 4 || y < MIN_Y + 6) continue;
        }
        if (w.get(x, y, z) !== 0 || w.get(x, y + 1, z) !== 0 || !isSolid(w.get(x, y - 1, z))) continue;
        if (boxIntersectsSolid(w.get, x + 0.5, y, z + 0.5, MOB_SPECS.zombie.halfW, MOB_SPECS.zombie.height)) continue;
        this.spawnMob('zombie', x + 0.5, y, z + 0.5);
        break;
      }
    }
  }

  private updateMobs(dt: number, day: number) {
    const players = [...this.players.values()].filter(p => !p.dead);
    for (const m of this.mobs.values()) {
      const spec = MOB_SPECS[m.kind];
      const b = m.body;
      // Nearest living player
      let target: Player | null = null, distP = Infinity;
      for (const p of players) {
        const d = Math.hypot(p.body.pos.x - b.pos.x, p.body.pos.z - b.pos.z);
        if (d < distP) { distP = d; target = p; }
      }
      let nearAny = Infinity;
      for (const p of this.players.values()) nearAny = Math.min(nearAny, Math.hypot(p.body.pos.x - b.pos.x, p.body.pos.z - b.pos.z));
      if (nearAny > 96 || (spec.hostile && day > 0.6 && nearAny > 40 && Math.random() < dt * 0.1)) { this.mobs.delete(m.eid); continue; }

      if (m.dying >= 0) {
        m.dying += dt;
        if (m.dying > 0.8) {
          for (const [type, n] of MOB_DROPS[m.kind]()) if (n > 0) this.spawnItem(type, n, b.pos.x, b.pos.y + 0.5, b.pos.z);
          this.mobs.delete(m.eid);
        }
        continue;
      }
      m.hurt = Math.max(0, m.hurt - dt);
      m.flee = Math.max(0, m.flee - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);

      let speed = spec.speed;
      const dxp = target ? target.body.pos.x - b.pos.x : 0, dzp = target ? target.body.pos.z - b.pos.z : 0;
      const chasing = spec.hostile && target && distP < 18 && Math.abs(target.body.pos.y - b.pos.y) < 8;
      if (chasing && target) {
        m.targetYaw = Math.atan2(-dxp, -dzp);
        m.moving = distP > 0.8;
        if (distP < 1.3 && Math.abs(target.body.pos.y - b.pos.y) < 1.6 && m.attackCd <= 0) {
          this.damagePlayer(target, 3, b.pos, 'zombie');
          m.attackCd = 1;
        }
      } else if (m.flee > 0) {
        speed *= 2.2;
        m.moving = true;
        m.wander -= dt;
        if (m.wander <= 0) { m.targetYaw = Math.atan2(dxp, dzp) + (Math.random() - 0.5); m.wander = 0.8; }
      } else {
        m.wander -= dt;
        if (m.wander <= 0) { m.moving = Math.random() < 0.55; m.targetYaw = Math.random() * Math.PI * 2; m.wander = 2 + Math.random() * 4; }
      }
      let dy = m.targetYaw - m.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.yaw += dy * Math.min(1, dt * 6);

      if (m.hurt <= 0.3) {
        const tx = m.moving ? -Math.sin(m.yaw) * speed : 0, tz = m.moving ? -Math.cos(m.yaw) * speed : 0;
        const k = Math.min(1, dt * (b.onGround ? 10 : 2));
        b.vel.x += (tx - b.vel.x) * k;
        b.vel.z += (tz - b.vel.z) * k;
      }
      if (b.inWater || b.inLava) { b.vel.y = Math.min(b.vel.y + 14 * dt, 2); b.vel.x *= 0.9; b.vel.z *= 0.9; }
      else b.vel.y = Math.max(b.vel.y - 30 * dt, -50);
      moveBody(this.world.get, b, dt);
      if (b.hitWall && b.onGround && m.moving) b.vel.y = 8.5; // hop single-block steps

      if (b.inLava) { m.lavaT -= dt; if (m.lavaT <= 0) { m.lavaT = 0.5; m.hurt = 0; this.damageMob(m, 2, { x: b.pos.x, y: b.pos.y - 1, z: b.pos.z }); } }
      // Zombies burn in daylight when exposed to the sky
      if (spec.hostile && day > 0.6 && b.pos.y > this.world.surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z))) {
        m.burnT -= dt;
        if (m.burnT <= 0) { m.burnT = 1; m.hurt = 0; this.damageMob(m, 2, b.pos); m.flee = 0; }
      }
      if (b.pos.y < MIN_Y - 10) this.mobs.delete(m.eid);
    }
  }

  // ---------------------------------------------------------------- Tick

  private tickMs = 0;
  private tickMaxMs = 0;

  tick(dt: number) {
    if (this.paused) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.tickCount++;
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const day = daylight(this.time);
    this.world.tick(dt);

    for (const p of this.players.values()) this.updatePlayer(p, dt);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1; this.trySpawnMobs(day); }
    this.updateMobs(dt, day);
    this.updateItems(dt);

    // Furnaces smelt even when nobody is looking; viewers get updates 4x per second
    for (const [key, f] of this.furnaces) {
      let changed = false;
      try { changed = tickFurnace(f, dt); } catch { this.furnaces.delete(key); continue; }
      if (changed) { this.dirty = true; if (this.tickCount % 5 === 0) this.sendFurnace(key); }
      else if (isFurnaceEmpty(f) && ![...this.players.values()].some(p => p.furnaceKey === key)) this.furnaces.delete(key);
    }

    if (this.pendingBlocks.length) {
      this.broadcast({ t: 'blocks', list: this.pendingBlocks });
      this.pendingBlocks = [];
    }
    this.sendSnapshots();
    if (this.tickCount % 100 === 0) this.broadcast({ t: 'time', time: this.time });
    if (this.tickCount % 100 === 50) this.sendPlayerList();
    const ms = performance.now() - t0;
    this.tickMs = this.tickMs * 0.95 + ms * 0.05;
    this.tickMaxMs = Math.max(this.tickMaxMs * 0.999, ms);
  }

  private updatePlayer(p: Player, dt: number) {
    p.moveBudget = Math.min(3, p.moveBudget + 11 * dt);   // ~11 blocks/s sustained, small burst
    p.climbBudget = Math.min(3, p.climbBudget + 13 * dt);
    p.dropCredit = Math.min(8, p.dropCredit + 4 * dt);     // item drops per second
    p.chatCredit = Math.min(5, p.chatCredit + 1 * dt);     // chat lines per second
    p.invuln = Math.max(0, p.invuln - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.digCredit = Math.min(1, p.digCredit + dt);
    p.sinceDamage += dt;
    if (p.dead) return;
    const w = this.world.get;
    const b = p.body;
    const inLava = boxTouchesBlock(w, b, LAVA, -0.01);
    if (inLava) { p.lavaT -= dt; if (p.lavaT <= 0) { p.lavaT = 0.5; p.invuln = 0; this.damagePlayer(p, 2, null, 'lava'); } }
    else p.lavaT = 0;
    p.cactusT -= dt;
    if (p.cactusT <= 0 && boxTouchesBlock(w, b, BLOCK_ID.cactus)) { p.cactusT = 0.5; this.damagePlayer(p, 1, null, 'cactus'); }
    if (b.pos.y < -140) { p.invuln = 0; this.damagePlayer(p, 100, null, 'void'); }
    if (p.health < MAX_HEALTH && p.sinceDamage > 4 && !p.dead) {
      p.regen += dt;
      if (p.regen > 2.5) { p.regen = 0; p.health++; p.conn.send({ t: 'health', hp: p.health }); }
    }
  }

  // Tells each player about entities entering/leaving their view, then sends positions
  private sendSnapshots() {
    const all: (Player | Mob | Item)[] = [...this.players.values(), ...this.mobs.values(), ...this.items.values()];
    for (const p of this.players.values()) {
      const visible = new Set<number>();
      const spawns: SpawnInfo[] = [];
      const ents: number[] = [];
      for (const e of all) {
        if (e === p) continue;
        const b = e.body;
        if (Math.abs(b.pos.x - p.body.pos.x) > VIEW_DIST || Math.abs(b.pos.z - p.body.pos.z) > VIEW_DIST) continue;
        if (e.kind === 'player' && e.dead) continue;
        visible.add(e.eid);
        if (!p.seen.has(e.eid)) spawns.push(this.spawnInfo(e));
        let yaw = 0, pitch = 0, flags = b.onGround ? EF_GROUND : 0;
        if (e.kind === 'player') {
          yaw = e.yaw; pitch = e.pitch;
          if (e.flags & MF_SNEAK) flags |= EF_SNEAK;
          if (e.invuln > 0.3) flags |= EF_HURT;
          if (this.clock < e.swingUntil) flags |= EF_SWING;
        } else if (e.kind !== 'item') {
          yaw = e.yaw;
          if (e.hurt > 0.2) flags |= EF_HURT;
          if (e.dying >= 0) flags |= EF_DYING;
        }
        ents.push(e.eid, b.pos.x, b.pos.y, b.pos.z, yaw, pitch, flags);
      }
      const gone = [...p.seen].filter(id => !visible.has(id));
      if (gone.length) p.conn.send({ t: 'despawn', eids: gone });
      if (spawns.length) p.conn.send({ t: 'spawn', ents: spawns });
      p.seen = visible;
      if (ents.length) p.conn.send({ t: 'snap', ents });
    }
  }

  private spawnInfo(e: Player | Mob | Item): SpawnInfo {
    const { x, y, z } = e.body.pos;
    if (e.kind === 'player') return { eid: e.eid, kind: 'player', x, y, z, player: { name: e.name, look: e.look, ...this.equipOf(e) } };
    if (e.kind === 'item') return { eid: e.eid, kind: 'item', x, y, z, item: { type: e.type, count: e.count } };
    return { eid: e.eid, kind: e.kind, x, y, z };
  }

  // ---------------------------------------------------------------- Sending helpers

  private invState(p: Player): InvState {
    return { slots: p.inv.slots, cursor: p.inv.cursor, selected: p.inv.selected, ack: p.invSeq };
  }
  private sendInv(p: Player) { p.conn.send({ t: 'inv', inv: this.invState(p) }); }
  private sendFurnace(key: string) {
    const f = this.furnaces.get(key);
    if (!f) return;
    for (const p of this.players.values()) if (p.furnaceKey === key) p.conn.send({ t: 'furnace', state: f });
  }
  private equipOf(p: Player) {
    return { held: p.inv.slots[p.inv.selected]?.type || '', armor: p.inv.slots.slice(55, 60).map(s => s?.type || null) };
  }
  private broadcastEquip(p: Player) {
    const msg: ServerMsg = { t: 'equip', eid: p.eid, ...this.equipOf(p) };
    for (const o of this.players.values()) if (o.seen.has(p.eid)) o.conn.send(msg);
    if (this.etheritePieces(p) !== (p as any)._lastEth) { (p as any)._lastEth = this.etheritePieces(p); this.sendHomes(p); }
  }
  private broadcastAnim(eid: number, a: 'swing' | 'hurt') {
    for (const o of this.players.values()) if (o.seen.has(eid)) o.conn.send({ t: 'anim', eid, a });
  }
  private sendPlayerList() {
    this.broadcast({ t: 'players', list: [...this.players.values()].map(p => ({ eid: p.eid, name: p.name, ping: p.ping })) });
  }
  broadcast(msg: ServerMsg) {
    for (const p of this.players.values()) p.conn.send(msg);
  }
  setPing(p: Player, ms: number) { p.ping = Math.round(ms); }

  // ---------------------------------------------------------------- Saving

  private savePlayer(p: Player) {
    const inv = { slots: p.inv.slots.map(s => (s ? { ...s } : null)), cursor: null, selected: p.inv.selected };
    if (p.inv.cursor) addItem({ ...p.inv, slots: inv.slots }, p.inv.cursor.type, p.inv.cursor.count);
    const b = p.body.pos;
    this.storage.savePlayer(p.name, {
      x: b.x, y: b.y, z: b.z, yaw: p.yaw, pitch: p.pitch, health: p.dead ? MAX_HEALTH : p.health,
      inv, spawn: p.spawn, homes: p.homes, token: p.token || undefined,
    });
  }

  worldSave(): WorldSave {
    return {
      v: 1, seed: this.world.seed, time: this.time, edits: this.world.exportEdits(), facing: this.world.exportFacing(),
      furnaces: Object.fromEntries(this.furnaces), spawn: this.spawnPoint,
    };
  }

  // Saves the world (if changed) and every online player
  saveAll(force = false) {
    for (const p of this.players.values()) this.safe(() => this.savePlayer(p), `saving ${p.name}`);
    if (this.dirty || force) this.safe(() => { this.storage.saveWorld(this.worldSave()); this.dirty = false; }, 'saving world');
  }

  private safe(fn: () => void, what: string) {
    try { fn(); } catch (e) { this.log(`Failed ${what}: ${(e as Error).message || e}`); }
  }

  stats() {
    return { players: this.players.size, mobs: this.mobs.size, items: this.items.size, chunks: this.world.chunkCount(), furnaces: this.furnaces.size,
      tickMs: +this.tickMs.toFixed(2), tickMaxMs: +this.tickMaxMs.toFixed(2) };
  }
}

export type { Player };
