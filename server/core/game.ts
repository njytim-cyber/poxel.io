// Authoritative game simulation. Environment-agnostic: runs in Node (multiplayer) and in a Web Worker
// (single player). Transports hand it decoded messages and deliver what it sends.
import { BLOCKS, BLOCK_ID, ITEMS, WATER, LAVA, OIL, POWDER_SNOW, CHEST, isLiquid, isFacingBlock, isLeaves, isPlant, isSolid, itemDef, miningInfo, plantCanStand, CROP_NEXT, CROP_GROW_SECONDS } from '../../shared/blocks.ts';
import { isRobotic, isPortal, portalDestination, roboticStructureAt, ROBO_DAYLIGHT } from '../../shared/robotic.ts';
import { makeBody, moveBody, boxIntersectsSolid, boxTouchesBlock, PLAYER_EYE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Body } from '../../shared/physics.ts';
import {
  newInv, sanitizeInv, addItem, applyAction, closeScreen, removeFromSlot, armorPoints, attackBonus,
  newChest, maxStack, CHEST_SIZE, type Inv, type Screen, type InvAction, type Stack,
} from '../../shared/inventory.ts';
import { newFurnace, tickFurnace, isFurnaceEmpty, type FurnaceState } from '../../shared/furnace.ts';
import { MOB_SPECS, MOB_KINDS } from '../../shared/mobs.ts';
import { DAY_LENGTH, daylight } from '../../shared/time.ts';
import { MIN_Y, MAX_Y, columnInfo } from '../../shared/worldgen.ts';
import {
  PROTOCOL_VERSION, MAX_PLAYERS, sanitizeName, sanitizeLook, isNum, isInt,
  MF_GROUND, MF_SNEAK, MF_WATER, EF_SNEAK, EF_HURT, EF_DYING, EF_GROUND, EF_SWING, EF_DOWNED,
  DIFFICULTIES, type Difficulty, type GameMode, type ClientMsg, type ServerMsg, type Look, type MobKind, type SpawnInfo, type InvState,
} from '../../shared/protocol.ts';
import { ServerWorld } from './world.ts';

export const MAX_HEALTH = 20;
const VIEW_DIST = 72;
const CAVE_DEPTH = 6;
const DOWNED_SECONDS = 60;   // multiplayer: how long a downed player waits for help
const REVIVE_SECONDS = 3;    // how long a friend must hold Use to revive
export const MAX_FOOD = 20;
const clampFood = (v: unknown) => (isNum(v) ? Math.max(0, Math.min(MAX_FOOD, Math.round(v as number))) : MAX_FOOD);
// Damage causes that come from mobs (scaled by difficulty)
// ------------------------------------------------------------------ Loot

type LootKind = 'dungeon' | 'temple' | 'igloo' | 'cabin' | 'ruin' | 'giant_robot';
// [item, min, max, chance]
const LOOT: Record<LootKind, [string, number, number, number][]> = {
  dungeon: [['iron_ingot', 1, 5, 0.7], ['gold_ingot', 1, 3, 0.4], ['diamond', 1, 2, 0.15], ['bread', 1, 3, 0.6], ['bone', 2, 6, 0.6],
    ['string', 1, 4, 0.5], ['coal', 3, 8, 0.6], ['golden_apple', 1, 1, 0.06], ['iron_chestplate', 1, 1, 0.08], ['iron_sword', 1, 1, 0.1],
    ['arrow', 4, 12, 0.4], ['seeds', 2, 6, 0.3], ['obsidian', 1, 3, 0.1], ['lantern', 1, 2, 0.2]],
  temple: [['gold_ingot', 2, 7, 0.8], ['diamond', 1, 3, 0.3], ['bone', 3, 8, 0.6], ['rotten_flesh', 2, 6, 0.6], ['golden_carrot', 1, 3, 0.25],
    ['golden_apple', 1, 1, 0.1], ['gold_helmet', 1, 1, 0.12], ['copper_ingot', 3, 9, 0.5], ['sandstone', 4, 12, 0.4], ['iron_ingot', 1, 4, 0.4]],
  igloo: [['snowball', 4, 16, 0.7], ['snowberries', 2, 6, 0.7], ['frost_crystal', 1, 3, 0.5], ['golden_apple', 1, 1, 0.12], ['coal', 2, 6, 0.5],
    ['iron_pickaxe', 1, 1, 0.12], ['wool', 2, 6, 0.4], ['lantern', 1, 1, 0.3], ['baked_potato', 2, 5, 0.5]],
  cabin: [['apple', 1, 4, 0.7], ['bread', 1, 3, 0.6], ['wheat', 2, 6, 0.5], ['seeds', 2, 8, 0.6], ['carrot', 1, 4, 0.5], ['potato', 1, 4, 0.5],
    ['torch', 4, 12, 0.6], ['iron_ingot', 1, 2, 0.35], ['stone_pickaxe', 1, 1, 0.3], ['planks', 4, 16, 0.4], ['bowl', 1, 2, 0.3], ['string', 1, 3, 0.3]],
  // The Robotic World
  ruin: [['tungsten_ingot', 1, 4, 0.7], ['iron_ingot', 2, 6, 0.6], ['coal', 2, 8, 0.5], ['robot_eye', 1, 2, 0.35], ['bread', 1, 3, 0.5],
    ['torch', 4, 10, 0.5], ['etherite', 1, 2, 0.08], ['golden_apple', 1, 1, 0.08], ['metal_plate', 2, 6, 0.4]],
  giant_robot: [['tungsten_ingot', 2, 6, 0.8], ['robot_eye', 1, 3, 0.6], ['iron_ingot', 3, 9, 0.6], ['diamond', 1, 2, 0.2], ['etherite', 1, 3, 0.12],
    ['gold_ingot', 1, 4, 0.4]],
};
function rollLoot(kind: LootKind): Stack[] {
  const c = newChest();
  const free = [...Array(CHEST_SIZE).keys()].sort(() => Math.random() - 0.5);
  for (const [type, min, max, chance] of LOOT[kind]) {
    if (Math.random() > chance || !free.length) continue;
    c[free.pop()!] = { type, count: Math.min(maxStack(type), min + Math.floor(Math.random() * (max - min + 1))) };
  }
  if (!c.some(Boolean)) c[free.pop()!] = { type: LOOT[kind][0][0], count: LOOT[kind][0][1] }; // never an empty treasure chest
  return c;
}
// /give item lookup: an item id ("diamond", "wooden_pickaxe") or display name ("oak_log", "block_of_iron")
function findItem(raw: string): string | null {
  const q = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!q) return null;
  if (Object.prototype.hasOwnProperty.call(ITEMS, q)) return q;
  const byName = Object.keys(ITEMS).find(k => ITEMS[k].name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '') === q);
  return byName || null;
}

function sanitizeChest(c: unknown[]): Stack[] {
  const out = newChest();
  for (let i = 0; i < CHEST_SIZE; i++) {
    const s = c[i] as any;
    if (s && typeof s.type === 'string' && Number.isInteger(s.count) && s.count > 0) out[i] = { type: s.type, count: Math.min(s.count, maxStack(s.type)) };
  }
  return out;
}

const MOB_CAUSES = new Set(['zombie', 'husk', 'frostbitten', 'spider', 'skeleton', 'slime', 'robot']);
const MAX_PETS = 3;
// /gamemode creative needs the owner's code. Only its fingerprint is kept here (the source is public).
const CREATIVE_CODE = 'ff78b193';
export function creativeCodeHash(code: string): string {
  let x = 0x811c9dc5;
  for (const c of 'poxel-creative:' + code) { x ^= c.charCodeAt(0); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16).padStart(8, '0');
}          // tamed robots per player        // blocks below the natural ground where zombies may spawn in daylight
const MAX_ITEMS = 600;        // item entities (drops and arrows); see makeRoomForItem
const EDIT_RADIUS = 12;      // chunks around a player whose saved edits it receives (render distance is at most 10)
const REACH = 6.5;          // server allows a little more than the client's 5 for latency
const ATTACK_REACH = 4.8;

// ------------------------------------------------------------------ Persistence contracts

export interface WorldSave {
  v: 1; seed: number; time: number; edits: number[]; facing: number[];
  furnaces: Record<string, FurnaceState>; spawn: [number, number, number];
  difficulty?: Difficulty;
  chests?: Record<string, Stack[]>;
  crops?: Record<string, number>; // "x,y,z" -> seconds until the next growth stage
}
export interface PlayerSave {
  x: number; y: number; z: number; yaw: number; pitch: number; health: number; food?: number; saturation?: number; gamemode?: GameMode;
  inv: InvState; spawn?: [number, number, number]; homes?: ({ x: number; y: number; z: number; name: string } | null)[];
  token?: string; // proves ownership of the name
  cheated?: boolean; // used /give, creative mode or dev tools: this character can't be carried into a server
  pets?: number[];   // tamed robots (their health), which come back with the player
}
export interface Storage {
  loadWorld(): WorldSave | null;
  saveWorld(s: WorldSave): void;
  loadPlayer(name: string): PlayerSave | null;
  savePlayer(name: string, s: PlayerSave): void;
  deletePlayer?(name: string): void; // frees a name after its owner renamed
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
  food: number; sat: number; exhaustion: number; foodT: number; freezeT: number; // hunger (not on Easy)
  // Multiplayer "downed": at 0 health you crawl until someone revives you, you give up, or time runs out
  downed: boolean; downT: number; downCause: string; downBy?: string; revive: number; reviveAt: number; reviverName: string;
  gamemode: GameMode;
  inv: Inv; screen: Screen | null; furnaceKey: string | null; // furnaceKey: position of the furnace or chest that's open
  screenAt: { x: number; y: number; z: number; id: number } | null; // the block whose screen is open (table, furnace, chest)
  spawn: [number, number, number]; homes: ({ x: number; y: number; z: number; name: string } | null)[];
  attackCd: number; lastDig: number; swingUntil: number; invSeq: number;
  moveBudget: number; climbBudget: number; dropCredit: number; chatCredit: number; token: string;
  seen: Set<number>;         // entity ids this client currently knows about
  ping: number;
  editChunks: Set<string>;   // chunks whose saved edits this client has (later changes arrive as 'blocks')
  editCenter: string;        // chunk the edits were last streamed around
  // Playing a character carried from a single-player save: this server's own character for the name,
  // saved in place of the carried inventory/health (which belong to that save, not to this server)
  home?: { inv: InvState; health: number; food?: number; saturation?: number };
  cheated: boolean;
  portalCd: number;          // game time before the next portal trip
}
interface Mob {
  kind: MobKind; eid: number; body: Body; yaw: number; targetYaw: number; health: number;
  wander: number; moving: boolean; hurt: number; flee: number; attackCd: number; dying: number; burnT: number; lavaT: number;
  owner?: string;            // a tamed robot: follows this player and fights for them
}
// arrow: set while an arrow is flying (it hurts the first player it hits, then lands as a normal item)
interface Item { kind: 'item'; eid: number; type: string; count: number; body: Body; age: number; pickupDelay: number; arrow?: { damage: number }; keep?: boolean }

