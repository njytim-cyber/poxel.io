// The Elemental World: a secret dimension of four biomes, each with a boss guarding its own elemental ore.
//   Frosted Lands (water): glaciers, ice spikes, ice caves, glacite; the Frost Wraith.
//   Volcano (lava): basalt and ash, magma, lava lakes and smoking cones; the Magma Colossus.
//   Overgrown Jungle (earth): moss, giant jungle trees, swampy pools; the Thorn Guardian.
//   Cloud Kingdom (wind): a sea of clouds with skystone islands floating above; the Tempest.
// Its portal is an upright frame: etherite blocks along the top, gold blocks along the bottom, obitite blocks
// down one side and moonstone blocks down the other, around a 2-wide, 3-tall hole. Fill the hole with robot
// eyes and they turn into a glowing portal you walk into.
// Like the Robotic World it is a far-off strip of the same world (ELEM_MIN_X <= x < ELEM_MAX_X), walled off
// with bedrock. Pure functions of the seed (runs on the server and in the client's workers).
import { BLOCK_ID, WATER, LAVA } from './blocks.ts';
import { Noise, hash3 } from './noise.ts';
import { CHUNK, CHUNK_VOLUME, MIN_Y, MAX_Y, idx } from './worldgen.ts';

export const ELEM_MIN_X = -130000; // chunk aligned
export const ELEM_MAX_X = -70000;
export const ELEM_OFFSET = -100000; // a portal at x leads to x + ELEM_OFFSET there (and back)
export const ICE_LEVEL = 4;          // low ground in the Frosted Lands holds frozen lakes up to here (pools in the jungle)
const LAVA_LEVEL = 5;                // low ground in the Volcano is lava up to here
export const ELEM_DAYLIGHT = 0.3;   // a long twilight: monsters roam at any hour
const WALL = 2;

export const isElemental = (x: number) => x >= ELEM_MIN_X && x < ELEM_MAX_X;

export function elementalDestination(x: number, z: number): { x: number; z: number } {
  if (isElemental(x)) return { x: Math.floor(x) - ELEM_OFFSET, z: Math.floor(z) };
  return { x: Math.max(ELEM_MIN_X + 64, Math.min(ELEM_MAX_X - 64, Math.floor(x) + ELEM_OFFSET)), z: Math.floor(z) };
}

// ------------------------------------------------------------------ The portal

export interface ElementalPortal { x: number; y: number; z: number; axis: 'x' | 'z' } // x,y,z: the hole's bottom-left cell

type Get = (x: number, y: number, z: number) => number;

// The 6 cells of a portal's hole
export function portalCells(p: ElementalPortal): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) out.push(p.axis === 'x' ? [p.x + i, p.y + j, p.z] : [p.x, p.y + j, p.z + i]);
  return out;
}

// Is there a complete frame around a hole whose cells all hold `fill`, with (x, y, z) one of the cells?
export function findElementalPortal(get: Get, x: number, y: number, z: number, fill: number): ElementalPortal | null {
  for (const axis of ['x', 'z'] as const) for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const p: ElementalPortal = axis === 'x' ? { x: x - i, y: y - j, z, axis } : { x, y: y - j, z: z - i, axis };
    if (portalCells(p).every(([a, b, c]) => get(a, b, c) === fill) && frameComplete(get, p)) return p;
  }
  return null;
}

// Etherite blocks along the top (4, corners included), gold blocks along the bottom (4), obitite blocks down one
// side (3) and moonstone blocks down the other (3), either way round. A return portal's frame counts as anything.
function frameComplete(get: Get, p: ElementalPortal): boolean {
  const B = BLOCK_ID;
  const at = (i: number, j: number) => (p.axis === 'x' ? get(p.x + i, p.y + j, p.z) : get(p.x, p.y + j, p.z + i));
  const is = (i: number, j: number, id: number) => { const b = at(i, j); return b === id || b === B.elemental_frame; };
  for (let i = -1; i <= 2; i++) if (!is(i, 3, B.etherite_block) || !is(i, -1, B.gold_block)) return false;
  const side = (i: number, id: number) => [0, 1, 2].every(j => is(i, j, id));
  return (side(-1, B.obitite_block) && side(2, B.moonstone_block)) || (side(-1, B.moonstone_block) && side(2, B.obitite_block));
}

// ------------------------------------------------------------------ Biomes

