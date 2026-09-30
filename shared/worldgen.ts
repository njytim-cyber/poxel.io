// Pure world generation + chunk meshing. No DOM or three.js, so it runs inside Web Workers
// (keeping the main thread free for rendering, input and networking) and on the main thread as a fallback.
import { BLOCKS, BLOCK_ID, WATER, LAVA, OIL, isOccluding, isFacingBlock } from './blocks.ts';
import { Noise, hash3 } from './noise.ts';
import { isRobotic, roboticHeight, generateRoboticChunk } from './robotic.ts';

export const CHUNK = 16;
export const MIN_Y = -104;
export const HEIGHT = 176;
export const MAX_Y = MIN_Y + HEIGHT - 1;
export const SECTIONS = HEIGHT / 16;
export const SEA_LEVEL = 3;
export const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT;

const B = BLOCK_ID;
export const idx = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;
export const blocksSky = (id: number) => id !== 0 && id !== WATER && id !== B.glass && !BLOCKS[id].plant;

// ------------------------------------------------------------------ Noise per seed

interface Gen { seed: number; n: Noise; nb: Noise; nc: Noise }
let gen: Gen | null = null;
function G(seed: number): Gen {
  if (!gen || gen.seed !== seed) gen = { seed, n: new Noise(seed), nb: new Noise(seed + 1), nc: new Noise(seed + 2) };
  return gen;
}

// ------------------------------------------------------------------ Terrain

export type Biome = 'plains' | 'forest' | 'pine' | 'desert' | 'snowy' | 'mountains' | 'robotic';

export function columnInfo(x: number, z: number, seed: number): { h: number; biome: Biome } {
  if (isRobotic(x)) return { h: roboticHeight(x, z, seed), biome: 'robotic' };
  const { n, nb, nc } = G(seed);
  const temp = nb.fbm2(x / 300, z / 300, 2);
  const humid = nc.fbm2(x / 260 + 50, z / 260 + 50, 2);
  const mountain = n.fbm2(x / 220 + 300, z / 220 + 300, 3);
  const base = 8 + n.fbm2(x / 110, z / 110, 4) * 16;
  const lift = Math.max(0, mountain - 0.12) * 110;
  const h = Math.floor(base + lift);
  let biome: Biome;
  if (lift > 10) biome = 'mountains';
  else if (temp < -0.2) biome = 'snowy';
  else if (temp > 0.22 && humid < 0.05) biome = 'desert';
  else if (temp < 0.02 && humid > 0.0) biome = 'pine';
  else if (humid > 0.12) biome = 'forest';
  else biome = 'plains';
  return { h: Math.min(h, MAX_Y - 20), biome };
}

const CAVE_STEP = 4;

// Trilinear interpolation, split in two: the x/z part once per column at every grid height (column()),
// then a single lerp in y per block (sample()). Same result as interpolating each block from scratch.
function column(arr: Float32Array, out: Float64Array, c00: number, c10: number, c01: number, c11: number, tx: number, tz: number) {
  for (let iy = 0; iy < out.length; iy++) {
    const a = arr[c00 + iy] + (arr[c10 + iy] - arr[c00 + iy]) * tx, b = arr[c01 + iy] + (arr[c11 + iy] - arr[c01 + iy]) * tx;
    out[iy] = a + (b - a) * tz;
  }
}

