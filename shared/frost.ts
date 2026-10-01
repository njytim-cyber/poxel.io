// The Frost World: a secret dimension. Its portal is an upright frame of moonstone blocks around a 2-wide,
// 3-tall hole; fill the hole with robot eyes and they turn into a glowing blue portal you walk into.
// Like the Robotic World it is a far-off strip of the same world (FROST_MIN_X <= x < FROST_MAX_X), walled
// off with bedrock: glacier plains and ice spikes over permafrost, frozen lakes, ice caves, glacite ore,
// ice ruins with loot, and shrines where the Frost Wraith wakes. Pure functions of the seed.
import { BLOCK_ID, WATER } from './blocks.ts';
import { Noise, hash3 } from './noise.ts';
import { CHUNK, CHUNK_VOLUME, MIN_Y, MAX_Y, idx } from './worldgen.ts';

export const FROST_MIN_X = -130000; // chunk aligned
export const FROST_MAX_X = -70000;
export const FROST_OFFSET = -100000; // a portal at x leads to x + FROST_OFFSET there (and back)
export const ICE_LEVEL = 4;          // low ground holds frozen lakes up to here
export const FROST_DAYLIGHT = 0.3;   // a long polar twilight: frostbitten roam at any hour
const WALL = 2;

export const isFrost = (x: number) => x >= FROST_MIN_X && x < FROST_MAX_X;

export function frostDestination(x: number, z: number): { x: number; z: number } {
  if (isFrost(x)) return { x: Math.floor(x) - FROST_OFFSET, z: Math.floor(z) };
  return { x: Math.max(FROST_MIN_X + 64, Math.min(FROST_MAX_X - 64, Math.floor(x) + FROST_OFFSET)), z: Math.floor(z) };
}

// ------------------------------------------------------------------ The portal

export interface FrostPortal { x: number; y: number; z: number; axis: 'x' | 'z' } // x,y,z: the hole's bottom-left cell

type Get = (x: number, y: number, z: number) => number;
const isFrame = (id: number) => id === BLOCK_ID.moonstone_block || id === BLOCK_ID.frost_frame;

// The 6 cells of a portal's hole
export function portalCells(p: FrostPortal): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) out.push(p.axis === 'x' ? [p.x + i, p.y + j, p.z] : [p.x, p.y + j, p.z + i]);
  return out;
}

// Is there a complete frame around a hole whose cells all hold `fill`, with (x, y, z) one of the cells?
// The corners are optional, as in any good portal.
export function findFrostPortal(get: Get, x: number, y: number, z: number, fill: number): FrostPortal | null {
  for (const axis of ['x', 'z'] as const) for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const p: FrostPortal = axis === 'x' ? { x: x - i, y: y - j, z, axis } : { x, y: y - j, z: z - i, axis };
    if (portalCells(p).every(([a, b, c]) => get(a, b, c) === fill) && frameComplete(get, p)) return p;
  }
  return null;
}

function frameComplete(get: Get, p: FrostPortal): boolean {
  const at = (i: number, j: number) => (p.axis === 'x' ? get(p.x + i, p.y + j, p.z) : get(p.x, p.y + j, p.z + i));
  for (let i = 0; i < 2; i++) if (!isFrame(at(i, -1)) || !isFrame(at(i, 3))) return false;
  for (let j = 0; j < 3; j++) if (!isFrame(at(-1, j)) || !isFrame(at(2, j))) return false;
  return true;
}

// ------------------------------------------------------------------ Terrain

interface FrostNoise { seed: number; a: Noise; b: Noise; c: Noise }
let noise: FrostNoise | null = null;
function N(seed: number): FrostNoise {
  if (!noise || noise.seed !== seed) noise = { seed, a: new Noise(seed + 80), b: new Noise(seed + 81), c: new Noise(seed + 82) };
  return noise;
}

export function frostHeight(x: number, z: number, seed: number): number {
  const { a, b } = N(seed);
  const base = 7 + a.fbm2(x / 100, z / 100, 4) * 14;
  const ridge = Math.max(0, b.fbm2(x / 180 + 30, z / 180 - 30, 3) - 0.15) * 70; // glacier ridges
  return Math.floor(base + Math.min(ridge, 30));
}

// An ice spike rising from this column, if any: [radius, height]
function spikeAt(x: number, z: number, seed: number): [number, number] | null {
  const cx = Math.floor(x / 24), cz = Math.floor(z / 24);
  if (hash3(cx, 171, cz, seed) > 0.35) return null;
  const sx = cx * 24 + 4 + Math.floor(hash3(cx, 172, cz, seed) * 16), sz = cz * 24 + 4 + Math.floor(hash3(cx, 173, cz, seed) * 16);
  const r = 1 + Math.floor(hash3(cx, 174, cz, seed) * 2), h = 8 + Math.floor(hash3(cx, 175, cz, seed) * 16);
  const d = Math.hypot(x - sx, z - sz);
  if (d > r + 0.5) return null;
  return [r, Math.floor(h * (1 - d / (r + 1.5)))]; // tapers to a point
}