export type ElemBiome = 'frost' | 'volcano' | 'jungle' | 'clouds';
const ELEM_BIOMES: ElemBiome[] = ['frost', 'volcano', 'jungle', 'clouds'];
export const BIOME_NAMES: Record<ElemBiome, string> = { frost: 'the Frosted Lands', volcano: 'the Volcano', jungle: 'the Overgrown Jungle', clouds: 'the Cloud Kingdom' };
const BIOME_CELL = 360; // biomes are regions roughly this size (a jittered grid of sites; each spot takes its nearest)
const BLEND = 40;       // heights blend over this many blocks at a border

interface Site { x: number; z: number; biome: ElemBiome }
function siteIn(i: number, j: number, seed: number): Site {
  return {
    x: i * BIOME_CELL + 40 + hash3(i, 191, j, seed) * (BIOME_CELL - 80),
    z: j * BIOME_CELL + 40 + hash3(i, 192, j, seed) * (BIOME_CELL - 80),
    biome: ELEM_BIOMES[Math.floor(hash3(i, 193, j, seed) * 4) % 4],
  };
}
// The biome here (its nearest site), the nearest site of a different biome, and how far inside the border we are
function sites(x: number, z: number, seed: number): { a: Site; b: Site; edge: number } {
  const ci = Math.floor(x / BIOME_CELL), cj = Math.floor(z / BIOME_CELL);
  const all: { s: Site; d: number }[] = [];
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
    const s = siteIn(ci + di, cj + dj, seed);
    all.push({ s, d: Math.hypot(s.x - x, s.z - z) });
  }
  all.sort((p, q) => p.d - q.d);
  const a = all[0], other = all.find(o => o.s.biome !== a.s.biome);
  return other ? { a: a.s, b: other.s, edge: other.d - a.d } : { a: a.s, b: a.s, edge: Infinity };
}
export function elementalBiome(x: number, z: number, seed: number): ElemBiome { return sites(x, z, seed).a.biome; }

interface ElemNoise { seed: number; a: Noise; b: Noise; c: Noise; d: Noise }
let noise: ElemNoise | null = null;
function N(seed: number): ElemNoise {
  if (!noise || noise.seed !== seed) noise = { seed, a: new Noise(seed + 80), b: new Noise(seed + 81), c: new Noise(seed + 82), d: new Noise(seed + 83) };
  return noise;
}

// A volcano cone near here, if any: its centre and size
function coneAt(x: number, z: number, seed: number): { d: number; peak: number } | null {
  const G = 120, ci = Math.floor(x / G), cj = Math.floor(z / G);
  let best: { d: number; peak: number } | null = null;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const i = ci + di, j = cj + dj;
    if (hash3(i, 201, j, seed) > 0.55) continue;
    const cx = i * G + 30 + hash3(i, 202, j, seed) * (G - 60), cz = j * G + 30 + hash3(i, 203, j, seed) * (G - 60);
    const d = Math.hypot(x - cx, z - cz), peak = 30 + hash3(i, 204, j, seed) * 22;
    if (d < peak / 1.1 && (!best || d < best.d)) best = { d, peak };
  }
  return best;
}

function biomeHeight(biome: ElemBiome, x: number, z: number, seed: number): number {
  const { a, b } = N(seed);
  if (biome === 'frost') {
    const base = 7 + a.fbm2(x / 100, z / 100, 4) * 14;
    const ridge = Math.max(0, b.fbm2(x / 180 + 30, z / 180 - 30, 3) - 0.15) * 70; // glacier ridges
    return base + Math.min(ridge, 30);
  }
  if (biome === 'volcano') {
    let h = 9 + a.fbm2(x / 90 + 7, z / 90, 4) * 10;
    const c = coneAt(x, z, seed);
    if (c) h += Math.max(0, c.peak - c.d * 1.1) - (c.d < 5 ? Math.min(c.peak * 0.3, 8) : 0); // a crater at the top
    return h;
  }
  if (biome === 'jungle') return 8 + a.fbm2(x / 70 - 9, z / 70, 4) * 16 + Math.max(0, b.fbm2(x / 50, z / 50 + 9, 2)) * 14;
  return 22 + a.fbm2(x / 40, z / 40, 2) * 2; // the cloud sea's billowing top
}