export function generateChunkData(cx: number, cz: number, seed: number): Uint8Array {
  if (isRobotic(cx * CHUNK)) return generateRoboticChunk(cx, cz, seed);
  const { n: noise, nb: noiseB, nc: noiseC } = G(seed);
  const d = new Uint8Array(CHUNK_VOLUME);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  // Coarse cave noise grid, trilinearly interpolated per block (16x fewer noise calls)
  const gy = HEIGHT / CAVE_STEP + 1, gx = CHUNK / CAVE_STEP + 1;
  const tunnelA = new Float32Array(gx * gx * gy), tunnelB = new Float32Array(gx * gx * gy), cheese = new Float32Array(gx * gx * gy);
  const blobs = new Float32Array(gx * gx * gy); // granite/diorite/andesite pockets
  for (let ix = 0; ix < gx; ix++) for (let iz = 0; iz < gx; iz++) for (let iy = 0; iy < gy; iy++) {
    const wx = x0 + ix * CAVE_STEP, wz = z0 + iz * CAVE_STEP, wy = MIN_Y + iy * CAVE_STEP;
    const gi = (ix * gx + iz) * gy + iy;
    tunnelA[gi] = noiseB.noise3(wx / 28, wy / 18, wz / 28);
    tunnelB[gi] = noiseC.noise3(wx / 28 + 71, wy / 18, wz / 28 + 13);
    cheese[gi] = noise.noise3(wx / 52, wy / 30, wz / 52);
    blobs[gi] = noise.noise3(wx / 14 + 700, wy / 10, wz / 14 + 700);
  }
  const colA = new Float64Array(gy), colB = new Float64Array(gy), colC = new Float64Array(gy), colBlob = new Float64Array(gy);
  const sample = (col: Float64Array, y: number) => {
    const fy = (y - MIN_Y) / CAVE_STEP, iy = Math.min(gy - 2, fy | 0), ty = fy - iy;
    return col[iy] + (col[iy + 1] - col[iy]) * ty;
  };

  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    const x = x0 + lx, z = z0 + lz;
    // This column's cell in the coarse grid (the per-block lookups below only vary in y)
    const fx = lx / CAVE_STEP, fz = lz / CAVE_STEP;
    const ix = Math.min(gx - 2, fx | 0), iz = Math.min(gx - 2, fz | 0), tx = fx - ix, tz = fz - iz;
    const c00 = (ix * gx + iz) * gy, c10 = ((ix + 1) * gx + iz) * gy, c01 = (ix * gx + iz + 1) * gy, c11 = ((ix + 1) * gx + iz + 1) * gy;
    column(tunnelA, colA, c00, c10, c01, c11, tx, tz);
    column(tunnelB, colB, c00, c10, c01, c11, tx, tz);
    column(cheese, colC, c00, c10, c01, c11, tx, tz);
    column(blobs, colBlob, c00, c10, c01, c11, tx, tz);
    const { h, biome } = columnInfo(x, z, seed);
    const underwater = h < SEA_LEVEL;
    const beach = h <= SEA_LEVEL + 1 && biome !== 'snowy';
    // Powder snow: hidden drifts in snowy land that you sink into
    const powder = biome === 'snowy' && !underwater && noiseB.noise2(x / 9 + 400, z / 9 + 400) > 0.45;

    // Ravines: open cracks in the surface that expose ores and lead down into the caves
    let ravineFloor = Infinity;
    if (!underwater && !beach && noiseC.noise2(x / 190 + 900, z / 190) > 0.05) {
      const r = Math.abs(noise.noise2(x / 75 + 500, z / 75 + 500));
      if (r < 0.04) ravineFloor = h - Math.floor(8 + 26 * (1 - r / 0.04));
    }

    for (let y = MIN_Y; y <= Math.max(h, SEA_LEVEL); y++) {
      let id: number;
      const depth = h - y;
      if (y <= MIN_Y + 4) id = B.bedrock;
      else if (y <= MIN_Y + 6 && hash3(x, y, z, seed) < (y === MIN_Y + 5 ? 0.6 : 0.3)) id = B.bedrock;
      else if (y > h) id = biome === 'snowy' && y === SEA_LEVEL ? B.ice : WATER; // snowy lakes freeze over
      else if (powder && depth <= 2) id = B.powder_snow;
      else if (depth === 0) {
        if (underwater) id = hash3(x >> 2, 0, z >> 2, seed + 9) < 0.25 ? B.clay : (hash3(x >> 1, 1, z >> 1, seed) < 0.3 ? B.gravel : B.sand);
        else if (biome === 'desert' || beach) id = B.sand;
        else if (biome === 'snowy') id = B.snowy_grass;
        else if (biome === 'mountains' && h > 30) id = h > 42 ? (hash3(x >> 2, 5, z >> 2, seed) < 0.3 ? B.packed_ice : B.snowy_grass) : B.stone;
        else id = B.grass;
      } else if (depth <= 3) {
        if (biome === 'desert' || beach || underwater) id = depth <= 2 ? B.sand : B.sandstone;
        else if (biome === 'mountains' && h > 30) id = B.stone;
        else id = B.dirt;
      } else if (biome === 'desert' && depth <= 6) id = B.sandstone;
      else {
        id = oreAt(x, y, z, h, seed, biome);
        // Big pockets of granite/diorite/andesite in plain stone (noise looked up only where it matters)
        if (id === B.stone && sample(colBlob, y) > 0.55) {
          const kind = hash3(x >> 4, y >> 4, z >> 4, seed + 24);
          id = kind < 0.34 ? B.granite : kind < 0.67 ? B.diorite : B.andesite;
        }
      }

      // Carve caves (keep a solid roof under water so lakes don't drain visually)
      if (id !== WATER && id !== B.bedrock && y > MIN_Y + 5 && !(underwater && depth < 5) && !(beach && depth < 3)) {
        const a = sample(colA, y), b2 = sample(colB, y);
        // Tunnels get wider near ravine floors so ravines connect into the cave network
        const nearRavine = ravineFloor !== Infinity && y < ravineFloor + 6;
        const tunnel = a * a + b2 * b2 < (nearRavine ? 0.02 : 0.0045);
        const room = y < h - 10 && sample(colC, y) > 0.42;
        if (tunnel || room || y >= ravineFloor) id = y <= MIN_Y + 18 ? LAVA : 0;
      }
      d[idx(lx, y, lz)] = id;
    }

    // Grass tufts, flowers and wild food on untouched grass
    const top = d[idx(lx, h, lz)];
    if (top === B.grass && h + 1 <= MAX_Y && d[idx(lx, h + 1, lz)] === 0) {
      const r = hash3(x, 3, z, seed);
      const [grassP, flowerP] = biome === 'plains' ? [0.2, 0.035] : biome === 'forest' ? [0.12, 0.015] : biome === 'pine' ? [0.1, 0.008] : [0.05, 0.005];
      const f = hash3(x, 4, z, seed);
      let plant = 0;
      if (r < flowerP) plant = biome === 'pine' ? B.cornflower : f < 0.5 ? B.dandelion : f < 0.85 ? B.poppy : B.cornflower;
      else if (r < flowerP + grassP) plant = B.tall_grass;
      else if (r < flowerP + grassP + 0.012) {
        // Food: berries in the woods, wild carrots/potatoes in the open, mushrooms in the shade
        if (biome === 'pine' || biome === 'forest') plant = f < 0.45 ? B.berry_bush : f < 0.75 ? B.brown_mushroom : B.red_mushroom;
        else if (biome === 'plains') plant = f < 0.5 ? B.wild_carrots : B.wild_potatoes;
      }
      if (plant) d[idx(lx, h + 1, lz)] = plant;
    } else if (top === B.snowy_grass && h + 1 <= MAX_Y && d[idx(lx, h + 1, lz)] === 0) {
      const r = hash3(x, 3, z, seed);
      if (r < 0.05) d[idx(lx, h + 1, lz)] = B.frost_fern;
      else if (r < 0.062) d[idx(lx, h + 1, lz)] = B.snowberry_bush;
    }

    // Mushrooms on dark cave floors
    for (let y = MIN_Y + 7; y < h - 8; y++) {
      if (d[idx(lx, y + 1, lz)] !== 0 || d[idx(lx, y, lz)] === 0 || d[idx(lx, y, lz)] === LAVA) continue;
      const r = hash3(x, y, z, seed + 21);
      if (r < 0.006) d[idx(lx, y + 1, lz)] = r < 0.003 ? B.brown_mushroom : B.red_mushroom;
    }
  }

  placeFeatures(d, cx, cz, seed);
  return d;
}

