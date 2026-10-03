// Authoritative game simulation. Environment-agnostic: runs in Node (multiplayer) and in a Web Worker
// (single player). Transports hand it decoded messages and deliver what it sends.
import { BLOCKS, BLOCK_ID, ITEMS, WATER, LAVA, OIL, POWDER_SNOW, CHEST, CLAIM_STONE, ELEM_PORTAL, COLORS, BOSS_CRYSTAL, isBanner, isShrine, isLiquid, isFacingBlock, isLeaves, isPlant, isReplaceable, isSolid, itemDef, miningInfo, plantCanStand, CROP_NEXT, CROP_GROW_SECONDS } from '../../shared/blocks.ts';
import { ACHIEVEMENT_IDS, itemAchievement } from '../../shared/achievements.ts';
import { isRobotic, isPortal, portalDestination, roboticStructureAt, nearestAltar, ROBO_DAYLIGHT } from '../../shared/robotic.ts';
import { shrineCrystals } from '../../shared/elemental.ts';
import { isElemental, elementalDestination, findElementalPortal, portalCells, nearestShrine, elementalBiome, ELEM_DAYLIGHT, ELEM_MIN_X, ELEM_MAX_X, SHRINE_BOSS, SHRINE_CORE, BIOME_NAMES } from '../../shared/elemental.ts';
import { makeBody, moveBody, boxIntersectsSolid, boxTouchesBlock, raycastBlocks, rayHitsBox, PLAYER_EYE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, type Body } from '../../shared/physics.ts';
import {
  newInv, sanitizeInv, addItem, applyAction, closeScreen, removeFromSlot, armorPoints, attackBonus,
  newChest, maxStack, CHEST_SIZE, OFFHAND, type Inv, type Screen, type InvAction, type Stack,
} from '../../shared/inventory.ts';
import { newFurnace, tickFurnace, isFurnaceEmpty, type FurnaceState } from '../../shared/furnace.ts';
import { MOB_SPECS, MOB_KINDS } from '../../shared/mobs.ts';
import { DAY_LENGTH, daylight } from '../../shared/time.ts';
import { MIN_Y, MAX_Y, columnInfo } from '../../shared/worldgen.ts';
import {
  PROTOCOL_VERSION, MAX_PLAYERS, sanitizeName, sanitizeLook, isNum, isInt,
  MF_GROUND, MF_SNEAK, MF_WATER, MF_JET, EF_SNEAK, EF_HURT, EF_DYING, EF_GROUND, EF_SWING, EF_DOWNED, EF_ANGRY,
  DIFFICULTIES, SQUAD_ORDERS, MF_GLIDE, type SquadOrder, type Weather, type Ride, type Difficulty, type GameMode, type ClientMsg, type ServerMsg, type Look, type MobKind, type SpawnInfo, type InvState,
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

type LootKind = 'dungeon' | 'temple' | 'igloo' | 'cabin' | 'ruin' | 'giant_robot' | 'frost_ruin' | 'temple_frost' | 'temple_volcano' | 'temple_jungle' | 'temple_clouds';
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
  // The Elemental World's Frosted Lands
  frost_ruin: [['frost_crystal', 2, 6, 0.7], ['snowberries', 2, 6, 0.6], ['glacite', 1, 2, 0.25], ['moonstone', 1, 3, 0.3], ['diamond', 1, 2, 0.15],
    ['packed_ice', 4, 12, 0.4], ['golden_apple', 1, 1, 0.1], ['baked_potato', 2, 5, 0.4], ['moonstone_orb', 1, 2, 0.15]],
  // The bosses' temples (two chests each, behind the arena)
  temple_frost: [['diamond', 2, 5, 0.6], ['glacite', 2, 4, 0.5], ['frost_crystal', 4, 10, 0.7], ['moonstone_orb', 1, 3, 0.4], ['etherite', 1, 3, 0.3],
    ['golden_apple', 1, 2, 0.4], ['moonstone', 2, 6, 0.5], ['glacite_sword', 1, 1, 0.08], ['water_ore', 1, 1, 0.05]],
  temple_volcano: [['diamond', 2, 5, 0.6], ['gold_block', 1, 3, 0.4], ['obsidian', 4, 10, 0.6], ['etherite', 1, 3, 0.3], ['magma_block', 4, 8, 0.5],
    ['golden_apple', 1, 2, 0.4], ['coal_block', 2, 5, 0.5], ['moonstone_orb', 1, 2, 0.25], ['lava_ore', 1, 1, 0.05]],
  temple_jungle: [['diamond', 2, 5, 0.6], ['golden_carrot', 2, 6, 0.6], ['etherite', 1, 3, 0.3], ['melon', 2, 4, 0.4], ['moss_block', 4, 12, 0.5],
    ['golden_apple', 1, 2, 0.4], ['moonstone_orb', 1, 2, 0.25], ['earth_ore', 1, 1, 0.05]],
  temple_clouds: [['diamond', 2, 5, 0.6], ['feather', 6, 16, 0.6], ['etherite', 1, 3, 0.3], ['obitite', 1, 2, 0.15], ['cloud', 6, 16, 0.5],
    ['golden_apple', 1, 2, 0.4], ['moonstone_orb', 1, 3, 0.4], ['skystone_bricks', 8, 20, 0.4], ['wind_ore', 1, 1, 0.05]],
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

const MOB_CAUSES = new Set(['zombie', 'husk', 'frostbitten', 'spider', 'skeleton', 'slime', 'robot', 'robot_titan', 'frost_wraith', 'magma_colossus', 'thorn_guardian', 'tempest', 'elemental_core']);
// The bosses: a health bar while near, kept far from where they wake, 5 minutes to return once defeated
const BOSS_NAMES: Partial<Record<MobKind, string>> = { robot_titan: 'Robot Titan', frost_wraith: 'Frost Wraith', magma_colossus: 'Magma Colossus', thorn_guardian: 'Thorn Guardian', tempest: 'Tempest', elemental_core: 'Elemental Core' };
const TRANSFORM_SECONDS = 10; // the Tempest's transformation into its second form (the client's animation matches it)
const BOSS_ACHIEVEMENTS: Partial<Record<MobKind, string>> = { robot_titan: 'titan', frost_wraith: 'wraith', magma_colossus: 'colossus', thorn_guardian: 'thorn', tempest: 'roc', elemental_core: 'core' };
const FLOAT_HEIGHT: Partial<Record<MobKind, number>> = { frost_wraith: 2.5, tempest: 7, elemental_core: 3 }; // flyers: how high above the ground
// The Elemental Core fights as each element's boss in turn
const CORE_ELEMENTS: MobKind[] = ['frost_wraith', 'magma_colossus', 'thorn_guardian', 'tempest'];
const CORE_ELEMENT_NAMES = ['ice', 'fire', 'earth', 'wind'];
const AIR_SECONDS = 15;      // breath underwater before drowning starts
// Frame blocks of an Elemental World portal (placing the last one may light it; breaking one puts it out)
const FRAME_BLOCKS = new Set([BLOCK_ID.etherite_block, BLOCK_ID.gold_block, BLOCK_ID.obitite_block, BLOCK_ID.moonstone_block, BLOCK_ID.elemental_frame]);
const JET_SECONDS = 30;       // a full jetpack tank lasts this long
const TITAN_RESPAWN = 5 * 60; // seconds after a boss (any of them) is defeated before it wakes again
const MAX_PETS = 3;
const MAX_HOLD = 6;          // stacks a collecting robot carries before bringing them to you
const CLAIM_R = 16;          // a claim stone protects the 33 x 33 columns around it, top to bottom
const MAX_CLAIMS = 3;        // claim stones per player
const SPAWN_FREE = 24;       // nobody can claim the world spawn
const TP_ASK_SECONDS = 60;   // how long a teleport request waits for an answer
const SEAT_HOLD = 60;       // seconds a dropped player stays in the world, so a quick reconnect picks up where they were
const NO_CONN: Conn = { send() {}, close() {} };
// /gamemode creative needs the owner's code. Only its fingerprint is kept here (the source is public).
const CREATIVE_CODE = 'c97bccc8';
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
  titans?: Record<string, number>; // altar (or Frost Wraith shrine) -> seconds until its boss wakes again
  claims?: Record<string, string>; // claim stone "x,y,z" -> owner
  teams?: Record<string, string>;  // player (lower case) -> team colour
  weather?: Weather;
  trust?: Record<string, string[]>; // owner -> players they let build on their claims
}
// A tamed robot as saved with its owner (older saves: just its health)
interface PetSave { hp: number; order?: SquadOrder; guard?: [number, number, number]; hold?: Stack[] }
export interface PlayerSave {
  x: number; y: number; z: number; yaw: number; pitch: number; health: number; food?: number; saturation?: number; gamemode?: GameMode;
  inv: InvState; spawn?: [number, number, number]; homes?: ({ x: number; y: number; z: number; name: string } | null)[];
  token?: string; // proves ownership of the name
  cheated?: boolean; // used /give, creative mode or dev tools: this character can't be carried into a server
  pets?: (number | PetSave)[]; // tamed robots, which come back with the player
  death?: [number, number, number]; // where they last died (a moonstone orb can take them back)
  jetFuel?: number;  // jetpack fuel, 0..1
  achievements?: string[];
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
  fireCd: number;            // laser cannon cooldown
  jetFuel: number;           // jetpack fuel, 0..1 (a full tank is JET_SECONDS of thrust)
  achievements: Set<string>;
  bossHp: number;            // boss health last shown to this player (-1: no bar)
  awayAt: number;            // clock time the connection dropped (-1: connected); see SEAT_HOLD
  blockedToastAt: number;    // last "your armour blocked it" message (so it isn't repeated every hit)
  lastDeath: [number, number, number] | null;
  tpAsks: Map<string, number>; // players asking to teleport to this one -> clock time the request expires
  claimShown: string;        // owner of the claim the player is standing in, as last announced ('' none)
  slowT: number;             // seconds of being slowed by frost
  inElemPortal: boolean;     // standing in an Elemental World portal (travel happens on stepping in)
  air: number;               // seconds of breath left underwater
  airShown: number;          // tenths of breath last sent
  poisonT: number;           // seconds left poisoned
  fireT: number;             // seconds left on fire
  effectT: number;           // timer for poison and fire damage (once a second)
  statusShown: string;       // poison/fire seconds last sent
  magmaT: number;            // standing on magma burns once a second
  fireballCd: number;        // the lava chestplate's fireball cooldown
  ride: Ride;                // in a boat or a minecart (the item is given back on getting out)
  maxShown: number;          // maximum health last sent
}
interface Mob {
  kind: MobKind; eid: number; body: Body; yaw: number; targetYaw: number; health: number;
  wander: number; moving: boolean; hurt: number; flee: number; attackCd: number; dying: number; burnT: number; lavaT: number;
  owner?: string;            // a tamed robot: follows this player and fights for them
  altar?: string;            // the Robot Titan: its altar (see shared/robotic.ts nearestAltar)
  phaseT?: number; grindT?: number;
  order?: SquadOrder;        // a tamed robot's order (default follow)
  guard?: [number, number, number]; // where a guarding robot stands
  hold?: Stack[];            // what a collecting robot is carrying back to its owner
  slowT?: number;            // seconds left of being chilled by glacite or frost
  moves?: Record<string, number>; // a boss's move cooldowns (seconds)
  phase2?: boolean;          // a boss below half health: angrier, faster, new moves
  held?: number[];           // the Magma Colossus: magma balls waiting to be thrown
  throwT?: number;
  stompT?: number;           // the Thorn Guardian: the warning before its stomp lands
  burst?: number;            // the Tempest: lasers left in this burst
  blindT?: number;           // a walking boss: seconds without sight of its target (then it leaps)
  life?: number;             // a hurricane: seconds before it blows over
  pullT?: number;            // a big hurricane: timer for dragging players in
  crystals?: [number, number, number][]; // a temple boss: its towers' crystals (it heals from them)
  healT?: number;
  transformT?: number;       // the Tempest: its second-form transformation (seconds left)
  home?: { x: number; z: number };        // a temple boss: the middle of its temple
  laserAt?: [number, number, number];      // the Tempest transforming: the crystal its laser is on
  absorbed?: number; absorbT?: number; // the Tempest's transformation: crystals drawn in so far, and when the next goes
  raptureAt?: { x: number; y: number; z: number }; // the Tempest's four-wing charge: where it will lunge
  raptureT?: number;
  grabbed?: number;          // the player it holds in its wings
  grabT?: number;
  starT?: number;            // the Tempest's sky lasers: seconds until they fall
  starSpots?: [number, number, number][];
  perchT?: number;           // the Tempest: seconds left resting on the ground
  elem?: number;             // the Elemental Core: which element it fights with (see CORE_ELEMENTS)
  elemT?: number;
  poisonT?: number;          // seconds left poisoned
  fireT?: number;            // seconds left on fire
  effectT?: number;
}
// arrow: set while an arrow is flying (it hurts the first player it hits, then lands as a normal item)
// shot: a projectile in flight (a fireball, magma ball or icicle); see spawnShot
type ShotKind = 'fireball' | 'magma_ball' | 'icicle';
interface Shot { kind: ShotKind; damage: number; owner: number; ownerName: string; bossKind?: MobKind; byPlayer: boolean;
  gravity?: boolean; fire?: number; freeze?: number; slow?: number; splash?: number; heldBy?: number; slot?: number }