export function elementalHeight(x: number, z: number, seed: number): number {
  const s = sites(x, z, seed);
  const ha = biomeHeight(s.a.biome, x, z, seed);
  if (s.a.biome === s.b.biome || s.edge >= BLEND) return Math.floor(Math.min(ha, MAX_Y - 40));
  const w = 0.5 + 0.5 * (s.edge / BLEND); // half and half right at the border
  return Math.floor(Math.min(ha * w + biomeHeight(s.b.biome, x, z, seed) * (1 - w), MAX_Y - 40));
}

// An ice spike rising from this column (Frosted Lands only): [radius, height]
function spikeAt(x: number, z: number, seed: number): [number, number] | null {
  const cx = Math.floor(x / 24), cz = Math.floor(z / 24);
  if (hash3(cx, 171, cz, seed) > 0.35) return null;
  const sx = cx * 24 + 4 + Math.floor(hash3(cx, 172, cz, seed) * 16), sz = cz * 24 + 4 + Math.floor(hash3(cx, 173, cz, seed) * 16);
  const r = 1 + Math.floor(hash3(cx, 174, cz, seed) * 2), h = 8 + Math.floor(hash3(cx, 175, cz, seed) * 16);
  const d = Math.hypot(x - sx, z - sz);
  if (d > r + 0.5) return null;
  return [r, Math.floor(h * (1 - d / (r + 1.5)))]; // tapers to a point
}

// ------------------------------------------------------------------ Terrain

export function generateElementalChunk(cx: number, cz: number, seed: number): Uint8Array {
  const B = BLOCK_ID;
  const { c: caves, d: islands } = N(seed);
  const d = new Uint8Array(CHUNK_VOLUME);
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number, onlyAir = false) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    if (onlyAir && d[idx(lx, y, lz)] !== 0) return;
    d[idx(lx, y, lz)] = id;
  };
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    const x = x0 + lx, z = z0 + lz;
    if (x < ELEM_MIN_X + WALL || x >= ELEM_MAX_X - WALL) {
      for (let y = MIN_Y; y <= MAX_Y; y++) d[idx(lx, y, lz)] = B.bedrock;
      continue;
    }
    const biome = elementalBiome(x, z, seed);
    const h = elementalHeight(x, z, seed);
    if (biome === 'clouds') { cloudColumn(d, lx, lz, x, z, h, seed, islands); continue; }
    const liquidTop = biome === 'volcano' ? LAVA_LEVEL : ICE_LEVEL;
    const lake = h < liquidTop;
    const cone = biome === 'volcano' ? coneAt(x, z, seed) : null;
    const crater = !!cone && cone.d < 5;
    for (let y = MIN_Y; y <= Math.max(h + (crater ? 3 : 0), liquidTop); y++) {
      const depth = h - y;
      let id: number;
      if (y <= MIN_Y + 4) id = B.bedrock;
      else if (y > h) {
        if (crater) id = LAVA; // a lava pool in each crater
        else if (biome === 'volcano') id = LAVA;
        else if (biome === 'frost') id = y === ICE_LEVEL ? (hash3(x >> 2, 1, z >> 2, seed + 90) < 0.3 ? B.blue_ice : B.ice) : WATER; // frozen lakes
        else id = WATER; // jungle pools
      } else if (biome === 'frost') {
        if (depth === 0) id = lake ? B.packed_ice : hash3(x >> 2, 2, z >> 2, seed + 91) < 0.12 ? B.packed_ice : B.snow_block;
        else if (depth <= 3) id = lake ? B.packed_ice : B.snow_block;
        else id = oreIn(B.permafrost, x, y, z, h, seed, biome);
      } else if (biome === 'volcano') {
        const r = hash3(x >> 1, y, z >> 1, seed + 110);
        if (depth === 0) id = r < 0.18 ? B.magma_block : r < 0.5 ? B.volcanic_ash : B.basalt;
        else if (depth <= 3) id = r < 0.3 ? B.volcanic_ash : B.basalt;
        else id = oreIn(hash3(x >> 2, y >> 2, z >> 2, seed + 111) < 0.15 ? B.obsidian : B.basalt, x, y, z, h, seed, biome);
      } else {
        if (depth === 0) id = lake ? B.dirt : hash3(x >> 2, 3, z >> 2, seed + 120) < 0.3 ? B.moss_block : B.grass;
        else if (depth <= 3) id = B.dirt;
        else id = oreIn(B.stone, x, y, z, h, seed, biome);
      }
      // Caves: ice-walled in the Frosted Lands, lava-floored deep down in the Volcano
      if (y > MIN_Y + 6 && y < h - 6 && id !== B.bedrock) {
        const n = Math.abs(caves.noise3(x / 32, y / 20, z / 32));
        if (n < 0.06) id = biome === 'volcano' && y < -60 ? LAVA : 0;
        else if (n < 0.085 && biome === 'frost' && id === B.permafrost) id = hash3(x, y, z, seed + 98) < 0.5 ? B.packed_ice : B.blue_ice;
      }
      d[idx(lx, y, lz)] = id;
    }
    if (lake || crater) continue;
    const top = d[idx(lx, h, lz)];
    const r = hash3(x, 3, z, seed + 99);
    if (biome === 'frost') {
      const spike = spikeAt(x, z, seed);
      if (spike) { for (let k = 1; k <= spike[1] && h + k <= MAX_Y; k++) d[idx(lx, h + k, lz)] = B.packed_ice; continue; }
      if (top === B.snow_block && h + 1 <= MAX_Y) {
        if (r < 0.03) d[idx(lx, h + 1, lz)] = B.frost_fern;
        else if (r < 0.036) d[idx(lx, h + 1, lz)] = B.snowberry_bush;
      }
    } else if (biome === 'jungle' && (top === B.grass || top === B.moss_block) && h + 1 <= MAX_Y) {
      if (r < 0.25) d[idx(lx, h + 1, lz)] = B.tall_grass;
      else if (r < 0.27) d[idx(lx, h + 1, lz)] = B.berry_bush;
      else if (r < 0.275 && top === B.grass) d[idx(lx, h + 1, lz)] = B.melon;
    }
  }
  placeJungleTrees(put, cx, cz, seed);
  placeRuins(put, cx, cz, seed);
  placeShrines(put, cx, cz, seed);
  return d;
}