function oreAt(x: number, y: number, z: number, h: number, seed: number, biome: Biome): number {
  // Ores only where r < 0.7 (a ragged edge to every vein), so the vein lookups are skipped otherwise
  if (hash3(x, y, z, seed + 3) < 0.7) {
    const vx = x >> 1, vy = y >> 1, vz = z >> 1;
    if (y < -92 && hash3(vx, vy, vz, seed + 11) < 0.018) return B.etherite_ore;
    if (y < -80 && hash3(vx, vy, vz, seed + 12) < 0.022) return B.moonstone_ore;
    if (y < -64 && hash3(vx, vy, vz, seed + 13) < 0.028) return B.diamond_ore;
    if (y < -32 && hash3(vx, vy, vz, seed + 14) < 0.035) return B.gold_ore;
    if (y < h - 6 && y > -95 && hash3(vx, vy, vz, seed + 15) < 0.06) return B.iron_ore;
    if (y < h - 4 && y > -60 && hash3(vx, vy, vz, seed + 16) < 0.08) return B.coal_ore;
    if (y < h - 4 && y > -30 && hash3(vx, vy, vz, seed + 18) < 0.05) return B.copper_ore;
    if ((biome === 'snowy' || biome === 'mountains') && y < h - 8 && y > -40 && hash3(vx, vy, vz, seed + 19) < 0.03) return B.frost_crystal_ore;
  }
  if (y < h - 8 && hash3(x >> 2, y >> 2, z >> 2, seed + 17) < 0.02) return B.gravel;
  // Deep layers: slate below -40 (with a ragged edge), basalt and obsidian near the bottom
  const deep = y < -44 || (y < -36 && y < -40 + Math.floor(hash3(x, 0, z, seed + 20) * 4));
  if (y < -86 && hash3(x >> 2, y >> 2, z >> 2, seed + 22) < 0.12) return hash3(x >> 1, y >> 1, z >> 1, seed + 23) < 0.25 ? B.obsidian : B.basalt;
  if (deep) return B.slate;
  return B.stone;
}