export function generateFrostChunk(cx: number, cz: number, seed: number): Uint8Array {
  const B = BLOCK_ID;
  const { c: caves } = N(seed);
  const d = new Uint8Array(CHUNK_VOLUME);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    const x = x0 + lx, z = z0 + lz;
    if (x < FROST_MIN_X + WALL || x >= FROST_MAX_X - WALL) {
      for (let y = MIN_Y; y <= MAX_Y; y++) d[idx(lx, y, lz)] = B.bedrock;
      continue;
    }
    const h = Math.min(frostHeight(x, z, seed), MAX_Y - 40);
    const lake = h < ICE_LEVEL;
    for (let y = MIN_Y; y <= Math.max(h, ICE_LEVEL); y++) {
      const depth = h - y;
      let id: number;
      if (y <= MIN_Y + 4) id = B.bedrock;
      else if (y > h) id = y === ICE_LEVEL ? (hash3(x >> 2, 1, z >> 2, seed + 90) < 0.3 ? B.blue_ice : B.ice) : WATER; // frozen lakes
      else if (depth === 0) id = lake ? B.packed_ice : hash3(x >> 2, 2, z >> 2, seed + 91) < 0.12 ? B.packed_ice : B.snow_block;
      else if (depth <= 3) id = lake ? B.packed_ice : B.snow_block;
      else {
        id = B.permafrost;
        if (hash3(x, y, z, seed + 92) < 0.7) {
          const vx = x >> 1, vy = y >> 1, vz = z >> 1;
          if (y < h - 10 && y < -20 && hash3(vx, vy, vz, seed + 93) < 0.02) id = B.glacite_ore;
          else if (y < h - 5 && hash3(vx, vy, vz, seed + 94) < 0.045) id = B.frost_crystal_ore;
          else if (y < h - 5 && hash3(vx, vy, vz, seed + 95) < 0.04) id = B.coal_ore;
          else if (y < h - 8 && hash3(vx, vy, vz, seed + 96) < 0.03) id = B.iron_ore;
          else if (y < -50 && hash3(vx, vy, vz, seed + 97) < 0.012) id = B.diamond_ore;
        }
      }
      // Ice caves: tunnels whose walls are glassy ice
      if (y > MIN_Y + 6 && y < h - 6 && id !== B.bedrock) {
        const n = Math.abs(caves.noise3(x / 32, y / 20, z / 32));
        if (n < 0.06) id = 0;
        else if (n < 0.085 && id === B.permafrost) id = hash3(x, y, z, seed + 98) < 0.5 ? B.packed_ice : B.blue_ice;
      }
      d[idx(lx, y, lz)] = id;
    }
    if (lake) continue;
    // Ice spikes, and frost ferns and snowberries on the snow
    const spike = spikeAt(x, z, seed);
    if (spike) { for (let k = 1; k <= spike[1] && h + k <= MAX_Y; k++) d[idx(lx, h + k, lz)] = B.packed_ice; continue; }
    const r = hash3(x, 3, z, seed + 99);
    if (d[idx(lx, h, lz)] === B.snow_block && h + 1 <= MAX_Y) {
      if (r < 0.03) d[idx(lx, h + 1, lz)] = B.frost_fern;
      else if (r < 0.036) d[idx(lx, h + 1, lz)] = B.snowberry_bush;
    }
  }
  placeRuins(d, cx, cz, seed);
  placeShrines(d, cx, cz, seed);
  return d;
}

// ------------------------------------------------------------------ Shrines (where the Frost Wraith wakes)

const SHRINE_GRID = 256;
const SHRINE_R = 5;

export interface Shrine { x: number; y: number; z: number; key: string }
function shrineInCell(ax: number, az: number, seed: number): Shrine | null {
  const x = ax * SHRINE_GRID + 40 + Math.floor(hash3(ax, 181, az, seed) * (SHRINE_GRID - 80));
  const z = az * SHRINE_GRID + 40 + Math.floor(hash3(ax, 182, az, seed) * (SHRINE_GRID - 80));
  if (x < FROST_MIN_X + WALL + 20 || x >= FROST_MAX_X - WALL - 20) return null;
  const y = Math.max(Math.min(frostHeight(x, z, seed), MAX_Y - 40), ICE_LEVEL) + 1;
  return { x, y, z, key: `f${ax},${az}` };
}
export function nearestShrine(x: number, z: number, seed: number): Shrine | null {
  const cx = Math.floor(x / SHRINE_GRID), cz = Math.floor(z / SHRINE_GRID);
  let best: Shrine | null = null, bd = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const s = shrineInCell(cx + dx, cz + dz, seed);
    if (!s) continue;
    const dd = Math.hypot(s.x - x, s.z - z);
    if (dd < bd) { bd = dd; best = s; }
  }
  return best;
}