// Ores in each biome's rock (veins, with a ragged edge)
function oreIn(rock: number, x: number, y: number, z: number, h: number, seed: number, biome: ElemBiome): number {
  const B = BLOCK_ID;
  if (hash3(x, y, z, seed + 92) >= 0.7) return rock;
  const vx = x >> 1, vy = y >> 1, vz = z >> 1;
  if (biome === 'frost') {
    if (y < h - 10 && y < -20 && hash3(vx, vy, vz, seed + 93) < 0.02) return B.glacite_ore;
    if (y < h - 5 && hash3(vx, vy, vz, seed + 94) < 0.045) return B.frost_crystal_ore;
  } else if (biome === 'volcano') {
    if (y < h - 5 && hash3(vx, vy, vz, seed + 112) < 0.04) return B.gold_ore;
    if (y < -40 && hash3(vx, vy, vz, seed + 113) < 0.015) return B.diamond_ore;
  } else if (y < h - 5 && hash3(vx, vy, vz, seed + 121) < 0.05) return B.copper_ore;
  if (y < h - 5 && hash3(vx, vy, vz, seed + 95) < 0.04) return B.coal_ore;
  if (y < h - 8 && hash3(vx, vy, vz, seed + 96) < 0.03) return B.iron_ore;
  if (y < -50 && hash3(vx, vy, vz, seed + 97) < 0.012) return B.diamond_ore;
  return rock;
}

// The Cloud Kingdom: a few blocks of cloud to walk on, nothing below (but a very long fall), and skystone
// islands floating overhead, grassy on top
function cloudColumn(d: Uint8Array, lx: number, lz: number, x: number, z: number, h: number, seed: number, islands: Noise) {
  const B = BLOCK_ID;
  for (let y = MIN_Y; y <= MIN_Y + 4; y++) d[idx(lx, y, lz)] = B.bedrock;
  for (let y = h - 3; y <= h; y++) d[idx(lx, y, lz)] = B.cloud;
  for (let y = 44; y <= 76 && y <= MAX_Y; y++) {
    const shape = islands.noise3(x / 44, y / 14, z / 44) - Math.abs(y - 58) / 22;
    if (shape > 0.18) d[idx(lx, y, lz)] = B.skystone;
  }
  for (let y = 76; y >= 44; y--) {
    if (d[idx(lx, y, lz)] === B.skystone && d[idx(lx, y + 1, lz)] === 0) {
      d[idx(lx, y, lz)] = B.grass;
      if (hash3(x, y, z, seed + 130) < 0.08) d[idx(lx, y + 1, lz)] = B.tall_grass;
    }
  }
}