interface Item { kind: 'item'; eid: number; type: string; count: number; body: Body; age: number; pickupDelay: number; arrow?: { damage: number }; keep?: boolean; shot?: Shot }
const SHOT_GRAVITY = 22;

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
  robot_titan: () => [['obitite', rnd(6, 10)], ...(Math.random() < 0.5 ? [['laser_cannon_core', 1] as [string, number]] : [])],
  frost_wraith: () => [['water_ore', rnd(2, 4)], ['glacite', rnd(6, 10)], ...(Math.random() < 0.5 ? [['frost_heart', 1] as [string, number]] : [])],
  magma_colossus: () => [['lava_ore', rnd(2, 4)], ['obsidian', rnd(2, 5)], ['magma_block', rnd(1, 3)]],
  thorn_guardian: () => [['earth_ore', rnd(2, 4)], ['moss_block', rnd(2, 5)], ['jungle_wood', rnd(2, 6)]],
  hurricane: () => [],
  elemental_core: () => [['elemental_wings', 1], ['water_ore', rnd(1, 2)], ['lava_ore', rnd(1, 2)], ['earth_ore', rnd(1, 2)], ['wind_ore', rnd(1, 2)], ['diamond_block', rnd(1, 3)]],
  tempest: () => [['wind_ore', rnd(2, 4)], ['feather', rnd(3, 8)], ['cloud', rnd(2, 6)]],
  robot: () => [...(Math.random() < 0.02 ? [['laser_cannon', 1] as [string, number]] : []), ['iron_ingot', rnd(0, 1)], ...(Math.random() < 0.15 ? [['tungsten_ingot', 1] as [string, number]] : []), ...(Math.random() < 0.25 ? [['robot_eye', 1] as [string, number]] : [])],
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
  private titanWakes = new Map<string, number>(); // altar key -> game clock when its Titan may wake again
  private claims = new Map<string, string>(); // claim stone "x,y,z" -> owner's name
  private teams = new Map<string, string>();  // player (lower case) -> team colour (one of the dye colours)
  private teamInvites = new Map<string, Map<string, number>>(); // player (lower case) -> team colour -> when the invite runs out
  private weather: Weather = 'clear';
  private weatherT = 300 + Math.random() * 600; // seconds until the weather changes
  private boltT = 8;                          // seconds until the next lightning strike (in a thunderstorm)
  private trust = new Map<string, Set<string>>(); // owner (lower case) -> trusted names (lower case)
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
      for (const [k, s] of Object.entries(save.titans || {})) if (isNum(s) && (/^f?-?\d+,-?\d+$/.test(k) || k === 'core')) this.titanWakes.set(k, this.clock + Math.max(0, Math.min(TITAN_RESPAWN, s)));
      for (const [k, o] of Object.entries(save.claims || {})) if (typeof o === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(k)) this.claims.set(k, sanitizeName(o));
      for (const [n, c] of Object.entries(save.teams || {})) if ((COLORS as readonly string[]).includes(c)) this.teams.set(sanitizeName(n).toLowerCase(), c);
      if (save.weather === 'rain' || save.weather === 'thunder') this.weather = save.weather;
      for (const [o, list] of Object.entries(save.trust || {})) if (Array.isArray(list)) this.trust.set(o.toLowerCase(), new Set(list.filter(n => typeof n === 'string').map(n => sanitizeName(n).toLowerCase())));
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
    if (!hello || hello.t !== 'hello') { conn.close('Expected a hello first'); return null; } // the game always says hello first
    if (hello.v !== PROTOCOL_VERSION) { conn.close('Version mismatch: please refresh the page'); return null; }
    const name = sanitizeName(hello.name);
    const token = typeof hello.token === 'string' ? hello.token.slice(0, 64) : '';
    const online = [...this.players.values()].find(o => o.name.toLowerCase() === name.toLowerCase());
    if (online) {
      // Same person coming back (a dropped connection, or another tab): carry on where they are
      if (token && online.token === token) return this.resume(online, conn, hello);
      conn.close(`The name "${name}" is already playing. Pick another name.`); return null;
    }
    if (this.players.size >= this.maxPlayers) { conn.close('Server is full'); return null; }
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
    // Invited by a friend (an invite link): a newcomer starts beside them instead of at the world spawn
    const friend = !saved && typeof hello.near === 'string' ? [...this.players.values()].find(o => o.name.toLowerCase() === sanitizeName(hello.near).toLowerCase() && o.awayAt < 0 && !o.dead) : undefined;
    const pos = saved && [saved.x, saved.y, saved.z].every(isNum) ? { x: saved.x, y: saved.y, z: saved.z }
      : friend ? this.spotBeside(friend) : { x: spawn[0], y: spawn[1], z: spawn[2] };
    // Don't start inside blocks (terrain may have changed)
    if (boxIntersectsSolid(this.world.get, pos.x, pos.y, pos.z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) pos.y = this.world.surfaceHeight(Math.floor(pos.x), Math.floor(pos.z)) + 1;

    const p: Player = {
      kind: 'player', eid: this.nextEid++, name, look: sanitizeLook(hello.look), conn,
      body: makeBody(PLAYER_HALF_WIDTH, PLAYER_HEIGHT, pos), yaw: friend ? Math.atan2(pos.x - friend.body.pos.x, pos.z - friend.body.pos.z) : saved?.yaw || 0, pitch: saved?.pitch || 0, flags: MF_GROUND,
      lastMove: this.clock, health: Math.max(1, Math.min(2 * MAX_HEALTH, (carry && isNum(carry.health) ? carry.health : saved?.health) ?? MAX_HEALTH)), dead: false,
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
      cheated: !!saved?.cheated, portalCd: 0, bossHp: -1, awayAt: -1, blockedToastAt: -99, fireCd: 0,
      lastDeath: Array.isArray(saved?.death) && saved!.death!.length === 3 && saved!.death!.every(isNum) ? saved!.death! : null,
      tpAsks: new Map(), claimShown: '', slowT: 0, inElemPortal: false,
      air: AIR_SECONDS, airShown: 10, poisonT: 0, fireT: 0, effectT: 0, statusShown: '0,0', magmaT: 0, fireballCd: 0, maxShown: MAX_HEALTH, ride: null, achievements: new Set(Array.isArray(saved?.achievements) ? saved!.achievements!.filter(a => ACHIEVEMENT_IDS.has(a)) : []), jetFuel: isNum(saved?.jetFuel) ? Math.max(0, Math.min(1, saved!.jetFuel!)) : 0,
    };
    p.health = Math.min(p.health, this.maxHp(p)); // 20 hearts only while wearing earth leggings
    this.players.set(p.eid, p);
    if (Array.isArray(saved?.pets)) for (const raw of saved!.pets!.slice(0, MAX_PETS)) {
      const pet: PetSave | null = isNum(raw) ? { hp: raw } : raw && typeof raw === 'object' && isNum(raw.hp) ? raw : null;
      if (!pet) continue;
      // A guard goes back to its post; the others arrive with their owner
      const guard = pet.order === 'guard' && Array.isArray(pet.guard) && pet.guard.length === 3 && pet.guard.every(isNum) ? pet.guard : undefined;
      const m = guard ? this.spawnMob('robot', guard[0], guard[1], guard[2]) : this.spawnMob('robot', pos.x + (Math.random() - 0.5) * 2, pos.y, pos.z + (Math.random() - 0.5) * 2);
      m.owner = p.name; m.health = Math.max(1, Math.min(MOB_SPECS.robot.health, pet.hp));
      m.order = guard ? 'guard' : pet.order === 'collect' ? 'collect' : 'follow';
      if (guard) m.guard = [guard[0], guard[1], guard[2]];
      if (Array.isArray(pet.hold)) m.hold = sanitizeChest(pet.hold).filter((st): st is NonNullable<Stack> => !!st).slice(0, MAX_HOLD);
    }
    if (renamedFrom) {
      // An operator's old name stays locked to them, so nobody else can claim it (and its powers)
      this.safe(() => {
        this.savePlayer(p);
        if (!this.isOp(renamedFrom!)) this.storage.deletePlayer?.(renamedFrom!);
        else this.storage.savePlayer(renamedFrom!, { ...saved!, inv: { slots: [], cursor: null, selected: 0, ack: 0 }, pets: [] });
      }, `renaming ${renamedFrom}`);
      this.log(`${renamedFrom} is now called ${name}`);
      this.renameInClaims(renamedFrom, name);
    }
    this.sendWelcome(p);
    if (this.maxPlayers > 1) for (const o of this.players.values()) {
      if (o === p) continue; // everyone else hears about it
      o.conn.send({ t: 'chat', from: null, text: o === friend ? `${name} joined you from your invite link` : `${name} joined the game` });
    }
    this.log(`${name} joined (${this.players.size} online)`);
    this.sendPlayerList();
    return p;
  }

  // Where an invited newcomer starts: a free spot with ground beside their friend (not in a hole they just
  // dug, not inside a mine's walls). Two blocks away first (close enough to be together, far enough to see
  // each other), then one, then three; level with them, then up to 3 up or down (pits, slopes). Else right on their spot.
  private spotBeside(friend: Player) {
    const f = friend.body.pos;
    const free = (x: number, y: number, z: number) => !boxIntersectsSolid(this.world.get, x, y, z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)
      && isSolid(this.world.get(Math.floor(x), Math.floor(y) - 1, Math.floor(z)));
    for (const dy of [0, 1, -1, 2, -2, 3, -3]) for (const r of [2, 1, 3]) {
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const x = f.x + dx, y = Math.floor(f.y) + dy, z = f.z + dz;
        if (free(x, y, z)) return { x, y, z };
      }
    }
    return { x: f.x, y: f.y, z: f.z };
  }

  // Everything a (re)connecting client needs to start playing
  private sendWelcome(p: Player) {
    // Only the edits around the player: the rest stream in as they move (see streamEdits),
    // so joining a long-lived world doesn't mean downloading every edit ever made
    const pos = p.body.pos;
    p.conn.send({
      t: 'welcome', eid: p.eid, seed: this.world.seed, time: this.time,
      edits: this.collectEdits(p), facing: this.world.exportFacing(), carried: !!p.home, difficulty: this.difficulty,
      you: { x: pos.x, y: pos.y, z: pos.z, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, gamemode: p.gamemode, inv: this.invState(p), spawn: p.spawn },
    });
    this.sendHomes(p);
    p.conn.send({ t: 'fuel', f: p.jetFuel });
    p.conn.send({ t: 'weather', kind: this.weather });
    p.conn.send({ t: 'ride', kind: p.ride });
    p.conn.send({ t: 'achievements', ids: [...p.achievements] });
    this.sendSquad(p);
    p.maxShown = this.maxHp(p);
    p.conn.send({ t: 'maxhp', max: p.maxShown });
    p.conn.send({ t: 'health', hp: p.health });
  }

  // A player whose seat is held (or who is still connected in another tab) takes it back with the new connection
  private resume(p: Player, conn: Conn, hello: any): Player {
    if (p.awayAt < 0) p.conn.close('Connected again from somewhere else');
    p.conn = conn;
    p.awayAt = -1;
    p.look = sanitizeLook(hello.look);
    p.seen.clear(); p.editChunks.clear(); p.editCenter = ''; // the new client starts with an empty view
    p.bossHp = -1;
    if (p.dead) this.onRespawn(p);
    this.sendWelcome(p);
    this.log(`${p.name} reconnected`);
    this.sendPlayerList();
    return p;
  }

  // The connection dropped unexpectedly. In multiplayer the player stays put for SEAT_HOLD seconds (see tick), so
  // a quick reconnect carries on seamlessly; otherwise they leave now. Stale connections are ignored.
  disconnect(p: Player, conn: Conn, holdSeat = true) {
    if (p.conn !== conn || !this.players.has(p.eid)) return;
    if (this.maxPlayers <= 1 || !holdSeat) { this.leave(p); return; }
    p.conn = NO_CONN;
    p.awayAt = this.clock;
    if (p.screen) { closeScreen(p.inv, (t, n) => this.dropFrom(p, t, n)); p.screen = null; p.furnaceKey = null; p.screenAt = null; }
    this.log(`${p.name} dropped; holding their place for ${SEAT_HOLD}s`);
    this.sendPlayerList(); // others see them as reconnecting
  }

  leave(p: Player) {
    if (!this.players.has(p.eid)) return;
    if (p.downed) this.killPlayer(p, p.downCause, p.downBy); // no escaping death by logging out
    this.getOut(p); // (the boat or minecart goes back in their inventory, and is saved)
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
      case 'fire': return this.onFire(p, msg);
      case 'refuel': return this.onRefuel(p, msg);
      case 'orb': return this.onOrb(p);
      case 'orbgo': return this.onOrbGo(p, msg);
      case 'tpreply': return this.onTpReply(p, msg.from, !!msg.accept);
      case 'squad': return this.onSquad(p, msg.order, msg.eid);
      case 'fireball': return this.onFireball(p, msg);
      case 'egg': return this.onEgg(p, msg);
      case 'ride': return this.onRide(p, msg);
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
    const sinceMove = Math.min(0.25, this.clock - p.lastMove); // for burning jetpack fuel
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
    // Jetpack thrust: needs one worn and fuel, which it burns; while thrusting you aren't falling
    // Gliding on Elemental Wings: in the air, wearing them; while it lasts you aren't falling
    if (p.flags & MF_GLIDE) {
      if (p.inv.slots[56]?.type === 'elemental_wings' && !(p.flags & MF_GROUND) && dy > -(2.2 * sinceMove + 0.5)) p.fallStart = b.pos.y;
      else p.flags &= ~MF_GLIDE;
    }
    if (p.flags & MF_JET) {
      if (p.inv.slots[56]?.type === 'jetpack' && p.jetFuel > 0 && !(p.flags & MF_GROUND) && dy > -0.4) {
        p.jetFuel = Math.max(0, p.jetFuel - sinceMove / JET_SECONDS);
        p.fallStart = b.pos.y;
        this.achieve(p, 'fly');
        if (p.jetFuel === 0 || Math.floor(p.jetFuel * 20) !== Math.floor((p.jetFuel + sinceMove / JET_SECONDS) * 20)) p.conn.send({ t: 'fuel', f: p.jetFuel });
      } else p.flags &= ~MF_JET;
    }
    // "On the ground" only counts with something solid right underfoot (so fall damage can't be skipped)
    if ((p.flags & MF_GROUND) && !boxIntersectsSolid(this.world.get, b.pos.x, b.pos.y - 0.2, b.pos.z, PLAYER_HALF_WIDTH, 0.25)) p.flags &= ~MF_GROUND;
    // ...and "in water" (which also stops fall damage) only with a liquid there
    if ((p.flags & MF_WATER) && ![WATER, OIL, LAVA, POWDER_SNOW].some(id => boxTouchesBlock(this.world.get, b, id, 0.05))) p.flags &= ~MF_WATER;
    const ground = !!(p.flags & MF_GROUND), water = !!(p.flags & MF_WATER);

    // Fall damage from the movement stream
    if (!ground && !water) p.fallStart = Math.max(p.fallStart, b.pos.y);
    if (ground && !wasGround) {
      const fell = p.fallStart - b.pos.y;
      if (fell > 3.5 && !this.wearing(p, 'wind_boots')) this.damagePlayer(p, Math.floor(fell - 3), null, 'fall'); // wind boots: no fall damage
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
    // Someone else's land (and only the owner can take up a claim stone)
    if (!this.canBuild(p, x, z) || (id === CLAIM_STONE && !this.ownsClaimStone(p, `${x},${y},${z}`))) { this.rejectBlock(p, x, y, z); return; }
    // A portal's frame can't be broken from outside a claim the portal reaches into
    if (FRAME_BLOCKS.has(id) && this.portalFrom(x, y, z).some(([a, , c]) => !this.canBuild(p, a, c))) { this.rejectBlock(p, x, y, z); return; }
    const heldType = p.inv.slots[p.inv.selected]?.type || null;
    const info = miningInfo(id, heldType);
    // Mining speed check: the time since the previous break must cover this block's mining time
    // (less a margin for network jitter), so no block breaks faster than it should
    const creative = p.gamemode === 'creative';
    const needs = creative ? 0 : info.time * 0.75 - 0.1;
    // (bosses' altars and shrines, and Frost World portals, can't be broken even in creative)
    const fixed = id === BLOCK_ID.altar_core || isShrine(id) || id === ELEM_PORTAL;
    if (p.dead || id === 0 || isLiquid(id) || fixed || (info.time === Infinity && !creative) || !this.inReach(p, x, y, z, REACH) || this.clock - p.lastDig < needs) {
      this.rejectBlock(p, x, y, z);
      return;
    }
    p.lastDig = this.clock;
    p.exhaustion += 0.005;
    this.setBlock(x, y, z, 0);
    if (/wood$/.test(BLOCKS[id].name)) this.achieve(p, 'wood');
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
    if (id === CLAIM_STONE && this.claims.delete(key)) p.conn.send({ t: 'chat', from: null, text: 'Claim removed: this land is open to everyone again.' });
    // Breaking a Frost World portal's frame puts the portal out
    if (FRAME_BLOCKS.has(id)) this.extinguishPortal(x, y, z);
    // Elemental tools: blazing ones smelt what they mine; quaking ones mine the 3x3 around it
    const element = heldType ? itemDef(heldType).element : undefined;
    if (info.drops && !creative) this.dropBlock(id, cx, cy, cz, element === 'lava');
    else if (BLOCKS[id].harvestTier >= 0) {
      p.conn.send({ t: 'toast', text: 'You need a better pickaxe to get anything from this' });
    }
    if (element === 'earth' && !creative) this.quake(p, x, y, z, id, heldType!);
    // Plants lose their support
    const above = this.world.get(x, y + 1, z);
    if (isPlant(above)) {
      this.setBlock(x, y + 1, z, 0);
      this.dropBlock(above, cx, cy + 1, cz);
    }
    this.flowInto(x, y, z);
  }

  // What a broken block leaves behind
  private dropBlock(id: number, cx: number, cy: number, cz: number, smelt = false) {
    const def = BLOCKS[id];
    let drop = def.drop;
    let count = def.dropCount ? def.dropCount[0] + Math.floor(Math.random() * (def.dropCount[1] - def.dropCount[0] + 1)) : 1;
    if (id === BLOCK_ID.gravel && Math.random() < 0.1) drop = 'flint';
    if (id === BLOCK_ID.leaves) drop = Math.random() < 0.05 ? 'apple' : Math.random() < 0.05 ? 'stick' : null;
    if ((id === BLOCK_ID.tall_grass || id === BLOCK_ID.frost_fern) && Math.random() < 0.12) drop = 'seeds';
    if (id === BLOCK_ID.wheat_2) this.spawnItem('seeds', 1 + Math.floor(Math.random() * 3), cx, cy, cz);
    if (id === BLOCK_ID.wild_carrots || id === BLOCK_ID.wild_potatoes) count = 2 + Math.floor(Math.random() * 3);
    if (drop && smelt && itemDef(drop).smelt) drop = itemDef(drop).smelt!; // a blazing tool: iron ore comes out as an ingot
    if (drop && count > 0) this.spawnItem(drop, count, cx, cy, cz);
  }

  // A quaking tool: the 8 blocks around the one mined (in the plane facing you) break too, if the tool suits them
  // (only when the block mined suits the tool, and never a block slower to mine than it: the dig's time covered that much)
  private quake(p: Player, x: number, y: number, z: number, centre: number, tool: string) {
    const kind = itemDef(tool).tool?.kind;
    if (BLOCKS[centre].tool !== kind) return;
    const limit = miningInfo(centre, tool).time;
    const down = Math.abs(p.pitch) > 0.7, alongX = Math.abs(Math.sin(p.yaw)) > Math.abs(Math.cos(p.yaw));
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      if (!a && !c) continue;
      const [bx, by, bz] = down ? [x + a, y, z + c] : alongX ? [x, y + a, z + c] : [x + a, y + c, z];
      const id = this.world.get(bx, by, bz), def = BLOCKS[id];
      if (!id || isLiquid(id) || def.tool !== kind || def.hardness === Infinity || id === CHEST || id === BLOCK_ID.furnace || id === CLAIM_STONE
        || FRAME_BLOCKS.has(id) || isShrine(id) || id === ELEM_PORTAL || !this.canBuild(p, bx, bz) || !miningInfo(id, tool).drops || miningInfo(id, tool).time > limit + 1e-9) continue;
      this.setBlock(bx, by, bz, 0);
      this.dropBlock(id, bx + 0.5, by + 0.3, bz + 0.5);
      // (and whatever stood on it falls: torches, crops, rails)
      const above = this.world.get(bx, by + 1, bz);
      if (isPlant(above)) { this.setBlock(bx, by + 1, bz, 0); this.dropBlock(above, bx + 0.5, by + 1.3, bz + 0.5); }
      this.flowInto(bx, by, bz);
    }
  }

  // Neighbouring water/lava flows into a new hole and keeps falling
  private flowInto(x: number, y: number, z: number) {
    const g = this.world.get;
    const nbs = [g(x, y + 1, z), g(x + 1, y, z), g(x - 1, y, z), g(x, y, z + 1), g(x, y, z - 1)];
    const liquid = nbs.includes(LAVA) ? LAVA : nbs.includes(OIL) ? OIL : nbs.includes(WATER) ? WATER : 0;
    if (!liquid) return;
    for (let i = 0, yy = y; i < 24 && g(x, yy, z) === 0; i++, yy--) this.setBlock(x, yy, z, liquid);
  }

  private onDev(p: Player, m: { give?: string; count?: number; spawn?: string; time?: number; tp?: { x: number; y: number; z: number }; blocks?: number[];
    equip?: (string | null)[]; heal?: boolean; enraged?: boolean; dist?: number; clearMobs?: boolean; weather?: Weather; achieve?: string[]; enrageNear?: boolean }) {
    if (!this.devTools) return;
    if (Array.isArray(m.blocks)) for (let i = 0; i + 3 < m.blocks.length; i += 4) {
      const [x, y, z, id] = m.blocks.slice(i, i + 4);
      if ([x, y, z].every(isInt) && isInt(id) && BLOCKS[id]) this.setBlock(x, y, z, id);
    }
    if (m.tp && [m.tp.x, m.tp.y, m.tp.z].every(isNum)) this.teleport(p, m.tp.x, m.tp.y, m.tp.z);
    if (typeof m.give === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, m.give)) { p.cheated = true; addItem(p.inv, m.give, isInt(m.count) ? Math.min(64, Math.max(1, m.count)) : 1); this.sendInv(p); }
    if (typeof m.spawn === 'string' && (MOB_KINDS as string[]).includes(m.spawn)) {
      const d = isNum(m.dist) ? Math.max(2, Math.min(20, m.dist)) : 4;
      const a = p.yaw, x = p.body.pos.x - Math.sin(a) * d, z = p.body.pos.z - Math.cos(a) * d;
      const mob = this.spawnMob(m.spawn as MobKind, x, this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1, z);
      if (m.enraged) mob.health = MOB_SPECS[mob.kind].health * 0.45; // a boss straight into phase two
    }
    // A boss already up (one that rose at its temple): straight into phase two
    if (m.enrageNear) for (const b of this.mobs.values()) if (BOSS_NAMES[b.kind] && b.dying < 0 && Math.hypot(b.body.pos.x - p.body.pos.x, b.body.pos.z - p.body.pos.z) < 64) b.health = Math.min(b.health, MOB_SPECS[b.kind].health * 0.45);
    // Wear armour (slots: helmet, chestplate, leggings, boots), and full health
    if (Array.isArray(m.equip)) {
      p.cheated = true;
      m.equip.slice(0, 4).forEach((t, i) => { p.inv.slots[55 + i] = typeof t === 'string' && ITEMS[t]?.armor?.slot === i ? { type: t, count: 1 } : null; });
      this.sendInv(p); this.broadcastEquip(p);
    }
    if (m.clearMobs) for (const mob of [...this.mobs.values()]) if (!mob.owner) this.mobs.delete(mob.eid);
    if (m.weather === 'clear' || m.weather === 'rain' || m.weather === 'thunder') { this.weather = m.weather; this.weatherT = 600; this.boltT = 1; this.broadcast({ t: 'weather', kind: this.weather }); }
    if (Array.isArray(m.achieve)) for (const a of m.achieve) if (typeof a === 'string') this.achieve(p, a);
    if (m.heal && !p.dead) { p.health = this.maxHp(p); p.downed = false; p.conn.send({ t: 'health', hp: p.health }); }
    if (isNum(m.time)) { this.time = ((m.time % 1) + 1) % 1; this.broadcast({ t: 'time', time: this.time }); }
  }

  // A spawn egg: the creature appears in the block it was used on (used up, except in creative)
  private onEgg(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    const held = p.inv.slots[p.inv.selected];
    const kind = held ? itemDef(held.type).egg : undefined;
    if (p.dead || p.downed || !kind || ![x, y, z].every(isInt) || !this.inReach(p, x, y, z, REACH + 0.5) || isSolid(this.world.get(x, y, z)) || !this.canBuild(p, x, z)) return;
    const mob = this.spawnMob(kind as MobKind, x + 0.5, y, z + 0.5);
    if (kind === 'hurricane') mob.life = 12;
    if (p.gamemode !== 'creative') { removeFromSlot(p.inv, p.inv.selected, 1); this.sendInv(p); this.broadcastEquip(p); }
    p.swingUntil = this.clock + 0.25;
  }

  private onTill(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (![x, y, z].every(isInt)) return;
    if (!this.inReach(p, x, y, z, REACH)) { this.rejectBlock(p, x, y, z); return; }
    const held = p.inv.slots[p.inv.selected];
    const id = this.world.get(x, y, z);
    const above = this.world.get(x, y + 1, z);
    if (p.dead || !held || !this.canBuild(p, x, z) || itemDef(held.type).tool?.kind !== 'hoe' || (id !== BLOCK_ID.grass && id !== BLOCK_ID.dirt) || (above !== 0 && !isReplaceable(above))) {
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
    if (isElemental(x)) {
      const s = nearestShrine(x, z, this.world.seed);
      if (s && Math.hypot(s.x - x, s.z - z) < 20) return `temple_${s.biome}`;
      if (biome === 'frost') return 'frost_ruin';
    }
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
      (existing === 0 || isLiquid(existing) || isReplaceable(existing)) &&
      !this.entityInBlock(x, y, z) && this.hasSupport(x, y, z) &&
      (!BLOCKS[def.block].plant || plantCanStand(def.block, this.world.get(x, y - 1, z)));
    if (!ok || !this.canBuild(p, x, z) || (def!.block === CLAIM_STONE && !this.canClaim(p, x, z))) { this.rejectBlock(p, x, y, z); this.sendInv(p); return; }
    this.setBlock(x, y, z, def!.block!, isInt(m.facing) ? m.facing & 3 : 0);
    if (CROP_NEXT[def!.block!] !== undefined) this.plantCrop(x, y, z);
    if (def!.block === CHEST) this.chests.set(`${x},${y},${z}`, newChest());
    if (isBanner(def!.block!)) this.achieve(p, 'banner');
    if (def!.block === CLAIM_STONE) this.addClaim(p, x, y, z);
    if (def!.block === BLOCK_ID.robot_eye || FRAME_BLOCKS.has(def!.block!)) this.tryLightPortal(p, x, y, z, def!.block!);
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
    if (id === BLOCK_ID.gold_block || id === BLOCK_ID.portal_core) { if (isPortal(this.world.get, x, y, z) && !isElemental(x)) this.travel(p, x, z); return; }
    if (id === BLOCK_ID.elemental_altar) { this.summonCore(p, x, y, z); return; }
    if ((id === BLOCK_ID.furnace || id === CHEST) && !this.canBuild(p, x, z)) { p.conn.send({ t: 'screen', mode: null }); return; }
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
      if (p.health >= this.maxHp(p)) return;
      p.health = Math.min(this.maxHp(p), p.health + food);
      p.conn.send({ t: 'toast', text: `Ate ${def!.name} (+${food / 2} ♥)` });
    } else {
      if (p.food >= MAX_FOOD && !golden) return;
      p.food = Math.min(MAX_FOOD, p.food + food);
      p.sat = Math.min(p.food, p.sat + food * 0.6);
      if (golden) p.health = Math.min(this.maxHp(p), p.health + 4);
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
    let dmg = (held ? itemDef(held.type).damage || 1 : 1) + attackBonus(p.inv);
    // Critical hit: while falling after a jump (in the air, below the top of the jump, not swimming)
    const crit = !(p.flags & MF_GROUND) && !(p.flags & MF_WATER) && p.fallStart - p.body.pos.y > 0.15;
    if (crit) { dmg = Math.round(dmg * 1.5); p.conn.send({ t: 'crit' }); this.achieve(p, 'crit'); }
    const chill = !!(held && itemDef(held.type).chill); // glacite: the hit slows them
    const poison = !!(held && itemDef(held.type).poison); // the poison sword
    const element = held ? itemDef(held.type).element : undefined; // elemental tools
    const kb = (this.wearing(p, 'earth_leggings') ? 2.2 : 1) * (element === 'earth' ? 3 : 1); // earth: your hits knock harder
    const before = target.health;
    if (target.kind === 'player') {
      if (this.sameTeam(p.name, target.name)) return; // teammates can't hurt each other
      this.damagePlayer(target, dmg, p.body.pos, 'player', p.name, 7 * kb, element === 'wind' ? 12 : undefined);
      if (chill) this.slowPlayer(target, 2);
      if (poison) this.poisonPlayer(target, 5);
      if (element === 'lava') this.burnPlayer(target, 4);
    } else if (!target.owner) {
      if (crit) target.hurt = 0;
      this.damageMob(target, dmg, p.body.pos, kb);
      if (chill) target.slowT = 3;
      if (poison) target.poisonT = 5;
      if (element === 'lava') target.fireT = 4;
      if (element === 'wind' && target.health < before) target.body.vel.y = BOSS_NAMES[target.kind] ? 3 : 12; // thrown into the air (bosses barely)
      if (target.dying >= 0 && MOB_SPECS[target.kind].hostile) this.achieve(p, 'monster');
    }
    // Tidal weapons: each hit that lands heals you a little
    if (element === 'water' && target.health < before && p.health < this.maxHp(p)) { p.health = Math.min(this.maxHp(p), p.health + 1); p.conn.send({ t: 'health', hp: p.health }); }
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
      p.conn.send({ t: 'chat', from: null, text: `Commands: /players, /spawn, /kill, /sethome <1-4>, /tphome <1-4>, /robots [order], /trust <player>, /untrust <player>, /claims, /tpaccept, /tpdeny, /team <colour|leave|list>${op ? ', /give <item> [amount] [player], /gamemode creative <code> [player], /gamemode survival [player]' : ''}` });
      return;
    }
    if (text.startsWith('/give ') || text === '/give' || text.startsWith('/gamemode') || text.startsWith('/gm ')) { this.opCommand(p, text); return; }
    const say = (t: string) => p.conn.send({ t: 'chat', from: null, text: t });
    const team = /^\/team(?:\s+(\S+))?(?:\s+(\S+))?$/i.exec(text);
    if (team) { this.onTeam(p, (team[1] || '').toLowerCase(), team[2] || ''); return; }
    const cmd = /^\/(trust|untrust|claims|tpaccept|tpdeny|robots)(?:\s+(\S+))?$/i.exec(text);
    if (cmd) {
      const verb = cmd[1].toLowerCase(), arg = cmd[2] || '';
      if (verb === 'claims') { this.listClaims(p); return; }
      if (verb === 'trust' || verb === 'untrust') {
        if (!arg) { say(`Usage: /${verb} <player>`); return; }
        const who = sanitizeName(arg), key = p.name.toLowerCase();
        const set = this.trust.get(key) ?? new Set<string>();
        if (verb === 'trust') set.add(who.toLowerCase()); else set.delete(who.toLowerCase());
        this.trust.set(key, set);
        this.dirty = true;
        say(verb === 'trust' ? `${who} can now build on your land.` : `${who} can no longer build on your land.`);
        return;
      }
      if (verb === 'tpaccept' || verb === 'tpdeny') {
        // No name: the latest request
        let from = arg;
        if (!from) { let best = -1; for (const [n, exp] of p.tpAsks) if (exp > best) { best = exp; from = n; } }
        if (!from) { say('Nobody has asked to teleport to you.'); return; }
        this.onTpReply(p, from, verb === 'tpaccept');
        return;
      }
      // /robots [follow|guard|collect]
      if (!arg) { const n = this.pets(p).length; say(n ? `You have ${n} robot${n > 1 ? 's' : ''}. Orders: /robots follow, /robots guard (stay here), /robots collect (fetch dropped items). Or press G.` : 'You have no robots. Tame one with a tungsten ingot in the Robotic World.'); return; }
      if (!SQUAD_ORDERS.includes(arg.toLowerCase() as SquadOrder)) { say('Orders: follow, guard, collect'); return; }
      this.onSquad(p, arg.toLowerCase());
      return;
    }
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
    // Creative also needs the owner's code (dev builds and test servers don't, but accept it the same way)
    let who = args[2];
    if (mode === 'creative') {
      const coded = creativeCodeHash(args[2] || '') === this.creativeCode;
      if (!coded && !this.devTools) { say('Creative mode needs the code: /gamemode creative <code>'); return; }
      if (coded) who = args[3];
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
      p.health = this.maxHp(p); p.food = MAX_FOOD; p.sat = 5;
      p.conn.send({ t: 'health', hp: p.health });
      this.sendFood(p);
    }
    p.conn.send({ t: 'gamemode', mode });
    p.conn.send({ t: 'chat', from: null, text: `You are now in ${mode} mode` });
  }

  private onRespawn(p: Player) {
    if (!p.dead) return;
    p.dead = false;
    p.health = this.maxHp(p);
    p.poisonT = p.fireT = 0; p.air = AIR_SECONDS;
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
        untouched = this.untouched(p, x + i, y + j, z + k);
      }
      if (!untouched) continue;
      for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) for (let j = 1; j <= 3; j++) this.setBlock(x + i, y + j, z + k, 0);
      this.setBlock(x, y, z, BLOCK_ID.portal_core);
      for (const [i, k] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.setBlock(x + i, y, z + k, BLOCK_ID.portal_frame);
      core = [x, y, z];
    }
    if (isRobotic(tx)) this.achieve(p, 'robotic');
    if (core) this.teleport(p, core[0] + 0.5, core[1] + 1, core[2] + 1.5); // standing on the frame beside the core
    else this.teleport(p, tx + 0.5, this.world.surfaceHeight(tx, tz) + 1, tz + 0.5); // all built up: just arrive
    const cx = core ? core[0] : tx;
    this.bringFollowers(p);
    const there = isRobotic(cx) ? 'the Robotic World' : 'the Overworld';
    p.conn.send({ t: 'chat', from: null, text: `You travelled to ${there}.` });
    this.log(`${p.name} travelled to ${there}`);
  }

  private playerByName(name: string) { for (const p of this.players.values()) if (p.name === name) return p; return null; }

  // Robots that aren't guarding somewhere come along (through portals, orbs)
  private bringFollowers(p: Player) {
    for (const m of this.mobs.values()) if (m.owner === p.name && m.order !== 'guard') this.bringPet(m, p);
  }

  // ---------------------------------------------------------------- The Frost World (a secret)

  // A robot eye (or a frame block) just placed may finish a portal: the eyes turn into the portal
  private tryLightPortal(p: Player, x: number, y: number, z: number, placed: number) {
    const eye = BLOCK_ID.robot_eye, g = this.world.get;
    const tries: [number, number, number][] = [];
    if (placed === eye) tries.push([x, y, z]);
    else for (let a = -2; a <= 2; a++) for (let b = -4; b <= 4; b++) for (let c = -2; c <= 2; c++) if (g(x + a, y + b, z + c) === eye) tries.push([x + a, y + b, z + c]); // (a corner touches no eye)
    for (const [a, b, c] of tries) {
      const portal = findElementalPortal(g, a, b, c, eye);
      if (!portal) continue;
      // Only from the Overworld's middle (where it maps onto the Frost World) or the Frost World itself
      const span = ELEM_MAX_X - ELEM_MIN_X;
      if (isRobotic(portal.x) || (!isElemental(portal.x) && Math.abs(portal.x) > span / 2 - 64)) {
        p.conn.send({ t: 'chat', from: null, text: 'The robot eyes flicker... but stay dark. The elements can\'t reach this far.' });
        return;
      }
      for (const [i, j, k] of portalCells(portal)) this.setBlock(i, j, k, ELEM_PORTAL);
      p.conn.send({ t: 'chat', from: null, text: 'The robot eyes flicker... and swirl with the light of the elements.' });
      this.log(`${p.name} lit an Elemental World portal at ${portal.x},${portal.y},${portal.z}`);
      return;
    }
  }

  // The portal blocks touching this spot (and the rest of that portal)
  private portalFrom(x: number, y: number, z: number): [number, number, number][] {
    const out: [number, number, number][] = [], seen = new Set<string>();
    const todo: [number, number, number][] = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
    while (todo.length && out.length < 40) {
      const [a, b, c] = todo.pop()!;
      const k = `${a},${b},${c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.world.get(a, b, c) !== ELEM_PORTAL) continue;
      out.push([a, b, c]);
      todo.push([a + 1, b, c], [a - 1, b, c], [a, b + 1, c], [a, b - 1, c], [a, b, c + 1], [a, b, c - 1]);
    }
    return out;
  }
  private extinguishPortal(x: number, y: number, z: number) {
    for (const [a, b, c] of this.portalFrom(x, y, z)) this.setBlock(a, b, c, 0);
  }

  // Ground a return portal may be built on: never edited, not a loot chest or a boss's altar, not someone else's land
  private untouched(p: Player, x: number, y: number, z: number): boolean {
    const id = this.world.get(x, y, z);
    if (id === CHEST || id === BLOCK_ID.altar_core || isShrine(id) || !this.world.isGenerated(x, y, z, id)) return false;
    if (this.maxPlayers <= 1) return true;
    const c = this.claimAt(x, z);
    return !c || this.trusts(c.owner, p.name);
  }

  // A player renamed: their claims and the friends they trust go with them (the old name could be taken by anyone)
  private renameInClaims(from: string, to: string) {
    const old = from.toLowerCase();
    for (const [k, owner] of this.claims) if (owner.toLowerCase() === old) this.claims.set(k, to);
    const trusted = this.trust.get(old);
    if (trusted) { this.trust.delete(old); this.trust.set(to.toLowerCase(), trusted); }
    for (const set of this.trust.values()) if (set.delete(old)) set.add(to.toLowerCase());
    this.dirty = true;
  }

  // Stepping into a portal: to the matching spot in the other world, in front of a portal there (built if missing)
  private elementalTravel(p: Player) {
    if (p.dead || p.downed || this.clock < p.portalCd) return;
    p.portalCd = this.clock + 3;
    const g = this.world.get;
    const { x: tx, z: tz } = elementalDestination(p.body.pos.x, p.body.pos.z);
    let at: { x: number; y: number; z: number; alongX: boolean } | null = null;
    for (let r = 0; r <= 10 && !at; r++) for (let dx = -r; dx <= r && !at; dx++) for (let dz = -r; dz <= r && !at; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = tx + dx, z = tz + dz, top = this.world.surfaceHeight(x, z);
      for (let y = top; y >= top - 8 && !at; y--) {
        if (g(x, y, z) !== ELEM_PORTAL) continue;
        let by = y; while (g(x, by - 1, z) === ELEM_PORTAL) by--;
        at = { x, y: by, z, alongX: g(x + 1, y, z) === ELEM_PORTAL || g(x - 1, y, z) === ELEM_PORTAL };
      }
    }
    // None there: build a return portal (its frame drops nothing), but only on untouched ground
    for (let r = 0; r <= 10 && !at; r++) for (let dx = -r; dx <= r && !at; dx++) for (let dz = -r; dz <= r && !at; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = tx + dx, z = tz + dz, y = Math.min(MAX_Y - 6, this.world.surfaceHeight(x, z));
      let untouched = true;
      for (let i = -1; i <= 2 && untouched; i++) for (let k = -1; k <= 1 && untouched; k++) for (let j = 0; j <= 4 && untouched; j++) {
        untouched = this.untouched(p, x + i, y + j, z + k);
      }
      if (!untouched) continue;
      for (let i = -1; i <= 2; i++) for (let j = 0; j <= 4; j++) {
        const hole = i >= 0 && i <= 1 && j >= 1 && j <= 3;
        this.setBlock(x + i, y + j, z, hole ? ELEM_PORTAL : BLOCK_ID.elemental_frame);
        if (j >= 1 && j <= 3) for (const k of [-1, 1]) this.setBlock(x + i, y + j, z + k, 0); // room in front and behind
      }
      at = { x, y: y + 1, z, alongX: true };
    }
    if (isElemental(tx)) this.achieve(p, 'frost');
    if (at) {
      // Step out in front of it (not inside, or we'd go straight back)
      const front = at.alongX ? [{ x: at.x + 1, z: at.z + 1.5 }, { x: at.x + 1, z: at.z - 0.5 }] : [{ x: at.x + 1.5, z: at.z + 1 }, { x: at.x - 0.5, z: at.z + 1 }];
      const spot = front.find(s => !boxIntersectsSolid(g, s.x, at!.y, s.z, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) ?? front[0];
      this.teleport(p, spot.x, at.y, spot.z);
    } else this.teleport(p, tx + 0.5, this.world.surfaceHeight(tx, tz) + 1, tz + 0.5);
    p.inElemPortal = false;
    this.bringFollowers(p);
    const there = isElemental(tx) ? `the Elemental World (${BIOME_NAMES[elementalBiome(tx, tz, this.world.seed)]})` : 'the Overworld';
    p.conn.send({ t: 'chat', from: null, text: `You travelled to ${there}.` });
    this.log(`${p.name} travelled to ${there}`);
  }

  // Frost slows a player (unless they hold a Frost Heart)
  private slowPlayer(p: Player, seconds: number) {
    if (this.holding(p, 'frost_heart') || p.gamemode === 'creative') return;
    p.slowT = Math.max(p.slowT, seconds);
    p.conn.send({ t: 'slow', seconds: p.slowT });
  }

  // ---------------------------------------------------------------- Teams (/team <colour>)

  private sameTeam(a: string, b: string) {
    const ta = this.teams.get(a.toLowerCase());
    return !!ta && ta === this.teams.get(b.toLowerCase());
  }

  // Join the team of a dye colour (your name tag shows it), leave it, or list the teams
  // A new colour is free to take; joining a team that has members needs an invite from one of them
  // (teammates share their land, so nobody can walk into a team uninvited)
  private onTeam(p: Player, arg: string, who = '') {
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    const key = p.name.toLowerCase();
    if (arg === 'invite') {
      const mine = this.teams.get(key);
      if (!mine) { say('Join or start a team first: /team <colour>'); return; }
      if (!who) { say('Usage: /team invite <player>'); return; }
      const name = sanitizeName(who).toLowerCase();
      const set = this.teamInvites.get(name) ?? new Map<string, number>();
      set.set(mine, this.clock + 300); // (good for 5 minutes)
      this.teamInvites.set(name, set);
      say(`Invited ${who} to the ${mine} team.`);
      const t = [...this.players.values()].find(o => o.name.toLowerCase() === name);
      t?.conn.send({ t: 'chat', from: null, text: `${p.name} invited you to the ${mine} team. Join with /team ${mine}` });
      return;
    }
    if ((COLORS as readonly string[]).includes(arg) && this.teams.get(key) !== arg) {
      const taken = [...this.teams.values()].includes(arg);
      if (taken && !((this.teamInvites.get(key)?.get(arg) ?? 0) > this.clock)) { say(`The ${arg} team is invite-only. Ask one of its members for /team invite ${p.name}`); return; }
      this.teamInvites.get(key)?.delete(arg);
    }
    if (arg === 'list' || !arg) {
      const by = new Map<string, string[]>();
      for (const [n, c] of this.teams) { const names = by.get(c) ?? []; names.push(n); by.set(c, names); }
      say(by.size ? [...by].map(([c, ns]) => `${c}: ${ns.join(', ')}`).join(' | ') + '. Start a new one: /team <colour>; invite friends: /team invite <name>' : `No teams yet. Start one: /team <colour> (${COLORS.join(', ')}).`);
      return;
    }
    if (arg === 'leave') { this.teams.delete(key); say('You left your team.'); }
    else if ((COLORS as readonly string[]).includes(arg)) { this.teams.set(key, arg); say(`You joined the ${arg} team. Teammates can build on each other's land and can't hurt each other.`); }
    else { say(`Teams are dye colours: ${COLORS.join(', ')}. /team leave to leave.`); return; }
    this.dirty = true;
    this.broadcastEquip(p);
    this.sendPlayerList();
  }

  // ---------------------------------------------------------------- Weather

  // Clear for a while, then rain (sometimes a thunderstorm), then clear again. Lightning strikes near players in a storm.
  private updateWeather(dt: number) {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.weather = this.weather === 'clear' ? (Math.random() < 0.3 ? 'thunder' : 'rain') : 'clear';
      this.weatherT = this.weather === 'clear' ? 400 + Math.random() * 800 : 120 + Math.random() * 240;
      this.broadcast({ t: 'weather', kind: this.weather });
      this.dirty = true;
    }
    if (this.weather !== 'thunder') return;
    this.boltT -= dt;
    if (this.boltT > 0) return;
    this.boltT = 5 + Math.random() * 10;
    const out = [...this.players.values()].filter(p => !p.dead && !isRobotic(p.body.pos.x) && !isElemental(p.body.pos.x));
    if (!out.length) return;
    const p = out[Math.floor(Math.random() * out.length)];
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 20;
    const x = Math.floor(p.body.pos.x + Math.cos(a) * r), z = Math.floor(p.body.pos.z + Math.sin(a) * r);
    if (!this.world.isLoaded(x, z)) { this.boltT = 1; return; } // (try again in a moment)
    this.strike(x + 0.5, this.world.surfaceHeight(x, z) + 1, z + 0.5);
  }

  // A lightning bolt: hurts and burns anything right there (out in the open)
  private strike(x: number, y: number, z: number) {
    for (const o of this.players.values()) if (Math.abs(o.body.pos.x - x) < VIEW_DIST * 2 && Math.abs(o.body.pos.z - z) < VIEW_DIST * 2) o.conn.send({ t: 'lightning', x, y, z });
    for (const p of this.players.values()) {
      if (p.dead || p.downed || Math.hypot(p.body.pos.x - x, p.body.pos.z - z) > 2.5 || Math.abs(p.body.pos.y - y) > 3) continue;
      if (this.world.surfaceHeight(Math.floor(p.body.pos.x), Math.floor(p.body.pos.z)) >= p.body.pos.y) continue; // under a roof
      p.invuln = 0;
      this.damagePlayer(p, 5, { x, y, z }, 'lightning');
      this.burnPlayer(p, 3);
    }
    for (const m of this.mobs.values()) if (m.dying < 0 && !m.owner && !BOSS_NAMES[m.kind] && m.kind !== 'hurricane' && Math.hypot(m.body.pos.x - x, m.body.pos.z - z) <= 2.5 && Math.abs(m.body.pos.y - y) <= 3 && this.world.surfaceHeight(Math.floor(m.body.pos.x), Math.floor(m.body.pos.z)) < m.body.pos.y) { m.hurt = 0; this.damageMob(m, 5, { x, y, z }, 0); m.fireT = 3; }
  }

  // Rain puts out a burning player who's out under the sky (not in deserts, other worlds or in the dry)
  private rainedOn(p: Player) {
    if (this.weather === 'clear' || isRobotic(p.body.pos.x) || isElemental(p.body.pos.x)) return false;
    const x = Math.floor(p.body.pos.x), z = Math.floor(p.body.pos.z);
    return columnInfo(x, z, this.world.seed).biome !== 'desert' && this.world.surfaceHeight(x, z) < p.body.pos.y + 1.8;
  }

  // ---------------------------------------------------------------- Riding (boats, minecarts)

  // Get into a boat on water, or a minecart on a rail (the item is used up while you ride); or get out (it comes back)
  private onRide(p: Player, m: { kind?: unknown; x?: unknown; y?: unknown; z?: unknown }) {
    if (m.kind === null || m.kind === undefined) { this.getOut(p); return; }
    if (p.dead || p.downed || p.ride || (m.kind !== 'boat' && m.kind !== 'cart')) return;
    const { x, y, z } = m as { x: number; y: number; z: number };
    if (![x, y, z].every(isInt) || !this.inReach(p, x, y, z, REACH + 1)) return;
    const item = m.kind === 'boat' ? 'boat' : 'minecart';
    const where = this.world.get(x, y, z);
    if (m.kind === 'boat' ? where !== WATER : where !== BLOCK_ID.rail) return;
    const i = p.inv.slots.findIndex((s, k) => k < 45 && s?.type === item); // (the inventory and hotbar: not the crafting grid's preview)
    if (i < 0) return;
    removeFromSlot(p.inv, i, 1);
    p.ride = m.kind;
    if (m.kind === 'boat') this.teleport(p, x + 0.5, y + 0.85, z + 0.5); // out onto the water it was used on
    this.sendInv(p);
    p.conn.send({ t: 'ride', kind: p.ride });
    this.broadcastEquip(p);
  }

  private getOut(p: Player) {
    if (!p.ride) return;
    const item = p.ride === 'boat' ? 'boat' : 'minecart';
    p.ride = null;
    const left = addItem(p.inv, item, 1);
    if (left > 0) this.spawnItem(item, left, p.body.pos.x, p.body.pos.y + 0.5, p.body.pos.z);
    if (this.players.has(p.eid)) { this.sendInv(p); p.conn.send({ t: 'ride', kind: null }); this.broadcastEquip(p); }
  }

  // ---------------------------------------------------------------- The Elemental Core (the final boss)

  // Using an Elemental Altar (in the Elemental World, having beaten all four elemental bosses) summons the Core above it
  private summonCore(p: Player, x: number, y: number, z: number) {
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    if (!isElemental(x)) { say('The altar stays dark. It only answers in the Elemental World.'); return; }
    if (!['wraith', 'colossus', 'thorn', 'roc'].every(a => p.achievements.has(a))) { say('The altar stays silent. Defeat the four elemental bosses first.'); return; }
    // One Core at a time in the whole world, and 5 minutes' rest after each (wherever the altar is moved to)
    const key = 'core';
    if ([...this.mobs.values()].some(m => m.kind === 'elemental_core')) { say('The Elemental Core is already awake somewhere.'); return; }
    const wait = (this.titanWakes.get(key) ?? 0) - this.clock;
    if (wait > 0) { say(`The altar is still recovering. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`); return; }
    const m = this.spawnMob('elemental_core', x + 0.5, y + 4, z + 0.5);
    m.altar = key; m.attackCd = 3; m.elem = 0; m.elemT = 12;
    this.fx('enrage', x + 0.5, y + 4, z + 0.5, 4);
    this.tellNear(x, z, 128, 'The Elemental Core awakens!');
    this.log(`${p.name} summoned the Elemental Core at ${x},${y},${z}`);
  }

  // Every 12 seconds (8 when enraged) it turns to the next element, and fights as that element's boss
  private updateCore(m: Mob, target: Player | null, dist: number, dt: number) {
    m.elemT = (m.elemT ?? 12) - dt;
    if (m.elemT <= 0) {
      m.elem = ((m.elem ?? 0) + 1) % 4;
      m.elemT = m.phase2 ? 8 : 12;
      m.stompT = undefined; m.burst = 0; // (magma balls it holds are still thrown, whatever the element)
      this.tellNear(m.body.pos.x, m.body.pos.z, 64, `The Elemental Core turns to ${CORE_ELEMENT_NAMES[m.elem]}!`);
      this.fx('charge', m.body.pos.x, m.body.pos.y, m.body.pos.z, 4);
    }
    this.updateElementalBoss(m, target, dist, dt, CORE_ELEMENTS[m.elem ?? 0]);
  }

  // ---------------------------------------------------------------- Claims (claim stones)

  private claimAt(x: number, z: number): { key: string; owner: string } | null {
    for (const [key, owner] of this.claims) {
      const c = key.split(',');
      if (Math.abs(x - Number(c[0])) <= CLAIM_R && Math.abs(z - Number(c[2])) <= CLAIM_R) return { key, owner };
    }
    return null;
  }
  private trusts(owner: string, name: string) {
    return owner.toLowerCase() === name.toLowerCase() || !!this.trust.get(owner.toLowerCase())?.has(name.toLowerCase()) || this.sameTeam(owner, name);
  }
  // May this player change blocks here (or open chests and furnaces)? Claims only matter with other players around.
  private canBuild(p: Player, x: number, z: number): boolean {
    if (this.maxPlayers <= 1) return true;
    const c = this.claimAt(x, z);
    if (!c || this.trusts(c.owner, p.name) || this.isOp(p.name)) return true;
    if (this.clock - p.blockedToastAt > 2) { p.blockedToastAt = this.clock; p.conn.send({ t: 'toast', text: `This land belongs to ${c.owner}` }); }
    return false;
  }
  private ownsClaimStone(p: Player, key: string) {
    const owner = this.claims.get(key);
    return this.maxPlayers <= 1 || !owner || owner.toLowerCase() === p.name.toLowerCase() || this.isOp(p.name);
  }
  // A new claim may not cover the world spawn or overlap someone else's, and each player has a few
  private canClaim(p: Player, x: number, z: number): boolean {
    if (this.maxPlayers <= 1) return true;
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    const [sx, , sz] = this.spawnPoint;
    if (Math.abs(x - sx) <= CLAIM_R + SPAWN_FREE && Math.abs(z - sz) <= CLAIM_R + SPAWN_FREE) { say('Too close to the world spawn to claim. Go a bit further out.'); return false; }
    let mine = 0;
    for (const [key, owner] of this.claims) {
      if (owner.toLowerCase() === p.name.toLowerCase()) { mine++; continue; }
      const c = key.split(',');
      if (Math.abs(x - Number(c[0])) <= 2 * CLAIM_R && Math.abs(z - Number(c[2])) <= 2 * CLAIM_R) { say(`Too close to ${owner}'s land to claim here.`); return false; }
    }
    if (mine >= MAX_CLAIMS) { say(`You already have ${MAX_CLAIMS} claims. Break one of your claim stones to move it.`); return false; }
    return true;
  }
  private addClaim(p: Player, x: number, y: number, z: number) {
    this.claims.set(`${x},${y},${z}`, p.name);
    this.achieve(p, 'claim');
    if (this.maxPlayers > 1) p.conn.send({ t: 'chat', from: null, text: `Claimed! Only you can build within ${CLAIM_R} blocks of this stone. /trust <name> lets a friend build too.` });
  }
  private listClaims(p: Player) {
    const mine = [...this.claims].filter(([, o]) => o.toLowerCase() === p.name.toLowerCase()).map(([k]) => { const c = k.split(','); return `(${c[0]}, ${c[2]})`; });
    const trusted = [...(this.trust.get(p.name.toLowerCase()) ?? [])];
    p.conn.send({ t: 'chat', from: null, text: mine.length ? `Your claims: ${mine.join(', ')}. Trusted: ${trusted.length ? trusted.join(', ') : 'nobody'} (/trust <name>).` : 'You have no claims. Craft a claim stone (stone bricks around an iron ingot) and place it.' });
  }
  // "Entering Tim's land" as you walk in and out of claims
  private announceClaims() {
    if (this.maxPlayers <= 1 || !this.claims.size) return;
    for (const p of this.players.values()) {
      const owner = this.claimAt(p.body.pos.x, p.body.pos.z)?.owner ?? '';
      if (owner === p.claimShown) continue;
      const mine = (o: string) => o.toLowerCase() === p.name.toLowerCase();
      if (owner) p.conn.send({ t: 'toast', text: mine(owner) ? 'Entering your land' : `Entering ${owner}'s land` });
      else p.conn.send({ t: 'toast', text: mine(p.claimShown) ? 'Leaving your land' : `Leaving ${p.claimShown}'s land` });
      p.claimShown = owner;
    }
  }

  // ---------------------------------------------------------------- Moonstone orbs (teleport)

  private onOrb(p: Player) {
    if (p.dead || p.downed || p.inv.slots[p.inv.selected]?.type !== 'moonstone_orb') return;
    const players = [...this.players.values()].filter(o => o !== p && o.awayAt < 0 && !o.dead).map(o => o.name);
    const homes: { i: number; name: string }[] = [];
    p.homes.forEach((h, i) => { if (h) homes.push({ i, name: h.name }); });
    p.conn.send({ t: 'orbmenu', players, homes, death: !!p.lastDeath });
  }

  // Uses up an orb from anywhere in the inventory (the player may have switched slots since asking)
  private takeOrb(p: Player): boolean {
    if (p.gamemode === 'creative') return true;
    const i = p.inv.slots.findIndex(s => s?.type === 'moonstone_orb');
    if (i < 0) return false;
    removeFromSlot(p.inv, i, 1);
    this.sendInv(p);
    this.broadcastEquip(p);
    return true;
  }

  private onOrbGo(p: Player, m: { to?: unknown; i?: unknown; name?: unknown }) {
    if (p.dead || p.downed || this.clock < p.portalCd) return;
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    if (m.to === 'player') {
      const name = typeof m.name === 'string' ? m.name.toLowerCase() : '';
      const t = [...this.players.values()].find(o => o.name.toLowerCase() === name && o !== p && o.awayAt < 0 && !o.dead);
      if (!t) { say("They aren't online any more."); return; }
      if (p.gamemode !== 'creative' && !p.inv.slots.some(s => s?.type === 'moonstone_orb')) return;
      // One request at a time to each player, and not too often (they'd be spammed)
      if ((t.tpAsks.get(p.name) ?? 0) > this.clock) { say(`You already asked ${t.name}. Wait for their answer.`); return; }
      if (p.chatCredit < 1) { say('You are asking too fast.'); return; }
      p.chatCredit--;
      t.tpAsks.set(p.name, this.clock + TP_ASK_SECONDS);
      t.conn.send({ t: 'tpask', from: p.name });
      t.conn.send({ t: 'chat', from: null, text: `${p.name} wants to teleport to you. Accept with Y (or /tpaccept), refuse with N (or /tpdeny).` });
      say(`Asked ${t.name} if you can teleport to them...`);
      return;
    }
    let dest: [number, number, number] | null = null;
    if (m.to === 'home' && isInt(m.i)) { const h = p.homes[m.i as number]; if (h) dest = [h.x, h.y, h.z]; }
    else if (m.to === 'death') dest = p.lastDeath;
    if (!dest || !this.takeOrb(p)) return;
    this.orbTeleport(p, dest[0], dest[1], dest[2]);
  }

  private orbTeleport(p: Player, x: number, y: number, z: number) {
    p.portalCd = this.clock + 2;
    this.teleport(p, x, y, z);
    this.bringFollowers(p);
    this.achieve(p, 'orb');
    p.conn.send({ t: 'toast', text: 'Whoosh!' });
  }

  private onTpReply(p: Player, from: unknown, accept: boolean) {
    const name = typeof from === 'string' ? from.toLowerCase() : '';
    const key = [...p.tpAsks.keys()].find(k => k.toLowerCase() === name);
    const say = (text: string) => p.conn.send({ t: 'chat', from: null, text });
    if (!key) return;
    const expires = p.tpAsks.get(key)!;
    p.tpAsks.delete(key);
    if (expires < this.clock) { say(`${key}'s request ran out.`); return; }
    const r = [...this.players.values()].find(o => o.name === key && o.awayAt < 0);
    if (!r || r.dead || r.downed) return;
    const tell = (text: string) => r.conn.send({ t: 'chat', from: null, text });
    if (!accept) { tell(`${p.name} said no.`); say(`You said no to ${r.name}.`); return; }
    if (!this.takeOrb(r)) { tell('You need a moonstone orb to teleport.'); return; }
    const spot = this.spotBeside(p);
    this.orbTeleport(r, spot.x, spot.y, spot.z);
    say(`${r.name} teleported to you.`);
  }

  // ---------------------------------------------------------------- Robot squads

  private onSquad(p: Player, order: unknown, eid?: unknown) {
    if (p.dead) return;
    if (order !== undefined) {
      if (!SQUAD_ORDERS.includes(order as SquadOrder)) return;
      const list = this.pets(p).filter(m => m.dying < 0 && (eid === undefined || m.eid === eid));
      list.forEach((m, i) => {
        m.order = order as SquadOrder;
        // Guards stand around where you are now, a little apart
        if (order === 'guard') { const a = (i / Math.max(1, list.length)) * Math.PI * 2; m.guard = [p.body.pos.x + Math.cos(a) * 1.5, p.body.pos.y, p.body.pos.z + Math.sin(a) * 1.5]; }
        else m.guard = undefined;
      });
      if (list.length) {
        this.achieve(p, 'squad');
        const what = order === 'guard' ? 'guarding this spot' : order === 'collect' ? 'collecting dropped items for you' : 'following you';
        p.conn.send({ t: 'toast', text: `${list.length > 1 ? `${list.length} robots` : 'Robot'}: ${what}` });
      }
    }
    this.sendSquad(p);
  }

  private sendSquad(p: Player) {
    p.conn.send({ t: 'squad', list: this.pets(p).filter(m => m.dying < 0).map(m => ({ eid: m.eid, hp: Math.max(0, Math.round(m.health)), max: MOB_SPECS.robot.health, order: m.order || 'follow' })) });
  }

  // The nearest item a collecting robot should fetch: close to it, and not too far from its owner
  private lootFor(m: Mob, owner: Player): Item | null {
    let best: Item | null = null, bd = 12;
    for (const it of this.items.values()) {
      if (it.arrow || it.age < it.pickupDelay + 0.5) continue;
      const d = Math.hypot(it.body.pos.x - m.body.pos.x, it.body.pos.z - m.body.pos.z);
      if (d < bd && Math.abs(it.body.pos.y - m.body.pos.y) < 4 && Math.hypot(it.body.pos.x - owner.body.pos.x, it.body.pos.z - owner.body.pos.z) < 20) { bd = d; best = it; }
    }
    return best;
  }

  // Picks up as much of an item as it can carry
  private robotPickUp(m: Mob, it: Item) {
    const hold = m.hold ??= [];
    const max = maxStack(it.type);
    for (const s of hold) {
      if (!s || s.type !== it.type || s.count >= max) continue;
      const n = Math.min(max - s.count, it.count);
      s.count += n; it.count -= n;
    }
    while (it.count > 0 && hold.length < MAX_HOLD) { const n = Math.min(max, it.count); hold.push({ type: it.type, count: n }); it.count -= n; }
    if (it.count <= 0) this.items.delete(it.eid);
  }

  // Hands over what it carries (what doesn't fit lands at the owner's feet)
  private deliverHold(m: Mob, owner: Player) {
    let n = 0;
    for (const s of m.hold ?? []) {
      if (!s) continue;
      n += s.count;
      const left = addItem(owner.inv, s.type, s.count);
      if (left > 0) this.spawnItem(s.type, left, owner.body.pos.x, owner.body.pos.y + 0.5, owner.body.pos.z);
    }
    m.hold = [];
    if (!n) return;
    this.sendInv(owner);
    this.broadcastEquip(owner);
    owner.conn.send({ t: 'toast', text: `Your robot brought you ${n} item${n > 1 ? 's' : ''}` });
  }

  private pets(p: Player) { return [...this.mobs.values()].filter(m => m.owner === p.name); }

  // ---------------------------------------------------------------- The Robot Titan (the boss)

  // A player near an altar wakes its Titan (unless it's already up, or was defeated less than 5 minutes ago)
  private wakeTitans() {
    for (const p of this.players.values()) {
      if (p.dead || !isRobotic(p.body.pos.x)) continue;
      const a = nearestAltar(p.body.pos.x, p.body.pos.z, this.world.seed);
      if (!a || Math.hypot(a.x + 0.5 - p.body.pos.x, a.z + 0.5 - p.body.pos.z) > 40) continue;
      if ((this.titanWakes.get(a.key) ?? 0) > this.clock) continue;
      if ([...this.mobs.values()].some(m => m.altar === a.key)) continue;
      if (this.world.get(a.x, a.y - 1, a.z) !== BLOCK_ID.altar_core) continue;
      const m = this.spawnMob('robot_titan', a.x + 0.5, a.y, a.z + 0.5);
      m.altar = a.key; m.phaseT = 0; m.attackCd = 2;
      this.tellNear(a.x, a.z, 128, 'The Robot Titan has awoken!');
      this.log(`Robot Titan woke at altar ${a.key}`);
    }
  }

  // Each Elemental World shrine's boss rises when a player comes near (and 5 minutes after it's defeated)
  private wakeWraiths() {
    for (const p of this.players.values()) {
      if (p.dead || !isElemental(p.body.pos.x)) continue;
      const s = nearestShrine(p.body.pos.x, p.body.pos.z, this.world.seed);
      if (!s || Math.hypot(s.x + 0.5 - p.body.pos.x, s.z + 0.5 - p.body.pos.z) > 40) continue;
      if ((this.titanWakes.get(s.key) ?? 0) > this.clock) continue;
      if ([...this.mobs.values()].some(m => m.altar === s.key)) continue;
      if (this.world.get(s.x, s.y - 1, s.z) !== BLOCK_ID[SHRINE_CORE[s.biome]]) continue;
      const kind = SHRINE_BOSS[s.biome];
      const m = this.spawnMob(kind, s.x + 0.5, s.y + (FLOAT_HEIGHT[kind] ?? 0), s.z + 0.5);
      m.altar = s.key; m.attackCd = 2; m.home = { x: s.x + 0.5, z: s.z + 0.5 };
      // Its temple's crystals are whole again, ready to heal it
      m.crystals = shrineCrystals(s);
      // (only into empty space: never over a player's chest or claim stone, nor on someone's claim)
      for (const [cx, cy, cz] of m.crystals) if (this.world.get(cx, cy, cz) === 0 && !this.claimAt(cx, cz)) this.setBlock(cx, cy, cz, BOSS_CRYSTAL);
      this.tellNear(s.x, s.z, 128, `The ${BOSS_NAMES[kind]} rises from its shrine!`);
      this.log(`${BOSS_NAMES[kind]} woke at shrine ${s.key}`);
    }
  }

  private titanDefeated(m: Mob) {
    this.titanWakes.set(m.altar!, this.clock + TITAN_RESPAWN);
    this.dirty = true;
    const name = BOSS_NAMES[m.kind] ?? 'boss';
    this.tellNear(m.body.pos.x, m.body.pos.z, 128, `The ${name} has been defeated! It will return in ${TITAN_RESPAWN / 60} minutes.`);
    const ach = BOSS_ACHIEVEMENTS[m.kind];
    if (ach) for (const p of this.players.values()) if (Math.hypot(p.body.pos.x - m.body.pos.x, p.body.pos.z - m.body.pos.z) < 48) this.achieve(p, ach);
    this.log(`${name} at ${m.altar} defeated`);
  }

  // ---------------------------------------------------------------- The Elemental World's bosses

  // A boss's aimed attack shown to everyone nearby (lightning, thorns, the Tempest's core laser), from its body to the target
  private bossBeam(m: Mob, to: { x: number; y: number; z: number }, color: number, from?: { x: number; y: number; z: number }) {
    const b = m.body, a = from ?? { x: b.pos.x, y: b.pos.y + b.height * 0.7, z: b.pos.z };
    const msg: ServerMsg = { t: 'beam', a: [a.x, a.y, a.z], b: [to.x, to.y, to.z], color };
    for (const o of this.players.values()) if (Math.abs(o.body.pos.x - b.pos.x) < VIEW_DIST && Math.abs(o.body.pos.z - b.pos.z) < VIEW_DIST) o.conn.send(msg);
  }

  // A visual effect for everyone nearby (explosions, shockwaves, warnings where icicles will land...)
  private fx(kind: Extract<ServerMsg, { t: 'fx' }>['kind'], x: number, y: number, z: number, r = 1) {
    const msg: ServerMsg = { t: 'fx', kind, x, y, z, r };
    for (const o of this.players.values()) if (Math.abs(o.body.pos.x - x) < VIEW_DIST && Math.abs(o.body.pos.z - z) < VIEW_DIST) o.conn.send(msg);
  }

  // Players a boss's area attack reaches: alive, standing (not down), within r blocks (and h up or down)
  private playersNear(x: number, y: number, z: number, r: number, h = 4) {
    return [...this.players.values()].filter(p => !p.dead && !p.downed && p.gamemode !== 'creative' && Math.hypot(p.body.pos.x - x, p.body.pos.z - z) <= r && Math.abs(p.body.pos.y - y) <= h);
  }

  // Each boss has several moves on their own timers, and a second, angrier phase below half health:
  //   Frost Wraith: icicle volleys, icicle rain (marked where it will land; freezes), a frost nova (freezes everyone close),
  //     calls up frostbitten, a chilling touch.
  //   Magma Colossus: fireballs; gathers five magma balls and throws them one by one (10 hearts each, without armour);
  //     slams the ground; in phase two, fireballs rain from the sky.
  //   Thorn Guardian: poison thorns; roots; a stomp that hurts everything nearby and throws it 8 blocks; in phase two,
  //     poison spores all around.
  //   Tempest: lasers from its core (bursts of three in phase two), gusts, and hurricanes that chase you and fling you up.
  // as: fight like this boss (the Elemental Core borrows each element's moves in turn)
  private updateElementalBoss(m: Mob, target: Player | null, dist: number, dt: number, as?: MobKind) {
    const b = m.body, spec = MOB_SPECS[m.kind], kind = as ?? m.kind;
    const cd = m.moves ??= {};
    for (const k in cd) cd[k] -= dt;
    const ready = (move: string, every: number, first = every / 2) => {
      if (cd[move] === undefined) cd[move] = first;
      if (cd[move] > 0) return false;
      cd[move] = every * (m.phase2 ? 0.6 : 1) * (this.difficulty === 'hard' ? 0.8 : 1);
      return true;
    };
    const name = BOSS_NAMES[m.kind] ?? 'boss';
    if (!m.phase2 && m.health <= spec.health * 0.5) {
      m.phase2 = true;
      if (m.kind === 'tempest') this.tempestTransforms(m);
      else {
        this.tellNear(b.pos.x, b.pos.z, 64, `The ${name} is enraged!`);
        this.fx('enrage', b.pos.x, b.pos.y + b.height / 2, b.pos.z, 3);
      }
    }
    // Healing from its temple's crystals, once a second, while they stand
    m.healT = (m.healT ?? 1) - dt;
    if (m.healT <= 0) { m.healT = 1; this.crystalsHeal(m); }
    // The Tempest's second form: its transformation, then its own deadly moves (see tempestPhaseTwo)
    if (m.kind === 'tempest' && m.phase2 && this.tempestPhaseTwo(m, target, dist, dt)) return;
    // Magma balls already gathered are thrown one by one, whatever else is going on
    if (m.held?.length) {
      m.throwT = (m.throwT ?? 0) - dt;
      // (only at someone in range and in sight; otherwise the balls keep circling until they are)
      if (m.throwT <= 0 && target && dist <= 40 && Math.abs(target.body.pos.y - b.pos.y) <= 30 && this.canSee(b, target)) { m.throwT = m.phase2 ? 0.45 : 0.7; this.throwMagma(m, m.held.shift()!, target); }
    }
    if (!target || dist > 40 || Math.abs(target.body.pos.y - b.pos.y) > 30) { m.moving = false; return; }
    const t = target.body.pos;
    m.targetYaw = Math.atan2(-(t.x - b.pos.x), -(t.z - b.pos.z));
    const sees = this.canSee(b, target);
    // Walkers that lose sight of you (behind a pillar, up a step) leap towards you after a while
    if (FLOAT_HEIGHT[m.kind] === undefined) {
      m.blindT = sees ? 0 : (m.blindT ?? 0) + dt;
      if (m.blindT > 4 && b.onGround) {
        m.blindT = 0;
        const len = Math.max(1, dist);
        b.vel.x = (t.x - b.pos.x) / len * 9; b.vel.z = (t.z - b.pos.z) / len * 9; b.vel.y = 13;
      }
    }
    const core = { x: b.pos.x, y: b.pos.y + b.height * 0.6, z: b.pos.z };
    const aim = (tx: number, ty: number, tz: number, speed: number) => { const dx = tx - core.x, dy = ty - core.y, dz = tz - core.z, l = Math.hypot(dx, dy, dz) || 1; return { x: dx / l * speed, y: dy / l * speed, z: dz / l * speed }; };

    if (kind === 'frost_wraith') {
      m.moving = dist > 6;
      if (dist < 7 && ready('nova', 12)) {
        this.fx('nova', b.pos.x, b.pos.y + 1, b.pos.z, 7);
        for (const p of this.playersNear(b.pos.x, b.pos.y, b.pos.z, 7, 6)) { this.damagePlayer(p, 3, b.pos, 'frost_wraith'); this.freezePlayer(p, 2); }
        return;
      }
      if (ready('rain', 9)) {
        // Icicles fall around you (and right on you); each spot is marked on the ground first
        const n = m.phase2 ? 8 : 5;
        for (let k = 0; k < n; k++) {
          const r = k === 0 ? 0 : 1.5 + Math.random() * 2.5, a = Math.random() * Math.PI * 2;
          const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r, gy = this.world.surfaceHeight(Math.floor(x), Math.floor(z)) + 1;
          this.fx('mark', x, Math.min(gy, t.y + 6), z, 1);
          this.spawnShot('icicle', { x, y: t.y + 12 + Math.random() * 3, z }, { x: 0, y: -2, z: 0 }, m.eid, false, 6, { gravity: true, freeze: 1.5, splash: 1.2 });
        }
        return;
      }
      if (ready('summon', 18)) {
        let n = 0;
        for (let k = 0; k < 8 && n < 2; k++) {
          const a = Math.random() * Math.PI * 2, x = Math.floor(t.x + Math.cos(a) * 4), z = Math.floor(t.z + Math.sin(a) * 4);
          const y = this.world.surfaceHeight(x, z) + 1;
          if (Math.abs(y - t.y) > 4 || boxIntersectsSolid(this.world.get, x + 0.5, y, z + 0.5, MOB_SPECS.frostbitten.halfW, MOB_SPECS.frostbitten.height)) continue;
          this.spawnMob('frostbitten', x + 0.5, y, z + 0.5); n++;
        }
        if (n) this.tellNear(b.pos.x, b.pos.z, 48, `The ${name} calls up the frozen dead!`);
        return;
      }
      if (m.attackCd > 0) return;
      if (dist < spec.halfW + 1.8 && Math.abs(t.y - b.pos.y) < 4) { this.damagePlayer(target, spec.damage!, b.pos, 'frost_wraith'); this.slowPlayer(target, 3); m.attackCd = 1.2; return; }
      if (sees) {
        // A volley of icicles, fanned out
        const n = m.phase2 ? 5 : 3;
        for (let k = 0; k < n; k++) {
          const spread = (k - (n - 1) / 2) * 0.9;
          const v = aim(t.x + spread * Math.cos(m.yaw), t.y + 1.2, t.z - spread * Math.sin(m.yaw), 22);
          this.spawnShot('icicle', { ...core }, v, m.eid, false, 4, { slow: 2 });
        }
        m.attackCd = this.difficulty === 'hard' ? 1.8 : 2.4;
      }
      return;
    }

    if (kind === 'magma_colossus') {
      m.moving = dist > (m.phase2 ? 5 : 7);
      if (ready('barrage', 16, 6) && !m.held?.length) {
        // Gathers five balls of magma over its head...
        m.held = [];
        for (let k = 0; k < 5; k++) m.held.push(this.spawnShot('magma_ball', { ...core }, { x: 0, y: 0, z: 0 }, m.eid, false, 20, { gravity: true, fire: 4, splash: 2, heldBy: m.eid, slot: k }));
        m.throwT = 1.4;
        this.tellNear(b.pos.x, b.pos.z, 48, `The ${name} gathers balls of magma!`);
        return;
      }
      if (dist < 6 && ready('slam', 11)) {
        this.fx('slam', b.pos.x, b.pos.y + 0.1, b.pos.z, 6);
        for (const p of this.playersNear(b.pos.x, b.pos.y, b.pos.z, 6, 3)) { this.damagePlayer(p, 5, b.pos, 'magma_colossus', undefined, 12, 7); this.burnPlayer(p, 3); }
        this.tellNear(b.pos.x, b.pos.z, 32, `The ${name} slams the ground!`);
        return;
      }
      if (m.phase2 && ready('eruption', 8)) {
        // Fireballs rain from the sky around you
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * Math.PI * 2, r = k === 0 ? 0 : 2 + Math.random() * 3;
          this.spawnShot('fireball', { x: t.x + Math.cos(a) * r, y: t.y + 16, z: t.z + Math.sin(a) * r }, { x: 0, y: -10, z: 0 }, m.eid, false, 5, { gravity: true, fire: 3, splash: 1.5 });
        }
        this.tellNear(b.pos.x, b.pos.z, 48, 'The volcano erupts!');
        return;
      }
      if (m.attackCd > 0) return;
      if (dist < spec.halfW + 1.6 && Math.abs(t.y - b.pos.y) < 3) { this.damagePlayer(target, spec.damage!, b.pos, m.kind); m.attackCd = 1.2; return; }
      if (sees) {
        this.spawnShot('fireball', { ...core }, aim(t.x, t.y + 1, t.z, 18), m.eid, false, 5, { fire: 3 });
        m.attackCd = this.difficulty === 'hard' ? 1.8 : 2.6;
      }
      return;
    }

    if (kind === 'thorn_guardian') {
      m.moving = dist > spec.halfW + 1.2 && (m.stompT ?? -1) < 0;
      // The stomp: it rears up (a short warning), then the ground shakes
      if (m.stompT !== undefined && m.stompT >= 0) {
        m.stompT -= dt;
        if (m.stompT < 0) this.stomp(m);
        return;
      }
      if (dist < 9 && ready('stomp', 9, 4)) { m.stompT = 0.8; this.fx('charge', b.pos.x, b.pos.y, b.pos.z, 8); return; }
      if (dist < 16 && ready('roots', 13)) { this.slowPlayer(target, 3); target.conn.send({ t: 'toast', text: 'Roots grab your feet!' }); return; }
      if (m.phase2 && ready('spores', 8)) {
        this.fx('spores', b.pos.x, b.pos.y + 1, b.pos.z, 10);
        for (const p of this.playersNear(b.pos.x, b.pos.y, b.pos.z, 10, 6)) this.poisonPlayer(p, 4);
        this.tellNear(b.pos.x, b.pos.z, 32, `The ${name} bursts into poison spores!`);
        return;
      }
      if (m.attackCd > 0) return;
      if (dist < spec.halfW + 1.6 && Math.abs(t.y - b.pos.y) < 3) { this.damagePlayer(target, spec.damage!, b.pos, m.kind); m.attackCd = 1.2; return; }
      if (sees) {
        const hit = Math.random() < 0.75;
        this.bossBeam(m, { x: t.x + (hit ? 0 : 1.5), y: t.y + 1, z: t.z }, 0x60d040);
        if (hit) { this.damagePlayer(target, 4, b.pos, 'thorn_guardian'); this.poisonPlayer(target, 4); }
        m.attackCd = this.difficulty === 'hard' ? 1.6 : 2.2;
      }
      return;
    }

    // The Tempest: circles above you, and now and then lands to rest (perches) for a few seconds: the moment to hit it
    if ((m.perchT ?? 0) > 0) {
      m.perchT! -= dt;
      m.moving = false;
      if (m.perchT! <= 0) this.tellNear(b.pos.x, b.pos.z, 48, 'The Tempest takes to the sky again!');
      return;
    }
    if (m.kind === 'tempest' && ready('perch', 16, 10)) {
      m.perchT = m.phase2 ? 3.5 : 5;
      this.tellNear(b.pos.x, b.pos.z, 48, 'The Tempest lands to rest. Strike now!');
      return;
    }
    m.moving = true;
    if (dist < 9) m.targetYaw += Math.PI / 2;
    if (ready('hurricanes', 15, 5)) {
      const n = m.phase2 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + Math.random(), x = t.x + Math.cos(a) * 7, z = t.z + Math.sin(a) * 7;
        // On the ground near the player (the sky arena floats high above the clouds: never down there)
        let gy: number | null = null;
        for (let y = Math.floor(t.y) + 3; y >= Math.floor(t.y) - 4 && gy === null; y--) {
          if (isSolid(this.world.get(Math.floor(x), y - 1, Math.floor(z))) && !isSolid(this.world.get(Math.floor(x), y, Math.floor(z)))) gy = y;
        }
        if (gy === null) continue;
        const h = this.spawnMob('hurricane', x, gy, z);
        h.life = 12;
        if (m.kind === 'tempest' && m.phase2) h.phase2 = true; // (twice the size, and it drags you in)
      }
      this.tellNear(b.pos.x, b.pos.z, 48, `The ${name} summons hurricanes!`);
      return;
    }
    if (ready('gust', 9)) {
      this.fx('gust', b.pos.x, b.pos.y, b.pos.z, 12);
      for (const p of this.playersNear(b.pos.x, b.pos.y, b.pos.z, 12, 16)) this.damagePlayer(p, 1, b.pos, 'tempest', undefined, 20);
      this.tellNear(b.pos.x, b.pos.z, 32, `The ${name} beats up a gust!`);
      return;
    }
    // Lasers from its core: one at a time, or bursts of three when enraged
    if ((m.burst ?? 0) > 0 && m.attackCd <= 0) {
      m.burst!--;
      m.attackCd = m.burst! > 0 ? 0.3 : (this.difficulty === 'hard' ? 1.6 : 2.2);
      const hit = sees && Math.random() < 0.7;
      this.bossBeam(m, { x: t.x + (hit ? 0 : 1.5), y: t.y + 1, z: t.z }, 0xffd040, core);
      if (hit) this.damagePlayer(target, 5, b.pos, 'tempest');
      return;
    }
    if (m.attackCd <= 0 && sees) m.burst = m.phase2 ? 3 : 1;
  }

  // The Thorn Guardian's stomp: everything nearby (players and mobs) is hurt and thrown about 8 blocks away
  private stomp(m: Mob) {
    const b = m.body;
    this.fx('stomp', b.pos.x, b.pos.y + 0.1, b.pos.z, 8);
    for (const p of this.playersNear(b.pos.x, b.pos.y, b.pos.z, 8, 4)) this.damagePlayer(p, 6, b.pos, 'thorn_guardian', undefined, 26, 9);
    for (const o of this.mobs.values()) {
      if (o === m || o.dying >= 0 || BOSS_NAMES[o.kind] || o.kind === 'hurricane') continue;
      const dx = o.body.pos.x - b.pos.x, dz = o.body.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d > 8 || Math.abs(o.body.pos.y - b.pos.y) > 4) continue;
      o.hurt = 0;
      o.health -= 6;
      if (o.health <= 0) o.dying = 0;
      o.body.vel.x = (dx / (d || 1)) * 20; o.body.vel.z = (dz / (d || 1)) * 20; o.body.vel.y = 9;
      o.hurt = 0.5;
    }
    this.tellNear(b.pos.x, b.pos.z, 32, `The ${BOSS_NAMES[m.kind] ?? 'boss'} stomps!`);
  }

  // A magma ball leaves the Colossus's crown in a high arc that lands on you
  private throwMagma(m: Mob, eid: number, target: Player) {
    const it = this.items.get(eid);
    if (!it?.shot) return;
    const s = it.shot, from = it.body.pos, t = target.body.pos;
    s.heldBy = undefined;
    const dx = t.x - from.x, dz = t.z - from.z, dy = t.y + 0.5 - from.y;
    const T = Math.max(0.7, Math.min(1.6, Math.hypot(dx, dz) / 13));
    it.body.vel.x = dx / T; it.body.vel.z = dz / T; it.body.vel.y = dy / T + 0.5 * SHOT_GRAVITY * T;
    it.age = 0;
  }

  // The Tempest's hurricanes: they chase the nearest player, fling them high into the air, and blow over after a while
  private updateHurricane(m: Mob, target: Player | null, dist: number, dt: number) {
    m.life = (m.life ?? 12) - dt;
    if (m.life <= 0) { this.mobs.delete(m.eid); return; }
    if (target) { m.targetYaw = Math.atan2(-(target.body.pos.x - m.body.pos.x), -(target.body.pos.z - m.body.pos.z)); m.moving = dist > 0.5; }
    const big = !!m.phase2; // the Tempest's second form: twice the size, and it drags you in
    const q = m.body.pos;
    if (big) {
      m.pullT = (m.pullT ?? 0) - dt;
      if (m.pullT <= 0) {
        m.pullT = 0.4;
        for (const p of this.playersNear(q.x, q.y, q.z, 10, 8)) {
          const d = Math.hypot(p.body.pos.x - q.x, p.body.pos.z - q.z);
          if (d < 1.5) continue;
          // (a push "from" the far side of the player is a pull towards the funnel)
          const from = { x: p.body.pos.x + (p.body.pos.x - q.x) / d, y: p.body.pos.y, z: p.body.pos.z + (p.body.pos.z - q.z) / d };
          p.conn.send({ t: 'hurt', from: [from.x, from.y, from.z], knock: 5, pull: true });
        }
      }
    }
    m.attackCd = Math.max(0, m.attackCd);
    if (m.attackCd > 0) return;
    for (const p of this.playersNear(q.x, q.y, q.z, (MOB_SPECS.hurricane.halfW + 0.6) * (big ? 2 : 1), big ? 8 : 4)) {
      this.damagePlayer(p, big ? 2 : 1, { x: q.x, y: q.y - 3, z: q.z }, 'tempest', undefined, 4, big ? 20 : 16);
      m.attackCd = 0.6;
    }
  }

  // ---------------------------------------------------------------- Temple crystals, and the Tempest's second form

  // A boss heals from each crystal still standing on its temple's towers (a beam shows it); break them to stop it
  private crystalsHeal(m: Mob) {
    if (!m.crystals || (m.kind === 'tempest' && m.phase2)) return;
    const max = MOB_SPECS[m.kind].health, b = m.body.pos;
    const color = { frost_wraith: 0x9ef4ff, magma_colossus: 0xff7a10, thorn_guardian: 0x6ad040, tempest: 0xffd040 }[m.kind as string] ?? 0xffffff;
    for (const [x, y, z] of m.crystals) {
      if (this.world.get(x, y, z) !== BOSS_CRYSTAL || Math.hypot(x - b.x, z - b.z) > 48 || m.health >= max) continue;
      m.health = Math.min(max, m.health + 4);
      this.bossBeam(m, { x: b.x, y: b.y + m.body.height * 0.6, z: b.z }, color, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    }
  }

  // Half its health gone: the Tempest's rings fade, leaving its core bare; it draws in its temple's crystals (healing
  // from each), grows four wings and an angel's ring, and a shield that turns back elemental shots
  // The transformation (10 s; it can't be hurt meanwhile). Timeline, in seconds from the start:
  //   0-2.5  it flies to the middle of its temple
  //   2.5-7  it fires a laser at each standing crystal in turn; each one shatters into it (60 health)
  //   6.8    light pours in from all around; its wings fade away (on the client)
  //   8.2    the burst: four wings, the angel's ring and the shield
  private tempestTransforms(m: Mob) {
    m.transformT = TRANSFORM_SECONDS;
    m.absorbed = 0;
    m.absorbT = 0; m.laserAt = undefined;
    this.tellNear(m.body.pos.x, m.body.pos.z, 96, 'The Tempest begins to transform!');
  }

  private stepTransform(m: Mob, dt: number) {
    const b = m.body.pos, was = TRANSFORM_SECONDS - m.transformT!;
    m.transformT = m.transformT! - dt;
    const at = TRANSFORM_SECONDS - m.transformT;
    const core = { x: b.x, y: b.y + m.body.height * 0.6, z: b.z };
    if (at < 2.5 && m.home) {
      // To the middle of its temple
      const k = Math.min(1, dt * 2.5);
      b.x += (m.home.x - b.x) * k; b.z += (m.home.z - b.z) * k;
    }
    if (at >= 2.5 && at < 7) {
      if (m.laserAt) {
        // Its laser on a crystal: held for 0.9 s, then the crystal shatters and its light flows in
        const [x, y, z] = m.laserAt;
        m.absorbT = (m.absorbT ?? 0) - dt;
        if (Math.floor((m.absorbT + dt) / 0.15) !== Math.floor(m.absorbT / 0.15)) this.bossBeam(m, { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 0xffe060, core);
        if (m.absorbT <= 0) {
          if (this.world.get(x, y, z) === BOSS_CRYSTAL) {
            this.fx('shatter', x + 0.5, y + 0.5, z + 0.5, 1);
            this.bossBeam(m, core, 0xffffff, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
            this.setBlock(x, y, z, 0);
            m.absorbed = (m.absorbed ?? 0) + 1;
            m.health = Math.min(MOB_SPECS.tempest.health, m.health + 60);
          }
          m.laserAt = undefined; m.absorbT = 0.2; // (a breath before the next)
        }
      } else if ((m.absorbT = (m.absorbT ?? 0) - dt) <= 0) {
        const c = (m.crystals ?? []).find(([x, y, z]) => this.world.get(x, y, z) === BOSS_CRYSTAL);
        if (c) { m.laserAt = c; m.absorbT = 0.9; this.bossBeam(m, { x: c[0] + 0.5, y: c[1] + 0.5, z: c[2] + 0.5 }, 0xffe060, core); }
      }
    }
    if (was < 6.8 && at >= 6.8) this.fx('gather', core.x, core.y, core.z, 7);
    if (was < 8.2 && at >= 8.2) {
      // The burst: four wings, the halo, the shield
      this.fx('transform', b.x, b.y + 1, b.z, 6);
      const n = m.absorbed ?? 0;
      this.tellNear(b.x, b.z, 96, n ? `The Tempest's rings shatter... it draws in ${n} crystal${n > 1 ? 's' : ''} and unfurls four wings!` : "The Tempest's rings shatter... it unfurls four wings!");
    }
  }

  // The Tempest's second form. Returns true while one of these moves has it busy (its other moves wait). Also
  //   lightning bolts blasted down on you (8 damage), every few seconds.
  //   the transformation itself (3 s); a wing swoop that snatches you and flings you high; the sky lasers (its core
  //   splits into five beams shot into the sky, and 5 s later they rain down where red warnings showed for 2 s: 18
  //   damage); and the four-wing charge: a long wind-up, a lunge where you stood, and if it catches you, it wraps you in
  //   its wings, pulls you in and finishes you with a 40-damage laser.
  private tempestPhaseTwo(m: Mob, target: Player | null, dist: number, dt: number): boolean {
    const b = m.body, cd = m.moves!;
    const core = { x: b.pos.x, y: b.pos.y + b.height * 0.6, z: b.pos.z };
    const ready = (move: string, every: number, first: number) => {
      if (cd[move] === undefined) cd[move] = first;
      if (cd[move] > 0) return false;
      cd[move] = every * (this.difficulty === 'hard' ? 0.8 : 1);
      return true;
    };
    if ((m.transformT ?? 0) > 0) { this.stepTransform(m, dt); m.moving = false; return true; }
    // Holding someone in its wings: it rises with them, then the laser
    if (m.grabbed !== undefined) {
      const v = this.players.get(m.grabbed);
      m.grabT = (m.grabT ?? 0) - dt;
      m.moving = false;
      if (!v || v.dead || v.downed || v.gamemode === 'creative' || Math.hypot(v.body.pos.x - b.pos.x, v.body.pos.z - b.pos.z) > 8) { m.grabbed = undefined; return true; }
      this.teleport(v, b.pos.x, b.pos.y - 1.6, b.pos.z - 1.2);
      if (m.grabT <= 0) {
        this.bossBeam(m, { x: v.body.pos.x, y: v.body.pos.y + 1, z: v.body.pos.z }, 0xffffff, core);
        v.invuln = 0;
        this.damagePlayer(v, 40, b.pos, 'rapture');
        m.grabbed = undefined;
      }
      return true;
    }
    // The four-wing charge: the wind-up (it locks on to where you stand), then the lunge
    if (m.raptureAt) {
      m.raptureT = (m.raptureT ?? 0) - dt;
      m.moving = false;
      if (m.raptureT > 0) return true;
      const at = m.raptureAt;
      m.raptureAt = undefined;
      this.bossBeam(m, { x: at.x, y: at.y + 1, z: at.z }, 0xffffff, core);
      b.pos.x = at.x; b.pos.z = at.z; b.pos.y = at.y + 2; b.vel.x = b.vel.y = b.vel.z = 0;
      const caught = this.playersNear(at.x, at.y, at.z, 3, 4)[0];
      if (caught) {
        m.grabbed = caught.eid; m.grabT = 1.6;
        this.freezePlayer(caught, 2, true);
        this.tellNear(at.x, at.z, 64, `${caught.name} is caught in the Tempest's wings!`);
      } else this.tellNear(at.x, at.z, 64, 'The Tempest lunges... and misses!');
      return true;
    }
    // The sky lasers: shot up, then (warnings first) they fall
    if (m.starT !== undefined) {
      const before = m.starT;
      m.starT -= dt;
      if (before > 2 && m.starT <= 2) {
        // Where they'll land: on and around everyone near, marked in red
        m.starSpots = [];
        const near = this.playersNear(b.pos.x, b.pos.y, b.pos.z, 40, 30);
        for (let k = 0; k < 5; k++) {
          const p = near[k % Math.max(1, near.length)] ?? target;
          if (!p) break;
          const r = k < near.length ? 0 : 2 + Math.random() * 4, a = Math.random() * Math.PI * 2;
          const x = p.body.pos.x + Math.cos(a) * r, z = p.body.pos.z + Math.sin(a) * r;
          const y = p.body.pos.y;
          m.starSpots.push([x, y, z]);
          this.fx('warn', x, y, z, 2.2);
        }
      }
      if (m.starT <= 0) {
        for (const [x, y, z] of m.starSpots ?? []) {
          this.fx('starfall', x, y, z, 2.2);
          for (const p of this.playersNear(x, y, z, 2.2, 3)) { p.invuln = 0; this.damagePlayer(p, 18, { x, y: y + 10, z }, 'starfall'); }
        }
        m.starT = undefined; m.starSpots = undefined;
      }
      return false; // (it keeps fighting while they're up there)
    }
    if (!target || dist > 40 || (m.perchT ?? 0) > 0) return false; // (resting on a tower: not now)
    const t = target.body.pos;
    if (dist < 24 && ready('rapture', 26, 8)) {
      m.raptureAt = { x: t.x, y: t.y, z: t.z }; m.raptureT = 1.8;
      this.fx('wingcharge', t.x, t.y, t.z, 3);
      this.tellNear(b.pos.x, b.pos.z, 64, 'The Tempest spreads all four wings... MOVE!');
      return true;
    }
    if (ready('starfall', 18, 4)) {
      m.starT = 5;
      this.fx('skybeam', core.x, core.y, core.z, 5);
      this.tellNear(b.pos.x, b.pos.z, 64, 'The Tempest splits its core into the sky!');
      return true;
    }
    if (ready('bolt', 4, 1.5)) {
      // A lightning bolt blasted down on you (8 damage; it misses now and then)
      const miss = Math.random() < 0.25 ? 2.5 : 0, a = Math.random() * Math.PI * 2;
      const x = t.x + Math.cos(a) * miss, z = t.z + Math.sin(a) * miss;
      for (const o of this.players.values()) if (Math.abs(o.body.pos.x - x) < VIEW_DIST * 2 && Math.abs(o.body.pos.z - z) < VIEW_DIST * 2) o.conn.send({ t: 'lightning', x, y: t.y, z });
      for (const p of this.playersNear(x, t.y, z, 1.8, 3)) { p.invuln = 0; this.damagePlayer(p, 8, { x, y: t.y + 5, z }, 'tempest'); }
      return true;
    }
    if (dist < 24 && ready('swoop', 9, 2)) {
      // Its wings shoot down and snatch you up, flinging you high into the air
      this.bossBeam(m, { x: t.x, y: t.y + 1, z: t.z }, 0xf4f8ff, core);
      this.fx('gust', t.x, t.y + 1, t.z, 3);
      if (Math.random() < 0.8) { target.invuln = 0; this.damagePlayer(target, 4, { x: t.x, y: t.y - 2, z: t.z }, 'tempest', undefined, 2, 24); }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Elemental armour, fire, poison, breath

  private wearing(p: Player, type: string) {
    for (let i = 55; i <= 58; i++) if (p.inv.slots[i]?.type === type) return true;
    return false;
  }
  // 20 hearts while wearing earth leggings, else 10
  private maxHp(p: Player) { return p.inv.slots[57]?.type === 'earth_leggings' ? 2 * MAX_HEALTH : MAX_HEALTH; }
  private fireproof(p: Player) { return this.wearing(p, 'lava_chestplate') || this.fullSet(p, 'obitite'); }

  private poisonPlayer(p: Player, seconds: number) {
    if (p.gamemode === 'creative' || p.dead) return;
    p.poisonT = Math.max(p.poisonT, seconds);
  }
  private burnPlayer(p: Player, seconds: number) {
    if (p.gamemode === 'creative' || p.dead || this.fireproof(p)) return;
    p.fireT = Math.max(p.fireT, seconds);
  }

  // The lava chestplate: . shoots a fireball where you aim
  private onFireball(p: Player, m: { dx: number; dy: number; dz: number }) {
    if (p.dead || p.downed || p.fireballCd > this.clock || !this.wearing(p, 'lava_chestplate') || ![m.dx, m.dy, m.dz].every(isNum)) return;
    const len = Math.hypot(m.dx, m.dy, m.dz);
    if (len < 0.5 || len > 2) return;
    p.fireballCd = this.clock + 1.2;
    p.swingUntil = this.clock + 0.25;
    const e = this.eye(p), dir = { x: m.dx / len, y: m.dy / len, z: m.dz / len };
    this.spawnShot('fireball', { x: e.x + dir.x * 0.8, y: e.y - 0.2 + dir.y * 0.8, z: e.z + dir.z * 0.8 }, { x: dir.x * 20, y: dir.y * 20, z: dir.z * 20 }, p.eid, true, 6, { fire: 3, splash: 1 });
  }

  // A projectile: a fireball, a magma ball or an icicle. It flies (falling, if it has weight) until it hits something or a
  // wall; magma and falling icicles also hurt everyone close to where they land. A magma ball can wait, circling its
  // boss's head (heldBy), until it's thrown. Returns its id.
  private spawnShot(kind: ShotKind, from: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, owner: number, byPlayer: boolean, damage: number,
    opts: { gravity?: boolean; fire?: number; freeze?: number; slow?: number; splash?: number; heldBy?: number; slot?: number } = {}): number {
    // (shots never push out dropped items at the item limit: they're short-lived)
    const it: Item = { kind: 'item', eid: this.nextEid++, type: kind, count: 1, body: makeBody(kind === 'magma_ball' ? 0.35 : 0.15, kind === 'magma_ball' ? 0.7 : 0.3, { ...from }, { ...vel }),
      age: 0, pickupDelay: 99, shot: { kind, damage, owner, ownerName: this.players.get(owner)?.name ?? '', bossKind: this.mobs.get(owner)?.kind, byPlayer, ...opts } };
    this.items.set(it.eid, it);
    return it.eid;
  }

  private updateShot(it: Item, dt: number) {
    const b = it.body, s = it.shot!;
    if (s.heldBy !== undefined) {
      // Circling its boss's head, waiting to be thrown
      const boss = this.mobs.get(s.heldBy);
      if (!boss || boss.dying >= 0) { this.items.delete(it.eid); return; }
      const a = this.clock * 2.5 + (s.slot ?? 0) * (Math.PI * 2 / 5);
      b.pos.x = boss.body.pos.x + Math.cos(a) * 2.2; b.pos.z = boss.body.pos.z + Math.sin(a) * 2.2; b.pos.y = boss.body.pos.y + boss.body.height + 1;
      it.age = 0;
      return;
    }
    if (it.age > 6) { this.items.delete(it.eid); return; }
    if (s.gravity) b.vel.y = Math.max(-40, b.vel.y - SHOT_GRAVITY * dt);
    const steps = 4;
    for (let k = 0; k < steps; k++) {
      b.pos.x += b.vel.x * dt / steps; b.pos.y += b.vel.y * dt / steps; b.pos.z += b.vel.z * dt / steps;
      if (isSolid(this.world.get(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z)))) { this.shotLands(it, null); return; }
      const inBox = (e: { body: Body }) => { const q = e.body.pos; return Math.abs(q.x - b.pos.x) < e.body.halfW + 0.25 && Math.abs(q.z - b.pos.z) < e.body.halfW + 0.25 && b.pos.y > q.y - 0.2 && b.pos.y < q.y + e.body.height + 0.2; };
      for (const p of this.players.values()) {
        if (p.eid === s.owner || p.dead || p.downed || !inBox(p)) continue;
        this.shotLands(it, p); return;
      }
      for (const m of this.mobs.values()) {
        // A player's shot hits wild monsters and animals (never tamed robots, like a sword); a boss's hits only robots
        if (m.eid === s.owner || m.dying >= 0 || m.kind === 'hurricane' || !inBox(m) || (s.byPlayer ? !!m.owner : !m.owner)) continue;
        if (s.byPlayer && m.kind === 'tempest' && m.phase2) {
          // The Tempest's shield: an elemental shot bounces straight back (and is now the Tempest's)
          b.vel.x = -b.vel.x; b.vel.y = -b.vel.y; b.vel.z = -b.vel.z;
          b.pos.x += b.vel.x * 0.1; b.pos.y += b.vel.y * 0.1; b.pos.z += b.vel.z * 0.1;
          s.byPlayer = false; s.owner = m.eid; s.bossKind = 'tempest'; s.ownerName = '';
          this.fx('deflect', b.pos.x, b.pos.y, b.pos.z, 1.5);
          return;
        }
        this.shotLands(it, m); return;
      }
    }
  }

  // Where a shot lands: what it hit takes the damage (and burns, freezes...), and so does everyone close if it splashes
  private shotLands(it: Item, hit: Player | Mob | null) {
    const s = it.shot!, at = it.body.pos;
    this.items.delete(it.eid);
    this.fx(s.kind === 'icicle' ? 'shatter' : 'explode', at.x, at.y, at.z, s.splash ?? 1);
    const from = { x: at.x - it.body.vel.x * 0.05, y: at.y, z: at.z - it.body.vel.z * 0.05 };
    const cause = s.byPlayer ? 'player' : s.bossKind ?? 'magma_colossus';
    const hurtPlayer = (p: Player) => {
      if (s.byPlayer && this.sameTeam(s.ownerName, p.name)) return; // a teammate's fireball: no harm (not even a burn)
      this.damagePlayer(p, s.damage, from, cause, s.byPlayer ? s.ownerName || undefined : undefined);
      if (s.fire) this.burnPlayer(p, s.fire);
      if (s.freeze) this.freezePlayer(p, s.freeze);
      if (s.slow) this.slowPlayer(p, s.slow);
    };
    const hurtMob = (m: Mob) => {
      m.hurt = 0;
      this.damageMob(m, s.damage, from);
      if (s.fire) m.fireT = s.fire;
      if (s.freeze || s.slow) m.slowT = s.freeze ?? s.slow;
      const owner = this.players.get(s.owner);
      if (owner && m.dying >= 0 && MOB_SPECS[m.kind].hostile) this.achieve(owner, 'monster');
    };
    if (hit) { if (hit.kind === 'player') hurtPlayer(hit); else hurtMob(hit); }
    if (s.splash) {
      for (const p of this.players.values()) if (p !== hit && p.eid !== s.owner && !p.dead && !p.downed && Math.hypot(p.body.pos.x - at.x, p.body.pos.y + 0.9 - at.y, p.body.pos.z - at.z) <= s.splash + 0.6) hurtPlayer(p);
      if (s.byPlayer) for (const m of this.mobs.values()) if (m !== hit && !m.owner && m.dying < 0 && m.kind !== 'hurricane' && !(m.kind === 'tempest' && m.phase2) && Math.hypot(m.body.pos.x - at.x, m.body.pos.z - at.z) <= s.splash) hurtMob(m);
    }
  }

  // Frozen solid: you can't move for a moment (a Frost Heart keeps the cold out)
  // held: caught in the Tempest's wings rather than frozen (a Frost Heart doesn't help)
  private freezePlayer(p: Player, seconds: number, held = false) {
    if ((!held && this.holding(p, 'frost_heart')) || p.gamemode === 'creative' || p.dead) return;
    p.slowT = Math.max(p.slowT, seconds);
    p.conn.send(held ? { t: 'slow', seconds, freeze: true, held } : { t: 'slow', seconds, freeze: true });
  }

  // Once a second: poison (never kills a player on its own) and fire; breath underwater; magma underfoot
  private updateEffects(p: Player, dt: number) {
    const w = this.world.get, b = p.body;
    const creative = p.gamemode === 'creative';
    p.poisonT = Math.max(0, p.poisonT - dt);
    if (boxTouchesBlock(w, b, WATER, 0) || (p.fireT > 0 && this.rainedOn(p))) p.fireT = 0; // water (or rain) puts you out
    p.fireT = Math.max(0, p.fireT - dt);
    if (this.fireproof(p)) p.fireT = 0;
    p.effectT -= dt;
    if (p.effectT <= 0 && !p.downed) { // (any damage while down would finish you off)
      p.effectT = 1;
      if (p.poisonT > 0 && p.health > 1) { p.invuln = 0; this.damagePlayer(p, 1, null, 'poison'); }
      if (p.fireT > 0) { p.invuln = 0; this.damagePlayer(p, 1, null, 'fire'); }
    }
    const status = `${Math.ceil(p.poisonT)},${Math.ceil(p.fireT)}`;
    if (status !== p.statusShown) { p.statusShown = status; p.conn.send({ t: 'status', poison: Math.ceil(p.poisonT), fire: Math.ceil(p.fireT) }); }
    // Breath: runs out with your head under water (or oil), unless you wear the water helmet
    const head = w(Math.floor(b.pos.x), Math.floor(b.pos.y + PLAYER_EYE), Math.floor(b.pos.z));
    if ((head === WATER || head === OIL) && !creative && !p.downed && !this.wearing(p, 'water_helmet')) {
      p.air -= dt;
      if (p.air <= 0) { p.air = 1; p.invuln = 0; this.damagePlayer(p, 2, null, 'drown'); }
    } else p.air = Math.min(AIR_SECONDS, p.air + dt * 5);
    const tenths = Math.ceil((p.air / AIR_SECONDS) * 10);
    if (tenths !== p.airShown) { p.airShown = tenths; p.conn.send({ t: 'air', air: tenths / 10 }); }
    // Magma burns whoever stands on it
    p.magmaT -= dt;
    if (p.magmaT <= 0 && !creative && !p.downed && !this.fireproof(p) && (p.flags & MF_GROUND) && w(Math.floor(b.pos.x), Math.floor(b.pos.y - 0.1), Math.floor(b.pos.z)) === BLOCK_ID.magma_block) {
      p.magmaT = 1; p.invuln = 0; this.damagePlayer(p, 1, null, 'magma');
    }
    // Earth leggings put on or taken off: the health bar grows or shrinks
    const max = this.maxHp(p);
    if (max !== p.maxShown) {
      p.maxShown = max;
      p.conn.send({ t: 'maxhp', max });
      if (p.health > max) { p.health = max; p.conn.send({ t: 'health', hp: p.health }); }
    }
  }

  private tellNear(x: number, z: number, r: number, text: string) {
    for (const p of this.players.values()) if (Math.hypot(p.body.pos.x - x, p.body.pos.z - z) < r) p.conn.send({ t: 'chat', from: null, text });
  }

  // Fires its laser from range, now and then charges with its grinder (1 heart a second), punches up close
  private updateTitan(m: Mob, target: Player | null, dist: number, dt: number) {
    const b = m.body, spec = MOB_SPECS.robot_titan;
    m.phaseT = (m.phaseT ?? 0) + dt;
    if (!target || dist > 32 || Math.abs(target.body.pos.y - b.pos.y) > 30) {
      m.moving = false;
      return;
    }
    const t = target.body.pos;
    m.targetYaw = Math.atan2(-(t.x - b.pos.x), -(t.z - b.pos.z));
    const reach = spec.halfW + 1.6;
    const close = dist < reach && Math.abs(t.y - b.pos.y) < 3;
    if (m.phaseT % 14 > 10) {
      // Grinder charge (4 seconds of every 14)
      m.moving = dist > reach - 0.5;
      m.grindT = (m.grindT ?? 0) - dt;
      if (close && m.grindT <= 0) { m.grindT = 1; this.damagePlayer(target, 2, b.pos, 'robot_titan'); }
      return;
    }
    m.moving = dist > 8;
    if (m.attackCd > 0) return;
    if (close) { this.damagePlayer(target, spec.damage!, b.pos, 'robot_titan'); m.attackCd = 1.2; return; }
    if (Math.hypot(dist, t.y - b.pos.y) < 32 && this.canSee(b, target)) {
      const hit = Math.random() < 0.75;
      const miss = hit ? 0 : 1.5;
      this.beam(m, { x: t.x + (Math.random() - 0.5) * miss * 2, y: t.y + 1.2 + (Math.random() - 0.5) * miss, z: t.z + (Math.random() - 0.5) * miss * 2 });
      if (hit) this.laserHit(m, target, 8);
      m.attackCd = this.difficulty === 'hard' ? 1.8 : 2.5;
    }
  }

  // The health bar at the top of the screen, for everyone near a Titan
  private sendBossBars() {
    for (const p of this.players.values()) {
      let boss: Mob | null = null;
      for (const m of this.mobs.values()) if (BOSS_NAMES[m.kind] && m.dying < 0 && Math.hypot(m.body.pos.x - p.body.pos.x, m.body.pos.z - p.body.pos.z) < 48) boss = m;
      const hp = boss ? Math.max(0, Math.round(boss.health)) : -1;
      if (hp === p.bossHp) continue;
      p.bossHp = hp;
      const kind = boss?.kind ?? 'robot_titan';
      p.conn.send({ t: 'boss', name: BOSS_NAMES[kind]!, hp, max: MOB_SPECS[kind].health });
    }
  }

  // ---------------------------------------------------------------- Lasers

  private holding(p: Player, type: string) {
    return p.inv.slots[p.inv.selected]?.type === type || p.inv.slots[OFFHAND]?.type === type;
  }

  // A robot's laser hits a player. A held compass deflects it half the time, bouncing half its power back at the robot.
  private laserHit(m: Mob, target: Player, damage: number) {
    // Full tungsten armour shrugs off robot lasers (the Titan's too)
    if (this.fullSet(target, 'tungsten')) {
      if (this.clock - target.blockedToastAt > 5) { target.blockedToastAt = this.clock; target.conn.send({ t: 'toast', text: 'Your tungsten armour blocked the laser!' }); }
      return;
    }
    if (this.holding(target, 'compass') && Math.random() < 0.5) {
      const t = target.body.pos;
      const msg: ServerMsg = { t: 'beam', a: [t.x, t.y + 1.2, t.z], b: [m.body.pos.x, m.body.pos.y + m.body.height * 0.6, m.body.pos.z], pet: true };
      for (const o of this.players.values()) if (Math.abs(o.body.pos.x - t.x) < VIEW_DIST && Math.abs(o.body.pos.z - t.z) < VIEW_DIST) o.conn.send(msg);
      m.hurt = 0;
      this.damageMob(m, Math.ceil(damage / 2), t);
      target.conn.send({ t: 'toast', text: 'Deflected!' });
      return;
    }
    this.damagePlayer(target, damage, m.body.pos, m.kind);
  }

  // Laser cannon (held, or in the offhand): 3 hearts to the first mob or player along the aim, up to 24 blocks
  private onFire(p: Player, m: { dx: number; dy: number; dz: number }) {
    if (p.dead || p.downed || p.fireCd > 0 || !this.holding(p, 'laser_cannon') || ![m.dx, m.dy, m.dz].every(isNum)) return;
    const len = Math.hypot(m.dx, m.dy, m.dz);
    if (len < 0.5 || len > 2) return;
    const dir = { x: m.dx / len, y: m.dy / len, z: m.dz / len };
    const eye = this.eye(p);
    p.fireCd = 1.2;
    p.swingUntil = this.clock + 0.25;
    const RANGE = 24;
    const wall = raycastBlocks(this.world.get, eye, dir, RANGE);
    let max = wall ? wall.dist : RANGE;
    let victim: Player | Mob | null = null;
    for (const e of [...this.mobs.values(), ...this.players.values()]) {
      if (e === p || (e.kind === 'player' && e.dead) || (e.kind !== 'player' && (e.dying >= 0 || e.owner))) continue;
      const b = e.body;
      const d = rayHitsBox(eye, dir, { x: b.pos.x - b.halfW, y: b.pos.y, z: b.pos.z - b.halfW }, { x: b.pos.x + b.halfW, y: b.pos.y + b.height, z: b.pos.z + b.halfW }, max);
      if (d !== null && d < max) { max = d; victim = e; }
    }
    const end = { x: eye.x + dir.x * max, y: eye.y + dir.y * max, z: eye.z + dir.z * max };
    const msg: ServerMsg = { t: 'beam', a: [eye.x, eye.y - 0.2, eye.z], b: [end.x, end.y, end.z], pet: true };
    for (const o of this.players.values()) if (Math.abs(o.body.pos.x - eye.x) < VIEW_DIST && Math.abs(o.body.pos.z - eye.z) < VIEW_DIST) o.conn.send(msg);
    if (!victim) return;
    if (victim.kind === 'player') this.damagePlayer(victim, 6, p.body.pos, 'player', p.name);
    else { victim.hurt = 0; this.damageMob(victim, 6, p.body.pos); if (victim.dying >= 0 && MOB_SPECS[victim.kind].hostile) this.achieve(p, 'monster'); }
  }

  // Right-click oil holding a jetpack: a third of a tank each time
  private onRefuel(p: Player, m: { x: number; y: number; z: number }) {
    const { x, y, z } = m;
    if (p.dead || ![x, y, z].every(isInt) || p.inv.slots[p.inv.selected]?.type !== 'jetpack') return;
    if (!this.inReach(p, x, y, z, REACH) || this.world.get(x, y, z) !== OIL) return;
    if (p.fireCd > 0) return; // (shares the cannon's cooldown: one fill per click)
    p.fireCd = 0.3;
    p.jetFuel = Math.min(1, Math.round((p.jetFuel + 1 / 3) * 3) / 3);
    p.conn.send({ t: 'fuel', f: p.jetFuel });
    p.conn.send({ t: 'toast', text: p.jetFuel >= 1 ? 'Jetpack full!' : `Jetpack fuel ${Math.round(p.jetFuel * 3)}/3` });
    p.swingUntil = this.clock + 0.25;
  }

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
    this.achieve(p, 'tame');
    m.attackCd = 1;
    this.refreshMob(m);
    say(`You tamed a robot! It will follow you and defend you. Press G (or type /robots) to give it orders. (${have + 1}/${MAX_PETS})`);
    m.order = 'follow';
    this.sendSquad(p);
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
    const msg: ServerMsg = { t: 'beam', a: [b.pos.x, b.pos.y + b.height * 0.8, b.pos.z], b: [to.x, to.y, to.z], pet: !!m.owner };
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

  // A tamed robot, by its order. follow: stays near its owner. guard: keeps watch at its post.
  // collect: fetches dropped items and brings them to its owner. All of them laser hostile mobs that come close.
  private updatePet(m: Mob, owner: Player) {
    const b = m.body;
    const order = m.order === 'guard' && m.guard ? 'guard' : m.order === 'collect' ? 'collect' : 'follow';
    const dOwner = Math.hypot(owner.body.pos.x - b.pos.x, owner.body.pos.z - b.pos.z);
    const face = (x: number, z: number) => { m.targetYaw = Math.atan2(-(x - b.pos.x), -(z - b.pos.z)); };
    if (order !== 'guard' && (dOwner > 24 || Math.abs(owner.body.pos.y - b.pos.y) > 12)) { this.bringPet(m, owner); return; }
    // Where it keeps watch from: its post, or its owner
    const home = order === 'guard' ? { x: m.guard![0], y: m.guard![1], z: m.guard![2] } : owner.body.pos;
    if (order === 'guard' && (Math.hypot(home.x - b.pos.x, home.z - b.pos.z) > 32 || Math.abs(home.y - b.pos.y) > 12)) {
      b.pos.x = home.x; b.pos.y = home.y; b.pos.z = home.z; b.vel.x = b.vel.y = b.vel.z = 0; // knocked far off its post
      return;
    }
    let foe: Mob | null = null, fd = Infinity;
    for (const o of this.mobs.values()) {
      if (o === m || o.owner || o.dying >= 0 || !MOB_SPECS[o.kind].hostile || o.kind === 'hurricane') continue;
      const d = Math.hypot(o.body.pos.x - b.pos.x, o.body.pos.z - b.pos.z);
      if (d < 14 && d < fd && Math.abs(o.body.pos.y - b.pos.y) < 8 && Math.hypot(o.body.pos.x - home.x, o.body.pos.z - home.z) < 18) { fd = d; foe = o; }
    }
    if (foe) {
      face(foe.body.pos.x, foe.body.pos.z);
      m.moving = fd > 7;
      if (m.attackCd <= 0 && this.canSeeMob(b, foe.body)) {
        this.beam(m, { x: foe.body.pos.x, y: foe.body.pos.y + foe.body.height * 0.5, z: foe.body.pos.z });
        this.damageMob(foe, 6, b.pos);
        m.attackCd = 1.6;
      }
      return;
    }
    if (m.hold?.length && dOwner < 2.5) this.deliverHold(m, owner);
    if (order === 'collect') {
      const it = (m.hold?.length ?? 0) < MAX_HOLD ? this.lootFor(m, owner) : null;
      if (it) {
        const d = Math.hypot(it.body.pos.x - b.pos.x, it.body.pos.z - b.pos.z);
        face(it.body.pos.x, it.body.pos.z);
        m.moving = d > 0.5;
        if (d < 1.3) this.robotPickUp(m, it);
        return;
      }
      if (m.hold?.length) { face(owner.body.pos.x, owner.body.pos.z); m.moving = dOwner > 1.8; return; }
    }
    if (order === 'guard') {
      const d = Math.hypot(home.x - b.pos.x, home.z - b.pos.z);
      m.moving = d > 1;
      if (m.moving) face(home.x, home.z);
      return;
    }
    face(owner.body.pos.x, owner.body.pos.z);
    m.moving = dOwner > 4;
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

  // A full set (helmet, chestplate, leggings, boots) of one material; the obitite jetpack counts as an obitite chestplate
  private fullSet(p: Player, tier: 'tungsten' | 'obitite') {
    for (let i = 55; i <= 58; i++) {
      const t = p.inv.slots[i]?.type || '';
      if (!t.startsWith(`${tier}_`) && !(tier === 'obitite' && t === 'jetpack')) return false;
    }
    return true;
  }

  private etheritePieces(p: Player) {
    let n = 0;
    for (let i = 55; i <= 58; i++) if (/^(etherite|tungsten|obitite)_|^jetpack$/.test(p.inv.slots[i]?.type || '')) n++; // etherite and up (and the obitite jetpack)
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

  damagePlayer(p: Player, amount: number, from: { x: number; y: number; z: number } | null, cause: string, by?: string, knock = 7, lift?: number) {
    if (p.dead || p.invuln > 0 || amount <= 0) return;
    if (cause === 'player' && by && this.sameTeam(p.name, by)) return; // no friendly fire
    if (p.gamemode === 'creative' && cause !== 'void') return;
    // Lava, fire and magma can't hurt you in full obitite armour, or wearing the lava chestplate
    if ((cause === 'lava' || cause === 'fire' || cause === 'magma') && this.fireproof(p)) return;
    if (p.downed) { this.killPlayer(p, cause, by); return; }
    let dmg = amount;
    if (MOB_CAUSES.has(cause)) dmg *= this.difficulty === 'easy' ? 0.5 : this.difficulty === 'hard' ? 1.5 : 1;
    if (!['fall', 'lava', 'void', 'starve', 'freeze', 'poison', 'fire', 'drown', 'magma', 'rapture', 'starfall'].includes(cause)) {
      dmg *= 1 - Math.min(20, armorPoints(p.inv)) * 0.04;
      // Beyond the armour cap, each tungsten piece takes off 2% more and each obitite piece 4%
      let tough = 0;
      for (let i = 55; i <= 58; i++) { const t = p.inv.slots[i]?.type || ''; tough += t.startsWith('obitite_') ? 0.04 : t.startsWith('tungsten_') ? 0.02 : 0; }
      dmg *= 1 - tough;
    }
    p.exhaustion += 0.1;
    dmg = Math.max(1, Math.round(dmg));
    p.health = Math.max(0, p.health - dmg);
    p.invuln = 0.5;
    p.sinceDamage = 0;
    if (cause !== 'starve') p.foodT = 0; // healing restarts its timer after a hit (no instant heal-back)
    p.conn.send({ t: 'health', hp: p.health });
    p.conn.send({ t: 'hurt', from: from ? [from.x, from.y, from.z] : null, knock: from ? knock : 0, lift });
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
    if (cause !== 'void') p.lastDeath = [x, y, z]; // a moonstone orb can bring you back here
    this.getOut(p); // (the boat or minecart is dropped with everything else)
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
      skeleton: 'was shot by a Skeleton', slime: 'was squashed by a Slime', slimelet: 'was squashed by a Slime', robot: 'was zapped by a Robot', robot_titan: 'was destroyed by the Robot Titan',
      frost_wraith: 'was frozen solid by the Frost Wraith', magma_colossus: 'was crushed by the Magma Colossus', elemental_core: 'was overwhelmed by the Elemental Core',
      rapture: "was wrapped in the Tempest's wings and obliterated", starfall: 'was struck by a falling star',
      lightning: 'was struck by lightning',
      thorn_guardian: 'was strangled by the Thorn Guardian', tempest: 'was struck down by the Tempest',
      poison: 'died of poison', fire: 'burned to death', drown: 'drowned', magma: 'discovered the floor was lava',
      cactus: 'was pricked to death', void: 'fell out of the world', starve: 'starved to death', freeze: 'froze to death', player: `was slain by ${by || 'a player'}`, kill: 'died',
    };
    const msg = messages[cause] || 'died';
    p.conn.send({ t: 'death', msg: `You ${msg.replace(/^was /, 'were ')}` });
    this.broadcast({ t: 'chat', from: null, text: `${p.name} ${msg}` });
  }

  private damageMob(m: Mob, amount: number, from: { x: number; y: number; z: number }, knock = 1) {
    if (m.dying >= 0 || m.hurt > 0.35 || m.kind === 'hurricane') return; // (a hurricane can't be hurt)
    if ((m.transformT ?? 0) > 0) return; // (nor the Tempest while it transforms)
    m.health -= amount;
    m.hurt = 0.5;
    const dx = m.body.pos.x - from.x, dz = m.body.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    const kb = (BOSS_NAMES[m.kind] ? 0.15 : 1) * knock;
    m.body.vel.x = (dx / d) * 6 * kb; m.body.vel.z = (dz / d) * 6 * kb; m.body.vel.y = 5 * kb;
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
      if (it.shot) { this.updateShot(it, dt); continue; }
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

    if (isElemental(p.body.pos.x)) {
      // The Elemental World: each biome's monsters roam at any hour
      if (hostile >= 6 * cap) return;
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 24;
      const x = Math.floor(p.body.pos.x + Math.cos(a) * r), z = Math.floor(p.body.pos.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z) || !isElemental(x)) return;
      const top = w.surfaceHeight(x, z);
      if (!isSolid(w.get(x, top, z))) return;
      const biome = elementalBiome(x, z, w.seed), roll = Math.random();
      const kind: MobKind = biome === 'volcano' ? (roll < 0.6 ? 'husk' : 'skeleton') : biome === 'jungle' ? (roll < 0.5 ? 'spider' : roll < 0.8 ? 'zombie' : 'slime')
        : biome === 'clouds' ? 'skeleton' : roll < 0.75 ? 'frostbitten' : 'skeleton';
      if (!boxIntersectsSolid(w.get, x + 0.5, top + 1, z + 0.5, MOB_SPECS[kind].halfW, MOB_SPECS[kind].height)) this.spawnMob(kind, x + 0.5, top + 1, z + 0.5);
      return;
    }
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
      const day = isRobotic(b.pos.x) ? ROBO_DAYLIGHT : isElemental(b.pos.x) ? ELEM_DAYLIGHT : dayNow;
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
          if (m.altar) this.titanDefeated(m);
          if (m.hold?.length) for (const st of m.hold) if (st) this.spawnItem(st.type, st.count, b.pos.x, b.pos.y + 0.5, b.pos.z, undefined, 0.5, true);
          if (m.kind === 'slime') for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) this.spawnMob('slimelet', b.pos.x + (Math.random() - 0.5), b.pos.y + 0.2, b.pos.z + (Math.random() - 0.5));
          this.mobs.delete(m.eid);
        }
        continue;
      }
      m.hurt = Math.max(0, m.hurt - dt);
      m.flee = Math.max(0, m.flee - dt);
      m.attackCd = Math.max(0, m.attackCd - dt);

      let speed = spec.speed * (m.kind === 'robot_titan' && (m.phaseT ?? 0) % 14 > 10 ? 1.8 : 1);
      if ((m.slowT ?? 0) > 0) { m.slowT! -= dt; speed *= 0.4; } // chilled
      // Poisoned or burning: a little damage every second
      if ((m.poisonT ?? 0) > 0 || (m.fireT ?? 0) > 0) {
        m.poisonT = Math.max(0, (m.poisonT ?? 0) - dt); m.fireT = Math.max(0, (m.fireT ?? 0) - dt);
        m.effectT = (m.effectT ?? 0) - dt;
        if (m.effectT <= 0) { m.effectT = 1; m.hurt = 0; this.damageMob(m, 1, { x: b.pos.x, y: b.pos.y, z: b.pos.z }, 0); }
      }
      const dxp = target ? target.body.pos.x - b.pos.x : 0, dzp = target ? target.body.pos.z - b.pos.z : 0;
      // Spiders only hunt in the dark (or when attacked)
      const calm = m.kind === 'spider' && day > 0.6 && m.flee <= 0 && b.pos.y > this.world.surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z)) - 2;
      const chasing = spec.hostile && !owner && !calm && target && distP < 18 && Math.abs(target.body.pos.y - b.pos.y) < 8;
      if (owner) this.updatePet(m, owner);
      else if (m.kind === 'robot_titan') this.updateTitan(m, target, distP, dt);
      else if (m.kind === 'frost_wraith' || m.kind === 'magma_colossus' || m.kind === 'thorn_guardian' || m.kind === 'tempest') this.updateElementalBoss(m, target, distP, dt);
      else if (m.kind === 'hurricane') this.updateHurricane(m, target, distP, dt);
      else if (m.kind === 'elemental_core') this.updateCore(m, target, distP, dt);
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
          if (hit) this.laserHit(m, target, 6);
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
          if (m.kind === 'frostbitten' && this.difficulty !== 'easy' && !this.holding(target, 'frost_heart')) target.freezeT = Math.max(target.freezeT, 4);
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
      const floats = FLOAT_HEIGHT[m.kind] !== undefined;
      if (floats) {
        // The Roc flies above whoever it's after (sky islands would otherwise lift it far out of reach); the Wraith hugs the ground
        let ground = m.kind === 'tempest' && target && distP < 40 ? target.body.pos.y : this.world.surfaceHeight(Math.floor(b.pos.x), Math.floor(b.pos.z));
        let want = ground + FLOAT_HEIGHT[m.kind]!;
        if ((m.perchT ?? 0) > 0) {
          // Perched: down onto whatever is right below it (not the top of a sky island overhead)
          ground = b.pos.y;
          for (let y = Math.floor(b.pos.y); y > Math.floor(b.pos.y) - 40; y--) if (isSolid(this.world.get(Math.floor(b.pos.x), y - 1, Math.floor(b.pos.z)))) { ground = y; break; }
          want = ground;
        }
        b.vel.y = Math.max(-4, Math.min(4, (want - b.pos.y) * 3));
      }
      else if (b.inWater || b.inLava) { b.vel.y = Math.min(b.vel.y + 14 * dt, 2); b.vel.x *= 0.9; b.vel.z *= 0.9; }
      else b.vel.y = Math.max(b.vel.y - 30 * dt, -50);
      moveBody(this.world.get, b, dt);
      if (b.hitWall && b.onGround && m.moving && !floats) b.vel.y = 8.5; // hop single-block steps
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

    for (const p of this.players.values()) {
      if (p.awayAt >= 0 && this.clock - p.awayAt > SEAT_HOLD) { this.leave(p); continue; }
      this.updatePlayer(p, dt);
    }
    if (this.tickCount % 5 === 0) for (const p of this.players.values()) this.streamEdits(p);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 1; this.trySpawnMobs(day); this.growCrops(); this.wakeTitans(); this.wakeWraiths(); }
    if (this.tickCount % 10 === 0) this.announceClaims();
    this.updateWeather(dt);
    if (this.tickCount % 4 === 0) this.sendBossBars();
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
    const creative = p.gamemode === 'creative'; // flying: up to 32 blocks/s (the client's sprint-flying speed), with room for lag
    p.moveBudget = p.downed ? Math.min(1.5, p.moveBudget + 2.5 * dt)                         // downed: a crawl
      : Math.min(creative ? 10 : 3, p.moveBudget + (creative ? 38 : 11) * dt);                 // ~11 blocks/s sustained, small burst
    p.climbBudget = Math.min(creative ? 8 : 3, p.climbBudget + (creative ? 24 : 13) * dt);
    p.dropCredit = Math.min(8, p.dropCredit + 4 * dt);     // item drops per second
    p.chatCredit = Math.min(5, p.chatCredit + 1 * dt);     // chat lines per second
    p.invuln = Math.max(0, p.invuln - dt);
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
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
    p.slowT = Math.max(0, p.slowT - dt);
    this.updateEffects(p, dt);
    if (p.dead) return;
    // Stepping into an Elemental World portal
    const inPortal = boxTouchesBlock(w, b, ELEM_PORTAL, -0.05);
    if (inPortal && !p.inElemPortal) this.elementalTravel(p);
    else p.inElemPortal = inPortal;
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
    if (this.difficulty !== 'easy' && boxTouchesBlock(w, b, POWDER_SNOW, -0.01) && !this.holding(p, 'frost_heart')) {
      p.freezeT += dt;
      if (p.freezeT > 5) { p.freezeT = 3; p.invuln = 0; this.damagePlayer(p, 1, null, 'freeze'); }
    } else p.freezeT = Math.max(0, p.freezeT - dt * 2);
    if (p.dead) return;
    if (this.difficulty === 'easy') {
      if (p.health < this.maxHp(p) && p.sinceDamage > 4) {
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
    if (p.food >= 18 && p.health < this.maxHp(p)) {
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
          if ((e.kind === 'robot_titan' && (e.phaseT ?? 0) % 14 > 10) || e.phase2) flags |= EF_ANGRY; // (an Elemental boss in phase two)
          if ((e.perchT ?? 0) > 0) flags |= EF_SNEAK; // (the Tempest perched: its wings fold)
          // (the Elemental Core: its current element, in two bits the other mobs don't use)
          if (e.kind === 'elemental_core') flags |= ((e.elem ?? 0) & 1 ? EF_SNEAK : 0) | ((e.elem ?? 0) & 2 ? EF_DOWNED : 0);
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
  private sendInv(p: Player) {
    p.conn.send({ t: 'inv', inv: this.invState(p) });
    for (const s of p.inv.slots) { const a = s && itemAchievement(s.type); if (a) this.achieve(p, a); }
    if (p.inv.cursor) { const a = itemAchievement(p.inv.cursor.type); if (a) this.achieve(p, a); }
  }

  // Unlocks an achievement (once) and tells the player
  private achieve(p: Player, id: string) {
    if (p.achievements.has(id) || !ACHIEVEMENT_IDS.has(id)) return;
    p.achievements.add(id);
    p.conn.send({ t: 'achievements', ids: [...p.achievements], unlocked: id });
  }
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
    return { held: p.inv.slots[p.inv.selected]?.type || '', armor: p.inv.slots.slice(55, 60).map(s => s?.type || null), ride: p.ride, team: this.teams.get(p.name.toLowerCase()) ?? null };
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
    this.broadcast({ t: 'players', list: [...this.players.values()].map(p => ({ eid: p.eid, name: p.name, ping: p.ping, away: p.awayAt >= 0 || undefined, team: this.teams.get(p.name.toLowerCase()) })) });
  }
  broadcast(msg: ServerMsg) {
    for (const p of this.players.values()) p.conn.send(msg);
  }
  setPing(p: Player, ms: number) { p.ping = Math.round(ms); }

  // ---------------------------------------------------------------- Saving

  private savePlayer(p: Player) {
    const inv = { slots: p.inv.slots.map(s => (s ? { ...s } : null)), cursor: null, selected: p.inv.selected };
    if (p.inv.cursor) addItem({ ...p.inv, slots: inv.slots }, p.inv.cursor.type, p.inv.cursor.count);
    if (p.ride) addItem({ ...p.inv, slots: inv.slots }, p.ride === 'boat' ? 'boat' : 'minecart', 1); // (riding one: it's still yours)
    const b = p.body.pos;
    const live = {
      health: p.dead ? MAX_HEALTH : p.health, food: p.dead ? MAX_FOOD : p.food, saturation: p.dead ? 5 : p.sat, inv,
    };
    this.storage.savePlayer(p.name, {
      x: b.x, y: b.y, z: b.z, yaw: p.yaw, pitch: p.pitch, gamemode: p.gamemode,
      ...(p.home || live), // a carried character goes back to its save; this server keeps its own
      spawn: p.spawn, homes: p.homes, token: p.token || undefined, cheated: p.cheated || undefined,
      pets: this.pets(p).filter(m => m.dying < 0).map(m => ({ hp: Math.round(m.health), order: m.order, guard: m.guard, hold: m.hold?.length ? m.hold : undefined })),
      death: p.lastDeath ?? undefined,
      jetFuel: p.jetFuel || undefined,
      achievements: [...p.achievements],
    });
  }

  worldSave(): WorldSave {
    return {
      v: 1, seed: this.world.seed, time: this.time, edits: this.world.exportEdits(), facing: this.world.exportFacing(),
      furnaces: Object.fromEntries(this.furnaces), spawn: this.spawnPoint, difficulty: this.difficulty, chests: Object.fromEntries(this.chests),
      crops: Object.fromEntries([...this.crops].map(([k, due]) => [k, Math.max(0, Math.round(due - this.clock))])),
      titans: Object.fromEntries([...this.titanWakes].filter(([, t]) => t > this.clock).map(([k, t]) => [k, Math.round(t - this.clock)])),
      claims: Object.fromEntries(this.claims),
      teams: Object.fromEntries(this.teams),
      weather: this.weather,
      trust: Object.fromEntries([...this.trust].filter(([, set]) => set.size).map(([o, set]) => [o, [...set]])),
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