function placeShrines(d: Uint8Array, cx: number, cz: number, seed: number) {
  const B = BLOCK_ID;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const s = nearestShrine(x0 + 8, z0 + 8, seed);
  if (!s || s.x + SHRINE_R + 1 < x0 || s.x - SHRINE_R - 1 > x0 + 15 || s.z + SHRINE_R + 1 < z0 || s.z - SHRINE_R - 1 > z0 + 15) return;
  const put = (x: number, y: number, z: number, id: number) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    d[idx(lx, y, lz)] = id;
  };
  // A round floor of blue ice, cleared above (the Wraith floats), with a ring of ice pillars
  for (let i = -SHRINE_R; i <= SHRINE_R; i++) for (let k = -SHRINE_R; k <= SHRINE_R; k++) {
    if (Math.hypot(i, k) > SHRINE_R + 0.5) continue;
    for (let j = -4; j <= -1; j++) put(s.x + i, s.y + j, s.z + k, j === -1 ? B.blue_ice : B.packed_ice);
    for (let j = 0; j <= 8; j++) put(s.x + i, s.y + j, s.z + k, 0);
  }
  for (let a = 0; a < 6; a++) {
    const i = Math.round(Math.cos(a * Math.PI / 3) * 4), k = Math.round(Math.sin(a * Math.PI / 3) * 4);
    for (let j = 0; j <= 4; j++) put(s.x + i, s.y + j, s.z + k, j === 4 ? B.frost_crystal_ore : B.packed_ice);
  }
  put(s.x, s.y - 1, s.z, B.frost_shrine);
}

// ------------------------------------------------------------------ Ice ruins (loot)

const REGION = 40, REACH = 6;
export interface FrostRuin { x: number; y: number; z: number }
function ruinInRegion(rx: number, rz: number, seed: number): FrostRuin | null {
  if (hash3(rx, 161, rz, seed) > 0.3) return null;
  const x = rx * REGION + REACH + Math.floor(hash3(rx, 162, rz, seed) * (REGION - 2 * REACH));
  const z = rz * REGION + REACH + Math.floor(hash3(rx, 163, rz, seed) * (REGION - 2 * REACH));
  if (x < FROST_MIN_X + WALL + REACH || x >= FROST_MAX_X - WALL - REACH) return null;
  const h = frostHeight(x, z, seed);
  if (h < ICE_LEVEL + 1 || h > MAX_Y - 50 || spikeAt(x, z, seed)) return null;
  return { x, y: h, z };
}
export function frostRuinAt(x: number, z: number, seed: number): FrostRuin | null {
  const r = ruinInRegion(Math.floor(x / REGION), Math.floor(z / REGION), seed);
  return r && Math.abs(x - r.x) <= REACH && Math.abs(z - r.z) <= REACH ? r : null;
}

function placeRuins(d: Uint8Array, cx: number, cz: number, seed: number) {
  const B = BLOCK_ID;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    d[idx(lx, y, lz)] = id;
  };
  const r0x = Math.floor((x0 - REACH) / REGION), r1x = Math.floor((x0 + 15 + REACH) / REGION);
  const r0z = Math.floor((z0 - REACH) / REGION), r1z = Math.floor((z0 + 15 + REACH) / REGION);
  for (let rx = r0x; rx <= r1x; rx++) for (let rz = r0z; rz <= r1z; rz++) {
    const r = ruinInRegion(rx, rz, seed);
    if (!r || r.x + REACH < x0 || r.x - REACH > x0 + 15 || r.z + REACH < z0 || r.z - REACH > z0 + 15) continue;
    // A half-buried ice house: snow brick walls (some fallen), a packed ice floor, a lantern and a chest
    for (let i = -3; i <= 3; i++) for (let k = -3; k <= 3; k++) {
      put(r.x + i, r.y, r.z + k, B.packed_ice);
      for (let j = 1; j <= 4; j++) {
        const wall = Math.abs(i) === 3 || Math.abs(k) === 3;
        const keep = wall && hash3(r.x + i, r.y + j, r.z + k, seed + 164) < 1.1 - j * 0.2;
        put(r.x + i, r.y + j, r.z + k, keep ? B.snow_bricks : j === 4 && hash3(r.x + i, 0, r.z + k, seed + 165) < 0.4 ? B.packed_ice : 0);
      }
    }
    put(r.x, r.y + 1, r.z + 3, 0); put(r.x, r.y + 2, r.z + 3, 0);
    put(r.x + 1, r.y + 1, r.z - 2, B.chest);
    put(r.x - 2, r.y + 1, r.z - 2, B.lantern);
  }
}