type Put = (x: number, y: number, z: number, id: number, onlyAir?: boolean) => void;

// Giant jungle trees: tall trunks under wide, layered canopies
function placeJungleTrees(put: Put, cx: number, cz: number, seed: number) {
  const B = BLOCK_ID;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let x = x0 - 4; x < x0 + 20; x++) for (let z = z0 - 4; z < z0 + 20; z++) {
    if (hash3(x, 141, z, seed) > 0.022) continue;
    if (elementalBiome(x, z, seed) !== 'jungle') continue;
    const sh = nearestShrine(x, z, seed);
    if (sh && Math.hypot(sh.x - x, sh.z - z) < TEMPLE_REACH + 4) continue; // no canopy over a temple
    const h = elementalHeight(x, z, seed);
    if (h < ICE_LEVEL + 1) continue;
    const th = 9 + Math.floor(hash3(x, 142, z, seed) * 8);
    for (let i = 1; i <= th; i++) put(x, h + i, z, B.jungle_wood);
    for (const [dy, r] of [[th - 2, 3], [th - 1, 3], [th, 2], [th + 1, 1]]) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && hash3(x + dx, h + dy, z + dz, seed + 143) < 0.7) continue;
        put(x + dx, h + dy, z + dz, B.jungle_leaves, true);
      }
    }
  }
}

// ------------------------------------------------------------------ Shrines (where each biome's boss wakes)

const SHRINE_GRID = 256;
const SHRINE_R = 9;          // a temple's arena radius
const TEMPLE_REACH = 13;     // (the Cloud Kingdom's stair reaches a little further out)
const SKY_TEMPLE_Y = 57;     // the Cloud Kingdom's temple floats at this height
export const SHRINE_BOSS = { frost: 'frost_wraith', volcano: 'magma_colossus', jungle: 'thorn_guardian', clouds: 'tempest' } as const;
export const SHRINE_CORE = { frost: 'frost_shrine', volcano: 'fire_shrine', jungle: 'earth_shrine', clouds: 'wind_shrine' } as const;