function placeFeatures(data: Uint8Array, cx: number, cz: number, seed: number) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number, onlyAir = false) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    const i = idx(lx, y, lz);
    if (onlyAir && data[i] !== 0) return;
    data[i] = id;
  };
  const leafBlob = (x: number, y: number, z: number, r: number, leaf: number, trimCorners: boolean) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (trimCorners && Math.abs(dx) === r && Math.abs(dz) === r && hash3(x + dx, y, z + dz, seed + 5) < 0.6) continue;
      put(x + dx, y, z + dz, leaf, true);
    }
  };

  // Candidates include neighbouring columns so trees crossing chunk borders are complete
  for (let x = x0 - 3; x < x0 + 19; x++) for (let z = z0 - 3; z < z0 + 19; z++) {
    const r = hash3(x, 7, z, seed);
    if (r > 0.04) continue; // quick reject before computing terrain
    const { h, biome } = columnInfo(x, z, seed);
    if (h < SEA_LEVEL + 1 || biome === 'robotic') continue;
    if (Math.abs(x) < 4 && Math.abs(z) < 4) continue; // clear spawn
    const r2 = hash3(x, 8, z, seed);
    if (biome === 'desert') {
      if (r < 0.006) { const ch = 1 + Math.floor(r2 * 3); for (let i = 1; i <= ch; i++) put(x, h + i, z, B.cactus); }
      continue;
    }
    if (biome === 'plains' && r < 0.0015) { put(x, h + 1, z, B.pumpkin); continue; }
    if ((biome === 'plains' || biome === 'forest') && r > 0.039 && r < 0.0398) { put(x, h + 1, z, B.melon, true); continue; }
    const density = biome === 'forest' ? 0.035 : biome === 'pine' ? 0.03 : biome === 'snowy' ? 0.01 : biome === 'mountains' ? (h > 30 ? 0 : 0.006) : 0.005;
    if (r >= density) continue;
    // Trees need ground: skip ravines/caves under the trunk
    const lx0 = x - x0, lz0 = z - z0;
    if (lx0 >= 0 && lx0 < 16 && lz0 >= 0 && lz0 < 16 && data[idx(lx0, h, lz0)] === 0) continue;

    if (biome === 'snowy' || biome === 'mountains' || biome === 'pine') {
      // Pine/spruce: tall trunk with a layered cone
      const th = 6 + Math.floor(r2 * 4);
      for (let i = 1; i <= th; i++) put(x, h + i, z, B.spruce_wood);
      put(x, h + th + 1, z, B.spruce_leaves, true);
      put(x, h + th + 2, z, B.spruce_leaves, true);
      let rad = 1;
      for (let y = h + th; y >= h + 3; y--) {
        leafBlob(x, y, z, rad, B.spruce_leaves, rad === 2);
        rad = rad === 1 ? 2 : 1;
      }
    } else {
      const birch = biome === 'forest' && r2 < 0.35;
      const log = birch ? B.birch_wood : B.wood, leaf = birch ? B.birch_leaves : B.leaves;
      const th = (birch ? 5 : 4) + Math.floor(r2 * 3);
      const top = h + th;
      leafBlob(x, top - 2, z, 2, leaf, true);
      leafBlob(x, top - 1, z, 2, leaf, true);
      leafBlob(x, top, z, 1, leaf, false);
      put(x, top + 1, z, leaf, true); put(x + 1, top + 1, z, leaf, true); put(x - 1, top + 1, z, leaf, true);
      put(x, top + 1, z + 1, leaf, true); put(x, top + 1, z - 1, leaf, true);
      for (let i = 1; i <= th; i++) put(x, h + i, z, log);
    }
  }
  placeStructures(put, cx, cz, seed);
}

// ------------------------------------------------------------------ Structures (with loot chests)
//
// The world is split into REGION x REGION areas; each can hold one surface structure (picked by biome)
// and, on a separate grid, one underground dungeon. Everything is a pure function of the seed, so each
// chunk draws just the part of any nearby structure that falls inside it.

