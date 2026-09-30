// The Robotic World: a dimension reached through a portal (a plus of etherite blocks around a gold
// block, right-clicked). It is a far-off strip of the same world (ROBO_MIN_X <= x < ROBO_MAX_X), so
// saving, chunk streaming and multiplayer work unchanged; bedrock walls keep it apart from the normal
// world. Scrap plains and mesas over rust rock, pools of oil, tungsten ore, the remains of giant robots,
// and ruins with loot. Pure functions of the seed (runs on the server and in the client's workers).
import { BLOCK_ID, OIL } from './blocks.ts';
import { Noise, hash3 } from './noise.ts';
import { CHUNK, CHUNK_VOLUME, MIN_Y, MAX_Y, idx } from './worldgen.ts';

export const ROBO_MIN_X = 70000;   // chunk aligned (x / 16 is whole)
export const ROBO_MAX_X = 130000;
export const ROBO_OFFSET = 100000; // a portal at x leads to x + ROBO_OFFSET there (and back)
export const OIL_LEVEL = 6;        // low ground floods with oil up to here
export const ROBO_DAYLIGHT = 0.3;  // always a smoggy dusk: robots are about all the time
const WALL = 2;                    // bedrock columns at each end

export const isRobotic = (x: number) => x >= ROBO_MIN_X && x < ROBO_MAX_X;

// Where a portal in one world leads in the other
export function portalDestination(x: number, z: number): { x: number; z: number } {
  if (isRobotic(x)) return { x: Math.floor(x) - ROBO_OFFSET, z: Math.floor(z) };
  const tx = Math.max(ROBO_MIN_X + 64, Math.min(ROBO_MAX_X - 64, Math.floor(x) + ROBO_OFFSET));
  return { x: tx, z: Math.floor(z) };
}

// A portal: a gold block (or a return portal's core) with etherite blocks (or frame) on all four sides
export function isPortal(get: (x: number, y: number, z: number) => number, x: number, y: number, z: number): boolean {
  const B = BLOCK_ID;
  const core = get(x, y, z);
  if (core !== B.gold_block && core !== B.portal_core) return false;
  const frame = (id: number) => id === B.etherite_block || id === B.portal_frame;
  return frame(get(x + 1, y, z)) && frame(get(x - 1, y, z)) && frame(get(x, y, z + 1)) && frame(get(x, y, z - 1));
}

// ------------------------------------------------------------------ Terrain

interface RoboNoise { seed: number; a: Noise; b: Noise }
let noise: RoboNoise | null = null;
function N(seed: number): RoboNoise {
  if (!noise || noise.seed !== seed) noise = { seed, a: new Noise(seed + 50), b: new Noise(seed + 51) };
  return noise;
}

export function roboticHeight(x: number, z: number, seed: number): number {
  const { a, b } = N(seed);
  const base = 9 + a.fbm2(x / 90, z / 90, 4) * 16;
  const mesa = Math.max(0, b.fbm2(x / 160 + 40, z / 160 - 40, 2) - 0.1) * 60; // flat-topped scrap mesas
  return Math.floor(base + Math.min(mesa, 16));
}

export function generateRoboticChunk(cx: number, cz: number, seed: number): Uint8Array {
  const B = BLOCK_ID;
  const d = new Uint8Array(CHUNK_VOLUME);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    const x = x0 + lx, z = z0 + lz;
    if (x < ROBO_MIN_X + WALL || x >= ROBO_MAX_X - WALL) {
      for (let y = MIN_Y; y <= MAX_Y; y++) d[idx(lx, y, lz)] = B.bedrock;
      continue;
    }
    const h = roboticHeight(x, z, seed);
    for (let y = MIN_Y; y <= Math.max(h, OIL_LEVEL); y++) {
      const depth = h - y;
      let id: number;
      if (y <= MIN_Y + 4) id = B.bedrock;
      else if (y > h) id = OIL;
      else if (depth === 0) id = h <= OIL_LEVEL ? B.rusty_metal : B.scrap_ground;
      else if (depth <= 2) id = hash3(x >> 1, y, z >> 1, seed + 60) < 0.5 ? B.rusty_metal : B.rust_rock;
      else {
        id = B.rust_rock;
        if (hash3(x, y, z, seed + 61) < 0.7) {
          const vx = x >> 1, vy = y >> 1, vz = z >> 1;
          if (y < h - 4 && hash3(vx, vy, vz, seed + 62) < 0.025) id = B.tungsten_ore;
          else if (y < h - 4 && hash3(vx, vy, vz, seed + 63) < 0.03) id = B.coal_ore;
          else if (y < h - 6 && hash3(vx, vy, vz, seed + 64) < 0.02) id = B.iron_ore;
        }
      }
      d[idx(lx, y, lz)] = id;
    }
    // Scrap lying about on dry ground
    if (h > OIL_LEVEL && h + 1 <= MAX_Y) {
      const r = hash3(x, 9, z, seed + 65);
      if (r < 0.006) d[idx(lx, h + 1, lz)] = B.rusty_metal;
      else if (r < 0.0075) d[idx(lx, h + 1, lz)] = B.metal_plate;
    }
  }
  placeRoboticStructures(d, cx, cz, seed);
  return d;
}

// ------------------------------------------------------------------ Structures

const REGION = 40;
const REACH = 10; // max distance of a structure's blocks from its origin