export interface Shrine { x: number; y: number; z: number; key: string; biome: ElemBiome; ground: number } // y: just above the arena floor; ground: the land (or cloud) below
function shrineInCell(ax: number, az: number, seed: number): Shrine | null {
  const x = ax * SHRINE_GRID + 40 + Math.floor(hash3(ax, 181, az, seed) * (SHRINE_GRID - 80));
  const z = az * SHRINE_GRID + 40 + Math.floor(hash3(ax, 182, az, seed) * (SHRINE_GRID - 80));
  if (x < ELEM_MIN_X + WALL + 20 || x >= ELEM_MAX_X - WALL - 20) return null;
  const biome = elementalBiome(x, z, seed);
  const ground = Math.max(elementalHeight(x, z, seed), biome === 'volcano' ? LAVA_LEVEL : ICE_LEVEL);
  return { x, y: biome === 'clouds' ? SKY_TEMPLE_Y : ground + 1, z, key: `f${ax},${az}`, biome, ground };
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

function placeShrines(put: Put, cx: number, cz: number, seed: number) {
  const B = BLOCK_ID;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const s = nearestShrine(x0 + 8, z0 + 8, seed);
  if (!s || s.x + TEMPLE_REACH < x0 || s.x - TEMPLE_REACH > x0 + 15 || s.z + TEMPLE_REACH < z0 || s.z - TEMPLE_REACH > z0 + 15) return;
  // Each boss's temple: a round arena (cleared high above: bosses are big, two of them fly), a low wall with four
  // gateways, pillars topped with braziers, two treasure chests at the back, and the shrine's core in the middle.
  // The Cloud Kingdom's floats high above the clouds on a platform, with a spiral stair up from the cloud sea.
  const look = {
    frost: { floor: B.blue_ice, under: B.packed_ice, wall: B.snow_bricks, pillar: B.packed_ice, cap: B.frost_crystal_ore },
    volcano: { floor: B.obsidian, under: B.basalt, wall: B.basalt, pillar: B.obsidian, cap: B.magma_block },
    jungle: { floor: B.mossy_stone_bricks, under: B.stone, wall: B.mossy_cobblestone, pillar: B.jungle_wood, cap: B.lantern },
    clouds: { floor: B.skystone_bricks, under: B.skystone, wall: B.skystone_bricks, pillar: B.skystone, cap: B.lantern },
  }[s.biome];
  const R = SHRINE_R, sky = s.biome === 'clouds';
  for (let i = -R - 1; i <= R + 1; i++) for (let k = -R - 1; k <= R + 1; k++) {
    const r = Math.hypot(i, k);
    if (r > R + 0.5) continue;
    // The floor, with solid ground (or the floating platform's underside) beneath it
    const depth = sky ? 3 + Math.round((R - r) * 0.9) : 12;
    for (let j = -depth; j <= -2; j++) put(s.x + i, s.y + j, s.z + k, look.under);
    put(s.x + i, s.y - 1, s.z + k, look.floor);
    for (let j = 0; j <= (sky ? 16 : 20); j++) put(s.x + i, s.y + j, s.z + k, 0);
    // The ring wall, open at the four gateways
    if (r > R - 0.5 && Math.abs(i) > 1 && Math.abs(k) > 1) for (let j = 0; j <= 1; j++) put(s.x + i, s.y + j, s.z + k, look.wall);
  }
  for (let a = 0; a < 6; a++) {
    const i = Math.round(Math.cos(a * Math.PI / 3 + 0.5) * 7), k = Math.round(Math.sin(a * Math.PI / 3 + 0.5) * 7);
    for (let j = 0; j <= 5; j++) put(s.x + i, s.y + j, s.z + k, look.pillar);
    put(s.x + i, s.y + 6, s.z + k, look.cap);
  }
  put(s.x - 2, s.y, s.z + 7, B.chest); put(s.x + 2, s.y, s.z + 7, B.chest);
  put(s.x, s.y - 1, s.z, B[SHRINE_CORE[s.biome]]);
  if (sky) {
    // The spiral stair: from the cloud sea up round the platform, arriving at its east gateway
    const steps = s.y - 1 - s.ground;
    for (let k = 0; k <= steps; k++) {
      const a = -(steps - k) * 0.11, y = s.ground + k;
      for (const r of [10, 11]) { // (the inner step meets the platform's edge at radius 9)
        const x = s.x + Math.round(Math.cos(a) * r), z = s.z + Math.round(Math.sin(a) * r);
        put(x, y, z, B.skystone_bricks);
        for (let j = 1; j <= 3; j++) put(x, y + j, z, 0);
      }
    }
  }
}

// ------------------------------------------------------------------ Ice ruins (loot, in the Frosted Lands)

const REGION = 40, REACH = 6;
export interface FrostRuin { x: number; y: number; z: number }
function ruinInRegion(rx: number, rz: number, seed: number): FrostRuin | null {
  if (hash3(rx, 161, rz, seed) > 0.3) return null;
  const x = rx * REGION + REACH + Math.floor(hash3(rx, 162, rz, seed) * (REGION - 2 * REACH));
  const z = rz * REGION + REACH + Math.floor(hash3(rx, 163, rz, seed) * (REGION - 2 * REACH));
  if (x < ELEM_MIN_X + WALL + REACH || x >= ELEM_MAX_X - WALL - REACH) return null;
  // Wholly inside the Frosted Lands (all four corners), on dry ground
  for (const [dx, dz] of [[-REACH, -REACH], [REACH, -REACH], [-REACH, REACH], [REACH, REACH]]) if (elementalBiome(x + dx, z + dz, seed) !== 'frost') return null;
  const sh = nearestShrine(x, z, seed);
  if (sh && Math.hypot(sh.x - x, sh.z - z) < TEMPLE_REACH + REACH + 2) return null; // not on a temple
  const h = elementalHeight(x, z, seed);
  if (h < ICE_LEVEL + 1 || h > MAX_Y - 50 || spikeAt(x, z, seed)) return null;
  return { x, y: h, z };
}
export function frostRuinAt(x: number, z: number, seed: number): FrostRuin | null {
  const r = ruinInRegion(Math.floor(x / REGION), Math.floor(z / REGION), seed);
  return r && Math.abs(x - r.x) <= REACH && Math.abs(z - r.z) <= REACH ? r : null;
}

function placeRuins(put: Put, cx: number, cz: number, seed: number) {
  const B = BLOCK_ID;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
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