const REGION = 48;
const STRUCT_REACH = 6; // max distance of a structure's blocks from its origin

export type StructureKind = 'cabin' | 'temple' | 'igloo' | 'dungeon';
export interface Structure { kind: StructureKind; x: number; y: number; z: number }

export function structureInRegion(rx: number, rz: number, seed: number, underground: boolean): Structure | null {
  const salt = underground ? 97 : 91;
  const r = hash3(rx, salt, rz, seed);
  const x = rx * REGION + 8 + Math.floor(hash3(rx, salt + 1, rz, seed) * (REGION - 16));
  const z = rz * REGION + 8 + Math.floor(hash3(rx, salt + 2, rz, seed) * (REGION - 16));
  if (Math.abs(x) < 24 && Math.abs(z) < 24) return null; // keep the world spawn clear
  if (isRobotic(x)) return null;
  const { h, biome } = columnInfo(x, z, seed);
  if (underground) {
    if (r > 0.55) return null;
    const y = Math.min(h - 14, -12 - Math.floor(hash3(rx, salt + 3, rz, seed) * 60));
    return { kind: 'dungeon', x, y, z };
  }
  if (h < SEA_LEVEL + 1) return null;
  if (biome === 'desert' && r < 0.45) return { kind: 'temple', x, y: h, z };
  if (biome === 'snowy' && r < 0.45) return { kind: 'igloo', x, y: h, z };
  if ((biome === 'plains' || biome === 'forest' || biome === 'pine') && r < 0.35) return { kind: 'cabin', x, y: h, z };
  return null;
}

function placeStructures(put: (x: number, y: number, z: number, id: number, onlyAir?: boolean) => void, cx: number, cz: number, seed: number) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const r0x = Math.floor((x0 - STRUCT_REACH) / REGION), r1x = Math.floor((x0 + 15 + STRUCT_REACH) / REGION);
  const r0z = Math.floor((z0 - STRUCT_REACH) / REGION), r1z = Math.floor((z0 + 15 + STRUCT_REACH) / REGION);
  for (let rx = r0x; rx <= r1x; rx++) for (let rz = r0z; rz <= r1z; rz++) for (const under of [false, true]) {
    const s = structureInRegion(rx, rz, seed, under);
    if (!s || s.x + STRUCT_REACH < x0 || s.x - STRUCT_REACH > x0 + 15 || s.z + STRUCT_REACH < z0 || s.z - STRUCT_REACH > z0 + 15) continue;
    buildStructure(s, put, seed);
  }
}