const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const MOB_DROPS: Record<MobKind, () => [string, number][]> = {
  pig: () => [['porkchop', rnd(1, 3)]],
  cow: () => [['beef', rnd(1, 3)]],
  chicken: () => [['chicken', 1], ['feather', rnd(0, 2)]],
  zombie: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.3 ? [['bone', 1] as [string, number]] : [])],
  husk: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.1 ? [['sand', rnd(1, 3)] as [string, number]] : [])],
  frostbitten: () => [['rotten_flesh', rnd(0, 2)], ...(Math.random() < 0.15 ? [['snowball', rnd(1, 3)] as [string, number]] : [])],
  spider: () => [['string', rnd(0, 2)], ...(Math.random() < 0.33 ? [['spider_eye', 1] as [string, number]] : [])],
  skeleton: () => [['bone', rnd(0, 2)], ['arrow', rnd(0, 2)]],
  slime: () => [],
  slimelet: () => [['slime_ball', rnd(0, 2)]],
  robot: () => [['iron_ingot', rnd(0, 1)], ...(Math.random() < 0.15 ? [['tungsten_ingot', 1] as [string, number]] : []), ...(Math.random() < 0.25 ? [['robot_eye', 1] as [string, number]] : [])],
};

// allowCarry: players may bring their character (inventory + health) from a single-player save
// devTools: accept 'dev' messages (give items, spawn mobs, set time). Only the dev build's single player turns it on.
// ops: player names allowed to use /give and /gamemode ('*': everyone, as in single player). None by default.
export interface GameOptions { creativeCode?: string; seed?: number; log?: (msg: string) => void; maxPlayers?: number; allowCarry?: boolean; difficulty?: Difficulty; devTools?: boolean; ops?: string[] }