export type RoboticStructureKind = 'giant_robot' | 'ruin';
export interface RoboticStructure { kind: RoboticStructureKind; x: number; y: number; z: number; flip: boolean }

export function roboticStructureInRegion(rx: number, rz: number, seed: number): RoboticStructure | null {
  const r = hash3(rx, 131, rz, seed);
  if (r > 0.6) return null;
  const x = rx * REGION + REACH + Math.floor(hash3(rx, 132, rz, seed) * (REGION - 2 * REACH));
  const z = rz * REGION + REACH + Math.floor(hash3(rx, 133, rz, seed) * (REGION - 2 * REACH));
  if (x < ROBO_MIN_X + WALL + REACH || x >= ROBO_MAX_X - WALL - REACH) return null;
  const h = roboticHeight(x, z, seed);
  const flip = hash3(rx, 134, rz, seed) < 0.5;
  if (r < 0.3) return { kind: 'giant_robot', x, y: Math.max(h, OIL_LEVEL), z, flip };
  if (h > OIL_LEVEL) return { kind: 'ruin', x, y: h, z, flip };
  return null;
}

// The structure whose area holds this spot, if any (each sits inside its own region, REACH from the edges)
export function roboticStructureAt(x: number, z: number, seed: number): RoboticStructure | null {
  const s = roboticStructureInRegion(Math.floor(x / REGION), Math.floor(z / REGION), seed);
  return s && Math.abs(x - s.x) <= REACH && Math.abs(z - s.z) <= REACH ? s : null;
}

function placeRoboticStructures(d: Uint8Array, cx: number, cz: number, seed: number) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    d[idx(lx, y, lz)] = id;
  };
  const r0x = Math.floor((x0 - REACH) / REGION), r1x = Math.floor((x0 + 15 + REACH) / REGION);
  const r0z = Math.floor((z0 - REACH) / REGION), r1z = Math.floor((z0 + 15 + REACH) / REGION);
  for (let rx = r0x; rx <= r1x; rx++) for (let rz = r0z; rz <= r1z; rz++) {
    const s = roboticStructureInRegion(rx, rz, seed);
    if (!s || s.x + REACH < x0 || s.x - REACH > x0 + 15 || s.z + REACH < z0 || s.z - REACH > z0 + 15) continue;
    buildRoboticStructure(s, put, seed);
  }
}

function buildRoboticStructure(s: RoboticStructure, put: (x: number, y: number, z: number, id: number) => void, seed: number) {
  const B = BLOCK_ID;
  const { y } = s;
  // Mirror some along x so they don't all lie the same way
  const P = (i: number, j: number, k: number, id: number) => put(s.x + (s.flip ? -i : i), y + j, s.z + k, id);
  const rusty = (i: number, j: number, k: number) => hash3(s.x + i, y + j, s.z + k, seed + 70) < 0.35;
  const box = (ai: number, aj: number, ak: number, bi: number, bj: number, bk: number, id: number, weathered = false) => {
    for (let i = ai; i <= bi; i++) for (let j = aj; j <= bj; j++) for (let k = ak; k <= bk; k++) P(i, j, k, weathered && rusty(i, j, k) ? B.rusty_metal : id);
  };
  if (s.kind === 'giant_robot') {
    // A giant robot lying broken on its back, half sunk into the ground
    box(-2, -1, -3, 2, 2, 3, B.metal_plate, true);        // torso
    box(-1, 0, -1, 1, 1, 1, 0);                             // hollow chest...
    P(0, 0, 0, B.chest);                                    // ...with something inside
    box(-1, -1, 4, 1, 1, 6, B.metal_plate, true);         // head
    P(-1, 2, 5, B.robot_eye); P(1, 2, 5, B.robot_eye);      // eyes, staring at the sky
    box(3, 0, -2, 7, 1, -1, B.rusty_metal);                 // one arm flung out
    box(8, 0, -3, 9, 2, 0, B.metal_plate, true);           // its hand
    box(-6, -1, 1, -4, 0, 2, B.rusty_metal);                // the other arm, snapped off
    box(-2, -1, -9, -1, 0, -4, B.metal_plate, true);       // legs
    box(1, -1, -7, 2, 0, -4, B.metal_plate, true);
    box(1, -1, -9, 2, -1, -8, B.rusty_metal);               // a broken-off foot
  } else {
    // A ruin: broken walls (gaps where blocks fell), a floor, a lamp and a chest
    box(-3, 0, -3, 3, 0, 3, B.rust_rock);
    box(-3, 1, -3, 3, 4, 3, 0);
    for (let j = 1; j <= 4; j++) for (let i = -3; i <= 3; i++) for (const k of [-3, 3]) {
      for (const [a, b] of [[i, k], [k, i]]) {
        const keep = hash3(s.x + a, y + j, s.z + b, seed + 71) < 1.05 - j * 0.22; // taller = more fallen
        if (keep) P(a, j, b, hash3(s.x + a, y + j, s.z + b, seed + 72) < 0.5 ? B.rusty_metal : B.metal_plate);
      }
    }
    P(0, 1, 3, 0); P(0, 2, 3, 0);                           // doorway
    P(1, 1, -2, B.chest);
    P(-2, 1, -2, B.robot_eye);                              // an old lamp, still glowing
  }
}