function buildStructure(s: Structure, put: (x: number, y: number, z: number, id: number, onlyAir?: boolean) => void, seed: number) {
  const { x, y, z } = s;
  const box = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, id: number) => {
    for (let i = ax; i <= bx; i++) for (let j = ay; j <= by; j++) for (let k = az; k <= bz; k++) put(x + i, y + j, z + k, id);
  };
  const B = BLOCK_ID;
  if (s.kind === 'cabin') {
    box(-3, -3, -3, 3, -1, 3, B.cobblestone);           // foundation (no floating cabins on slopes)
    box(-3, 0, -3, 3, 0, 3, B.planks);                  // floor
    box(-3, 1, -3, 3, 4, 3, 0);                          // clear the inside
    for (let j = 1; j <= 3; j++) for (let i = -3; i <= 3; i++) for (const k of [-3, 3]) {
      const corner = Math.abs(i) === 3;
      put(x + i, y + j, z + k, corner ? B.wood : B.planks);
      put(x + k, y + j, z + i, corner ? B.wood : B.planks);
    }
    for (const [i, k] of [[0, -3], [-3, 0], [3, 0]]) put(x + i, y + 2, z + k, B.glass);
    put(x, y + 1, z + 3, 0); put(x, y + 2, z + 3, 0);   // doorway
    box(-4, 4, -4, 4, 4, 4, B.planks);                  // roof with overhang
    box(-2, 5, -2, 2, 5, 2, B.planks);
    put(x + 2, y + 1, z - 2, B.chest);
    put(x - 2, y + 1, z - 2, B.crafting_table);
    put(x - 2, y + 1, z + 1, B.furnace);
    put(x, y + 3, z, B.lantern);
  } else if (s.kind === 'temple') {
    for (let layer = 0; layer <= 4; layer++) box(-(5 - layer), layer, -(5 - layer), 5 - layer, layer, 5 - layer, layer === 4 ? B.terracotta : B.sandstone);
    box(-2, 1, -2, 2, 2, 2, 0);                          // treasure room
    box(-2, 0, -2, 2, 0, 2, B.terracotta);
    put(x, y + 1, z + 5, 0); put(x, y + 2, z + 5, 0);   // tunnel in
    put(x, y + 1, z + 4, 0); put(x, y + 2, z + 4, 0); put(x, y + 1, z + 3, 0); put(x, y + 2, z + 3, 0);
    put(x - 1, y + 1, z - 2, B.chest); put(x + 1, y + 1, z - 2, B.chest);
  } else if (s.kind === 'igloo') {
    for (let i = -4; i <= 4; i++) for (let j = 0; j <= 4; j++) for (let k = -4; k <= 4; k++) {
      const d = Math.hypot(i, j * 1.25, k);
      if (d <= 2.6) put(x + i, y + 1 + j, z + k, 0);
      else if (d <= 3.6) put(x + i, y + 1 + j, z + k, B.snow_bricks);
    }
    box(-2, 0, -2, 2, 0, 2, B.wool);                    // rug
    put(x, y + 1, z + 3, 0); put(x, y + 2, z + 3, 0); put(x, y + 1, z + 4, 0); put(x, y + 2, z + 4, 0);
    put(x + 1, y + 1, z - 2, B.chest);
    put(x - 1, y + 1, z - 2, B.lantern);
  } else {
    // Dungeon: a mossy room hidden in the rock
    for (let i = -3; i <= 3; i++) for (let j = -1; j <= 4; j++) for (let k = -3; k <= 3; k++) {
      const shell = Math.abs(i) === 3 || Math.abs(k) === 3 || j === -1 || j === 4;
      put(x + i, y + j, z + k, shell ? (hash3(x + i, y + j, z + k, seed + 31) < 0.5 ? B.mossy_cobblestone : B.cobblestone) : 0);
    }
    put(x + 2, y, z - 2, B.chest);
    if (hash3(x, y, z, seed + 32) < 0.5) put(x - 2, y, z + 2, B.chest);
    put(x, y, z + 3, 0); put(x, y + 1, z + 3, 0);        // a way out into the rock
  }
}

export function computeHeights(data: Uint8Array): Int16Array {
  const heights = new Int16Array(CHUNK * CHUNK);
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    let y = MAX_Y;
    while (y > MIN_Y && !blocksSky(data[idx(lx, y, lz)])) y--;
    heights[(lz << 4) | lx] = y;
  }
  return heights;
}

// ------------------------------------------------------------------ Meshing (greedy, packed vertices)
//
// Vertex format (10 bytes):
//   aPos  Uint16 x3 : chunk-local position in 1/16 block units (x, y - MIN_Y, z)
//   aData Uint16 x2 : [tile | light<<8 | face<<11 | ao<<14,  u | v<<5]   (tile: 8 bits, up to 256 textures)
// Faces with the same texture, light and flat AO are merged into one quad; the shader repeats
// the texture across it using the block-unit u/v.

export const PAD_B = 18;
export const PAD_H = 22;
// Input for one 16^3 section, padded so faces/AO/light at the borders need no other lookups:
//   blocks: 18^3, index ((y+1)*18 + (z+1))*18 + (x+1) for local x,y,z in -1..16
//   heights: 22x22 column heights, index (z+3)*22 + (x+3) for local x,z in -3..18
export interface SectionInput {
  y0: number;
  blocks: Uint8Array;
  heights: Int16Array;
  facing: number[]; // flat [lx, ly, lz, f, ...] for furnaces/pumpkins in this section
}
export interface MeshArrays { pos: Uint16Array; data: Uint16Array; index: Uint32Array }
export interface SectionOutput { solid: MeshArrays | null; liquid: MeshArrays | null }