function sanitizeFurnace(f: any): FurnaceState | null {
  if (!f || typeof f !== 'object') return null;
  const stack = (s: any) => (s && typeof s.type === 'string' && Number.isInteger(s.count) && s.count > 0 ? { type: s.type, count: Math.min(maxStack(s.type), s.count) } : null);
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
  private allowCarry: boolean;
  private devTools: boolean;
  private ops: Set<string>;
  private creativeCode: string; // fingerprint of the code /gamemode creative needs (creativeCodeHash)
  readonly difficulty: Difficulty;
  private players = new Map<number, Player>();
  private mobs = new Map<number, Mob>();
  private items = new Map<number, Item>();
  private furnaces = new Map<string, FurnaceState>();
  private spawnPoint: [number, number, number];
  private nextEid = 1;
  private clock = 0;          // seconds of game time
  private pendingBlocks: number[] = [];
  private crops = new Map<string, number>();
  private chests = new Map<string, Stack[]>(); // "x,y,z" -> 27 slots (a generated chest gets its loot when first opened) // "x,y,z" -> game clock when it grows a stage
  private tickCount = 0;
  private spawnTimer = 0;
  private dirty = false;

  constructor(storage: Storage, opts: GameOptions = {}) {
    this.storage = storage;
    this.log = opts.log || (() => {});
    this.maxPlayers = opts.maxPlayers || MAX_PLAYERS;
    this.allowCarry = opts.allowCarry ?? true;
    this.devTools = !!opts.devTools;
    this.ops = new Set((opts.ops ?? []).map(n => n.toLowerCase()));
    this.creativeCode = opts.creativeCode ?? CREATIVE_CODE;
    const save = storage.loadWorld();
    this.difficulty = DIFFICULTIES.includes(save?.difficulty as Difficulty) ? save!.difficulty! : DIFFICULTIES.includes(opts.difficulty!) ? opts.difficulty! : 'medium';
    const seed = save?.seed ?? opts.seed ?? ((Math.random() * 2 ** 31) | 0);
    this.world = new ServerWorld(seed);
    if (save) {
      this.world.importEdits(save.edits || []);
      this.world.importFacing(save.facing || []);
      this.time = isNum(save.time) ? save.time : 0.3;
      for (const [k, f] of Object.entries(save.furnaces || {})) { const clean = sanitizeFurnace(f); if (clean) this.furnaces.set(k, clean); }
      for (const [k, c] of Object.entries(save.chests || {})) if (Array.isArray(c)) this.chests.set(k, sanitizeChest(c));
      for (const [k, s] of Object.entries(save.crops || {})) if (isNum(s) && /^-?\d+,-?\d+,-?\d+$/.test(k)) this.crops.set(k, this.clock + Math.max(0, s));
    }
    const sp = save?.spawn;
    this.spawnPoint = Array.isArray(sp) && sp.length === 3 && sp.every(isNum) ? sp : this.world.findSpawn();
    this.log(`World seed ${seed}, spawn ${this.spawnPoint.map(v => v.toFixed(1)).join(', ')}`);
    // Write a brand-new world right away: otherwise a crash before the first edit is saved
    // restarts with a different random seed and everyone's surroundings change under them.
    if (!save) this.safe(() => this.storage.saveWorld(this.worldSave()), 'saving new world');
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
    let saved = this.storage.loadPlayer(name);
    if (saved?.token && saved.token !== token) { conn.close(`The name "${name}" belongs to another player. Pick another name.`); return null; }
    // Rename: the owner of the old name (same token) takes their character to the new, unclaimed name,
    // and the old name is freed. Names stay locked to their owner on this server.
    let renamedFrom: string | null = null;
    if (!saved && token && typeof hello.prevName === 'string') {
      const prev = sanitizeName(hello.prevName);
      const prevOnline = [...this.players.values()].some(o => o.name.toLowerCase() === prev.toLowerCase());
      if (prev.toLowerCase() !== name.toLowerCase() && !prevOnline) {
        const old = this.storage.loadPlayer(prev);
        if (old?.token === token) { saved = old; renamedFrom = prev; }
      }
    }
    // A character brought from a single-player save replaces this server's inventory and health for them;
    // the client writes what happens here (items found, lost on death) back into that save
    const carry = this.allowCarry && hello.carry && typeof hello.carry === 'object' ? hello.carry : null;
    const spawn = saved?.spawn || this.spawnPoint;
    const pos = saved && [saved.x, saved.y, saved.z].every(isNum) ? { x: saved.x, y: saved.y, z: saved.z } : { x: spawn[0], y: spawn[1], z: spawn[2] };
    // Don't start inside blocks (terrain may have changed)
    if (boxIntersectsSolid(this.world.get, pos.x, pos.y, pos.z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) pos.y = this.world.surfaceHeight(Math.floor(pos.x), Math.floor(pos.z)) + 1;

    const p: Player = {
      kind: 'player', eid: this.nextEid++, name, look: sanitizeLook(hello.look), conn,
      body: makeBody(PLAYER_HALF_WIDTH, PLAYER_HEIGHT, pos), yaw: saved?.yaw || 0, pitch: saved?.pitch || 0, flags: MF_GROUND,
      lastMove: this.clock, health: Math.max(1, Math.min(MAX_HEALTH, (carry && isNum(carry.health) ? carry.health : saved?.health) ?? MAX_HEALTH)), dead: false,
      invuln: 2, sinceDamage: 99, regen: 0, lavaT: 0, cactusT: 0, fallStart: pos.y,
      food: this.difficulty === 'easy' ? MAX_FOOD : clampFood(carry && isNum(carry.food) ? carry.food : saved?.food), sat: isNum(saved?.saturation) ? Math.max(0, Math.min(MAX_FOOD, saved!.saturation!)) : 5,
      exhaustion: 0, foodT: 0, freezeT: 0,
      downed: false, downT: 0, downCause: '', revive: 0, reviveAt: -1, reviverName: '',
      gamemode: saved?.gamemode === 'creative' && this.isOp(name) ? 'creative' : 'survival',
      inv: carry ? { ...sanitizeInv(carry.inv), cursor: null } : saved ? sanitizeInv(saved.inv) : newInv(), screen: null, furnaceKey: null, screenAt: null,
      spawn: [...spawn] as [number, number, number], homes: Array.isArray(saved?.homes) ? saved!.homes!.slice(0, 4).map(h => (h && [h.x, h.y, h.z].every(isNum) ? h : null)) : [],
      attackCd: 0, lastDig: -99, swingUntil: 0, invSeq: 0, seen: new Set(), ping: 0,
      moveBudget: 3, climbBudget: 3, dropCredit: 8, chatCredit: 5, token,
      editChunks: new Set(), editCenter: '',
      home: carry ? (saved ? { inv: saved.inv, health: saved.health, food: saved.food, saturation: saved.saturation } : { inv: { slots: [], cursor: null, selected: 0, ack: 0 }, health: MAX_HEALTH }) : undefined,
      cheated: !!saved?.cheated, portalCd: 0,
    };
    this.players.set(p.eid, p);
    if (Array.isArray(saved?.pets)) for (const hp of saved!.pets!.slice(0, MAX_PETS)) {
      if (!isNum(hp)) continue;
      const m = this.spawnMob('robot', pos.x + (Math.random() - 0.5) * 2, pos.y, pos.z + (Math.random() - 0.5) * 2);
      m.owner = p.name; m.health = Math.max(1, Math.min(MOB_SPECS.robot.health, hp));
    }
    if (renamedFrom) {
      // An operator's old name stays locked to them, so nobody else can claim it (and its powers)
      this.safe(() => {
        this.savePlayer(p);
        if (!this.isOp(renamedFrom!)) this.storage.deletePlayer?.(renamedFrom!);
        else this.storage.savePlayer(renamedFrom!, { ...saved!, inv: { slots: [], cursor: null, selected: 0, ack: 0 }, pets: [] });
      }, `renaming ${renamedFrom}`);
      this.log(`${renamedFrom} is now called ${name}`);
    }
    // Only the edits around the player: the rest stream in as they move (see streamEdits),
    // so joining a long-lived world doesn't mean downloading every edit ever made
    conn.send({
      t: 'welcome', eid: p.eid, seed: this.world.seed, time: this.time,
      edits: this.collectEdits(p), facing: this.world.exportFacing(), carried: !!carry, difficulty: this.difficulty,
      you: { ...pos, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, gamemode: p.gamemode, inv: this.invState(p), spawn: p.spawn },
    });
    this.sendHomes(p);
    if (this.maxPlayers > 1) this.broadcast({ t: 'chat', from: null, text: `${name} joined the game` });
    this.log(`${name} joined (${this.players.size} online)`);
    this.sendPlayerList();
    return p;
  }

  leave(p: Player) {
    if (!this.players.has(p.eid)) return;
    if (p.downed) this.killPlayer(p, p.downCause, p.downBy); // no escaping death by logging out
    // Remove first so a failing save can never leave a ghost player occupying a slot
    this.players.delete(p.eid);
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    this.safe(() => this.savePlayer(p), `saving ${p.name}`);
    for (const m of this.pets(p)) this.mobs.delete(m.eid); // they leave with their owner (saved above)
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
    if (p.downed && !['move', 'chat', 'giveup', 'ping', 'select', 'screen', 'inv'].includes(msg.t)) return;
    switch (msg.t) {
      case 'revive': return this.onRevive(p, msg.eid);
      case 'tame': return this.onTame(p, msg.eid);
      case 'dev': return this.onDev(p, msg);
      case 'giveup': if (p.downed) this.killPlayer(p, p.downCause, p.downBy); return;
      case 'move': return this.onMove(p, msg);
      case 'dig': return this.onDig(p, msg);
      case 'place': return this.onPlace(p, msg);
      case 'till': return this.onTill(p, msg);
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
      case 'sethome': return this.onSetHome(p, -1);
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
    // Walking through blocks: the box (slightly shrunk, for rounding and blocks placed next to you) must be clear
    const shrunk = (x: number, y: number, z: number) => boxIntersectsSolid(this.world.get, x, y + 0.05, z, PLAYER_HALF_WIDTH - 0.08, PLAYER_HEIGHT - 0.15);
    // Already stuck (terrain changed around them): they may wiggle a little, or move out into clear space
    const insideBlocks = p.gamemode !== 'creative' && shrunk(m.x, m.y, m.z) && (!shrunk(b.pos.x, b.pos.y, b.pos.z) || Math.hypot(dx, dy, dz) > 0.5);
    if (insideBlocks || horiz > p.moveBudget || dy > p.climbBudget || m.y < MIN_Y - 60 || m.y > 400) {
      p.conn.send({ t: 'pos', x: b.pos.x, y: b.pos.y, z: b.pos.z });
      p.lastMove = this.clock;
      return;
    }
    p.moveBudget -= horiz;
    if (dy > 0) p.climbBudget -= dy;
    // Hunger: walking and (much more) sprinting tire you; so does jumping
    p.exhaustion += horiz * (horiz > 0.27 ? 0.1 : 0.01);
    if (dy > 0.2 && (p.flags & MF_GROUND)) p.exhaustion += 0.05;
    b.pos.x = m.x; b.pos.y = m.y; b.pos.z = m.z;
    p.yaw = m.yaw; p.pitch = Math.max(-1.6, Math.min(1.6, m.pitch));
    p.lastMove = this.clock;
    const wasGround = !!(p.flags & MF_GROUND);
    p.flags = m.flags | 0;
    // "On the ground" only counts with something solid right underfoot (so fall damage can't be skipped)
    if ((p.flags & MF_GROUND) && !boxIntersectsSolid(this.world.get, b.pos.x, b.pos.y - 0.2, b.pos.z, PLAYER_HALF_WIDTH, 0.25)) p.flags &= ~MF_GROUND;
    // ...and "in water" (which also stops fall damage) only with a liquid there
    if ((p.flags & MF_WATER) && ![WATER, OIL, LAVA, POWDER_SNOW].some(id => boxTouchesBlock(this.world.get, b, id, 0.05))) p.flags &= ~MF_WATER;
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

  // Saved edits of chunks within EDIT_RADIUS of the player that it hasn't been sent yet.
  // Every chunk in range is marked as sent (even unedited ones): later changes reach all players as 'blocks'.
  private collectEdits(p: Player): number[] {
    const cx = Math.floor(p.body.pos.x) >> 4, cz = Math.floor(p.body.pos.z) >> 4;
    const center = `${cx},${cz}`;
    const out: number[] = [];
    if (center === p.editCenter) return out;
    p.editCenter = center;
    if (p.editChunks.size > 4 * (2 * EDIT_RADIUS + 1) ** 2) {
      for (const key of p.editChunks) {
        const [kx, kz] = key.split(',').map(Number);
        if (Math.abs(kx - cx) > EDIT_RADIUS + 4 || Math.abs(kz - cz) > EDIT_RADIUS + 4) p.editChunks.delete(key);
      }
    }
    for (let dx = -EDIT_RADIUS; dx <= EDIT_RADIUS; dx++) for (let dz = -EDIT_RADIUS; dz <= EDIT_RADIUS; dz++) {
      const key = `${cx + dx},${cz + dz}`;
      if (p.editChunks.has(key)) continue;
      p.editChunks.add(key);
      this.world.chunkEdits(key, out);
    }
    return out;
  }

  private streamEdits(p: Player) {
    const list = this.collectEdits(p);
    if (list.length) p.conn.send({ t: 'edits', list });
  }

  private setBlock(x: number, y: number, z: number, id: number, facing = -1) {
    this.world.set(x, y, z, id, facing);
    this.pendingBlocks.push(x, y, z, id, isFacingBlock(id) ? facing : -1);
    this.dirty = true;
  }

  private onDig(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt)) return;
    // The client already predicted the break, so a refusal must tell it the real block (rejectBlock),
    // or it keeps a hole the server doesn't have. Checked before world.get so far requests generate nothing.
    if (!this.inReach(p, x, y, z, REACH)) { this.rejectBlock(p, x, y, z); return; }
    const id = this.world.get(x, y, z);
    const heldType = p.inv.slots[p.inv.selected]?.type || null;
    const info = miningInfo(id, heldType);
    // Mining speed check: the time since the previous break must cover this block's mining time
    // (less a margin for network jitter), so no block breaks faster than it should
    const creative = p.gamemode === 'creative';
    const needs = creative ? 0 : info.time * 0.75 - 0.1;
    if (p.dead || id === 0 || isLiquid(id) || (info.time === Infinity && !creative) || !this.inReach(p, x, y, z, REACH) || this.clock - p.lastDig < needs) {
      this.rejectBlock(p, x, y, z);
      return;
    }
    p.lastDig = this.clock;
    p.exhaustion += 0.005;
    this.setBlock(x, y, z, 0);
    const cx = x + 0.5, cy = y + 0.3, cz = z + 0.5;
    const key = `${x},${y},${z}`;
    if (id === BLOCK_ID.furnace) {
      const f = this.furnaces.get(key);
      if (f) for (const s of [f.input, f.fuel, f.output]) if (s) this.spawnItem(s.type, s.count, cx, cy, cz, undefined, 0.5, true);
      this.furnaces.delete(key);
      for (const o of this.players.values()) if (o.furnaceKey === key) this.forceCloseScreen(o);
    }
    if (id === CHEST) {
      const c = this.chests.get(key) ?? (this.world.isGenerated(x, y, z, CHEST) ? rollLoot(this.lootKind(x, y, z)) : null);
      if (c) for (const s of c) if (s) this.spawnItem(s.type, s.count, cx, cy, cz, undefined, 0.5, true);
      this.chests.delete(key);
      for (const o of this.players.values()) if (o.furnaceKey === key) this.forceCloseScreen(o);
    }
    if (info.drops && !creative) this.dropBlock(id, cx, cy, cz);
    else if (BLOCKS[id].harvestTier >= 0) {
      p.conn.send({ t: 'toast', text: 'You need a better pickaxe to get anything from this' });
    }
    // Plants lose their support
    const above = this.world.get(x, y + 1, z);
    if (isPlant(above)) {
      this.setBlock(x, y + 1, z, 0);
      this.dropBlock(above, cx, cy + 1, cz);
    }
    this.flowInto(x, y, z);
  }

  // What a broken block leaves behind
  private dropBlock(id: number, cx: number, cy: number, cz: number) {
    const def = BLOCKS[id];
    let drop = def.drop;
    let count = def.dropCount ? def.dropCount[0] + Math.floor(Math.random() * (def.dropCount[1] - def.dropCount[0] + 1)) : 1;
    if (id === BLOCK_ID.gravel && Math.random() < 0.1) drop = 'flint';
    if (id === BLOCK_ID.leaves) drop = Math.random() < 0.05 ? 'apple' : Math.random() < 0.05 ? 'stick' : null;
    if ((id === BLOCK_ID.tall_grass || id === BLOCK_ID.frost_fern) && Math.random() < 0.12) drop = 'seeds';
    if (id === BLOCK_ID.wheat_2) this.spawnItem('seeds', 1 + Math.floor(Math.random() * 3), cx, cy, cz);
    if (id === BLOCK_ID.wild_carrots || id === BLOCK_ID.wild_potatoes) count = 2 + Math.floor(Math.random() * 3);
    if (drop && count > 0) this.spawnItem(drop, count, cx, cy, cz);
  }

  // Neighbouring water/lava flows into a new hole and keeps falling
  private flowInto(x: number, y: number, z: number) {
    const g = this.world.get;
    const nbs = [g(x, y + 1, z), g(x + 1, y, z), g(x - 1, y, z), g(x, y, z + 1), g(x, y, z - 1)];
    const liquid = nbs.includes(LAVA) ? LAVA : nbs.includes(OIL) ? OIL : nbs.includes(WATER) ? WATER : 0;
    if (!liquid) return;
    for (let i = 0, yy = y; i < 24 && g(x, yy, z) === 0; i++, yy--) this.setBlock(x, yy, z, liquid);
  }

  private onDev(p: Player, m: { give?: string; count?: number; spawn?: string; time?: number; tp?: { x: number; y: number; z: number }; blocks?: number[] }) {
    if (!this.devTools) return;
    if (Array.isArray(m.blocks)) for (let i = 0; i + 3 < m.blocks.length; i += 4) {
      const [x, y, z, id] = m.blocks.slice(i, i + 4);
      if ([x, y, z].every(isInt) && isInt(id) && BLOCKS[id]) this.setBlock(x, y, z, id);
    }
    if (m.tp && [m.tp.x, m.tp.y, m.tp.z].every(isNum)) this.teleport(p, m.tp.x, m.tp.y, m.tp.z);
    if (typeof m.give === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, m.give)) { p.cheated = true; addItem(p.inv, m.give, isInt(m.count) ? Math.min(64, Math.max(1, m.count)) : 1); this.sendInv(p); }
    if (typeof m.spawn === 'string' && (MOB_KINDS as string[]).includes(m.spawn)) {
      const a = p.yaw, x = p.body.pos.x - Math.sin(a) * 4, z = p.body.pos.z - Math.cos(a) * 4;
      this.spawnMob(m.spawn as MobKind, x, this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1, z);
    }
    if (isNum(m.time)) { this.time = ((m.time % 1) + 1) % 1; this.broadcast({ t: 'time', time: this.time }); }
  }

  private onTill(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt)) return;
    if (!this.inReach(p, x, y, z, REACH)) { this.rejectBlock(p, x, y, z); return; }
    const held = p.inv.slots[p.inv.selected];
    const id = this.world.get(x, y, z);
    const above = this.world.get(x, y + 1, z);
    if (p.dead || !held || itemDef(held.type).tool?.kind !== 'hoe' || (id !== BLOCK_ID.grass && id !== BLOCK_ID.dirt) || (above !== 0 && !isPlant(above))) {
      this.rejectBlock(p, x, y, z);
      this.rejectBlock(p, x, y + 1, z);
      return;
    }
    if (above) this.setBlock(x, y + 1, z, 0); // tilling clears tall grass/flowers on top
    this.setBlock(x, y, z, BLOCK_ID.farmland);
  }

  // Which loot a generated chest holds, from where it is
  private lootKind(x: number, y: number, z: number): LootKind {
    const { h, biome } = columnInfo(x, z, this.world.seed);
    if (biome === 'robotic') return roboticStructureAt(x, z, this.world.seed)?.kind === 'giant_robot' ? 'giant_robot' : 'ruin';
    if (y < h - 8) return 'dungeon';
    if (biome === 'desert') return 'temple';
    if (biome === 'snowy' || biome === 'mountains') return 'igloo';
    return 'cabin';
  }

  // Crops advance a stage at random-ish intervals; each growing crop is tracked until ripe
  private plantCrop(x: number, y: number, z: number) {
    this.crops.set(`${x},${y},${z}`, this.clock + CROP_GROW_SECONDS * (0.6 + Math.random() * 0.8));
  }

  private growCrops() {
    for (const [key, due] of this.crops) {
      if (due > this.clock) continue;
      const [x, y, z] = key.split(',').map(Number);
      if (!this.world.isLoaded(x, z)) { this.crops.set(key, this.clock + 10); continue; } // wait until someone is nearby
      const id = this.world.get(x, y, z), next = CROP_NEXT[id];
      if (next === undefined || this.world.get(x, y - 1, z) !== BLOCK_ID.farmland) { this.crops.delete(key); continue; }
      this.setBlock(x, y, z, next);
      if (CROP_NEXT[next] !== undefined) this.plantCrop(x, y, z); else this.crops.delete(key);
    }
  }

  private onPlace(p: Player, m: Extract<ClientMsg, { t: 'place' }>) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt) || y < MIN_Y || y > MAX_Y) { this.sendInv(p); return; }
    if (!this.inReach(p, x, y, z, REACH + 0.5)) { this.rejectBlock(p, x, y, z); this.sendInv(p); return; }
    const slot = p.inv.slots[p.inv.selected];
    const held = slot ? itemDef(slot.type) : null;
    // Seeds/carrots/potatoes place their crop block
    const def = held?.plants ? { ...held, block: BLOCK_ID[held.plants] } : held;
    const existing = this.world.get(x, y, z);
    const ok = !p.dead && def && def.block !== undefined && this.inReach(p, x, y, z, REACH + 0.5) &&
      (existing === 0 || isLiquid(existing) || isPlant(existing)) &&
      !this.entityInBlock(x, y, z) && this.hasSupport(x, y, z) &&
      (!BLOCKS[def.block].plant || plantCanStand(def.block, this.world.get(x, y - 1, z)));
    if (!ok) { this.rejectBlock(p, x, y, z); this.sendInv(p); return; }
    this.setBlock(x, y, z, def!.block!, isInt(m.facing) ? m.facing & 3 : 0);
    if (CROP_NEXT[def!.block!] !== undefined) this.plantCrop(x, y, z);
    if (def!.block === CHEST) this.chests.set(`${x},${y},${z}`, newChest());
    if (p.gamemode !== 'creative') removeFromSlot(p.inv, p.inv.selected, 1);
    this.sendInv(p);
    this.broadcastEquip(p);
  }

  private hasSupport(x: number, y: number, z: number) {
    const g = this.world.get;
    return [g(x + 1, y, z), g(x - 1, y, z), g(x, y + 1, z), g(x, y - 1, z), g(x, y, z + 1), g(x, y, z - 1)].some(id => id !== 0 && !isLiquid(id));
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
    if (id === BLOCK_ID.gold_block || id === BLOCK_ID.portal_core) { if (isPortal(this.world.get, x, y, z)) this.travel(p, x, z); return; }
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    p.screenAt = { x, y, z, id };
    if (id === BLOCK_ID.crafting_table) {
      p.screen = { mode: 'table', furnace: null }; p.furnaceKey = null;
      p.conn.send({ t: 'screen', mode: 'table' });
    } else if (id === BLOCK_ID.furnace) {
      const key = `${x},${y},${z}`;
      let f = this.furnaces.get(key);
      if (!f) { f = newFurnace(); this.furnaces.set(key, f); }
      p.screen = { mode: 'furnace', furnace: f }; p.furnaceKey = key;
      p.conn.send({ t: 'screen', mode: 'furnace', furnace: f });
    } else if (id === CHEST) {
      const key = `${x},${y},${z}`;
      let c = this.chests.get(key);
      if (!c) { c = this.world.isGenerated(x, y, z, CHEST) ? rollLoot(this.lootKind(x, y, z)) : newChest(); this.chests.set(key, c); this.dirty = true; }
      p.screen = { mode: 'chest', furnace: null, chest: c }; p.furnaceKey = key;
      p.conn.send({ t: 'screen', mode: 'chest', chest: c });
    } else {
      p.screen = null; p.furnaceKey = null; p.screenAt = null;
      p.conn.send({ t: 'screen', mode: null });
    }
    this.sendInv(p);
  }

  private onScreen(p: Player, mode: 'inventory' | null) {
    if (p.screen) closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    p.screen = mode === 'inventory' && !p.dead ? { mode: 'inventory', furnace: null } : null;
    p.furnaceKey = null; p.screenAt = null;
    this.sendInv(p);
    this.broadcastEquip(p);
  }

  private forceCloseScreen(p: Player) {
    if (!p.screen) return;
    closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n));
    p.screen = null; p.furnaceKey = null; p.screenAt = null;
    p.conn.send({ t: 'screen', mode: null });
    this.sendInv(p);
  }

  private onInv(p: Player, action: InvAction) {
    if (!p.screen || !action || typeof action !== 'object' || (p.downed && action.a !== 'close') || (action.a === 'creative' && p.gamemode !== 'creative')) { this.sendInv(p); return; }
    // A table, furnace or chest only works while it's still there and within reach
    const at = p.screenAt;
    if (at && action.a !== 'close' && (this.world.get(at.x, at.y, at.z) !== at.id || !this.inReach(p, at.x, at.y, at.z, REACH + 2))) {
      this.forceCloseScreen(p);
      return;
    }
    applyAction(p.inv, p.screen, action, (t, n) => this.dropFrom(p, t, n));
    if (action.a === 'close') { p.screen = null; p.furnaceKey = null; p.screenAt = null; }
    this.sendInv(p);
    this.broadcastEquip(p);
    if (p.furnaceKey) { this.sendFurnace(p.furnaceKey); this.sendChest(p.furnaceKey); }
    this.dirty = true;
  }

  private onEat(p: Player) {
    const it = p.inv.slots[p.inv.selected];
    const def = it ? itemDef(it.type) : null;
    const food = def?.food || 0;
    if (p.dead || !food) return;
    const golden = it!.type === 'golden_apple';
    if (this.difficulty === 'easy') {
      // No hunger on Easy: food heals directly
      if (p.health >= MAX_HEALTH) return;
      p.health = Math.min(MAX_HEALTH, p.health + food);
      p.conn.send({ t: 'toast', text: `Ate ${def!.name} (+${food / 2} ♥)` });
    } else {
      if (p.food >= MAX_FOOD && !golden) return;
      p.food = Math.min(MAX_FOOD, p.food + food);
      p.sat = Math.min(p.food, p.sat + food * 0.6);
      if (golden) p.health = Math.min(MAX_HEALTH, p.health + 4);
      this.sendFood(p);
    }
    removeFromSlot(p.inv, p.inv.selected, 1);
    if (def!.returns) { const left = addItem(p.inv, def!.returns, 1); if (left) this.dropFrom(p, def!.returns, left); }
    p.conn.send({ t: 'health', hp: p.health });
    this.sendInv(p);
  }

  private sendFood(p: Player) { p.conn.send({ t: 'food', food: p.food, sat: Math.round(p.sat * 10) / 10 }); }

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
    p.exhaustion += 0.1;
    p.swingUntil = this.clock + 0.25;
    const held = p.inv.slots[p.inv.selected];
    const dmg = (held ? itemDef(held.type).damage || 1 : 1) + attackBonus(p.inv);
    if (target.kind === 'player') this.damagePlayer(target, dmg, p.body.pos, 'player', p.name);
    else if (!target.owner) this.damageMob(target, dmg, p.body.pos);
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
      const op = this.isOp(p.name);
      p.conn.send({ t: 'chat', from: null, text: `Commands: /players, /spawn, /kill, /sethome <1-4>, /tphome <1-4>${op ? ', /give <item> [amount] [player], /gamemode creative <code> [player], /gamemode survival [player]' : ''}` });
      return;
    }
    if (text.startsWith('/give ') || text === '/give' || text.startsWith('/gamemode') || text.startsWith('/gm ')) { this.opCommand(p, text); return; }
    if (text === '/kill') { if (!p.dead) { p.health = 0; p.conn.send({ t: 'health', hp: 0 }); this.killPlayer(p, 'kill'); } return; }
    const homeCmd = /^\/(sethome|tphome|home)(?:\s+(\d+))?$/i.exec(text);
    if (homeCmd) {
      const n = homeCmd[2] ? Number(homeCmd[2]) : 1;
      if (homeCmd[1].toLowerCase() === 'sethome') this.onSetHome(p, n - 1); else this.onGoHome(p, n - 1, true);
      return;
    }
    if (text === '/spawn') { if (p.downed) { p.conn.send({ t: 'chat', from: null, text: "You can't do that while you're down." }); return; } this.teleport(p, p.spawn[0], p.spawn[1], p.spawn[2]); return; }
    this.broadcast({ t: 'chat', from: p.name, text });
    this.log(`<${p.name}> ${text}`);
  }

  private isOp(name: string) { return this.ops.has('*') || this.ops.has(name.toLowerCase()); }

  // /give and /gamemode: operators only (see GameOptions.ops)
  private opCommand(p: Player, text: string) {
    const say = (t: string) => p.conn.send({ t: 'chat', from: null, text: t });
    if (!this.isOp(p.name)) { say('Only server operators can use that command.'); return; }
    const args = text.trim().split(/\s+/);
    const findPlayer = (name: string | undefined) => name ? [...this.players.values()].find(o => o.name.toLowerCase() === name.toLowerCase()) : p;
    if (args[0] === '/give') {
      // /give <item> [amount] [player]; item by id (diamond, oak_log...) or display name with underscores
      const type = findItem(args[1] || '');
      if (!type) { say(args[1] ? `Unknown item "${args[1]}". Examples: /give diamond 5, /give torch 64` : 'Usage: /give <item> [amount] [player]'); return; }
      const count = Math.max(1, Math.min(64 * 36, Math.floor(Number(args[2]) || 1)));
      const target = findPlayer(args[3]);
      if (!target) { say(`No player called ${args[3]} is online.`); return; }
      target.cheated = true;
      const left = addItem(target.inv, type, count);
      if (left > 0) this.spawnItem(type, left, target.body.pos.x, target.body.pos.y + 1, target.body.pos.z);
      this.sendInv(target);
      this.broadcastEquip(target);
      say(`Gave ${count} ${itemDef(type).name} to ${target.name}`);
      return;
    }
    // /gamemode creative <code> [player] or /gamemode survival [player]  (also c/s, 1/0)
    const m = (args[1] || '').toLowerCase();
    const mode: GameMode | null = ['creative', 'c', '1'].includes(m) ? 'creative' : ['survival', 's', '0'].includes(m) ? 'survival' : null;
    if (!mode) { say('Usage: /gamemode creative <code> [player], or /gamemode survival [player]'); return; }
    // Creative also needs the owner's code (dev builds and test servers skip it)
    let who = args[2];
    if (mode === 'creative' && !this.devTools) {
      if (creativeCodeHash(args[2] || '') !== this.creativeCode) { say('Creative mode needs the code: /gamemode creative <code>'); return; }
      who = args[3];
    }
    const target = findPlayer(who);
    if (!target) { say(`No player called ${who} is online.`); return; }
    this.setGamemode(target, mode);
    if (target !== p) say(`${target.name} is now in ${mode} mode`);
  }

  setGamemode(p: Player, mode: GameMode) {
    p.gamemode = mode;
    if (mode === 'creative') {
      p.cheated = true;
      if (p.downed) { p.downed = false; p.conn.send({ t: 'revived' }); }
      p.health = MAX_HEALTH; p.food = MAX_FOOD; p.sat = 5;
      p.conn.send({ t: 'health', hp: p.health });
      this.sendFood(p);
    }
    p.conn.send({ t: 'gamemode', mode });
    p.conn.send({ t: 'chat', from: null, text: `You are now in ${mode} mode` });
  }

  private onRespawn(p: Player) {
    if (!p.dead) return;
    p.dead = false;
    p.health = MAX_HEALTH;
    p.invuln = 2;
    p.food = MAX_FOOD; p.sat = 5; p.exhaustion = 0; p.foodT = 0; p.freezeT = 0; p.downed = false;
    this.teleport(p, p.spawn[0], p.spawn[1], p.spawn[2]);
    p.conn.send({ t: 'health', hp: p.health });
    this.sendFood(p);
  }

  // ---------------------------------------------------------------- The Robotic World

  // Through a portal: to the matching spot in the other world, next to a portal there (built if missing)
  private travel(p: Player, fromX: number, fromZ: number) {
    if (p.dead || p.downed || this.clock < p.portalCd) return;
    p.portalCd = this.clock + 3;
    const { x: tx, z: tz } = portalDestination(fromX, fromZ);
    let core: [number, number, number] | null = null;
    for (let r = 0; r <= 8 && !core; r++) for (let dx = -r; dx <= r && !core; dx++) for (let dz = -r; dz <= r && !core; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const top = this.world.surfaceHeight(tx + dx, tz + dz);
      for (let y = top; y >= top - 3 && !core; y--) if (isPortal(this.world.get, tx + dx, y, tz + dz)) core = [tx + dx, y, tz + dz];
    }
    // No portal there: build a return portal, but only on untouched ground (never over anyone's chests or builds).
    // Its blocks drop nothing when mined, so travelling can't make free etherite and gold.
    for (let r = 0; r <= 8 && !core; r++) for (let dx = -r; dx <= r && !core; dx++) for (let dz = -r; dz <= r && !core; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = tx + dx, z = tz + dz, y = Math.min(MAX_Y - 4, this.world.surfaceHeight(x, z));
      let untouched = true;
      for (let i = -1; i <= 1 && untouched; i++) for (let k = -1; k <= 1 && untouched; k++) for (let j = 0; j <= 3 && untouched; j++) {
        untouched = this.world.isGenerated(x + i, y + j, z + k, this.world.get(x + i, y + j, z + k));
      }
      if (!untouched) continue;
      for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) for (let j = 1; j <= 3; j++) this.setBlock(x + i, y + j, z + k, 0);
      this.setBlock(x, y, z, BLOCK_ID.portal_core);
      for (const [i, k] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.setBlock(x + i, y, z + k, BLOCK_ID.portal_frame);
      core = [x, y, z];
    }
    if (core) this.teleport(p, core[0] + 0.5, core[1] + 1, core[2] + 1.5); // standing on the frame beside the core
    else this.teleport(p, tx + 0.5, this.world.surfaceHeight(tx, tz) + 1, tz + 0.5); // all built up: just arrive
    const cx = core ? core[0] : tx;
    for (const m of this.mobs.values()) if (m.owner === p.name) this.bringPet(m, p);
    const there = isRobotic(cx) ? 'the Robotic World' : 'the Overworld';
    p.conn.send({ t: 'chat', from: null, text: `You travelled to ${there}.` });
    this.log(`${p.name} travelled to ${there}`);
  }

  private playerByName(name: string) { for (const p of this.players.values()) if (p.name === name) return p; return null; }

  private pets(p: Player) { return [...this.mobs.values()].filter(m => m.owner === p.name); }

  // A tamed robot catches up with its owner
  private bringPet(m: Mob, p: Player) {
    const a = Math.random() * Math.PI * 2;
    const x = p.body.pos.x + Math.cos(a) * 1.5, z = p.body.pos.z + Math.sin(a) * 1.5;
    m.body.pos.x = x; m.body.pos.z = z; m.body.pos.y = Math.max(p.body.pos.y, this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1);
    m.body.vel.x = m.body.vel.y = m.body.vel.z = 0;
  }

  // Use on a robot while holding a tungsten ingot: it becomes yours (up to MAX_PETS)
  private onTame(p: Player, eid: unknown) {
    if (p.dead || p.downed || !isInt(eid)) return;
    const m = this.mobs.get(eid);
    const held = p.inv.slots[p.inv.selected];
    if (!m || m.kind !== 'robot' || m.owner || m.dying >= 0 || held?.type !== 'tungsten_ingot') return;
    if (Math.hypot(m.body.pos.x - p.body.pos.x, m.body.pos.y - p.body.pos.y, m.body.pos.z - p.body.pos.z) > 5) return;
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    const have = this.pets(p).length;
    if (have >= MAX_PETS) { say(`You already have ${MAX_PETS} robot friends.`); return; }
    held.count--;
    if (held.count <= 0) p.inv.slots[p.inv.selected] = null;
    this.sendInv(p);
    this.broadcastEquip(p);
    m.owner = p.name;
    m.health = MOB_SPECS.robot.health;
    m.attackCd = 1;
    this.refreshMob(m);
    say(`You tamed a robot! It will follow you and defend you. (${have + 1}/${MAX_PETS})`);
    p.swingUntil = this.clock + 0.25;
    this.dirty = true;
  }

  // Resend a mob to everyone who sees it (its looks changed, e.g. tamed)
  private refreshMob(m: Mob) {
    const info = this.spawnInfo(m);
    for (const o of this.players.values()) if (o.seen.has(m.eid)) o.conn.send({ t: 'spawn', ents: [info] });
  }

  // A robot's laser: shown to everyone nearby, from its eye to where it hits
  private beam(m: Mob, to: { x: number; y: number; z: number }) {
    const b = m.body;
    const msg: ServerMsg = { t: 'beam', a: [b.pos.x, b.pos.y + 1.6, b.pos.z], b: [to.x, to.y, to.z], pet: !!m.owner };
    for (const o of this.players.values()) if (Math.abs(o.body.pos.x - b.pos.x) < VIEW_DIST && Math.abs(o.body.pos.z - b.pos.z) < VIEW_DIST) o.conn.send(msg);
  }

  private canSeeMob(from: Body, to: Body): boolean {
    const ax = from.pos.x, ay = from.pos.y + from.height * 0.85, az = from.pos.z;
    const bx = to.pos.x, by = to.pos.y + to.height * 0.5, bz = to.pos.z;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (isSolid(this.world.get(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t)))) return false;
    }
    return true;
  }

  // A tamed robot: stays near its owner, and lasers hostile mobs that come close
  private updatePet(m: Mob, owner: Player) {
    const b = m.body;
    const dOwner = Math.hypot(owner.body.pos.x - b.pos.x, owner.body.pos.z - b.pos.z);
    if (dOwner > 24 || Math.abs(owner.body.pos.y - b.pos.y) > 12) { this.bringPet(m, owner); return; }
    let foe: Mob | null = null, fd = Infinity;
    for (const o of this.mobs.values()) {
      if (o === m || o.owner || o.dying >= 0 || !MOB_SPECS[o.kind].hostile) continue;
      const d = Math.hypot(o.body.pos.x - b.pos.x, o.body.pos.z - b.pos.z);
      if (d < 14 && d < fd && Math.abs(o.body.pos.y - b.pos.y) < 8) { fd = d; foe = o; }
    }
    if (foe && dOwner < 18) {
      m.targetYaw = Math.atan2(-(foe.body.pos.x - b.pos.x), -(foe.body.pos.z - b.pos.z));
      m.moving = fd > 7;
      if (m.attackCd <= 0 && this.canSeeMob(b, foe.body)) {
        this.beam(m, { x: foe.body.pos.x, y: foe.body.pos.y + foe.body.height * 0.5, z: foe.body.pos.z });
        this.damageMob(foe, 6, b.pos);
        m.attackCd = 1.6;
      }
    } else {
      m.targetYaw = Math.atan2(-(owner.body.pos.x - b.pos.x), -(owner.body.pos.z - b.pos.z));
      m.moving = dOwner > 4;
    }
  }

  private teleport(p: Player, x: number, y: number, z: number) {
    // Never into blocks (a spawn point or home may have been built over since)
    if (boxIntersectsSolid(this.world.get, x, y, z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) y = this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1;
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

  // Homes: one slot per piece of etherite armour worn (up to 4). slot -1 (the H key): the first empty
  // slot, or the last one when all are used.
  private onSetHome(p: Player, slot: number) {
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    const slots = this.etheritePieces(p);
    if (p.dead || p.downed) return;
    if (slots <= 0) { say('Wear etherite armour to get home slots (one per piece, up to 4).'); return; }
    if (slot < 0) { slot = p.homes.findIndex(h => !h); if (slot < 0 || slot >= slots) slot = Math.min(p.homes.length, slots - 1); }
    if (!(slot >= 0 && slot < slots)) { say(`Pick a home from 1 to ${slots} (one per piece of etherite armour you wear).`); return; }
    while (p.homes.length < slot) p.homes.push(null);
    p.homes[slot] = { x: p.body.pos.x, y: p.body.pos.y, z: p.body.pos.z, name: `Home ${slot + 1}` };
    p.conn.send({ t: 'toast', text: `Home ${slot + 1} set!` });
    this.sendHomes(p);
  }

  private onGoHome(p: Player, i: number, fromChat = false) {
    const say = (text: string) => { if (fromChat) p.conn.send({ t: 'chat', from: null, text }); };
    if (p.dead) return;
    if (p.downed) { say("You can't do that while you're down."); return; }
    const slots = this.etheritePieces(p);
    if (!(i >= 0 && i < slots)) { say(slots ? `Pick a home from 1 to ${slots}.` : 'Wear etherite armour to get home slots (one per piece, up to 4).'); return; }
    const h = p.homes[i];
    if (!h) { say(`Home ${i + 1} isn't set yet. Stand there and type /sethome ${i + 1}.`); return; }
    this.teleport(p, h.x, h.y, h.z);
    say(`Teleported to Home ${i + 1}.`);
  }

  private sendHomes(p: Player) {
    p.conn.send({ t: 'homes', list: p.homes, slots: this.etheritePieces(p) });
  }

  // ---------------------------------------------------------------- Health

  damagePlayer(p: Player, amount: number, from: { x: number; y: number; z: number } | null, cause: string, by?: string) {
    if (p.dead || p.invuln > 0 || amount <= 0) return;
    if (p.gamemode === 'creative' && cause !== 'void') return;
    if (p.downed) { this.killPlayer(p, cause, by); return; }
    let dmg = amount;
    if (MOB_CAUSES.has(cause)) dmg *= this.difficulty === 'easy' ? 0.5 : this.difficulty === 'hard' ? 1.5 : 1;
    if (cause !== 'fall' && cause !== 'lava' && cause !== 'void' && cause !== 'starve' && cause !== 'freeze') dmg *= 1 - Math.min(20, armorPoints(p.inv)) * 0.04;
    p.exhaustion += 0.1;
    dmg = Math.max(1, Math.round(dmg));
    p.health = Math.max(0, p.health - dmg);
    p.invuln = 0.5;
    p.sinceDamage = 0;
    if (cause !== 'starve') p.foodT = 0; // healing restarts its timer after a hit (no instant heal-back)
    p.conn.send({ t: 'health', hp: p.health });
    p.conn.send({ t: 'hurt', from: from ? [from.x, from.y, from.z] : null, knock: from ? 7 : 0 });
    this.broadcastAnim(p.eid, 'hurt');
    if (p.health <= 0) {
      if (this.maxPlayers > 1 && cause !== 'void') this.downPlayer(p, cause, by);
      else this.killPlayer(p, cause, by);
    }
  }

  private downPlayer(p: Player, cause: string, by?: string) {
    p.downed = true; p.downT = DOWNED_SECONDS; p.downCause = cause; p.downBy = by; p.revive = 0; p.reviveAt = -1;
    p.invuln = 1;
    if (p.screen) this.forceCloseScreen(p);
    p.conn.send({ t: 'downed', seconds: DOWNED_SECONDS });
    this.broadcast({ t: 'chat', from: null, text: `${p.name} is down! Hold Use on them to revive them.` });
  }

  // A reviver holds Use on a downed player; progress builds while the messages keep coming
  private onRevive(p: Player, eid: unknown) {
    if (p.dead || p.downed || !isInt(eid)) return;
    const t = this.players.get(eid);
    if (!t || !t.downed || t === p) return;
    const d = Math.hypot(t.body.pos.x - p.body.pos.x, t.body.pos.y - p.body.pos.y, t.body.pos.z - p.body.pos.z);
    if (d > 3.5) return;
    t.reviveAt = this.clock; t.reviverName = p.name;
    p.swingUntil = this.clock + 0.25;
  }

  private killPlayer(p: Player, cause: string, by?: string) {
    p.dead = true;
    p.downed = false; p.health = 0;
    const { x, y, z } = p.body.pos;
    const spill = (type: string, count: number) => this.spawnItem(type, count, x, y + 1, z, { x: (Math.random() - 0.5) * 6, y: 4, z: (Math.random() - 0.5) * 6 }, 1, true);
    if (p.screen) { closeScreen(p.inv, spill); p.screen = null; p.furnaceKey = null; p.screenAt = null; } // what doesn't fit back is dropped too
    for (let i = 0; i < p.inv.slots.length; i++) {
      const it = p.inv.slots[i];
      if (it && i !== 54) spill(it.type, it.count);
    }
    p.inv = newInv();
    this.sendInv(p);
    const messages: Record<string, string> = {
      fall: 'hit the ground too hard', lava: 'tried to swim in lava', zombie: 'was slain by a Zombie',
      husk: 'was slain by a Husk', frostbitten: 'was slain by a Frostbitten', spider: 'was slain by a Spider',
      skeleton: 'was shot by a Skeleton', slime: 'was squashed by a Slime', slimelet: 'was squashed by a Slime', robot: 'was zapped by a Robot',
      cactus: 'was pricked to death', void: 'fell out of the world', starve: 'starved to death', freeze: 'froze to death', player: `was slain by ${by || 'a player'}`, kill: 'died',
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

  spawnItem(type: string, count: number, x: number, y: number, z: number, vel?: { x: number; y: number; z: number }, pickupDelay = 0.5, keep = false) {
    if (count <= 0 || !itemDef(type)) return;
    // Merge into an identical item lying right there instead of adding another entity
    const max = itemDef(type).stack;
    for (const o of this.items.values()) {
      if (o.type === type && o.count + count <= max && Math.abs(o.body.pos.x - x) < 1 && Math.abs(o.body.pos.y - y) < 1 && Math.abs(o.body.pos.z - z) < 1) {
        o.count += count; o.age = Math.min(o.age, 5); if (keep) o.keep = true;
        return;
      }
    }
    this.makeRoomForItem();
    const body = makeBody(0.125, 0.25, { x, y, z }, vel ? { ...vel } : { x: (Math.random() - 0.5) * 3, y: 3.5, z: (Math.random() - 0.5) * 3 });
    const it: Item = { kind: 'item', eid: this.nextEid++, type, count, body, age: 0, pickupDelay, keep: keep || undefined };
    this.items.set(it.eid, it);
  }

  // Over the cap, drop the oldest item, but not death loot or a broken chest's contents while anything else can go
  private makeRoomForItem() {
    if (this.items.size <= MAX_ITEMS) return;
    let victim: number | undefined;
    for (const [eid, it] of this.items) if (!it.keep) { victim = eid; break; }
    this.items.delete(victim ?? this.items.keys().next().value!);
  }

  private spawnArrow(x: number, y: number, z: number, vel: { x: number; y: number; z: number }, damage: number) {
    this.makeRoomForItem();
    const it: Item = { kind: 'item', eid: this.nextEid++, type: 'arrow', count: 1, body: makeBody(0.1, 0.2, { x, y, z }, vel), age: 0, pickupDelay: 1, arrow: { damage } };
    this.items.set(it.eid, it);
  }

  private updateItems(dt: number) {
    for (const it of this.items.values()) {
      it.age += dt;
      const b = it.body;
      if (it.age > (it.type === 'arrow' ? 60 : 300)) { this.items.delete(it.eid); continue; }
      if (b.inWater) b.vel.y = Math.min(b.vel.y + 12 * dt, 1.5);
      else b.vel.y = Math.max(b.vel.y - 22 * dt, -30);
      if (it.arrow) {
        // A flying arrow hits the first player whose box it enters
        for (const p of this.players.values()) {
          const q = p.body.pos;
          if (p.dead || Math.abs(q.x - b.pos.x) > p.body.halfW + 0.15 || Math.abs(q.z - b.pos.z) > p.body.halfW + 0.15 || b.pos.y < q.y - 0.1 || b.pos.y > q.y + p.body.height) continue;
          this.damagePlayer(p, it.arrow.damage, { x: b.pos.x - b.vel.x * 0.1, y: b.pos.y, z: b.pos.z - b.vel.z * 0.1 }, 'skeleton');
          this.items.delete(it.eid);
          break;
        }
        if (!this.items.has(it.eid)) continue;
        moveBody(this.world.get, b, dt);
        if (b.onGround || b.hitWall) { it.arrow = undefined; b.vel.x = b.vel.y = b.vel.z = 0; it.age = 55; } // lands; vanishes in a few seconds unless picked up
        continue;
      }
      const drag = b.onGround ? 8 : 1;
      b.vel.x -= b.vel.x * Math.min(1, drag * dt);
      b.vel.z -= b.vel.z * Math.min(1, drag * dt);

      // Pull toward the nearest living player within 2.5 blocks, pick up within 1.1
      if (it.age > it.pickupDelay) {
        let best: Player | null = null, bestD = 2.5;
        for (const p of this.players.values()) {
          if (p.dead || p.downed) continue;
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

  // Straight line from a mob's eyes to a player's chest, not blocked by solid blocks
  private canSee(from: Body, p: Player): boolean {
    const ax = from.pos.x, ay = from.pos.y + from.height * 0.85, az = from.pos.z;
    const bx = p.body.pos.x, by = p.body.pos.y + 1.2, bz = p.body.pos.z;
    const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (isSolid(this.world.get(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t)))) return false;
    }
    return true;
  }

  // Which hostile mob appears at a spot: by biome on the surface at night, a mix in caves
  private hostileKind(x: number, y: number, z: number, cave: boolean): MobKind {
    const r = Math.random();
    if (cave) return y < -20 && r < 0.15 ? 'slime' : r < 0.5 ? 'zombie' : r < 0.75 ? 'skeleton' : 'spider';
    const { biome } = columnInfo(x, z, this.world.seed);
    if (biome === 'desert') return r < 0.65 ? 'husk' : r < 0.85 ? 'spider' : 'skeleton';
    if (biome === 'snowy') return r < 0.55 ? 'frostbitten' : r < 0.8 ? 'skeleton' : 'spider';
    return r < 0.45 ? 'zombie' : r < 0.75 ? 'skeleton' : 'spider';
  }

  private spawnMob(kind: MobKind, x: number, y: number, z: number): Mob {
    const s = MOB_SPECS[kind];
    const yaw = Math.random() * Math.PI * 2;
    const m: Mob = { kind, eid: this.nextEid++, body: makeBody(s.halfW, s.height, { x, y, z }), yaw, targetYaw: yaw, health: s.health,
      wander: 0, moving: false, hurt: 0, flee: 0, attackCd: 0, dying: -1, burnT: 0, lavaT: 0 };
    this.mobs.set(m.eid, m);
    return m;
  }

  private trySpawnMobs(daylightNow: number) {
    const players = [...this.players.values()].filter(p => !p.dead);
    if (!players.length) return;
    const p = players[Math.floor(Math.random() * players.length)];
    let passive = 0, hostile = 0;
    for (const m of this.mobs.values()) { if (m.owner) continue; if (MOB_SPECS[m.kind].hostile) hostile++; else passive++; }
    const cap = Math.min(4, players.length) * (this.difficulty === 'easy' ? 0.5 : this.difficulty === 'hard' ? 1.5 : 1);
    const w = this.world;

    if (isRobotic(p.body.pos.x)) {
      // The Robotic World: robots roam the scrap, at any time
      if (hostile >= 6 * cap) return;
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 24;
      const x = Math.floor(p.body.pos.x + Math.cos(a) * r), z = Math.floor(p.body.pos.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z) || !isRobotic(x)) return;
      const top = w.surfaceHeight(x, z);
      if (!isSolid(w.get(x, top, z))) return; // not on oil
      if (!boxIntersectsSolid(w.get, x + 0.5, top + 1, z + 0.5, MOB_SPECS.robot.halfW, MOB_SPECS.robot.height)) this.spawnMob('robot', x + 0.5, top + 1, z + 0.5);
      return;
    }

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
        // Zombies spawn only at night on the surface, or in caves (any time)
        const top = w.surfaceHeight(x, z);
        const night = daylightNow < 0.35;
        let y: number;
        let cave = false;
        if (night && Math.random() < 0.5) {
          y = top + 1;
          if (isLeaves(w.get(x, top, z))) continue; // on the ground, not on treetops
        } else {
          // A cave: well below the natural ground (the tallest block can be a treetop, so measure from
          // the generated terrain height) and roofed over, so nothing appears in daylight under trees
          y = Math.floor(p.body.pos.y + (Math.random() - 0.5) * 20);
          cave = true;
          if (y > columnInfo(x, z, w.seed).h - CAVE_DEPTH || y > top - CAVE_DEPTH || y < MIN_Y + 6) continue;
        }
        if (w.get(x, y, z) !== 0 || w.get(x, y + 1, z) !== 0 || !isSolid(w.get(x, y - 1, z))) continue;
        const kind = this.hostileKind(x, y, z, cave);
        if (boxIntersectsSolid(w.get, x + 0.5, y, z + 0.5, MOB_SPECS[kind].halfW, MOB_SPECS[kind].height)) continue;
        this.spawnMob(kind, x + 0.5, y, z + 0.5);
        break;
      }
    }
  }

  private updateMobs(dt: number, dayNow: number) {
    const players = [...this.players.values()].filter(p => !p.dead && !p.downed && p.gamemode !== 'creative');
    for (const m of this.mobs.values()) {
      const spec = MOB_SPECS[m.kind];
      const b = m.body;
      const day = isRobotic(b.pos.x) ? ROBO_DAYLIGHT : dayNow;
      const owner = m.owner ? this.playerByName(m.owner) : null;
      if (m.owner && !owner) { this.mobs.delete(m.eid); continue; }
      // Nearest living player
      let target: Player | null = null, distP = Infinity;
      for (const p of players) {
        const d = Math.hypot(p.body.pos.x - b.pos.x, p.body.pos.z - b.pos.z);
        if (d < distP) { distP = d; target = p; }
      }
      let nearAny = Infinity;
      for (const p of this.players.values()) nearAny = Math.min(nearAny, Math.hypot(p.body.pos.x - b.pos.x, p.body.pos.z - b.pos.z));
      if (!owner && (nearAny > 96 || (spec.hostile && day > 0.6 && nearAny > 40 && Math.random() < dt * 0.1))) { this.mobs.delete(m.eid); continue; }

      if (m.dying >= 0) {
        m.dying += dt;
        if (m.dying > 0.8) {
          for (const [type, n] of MOB_DROPS[m.kind]()) if (n > 0) this.spawnItem(type, n, b.pos.x, b.pos.y + 0.5, b.pos.z);
          if (m.kind === 'slime') for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) this.spawnMob('slimelet', b.pos.x + (Math.random() - 0.5), b.pos.y + 0.2, b.pos.z + (Math.random() - 0.5));
          this.mobs.delete(m.eid);
        }
        continue;
      }
      m.hurt = Math.max(0, m.hurt - dt);
      m.flee = Math.max(0, m.flee - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);

      let speed = spec.speed;
      const dxp = target ? target.body.pos.x - b.pos.x : 0, dzp = target ? target.body.pos.z - b.pos.z : 0;
      // Spiders only hunt in the dark (or when attacked)
      const calm = m.kind === 'spider' && day > 0.6 && m.flee <= 0 && b.pos.y > this.world.surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z)) - 2;
      const chasing = spec.hostile && !owner && !calm && target && distP < 18 && Math.abs(target.body.pos.y - b.pos.y) < 8;
      if (owner) this.updatePet(m, owner);
      else if (chasing && target && m.kind === 'robot') {
        // Keeps 4-12 blocks away and fires its laser when it can see you (3 hearts; it can miss)
        m.targetYaw = Math.atan2(-dxp, -dzp);
        m.moving = distP > 12 || distP < 4;
        if (distP < 4) m.targetYaw += Math.PI;
        if (m.attackCd <= 0 && distP < 16 && this.canSee(b, target)) {
          const t = target.body.pos;
          const hit = Math.random() < (this.difficulty === 'hard' ? 0.85 : 0.7);
          const miss = hit ? 0 : 1.2;
          this.beam(m, { x: t.x + (Math.random() - 0.5) * miss * 2, y: t.y + 1.2 + (Math.random() - 0.5) * miss, z: t.z + (Math.random() - 0.5) * miss * 2 });
          if (hit) this.damagePlayer(target, 6, b.pos, 'robot');
          m.attackCd = this.difficulty === 'hard' ? 2 : 3;
        }
      } else if (chasing && target && m.kind === 'skeleton') {
        // Archer: keep 5-11 blocks away and shoot when it can see you
        m.targetYaw = Math.atan2(-dxp, -dzp);
        m.moving = distP > 11 || distP < 5;
        if (distP < 5) m.targetYaw += Math.PI;
        if (m.attackCd <= 0 && distP < 16 && this.canSee(b, target)) {
          const ex = b.pos.x, ey = b.pos.y + 1.6, ez = b.pos.z;
          const tx = target.body.pos.x, ty = target.body.pos.y + 1.2, tz = target.body.pos.z;
          const v = 16, dist = Math.hypot(tx - ex, tz - ez), t = dist / v;
          const inaccuracy = this.difficulty === 'hard' ? 0.4 : 0.9;
          this.spawnArrow(ex, ey, ez, {
            x: (tx - ex) / t + (Math.random() - 0.5) * inaccuracy,
            y: (ty - ey) / t + 11 * t + (Math.random() - 0.5) * inaccuracy,
            z: (tz - ez) / t + (Math.random() - 0.5) * inaccuracy,
          }, 3);
          m.attackCd = this.difficulty === 'hard' ? 1.4 : 2.2;
        }
      } else if (chasing && target) {
        m.targetYaw = Math.atan2(-dxp, -dzp);
        m.moving = distP > 0.8;
        const reach = spec.halfW + 0.95;
        if (spec.damage && distP < reach && Math.abs(target.body.pos.y - b.pos.y) < 1.6 && m.attackCd <= 0) {
          this.damagePlayer(target, spec.damage, b.pos, m.kind);
          if (m.kind === 'husk' && this.difficulty !== 'easy') { target.exhaustion += 8; }
          if (m.kind === 'frostbitten' && this.difficulty !== 'easy') target.freezeT = Math.max(target.freezeT, 4);
          m.attackCd = 1;
        }
        // Slimes move in hops
        if ((m.kind === 'slime' || m.kind === 'slimelet') && b.onGround) { m.moving = false; if (Math.random() < dt * 1.5) { b.vel.y = 7; m.moving = true; } }
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
      if (m.kind === 'spider' && b.hitWall && m.moving) b.vel.y = 4; // spiders climb walls

      if (b.inLava) { m.lavaT -= dt; if (m.lavaT <= 0) { m.lavaT = 0.5; m.hurt = 0; this.damageMob(m, 2, { x: b.pos.x, y: b.pos.y - 1, z: b.pos.z }); } }
      // Zombies burn in daylight when exposed to the sky
      if (spec.burns && day > 0.6 && b.pos.y > this.world.surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z))) {
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
    if (this.tickCount % 5 === 0) for (const p of this.players.values()) this.streamEdits(p);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1; this.trySpawnMobs(day); this.growCrops(); }
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
    const creative = p.gamemode === 'creative'; // flying: up to ~22 blocks/s
    p.moveBudget = p.downed ? Math.min(1.5, p.moveBudget + 2.5 * dt)                         // downed: a crawl
      : Math.min(creative ? 6 : 3, p.moveBudget + (creative ? 24 : 11) * dt);                 // ~11 blocks/s sustained, small burst
    p.climbBudget = Math.min(creative ? 6 : 3, p.climbBudget + (creative ? 24 : 13) * dt);
    p.dropCredit = Math.min(8, p.dropCredit + 4 * dt);     // item drops per second
    p.chatCredit = Math.min(5, p.chatCredit + 1 * dt);     // chat lines per second
    p.invuln = Math.max(0, p.invuln - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
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
    if (p.downed) {
      // Revive progress builds while someone keeps holding Use on you
      if (p.reviveAt >= 0 && this.clock - p.reviveAt < 0.4) {
        p.revive += dt;
        if (Math.floor((p.revive - dt) * 4) !== Math.floor(p.revive * 4)) {
          const msg: ServerMsg = { t: 'revive_progress', progress: Math.min(1, p.revive / REVIVE_SECONDS), name: p.reviverName };
          p.conn.send(msg);
          const r = [...this.players.values()].find(o => o.name === p.reviverName); if (r) r.conn.send(msg);
        }
        if (p.revive >= REVIVE_SECONDS) {
          p.downed = false; p.health = 6; p.invuln = 2; p.revive = 0;
          p.conn.send({ t: 'health', hp: p.health });
          p.conn.send({ t: 'revived' });
          this.broadcast({ t: 'chat', from: null, text: `${p.reviverName} revived ${p.name}` });
          return;
        }
      } else if (p.revive > 0) {
        p.revive = 0;
        p.conn.send({ t: 'revive_progress', progress: 0, name: '' });
      }
      p.downT -= dt;
      if (p.downT <= 0) this.killPlayer(p, p.downCause, p.downBy);
      return;
    }
    if (p.gamemode === 'creative') { p.exhaustion = 0; p.freezeT = 0; return; }
    // Freezing in powder snow (not on Easy): after a few seconds it starts to hurt
    if (this.difficulty !== 'easy' && boxTouchesBlock(w, b, POWDER_SNOW, -0.01)) {
      p.freezeT += dt;
      if (p.freezeT > 5) { p.freezeT = 3; p.invuln = 0; this.damagePlayer(p, 1, null, 'freeze'); }
    } else p.freezeT = Math.max(0, p.freezeT - dt * 2);
    if (p.dead) return;
    if (this.difficulty === 'easy') {
      if (p.health < MAX_HEALTH && p.sinceDamage > 4) {
        p.regen += dt;
        if (p.regen > 2.5) { p.regen = 0; p.health++; p.conn.send({ t: 'health', hp: p.health }); }
      }
      return;
    }
    // Hunger: exhaustion burns saturation first, then food points
    let foodChanged = false;
    while (p.exhaustion >= 4) {
      p.exhaustion -= 4;
      if (p.sat > 0) p.sat = Math.max(0, p.sat - 1); else { p.food = Math.max(0, p.food - 1); foodChanged = true; }
    }
    p.foodT += dt;
    if (p.food >= 18 && p.health < MAX_HEALTH) {
      // Well fed: heal (fast while saturated and full)
      if (p.foodT >= (p.food >= MAX_FOOD && p.sat > 0 ? 0.5 : 4)) {
        p.foodT = 0; p.health++; p.exhaustion += 6;
        p.conn.send({ t: 'health', hp: p.health });
      }
    } else if (p.food <= 0) {
      // Starving: Medium stops at half a heart, Hard can kill
      if (p.foodT >= 4) {
        p.foodT = 0;
        if (this.difficulty === 'hard' || p.health > 1) { p.invuln = 0; this.damagePlayer(p, 1, null, 'starve'); }
      }
    } else p.foodT = Math.min(p.foodT, 4);
    if (foodChanged) this.sendFood(p);
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
          if (e.downed) flags |= EF_DOWNED;
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
    return { eid: e.eid, kind: e.kind, x, y, z, owner: e.owner };
  }

  // ---------------------------------------------------------------- Sending helpers

  private invState(p: Player): InvState {
    return { slots: p.inv.slots, cursor: p.inv.cursor, selected: p.inv.selected, ack: p.invSeq };
  }
  private sendInv(p: Player) { p.conn.send({ t: 'inv', inv: this.invState(p) }); }
  private sendChest(key: string) {
    const c = this.chests.get(key);
    if (!c) return;
    for (const p of this.players.values()) if (p.furnaceKey === key && p.screen?.mode === 'chest') p.conn.send({ t: 'chest', slots: c });
  }
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
    const live = {
      health: p.dead ? MAX_HEALTH : p.health, food: p.dead ? MAX_FOOD : p.food, saturation: p.dead ? 5 : p.sat, inv,
    };
    this.storage.savePlayer(p.name, {
      x: b.x, y: b.y, z: b.z, yaw: p.yaw, pitch: p.pitch, gamemode: p.gamemode,
      ...(p.home || live), // a carried character goes back to its save; this server keeps its own
      spawn: p.spawn, homes: p.homes, token: p.token || undefined, cheated: p.cheated || undefined,
      pets: this.pets(p).filter(m => m.dying < 0).map(m => Math.round(m.health)),
    });
  }

  worldSave(): WorldSave {
    return {
      v: 1, seed: this.world.seed, time: this.time, edits: this.world.exportEdits(), facing: this.world.exportFacing(),
      furnaces: Object.fromEntries(this.furnaces), spawn: this.spawnPoint, difficulty: this.difficulty, chests: Object.fromEntries(this.chests),
      crops: Object.fromEntries([...this.crops].map(([k, due]) => [k, Math.max(0, Math.round(due - this.clock))])),
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
    return { players: this.players.size, mobs: this.mobs.size, items: this.items.size, chunks: this.world.chunkCount(), editedChunks: this.world.editedChunkCount(), furnaces: this.furnaces.size,
      tickMs: +this.tickMs.toFixed(2), tickMaxMs: +this.tickMaxMs.toFixed(2) };
  }
}

export type { Player };