// Face order matches BlockDef.tiles: +x, -x, +y, -y, +z, -z. Corners: BL, BR, TR, TL seen from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const axisOf = (v: number[]) => (v[0] ? 0 : v[1] ? 1 : 2);
const FACE_AXES = FACES.map(f => ({
  d: axisOf(f.n),
  u: axisOf([f.c[1][0] - f.c[0][0], f.c[1][1] - f.c[0][1], f.c[1][2] - f.c[0][2]]),
  v: axisOf([f.c[3][0] - f.c[0][0], f.c[3][1] - f.c[0][1], f.c[3][2] - f.c[0][2]]),
}));
// Tangent offsets per face corner for ambient occlusion
const AO_OFFSETS = FACES.map(face => {
  const t: number[] = [];
  for (let a = 0; a < 3; a++) if (face.n[a] === 0) t.push(a);
  return face.c.map(cc => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[t[0]] = cc[t[0]] ? 1 : -1;
    s2[t[1]] = cc[t[1]] ? 1 : -1;
    return [s1, s2, [s1[0] + s2[0], s1[1] + s2[1], s1[2] + s2[2]]];
  });
});
const FRONT_FACE = [4, 0, 5, 1]; // facing 0:+z 1:+x 2:-z 3:-x
const OCCLUDES = new Uint8Array(256);
const TRANSPARENT = new Uint8Array(256);
const GLOW = new Uint8Array(256);
for (const b of BLOCKS) { OCCLUDES[b.id] = isOccluding(b.id) ? 1 : 0; TRANSPARENT[b.id] = b.transparent ? 1 : 0; GLOW[b.id] = b.glow ? 1 : 0; }

class Builder {
  pos: number[] = [];
  data: number[] = [];
  index: number[] = [];
  vert(x: number, y: number, z: number, d0: number, d1: number) {
    this.pos.push(x, y, z);
    this.data.push(d0, d1);
  }
  finish(): MeshArrays | null {
    if (!this.index.length) return null;
    return { pos: new Uint16Array(this.pos), data: new Uint16Array(this.data), index: new Uint32Array(this.index) };
  }
}

export function meshSection(input: SectionInput): SectionOutput {
  const { y0, blocks, heights } = input;
  const yBase = (y0 - MIN_Y) * 16; // chunk-local y offset of this section, 1/16 units
  const get = (x: number, y: number, z: number) => blocks[((y + 1) * PAD_B + (z + 1)) * PAD_B + (x + 1)];
  const hAt = (x: number, z: number) => heights[(z + 3) * PAD_H + (x + 3)];
  // Light level index: 3 open sky, 2/1 near an opening, 0 enclosed (4 = lava glow)
  const skyLight = (lx: number, y: number, lz: number): number => {
    if (y > hAt(lx, lz)) return 3;
    if (y > hAt(lx + 1, lz) || y > hAt(lx - 1, lz) || y > hAt(lx, lz + 1) || y > hAt(lx, lz - 1)) return 2;
    if (y > hAt(lx + 2, lz) || y > hAt(lx - 2, lz) || y > hAt(lx, lz + 2) || y > hAt(lx, lz - 2)) return 1;
    return 0;
  };
  const facingMap = new Map<number, number>();
  for (let i = 0; i < input.facing.length; i += 4) facingMap.set((input.facing[i + 1] * 16 + input.facing[i + 2]) * 16 + input.facing[i], input.facing[i + 3]);

  const solid = new Builder(), liquid = new Builder();

  // Plants: two crossed double-sided quads (not merged)
  for (let ly = 0; ly < 16; ly++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
    const id = get(lx, ly, lz);
    if (!id || !BLOCKS[id].plant) continue;
    const d0 = BLOCKS[id].tiles[0] | ((GLOW[id] ? 4 : skyLight(lx, y0 + ly, lz)) << 8) | (6 << 11) | (3 << 14);
    const X = lx * 16, Y = yBase + ly * 16, Z = lz * 16;
    for (const [ax, az, bx, bz] of [[2, 2, 14, 14], [2, 14, 14, 2]]) {
      const base = solid.pos.length / 3;
      solid.vert(X + ax, Y, Z + az, d0, 0);
      solid.vert(X + bx, Y, Z + bz, d0, 1);
      solid.vert(X + bx, Y + 16, Z + bz, d0, 1 | (1 << 5));
      solid.vert(X + ax, Y + 16, Z + az, d0, 1 << 5);
      solid.index.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  const mask = new Int32Array(256);
  const maskAo = new Uint8Array(256 * 4);
  const p = [0, 0, 0];

  for (let f = 0; f < 6; f++) {
    const face = FACES[f];
    const { d, u, v } = FACE_AXES[f];
    for (let s = 0; s < 16; s++) {
      // 1) Build this slice's face mask: 0 = no face, otherwise a key describing its look
      mask.fill(0);
      for (let b = 0; b < 16; b++) for (let a = 0; a < 16; a++) {
        p[d] = s; p[u] = a; p[v] = b;
        const lx = p[0], ly = p[1], lz = p[2];
        const id = get(lx, ly, lz);
        if (id === 0 || BLOCKS[id].plant) continue;
        const nx = lx + face.n[0], ny = ly + face.n[1], nz = lz + face.n[2];
        const nid = get(nx, ny, nz);
        const isWater = id === WATER, isLava = id === LAVA;
        const liquidBlock = isWater || isLava || id === OIL;
        const lowered = liquidBlock && get(lx, ly + 1, lz) !== id;
        if (liquidBlock) {
          if (nid === id || (OCCLUDES[nid] && !(f === 2 && lowered))) continue;
          if (isWater && nid === LAVA) continue;
        } else {
          if (OCCLUDES[nid]) continue;
          if (nid === id && TRANSPARENT[id]) continue; // leaves/glass: skip inner faces
        }
        let tile = BLOCKS[id].tiles[f];
        if (isFacingBlock(id)) {
          const fc = facingMap.get((ly * 16 + lz) * 16 + lx) ?? 0;
          tile = FRONT_FACE[fc] === f ? BLOCKS[id].tiles[4] : f === 2 || f === 3 ? BLOCKS[id].tiles[f] : BLOCKS[id].tiles[0];
        }
        const light = isLava || GLOW[id] ? 4 : skyLight(nx, y0 + ny, nz);
        const cell = (b << 4) | a;
        let aoKey = 0, uniform = 1;
        for (let k = 0; k < 4; k++) {
          let ao = 3;
          if (!liquidBlock) {
            const [s1, s2, sc] = AO_OFFSETS[f][k];
            const o1 = OCCLUDES[get(nx + s1[0], ny + s1[1], nz + s1[2])];
            const o2 = OCCLUDES[get(nx + s2[0], ny + s2[1], nz + s2[2])];
            const oc = OCCLUDES[get(nx + sc[0], ny + sc[1], nz + sc[2])];
            ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
          }
          maskAo[cell * 4 + k] = ao;
          aoKey |= ao << (k * 2);
          if (k > 0 && ao !== maskAo[cell * 4]) uniform = 0;
        }
        mask[cell] = 1 + (tile | (light << 8) | (lowered ? 1 << 11 : 0) | (isWater ? 1 << 12 : 0) | (aoKey << 13) | (uniform << 21));
      }

      // 2) Greedy merge: grow each face along a, then along b, while the key matches and AO is flat
      for (let b = 0; b < 16; b++) {
        let a = 0;
        while (a < 16) {
          const cell = (b << 4) | a;
          const key = mask[cell];
          if (!key) { a++; continue; }
          let w = 1, h = 1;
          if ((key - 1) & (1 << 21)) {
            while (a + w < 16 && mask[(b << 4) | (a + w)] === key) w++;
            let grow = true;
            while (grow && b + h < 16) {
              for (let k = 0; k < w; k++) if (mask[((b + h) << 4) | (a + k)] !== key) { grow = false; break; }
              if (grow) h++;
            }
          }
          const aos = [maskAo[cell * 4], maskAo[cell * 4 + 1], maskAo[cell * 4 + 2], maskAo[cell * 4 + 3]];
          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[((b + hh) << 4) | (a + k)] = 0;

          const kv = key - 1;
          const tile = kv & 255, light = (kv >> 8) & 7, lowered = (kv >> 11) & 1, water = (kv >> 12) & 1;
          const out = water ? liquid : solid;
          const base = out.pos.length / 3;
          for (let k = 0; k < 4; k++) {
            const cc = face.c[k];
            p[d] = s + cc[d];
            p[u] = a + (cc[u] ? w : 0);
            p[v] = b + (cc[v] ? h : 0);
            let py = yBase + p[1] * 16;
            if (lowered && cc[1] === 1) py -= 2;
            const uu = k === 1 || k === 2 ? w : 0, vv = k >= 2 ? h : 0;
            out.vert(p[0] * 16, py, p[2] * 16, tile | (light << 8) | (f << 11) | (aos[k] << 14), uu | (vv << 5));
          }
          // Flip the quad diagonal so AO gradients interpolate evenly
          if (aos[0] + aos[2] < aos[1] + aos[3]) out.index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          else out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
          a += w;
        }
      }
    }
  }
  return { solid: solid.finish(), liquid: liquid.finish() };
}

export function transferables(out: SectionOutput): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  for (const m of [out.solid, out.liquid]) if (m) list.push(m.pos.buffer as ArrayBuffer, m.data.buffer as ArrayBuffer, m.index.buffer as ArrayBuffer);
  return list;
}
