import * as THREE from 'three';
import { BLOCKS, BLOCK_ID, WATER, LAVA, isOccluding, isFacingBlock, TILE_COUNT } from './blocks';
import { atlasTexture, tileUV } from './textures';
import { Noise, hash3 } from './noise';

// World layout: block (x,y,z) occupies [x,x+1) x [y,y+1) x [z,z+1)
export const CHUNK = 16;
export const MIN_Y = -104;
export const HEIGHT = 176;
export const MAX_Y = MIN_Y + HEIGHT - 1;
const SECTIONS = HEIGHT / 16;
export const SEA_LEVEL = 3;
export let RENDER_DIST = 4; // chunks

const B = BLOCK_ID;

export const worldGroup = new THREE.Group();

// ------------------------------------------------------------------ Materials

export const worldUniforms = {
  uDaylight: { value: 1.0 },
};

const vertexShader = `
attribute float aShade;
attribute float aLight;
varying vec2 vUv;
varying float vShade;
varying float vLight;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vShade = aShade;
  vLight = aLight;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = `
uniform sampler2D map;
uniform float uDaylight;
uniform float uOpacity;
varying vec2 vUv;
varying float vShade;
varying float vLight;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.5) discard;
  float l = vLight > 1.5 ? 1.0 : max(vLight * uDaylight, 0.07 + 0.05 * uDaylight);
  gl_FragColor = vec4(tex.rgb * vShade * l, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeMaterial(opacity: number, transparent: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: atlasTexture }, uOpacity: { value: opacity } }]),
    vertexShader, fragmentShader, fog: true, transparent, depthWrite: !transparent,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
}
const opaqueMaterial = makeMaterial(1, false);
const liquidMaterial = makeMaterial(0.72, true);
// Share the daylight uniform object so one write updates both
opaqueMaterial.uniforms.uDaylight = worldUniforms.uDaylight;
liquidMaterial.uniforms.uDaylight = worldUniforms.uDaylight;
opaqueMaterial.uniforms.map.value = atlasTexture;
liquidMaterial.uniforms.map.value = atlasTexture;

// ------------------------------------------------------------------ Chunk storage

class Chunk {
  data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  heights = new Int16Array(CHUNK * CHUNK); // highest sky-blocking y per column
  meshes: (THREE.Mesh | null)[] = new Array(SECTIONS * 2).fill(null);
  meshed = false;
  dirty = new Set<number>();
  constructor(public cx: number, public cz: number) {}
}

const chunks = new Map<string, Chunk>();
const ckey = (cx: number, cz: number) => cx + ',' + cz;
const idx = (lx: number, y: number, lz: number) => ((y - MIN_Y) << 8) | (lz << 4) | lx;

// Player edits: chunkKey -> (local index -> block id). Kept for chunks even while unloaded.
const mods = new Map<string, Map<number, number>>();
// Facing of furnaces/pumpkins: "x,y,z" -> 0..3
export const facing = new Map<string, number>();

let seed = 1337;
let noise = new Noise(seed);
let noiseB = new Noise(seed + 1);
let noiseC = new Noise(seed + 2);

export function getSeed() { return seed; }

export function resetWorld(newSeed: number) {
  for (const c of chunks.values()) disposeChunk(c);
  chunks.clear();
  mods.clear();
  facing.clear();
  seed = newSeed | 0;
  noise = new Noise(seed);
  noiseB = new Noise(seed + 1);
  noiseC = new Noise(seed + 2);
}

// ------------------------------------------------------------------ Block access

export function getBlock(x: number, y: number, z: number): number {
  if (y < MIN_Y) return B.bedrock;
  if (y > MAX_Y) return 0;
  const cx = x >> 4, cz = z >> 4;
  const c = chunks.get(ckey(cx, cz));
  if (!c) return B.bedrock; // unloaded terrain behaves as solid so nothing falls through
  return c.data[idx(x & 15, y, z & 15)];
}

export function isLoaded(x: number, z: number) {
  return chunks.has(ckey(x >> 4, z >> 4));
}

export function surfaceHeight(x: number, z: number): number {
  const c = chunks.get(ckey(x >> 4, z >> 4));
  if (!c) return columnInfo(x, z).h;
  return c.heights[((z & 15) << 4) | (x & 15)];
}

export function setBlock(x: number, y: number, z: number, id: number) {
  if (y < MIN_Y || y > MAX_Y) return;
  const cx = x >> 4, cz = z >> 4;
  const key = ckey(cx, cz);
  const c = chunks.get(key);
  if (!c) return;
  const lx = x & 15, lz = z & 15, i = idx(lx, y, lz);
  if (c.data[i] === id) return;
  c.data[i] = id;

  let m = mods.get(key);
  if (!m) { m = new Map(); mods.set(key, m); }
  m.set(i, id);
  if (!isFacingBlock(id)) facing.delete(`${x},${y},${z}`);

  // Heightmap update (affects sky light of everything below)
  const col = (lz << 4) | lx;
  const oldH = c.heights[col];
  if (blocksSky(id) && y > oldH) c.heights[col] = y;
  else if (!blocksSky(id) && y === oldH) {
    let ny = y - 1;
    while (ny > MIN_Y && !blocksSky(c.data[idx(lx, ny, lz)])) ny--;
    c.heights[col] = ny;
  }
  const newH = c.heights[col];

  const sec = (y - MIN_Y) >> 4;
  markDirty(c, sec);
  if (((y - MIN_Y) & 15) === 0) markDirty(c, sec - 1);
  if (((y - MIN_Y) & 15) === 15) markDirty(c, sec + 1);
  if (newH !== oldH) {
    const lo = (Math.min(oldH, newH) - MIN_Y) >> 4, hi = (Math.max(oldH, newH) - MIN_Y) >> 4;
    for (let s = Math.max(0, lo - 1); s <= hi; s++) markDirty(c, s);
  }
  // Neighbouring chunks share faces / AO at the borders
  const markNeighbour = (ncx: number, ncz: number) => {
    const n = chunks.get(ckey(ncx, ncz));
    if (n) { markDirty(n, sec); markDirty(n, sec - 1); markDirty(n, sec + 1); }
  };
  if (lx === 0) markNeighbour(cx - 1, cz);
  if (lx === 15) markNeighbour(cx + 1, cz);
  if (lz === 0) markNeighbour(cx, cz - 1);
  if (lz === 15) markNeighbour(cx, cz + 1);
}

function markDirty(c: Chunk, sec: number) {
  if (sec >= 0 && sec < SECTIONS && c.meshed) c.dirty.add(sec);
}

const blocksSky = (id: number) => id !== 0 && id !== WATER && id !== B.glass && !BLOCKS[id].plant;

// ------------------------------------------------------------------ Generation

type Biome = 'plains' | 'forest' | 'pine' | 'desert' | 'snowy' | 'mountains';

export function columnInfo(x: number, z: number): { h: number; biome: Biome } {
  const temp = noiseB.fbm2(x / 300, z / 300, 2);
  const humid = noiseC.fbm2(x / 260 + 50, z / 260 + 50, 2);
  const mountain = noise.fbm2(x / 220 + 300, z / 220 + 300, 3);
  const base = 8 + noise.fbm2(x / 110, z / 110, 4) * 16;
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

export function biomeAt(x: number, z: number): string {
  return columnInfo(Math.floor(x), Math.floor(z)).biome;
}

const CAVE_STEP = 4;
function generateChunk(cx: number, cz: number): Chunk {
  const c = new Chunk(cx, cz);
  const d = c.data;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  // Coarse cave noise grid, trilinearly interpolated per block (16x fewer noise calls)
  const gy = HEIGHT / CAVE_STEP + 1, gx = CHUNK / CAVE_STEP + 1;
  const tunnelA = new Float32Array(gx * gx * gy), tunnelB = new Float32Array(gx * gx * gy), cheese = new Float32Array(gx * gx * gy);
  for (let ix = 0; ix < gx; ix++) for (let iz = 0; iz < gx; iz++) for (let iy = 0; iy < gy; iy++) {
    const wx = x0 + ix * CAVE_STEP, wz = z0 + iz * CAVE_STEP, wy = MIN_Y + iy * CAVE_STEP;
    const gi = (ix * gx + iz) * gy + iy;
    tunnelA[gi] = noiseB.noise3(wx / 28, wy / 18, wz / 28);
    tunnelB[gi] = noiseC.noise3(wx / 28 + 71, wy / 18, wz / 28 + 13);
    cheese[gi] = noise.noise3(wx / 52, wy / 30, wz / 52);
  }
  const sample = (arr: Float32Array, lx: number, y: number, lz: number) => {
    const fx = lx / CAVE_STEP, fz = lz / CAVE_STEP, fy = (y - MIN_Y) / CAVE_STEP;
    const ix = Math.min(gx - 2, fx | 0), iz = Math.min(gx - 2, fz | 0), iy = Math.min(gy - 2, fy | 0);
    const tx = fx - ix, tz = fz - iz, ty = fy - iy;
    const g = (a: number, b: number, c2: number) => arr[((ix + a) * gx + iz + b) * gy + iy + c2];
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(g(0, 0, 0), g(1, 0, 0), tx), l(g(0, 1, 0), g(1, 1, 0), tx), tz),
      l(l(g(0, 0, 1), g(1, 0, 1), tx), l(g(0, 1, 1), g(1, 1, 1), tx), tz), ty);
  };

  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    const x = x0 + lx, z = z0 + lz;
    const { h, biome } = columnInfo(x, z);
    const underwater = h < SEA_LEVEL;
    const beach = h <= SEA_LEVEL + 1 && biome !== 'snowy';

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
      else if (y > h) id = WATER;
      else if (depth === 0) {
        if (underwater) id = hash3(x >> 2, 0, z >> 2, seed + 9) < 0.25 ? B.clay : (hash3(x >> 1, 1, z >> 1, seed) < 0.3 ? B.gravel : B.sand);
        else if (biome === 'desert' || beach) id = B.sand;
        else if (biome === 'snowy') id = B.snowy_grass;
        else if (biome === 'mountains' && h > 30) id = h > 42 ? B.snowy_grass : B.stone;
        else id = B.grass;
      } else if (depth <= 3) {
        if (biome === 'desert' || beach || underwater) id = depth <= 2 ? B.sand : B.sandstone;
        else if (biome === 'mountains' && h > 30) id = B.stone;
        else id = B.dirt;
      } else if (biome === 'desert' && depth <= 6) id = B.sandstone;
      else id = oreAt(x, y, z, h);

      // Carve caves (keep a solid roof under water so lakes don't drain visually)
      if (id !== WATER && id !== B.bedrock && y > MIN_Y + 5 && !(underwater && depth < 5) && !(beach && depth < 3)) {
        const a = sample(tunnelA, lx, y, lz), b2 = sample(tunnelB, lx, y, lz);
        // Tunnels get wider near ravine floors so ravines connect into the cave network
        const nearRavine = ravineFloor !== Infinity && y < ravineFloor + 6;
        const tunnel = a * a + b2 * b2 < (nearRavine ? 0.02 : 0.0045);
        const room = y < h - 10 && sample(cheese, lx, y, lz) > 0.42;
        if (tunnel || room || y >= ravineFloor) id = y <= MIN_Y + 18 ? LAVA : 0;
      }
      d[idx(lx, y, lz)] = id;
    }

    // Grass tufts and flowers on untouched grass
    const top = d[idx(lx, h, lz)];
    if (top === B.grass && h + 1 <= MAX_Y && d[idx(lx, h + 1, lz)] === 0) {
      const r = hash3(x, 3, z, seed);
      const [grassP, flowerP] = biome === 'plains' ? [0.2, 0.035] : biome === 'forest' ? [0.12, 0.015] : biome === 'pine' ? [0.1, 0.008] : [0.05, 0.005];
      if (r < flowerP) {
        const f = hash3(x, 4, z, seed);
        d[idx(lx, h + 1, lz)] = biome === 'pine' ? B.cornflower : f < 0.5 ? B.dandelion : f < 0.85 ? B.poppy : B.cornflower;
      } else if (r < flowerP + grassP) d[idx(lx, h + 1, lz)] = B.tall_grass;
    }
  }

  placeFeatures(c);

  // Apply player modifications
  const m = mods.get(ckey(cx, cz));
  if (m) for (const [i, id] of m) d[i] = id;

  computeHeights(c);
  return c;
}

function oreAt(x: number, y: number, z: number, h: number): number {
  const r = hash3(x, y, z, seed + 3);
  const vein = (salt: number, p: number) => hash3(x >> 1, y >> 1, z >> 1, seed + salt) < p && r < 0.7;
  if (y < -92 && vein(11, 0.018)) return B.etherite_ore;
  if (y < -80 && vein(12, 0.022)) return B.moonstone_ore;
  if (y < -64 && vein(13, 0.028)) return B.diamond_ore;
  if (y < -32 && vein(14, 0.035)) return B.gold_ore;
  if (y < h - 6 && y > -95 && vein(15, 0.06)) return B.iron_ore;
  if (y < h - 4 && y > -60 && vein(16, 0.08)) return B.coal_ore;
  if (y < h - 8 && hash3(x >> 2, y >> 2, z >> 2, seed + 17) < 0.02) return B.gravel;
  return B.stone;
}

function placeFeatures(c: Chunk) {
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
  const put = (x: number, y: number, z: number, id: number, onlyAir = false) => {
    const lx = x - x0, lz = z - z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < MIN_Y || y > MAX_Y) return;
    const i = idx(lx, y, lz);
    if (onlyAir && c.data[i] !== 0) return;
    c.data[i] = id;
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
    const { h, biome } = columnInfo(x, z);
    if (h < SEA_LEVEL + 1) continue;
    if (Math.abs(x) < 4 && Math.abs(z) < 4) continue; // clear spawn
    const r2 = hash3(x, 8, z, seed);
    if (biome === 'desert') {
      if (r < 0.006) { const ch = 1 + Math.floor(r2 * 3); for (let i = 1; i <= ch; i++) put(x, h + i, z, B.cactus); }
      continue;
    }
    if (biome === 'plains' && r < 0.0015) { put(x, h + 1, z, B.pumpkin); continue; }
    const density = biome === 'forest' ? 0.035 : biome === 'pine' ? 0.03 : biome === 'snowy' ? 0.01 : biome === 'mountains' ? (h > 30 ? 0 : 0.006) : 0.005;
    if (r >= density) continue;
    // Trees need ground: skip ravines/caves under the trunk
    const lx0 = x - x0, lz0 = z - z0;
    if (lx0 >= 0 && lx0 < 16 && lz0 >= 0 && lz0 < 16 && c.data[idx(lx0, h, lz0)] === 0) continue;

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
}

function computeHeights(c: Chunk) {
  for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
    let y = MAX_Y;
    while (y > MIN_Y && !blocksSky(c.data[idx(lx, y, lz)])) y--;
    c.heights[(lz << 4) | lx] = y;
  }
}

export function ensureChunk(cx: number, cz: number): Chunk {
  const key = ckey(cx, cz);
  let c = chunks.get(key);
  if (!c) { c = generateChunk(cx, cz); chunks.set(key, c); }
  return c;
}

// ------------------------------------------------------------------ Meshing

// Face order matches BlockDef.tiles: +x, -x, +y, -y, +z, -z. Corners: BL, BR, TR, TL seen from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.62 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.62 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
];
const AO_CURVE = [0.45, 0.65, 0.82, 1.0];
// For a facing block, which face index shows the front texture: facing 0:+z 1:+x 2:-z 3:-x
const FRONT_FACE = [4, 0, 5, 1];

// Pre-computed tile UVs
const UVS: [number, number, number, number][] = [];
for (let t = 0; t < TILE_COUNT; t++) UVS.push(tileUV(t));

class MeshBuilder {
  pos: number[] = []; uv: number[] = []; shade: number[] = []; light: number[] = []; index: number[] = [];
  get empty() { return this.index.length === 0; }
}

function buildSection(c: Chunk, sec: number) {
  const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK, yBase = MIN_Y + sec * 16;
  const d = c.data;
  const nb = {
    px: chunks.get(ckey(c.cx + 1, c.cz)), nx: chunks.get(ckey(c.cx - 1, c.cz)),
    pz: chunks.get(ckey(c.cx, c.cz + 1)), nz: chunks.get(ckey(c.cx, c.cz - 1)),
  };
  // Fast local lookup with fallback across chunk borders
  const get = (lx: number, y: number, lz: number): number => {
    if (y < MIN_Y) return B.bedrock;
    if (y > MAX_Y) return 0;
    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) return d[idx(lx, y, lz)];
    return getBlock(x0 + lx, y, z0 + lz);
  };
  const heightAtLocal = (lx: number, lz: number): number => {
    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) return c.heights[(lz << 4) | lx];
    const n = lx < 0 ? nb.nx : lx > 15 ? nb.px : lz < 0 ? nb.nz : nb.pz;
    if (!n || (lx < 0 || lx > 15) && (lz < 0 || lz > 15)) return -1e4;
    return n.heights[((lz & 15) << 4) | (lx & 15)];
  };
  const skyLight = (lx: number, y: number, lz: number): number => {
    if (y > heightAtLocal(lx, lz)) return 1;
    // Near an opening: partial light so overhangs/cave mouths aren't pitch black
    if (y > heightAtLocal(lx + 1, lz) || y > heightAtLocal(lx - 1, lz) || y > heightAtLocal(lx, lz + 1) || y > heightAtLocal(lx, lz - 1)) return 0.6;
    if (y > heightAtLocal(lx + 2, lz) || y > heightAtLocal(lx - 2, lz) || y > heightAtLocal(lx, lz + 2) || y > heightAtLocal(lx, lz - 2)) return 0.3;
    return 0;
  };

  const solid = new MeshBuilder(), liquid = new MeshBuilder();

  for (let ly = 0; ly < 16; ly++) {
    const y = yBase + ly;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const id = d[idx(lx, y, lz)];
      if (id === 0) continue;
      const def = BLOCKS[id];
      if (def.plant) { addPlant(solid, x0 + lx, y, z0 + lz, def.tiles[0], skyLight(lx, y, lz)); continue; }
      const isWater = id === WATER, isLava = id === LAVA;
      const liquidBlock = isWater || isLava;
      const out = isWater ? liquid : solid;
      let tiles = def.tiles;
      if (isFacingBlock(id)) {
        const f = facing.get(`${x0 + lx},${y},${z0 + lz}`) ?? 0;
        const front = FRONT_FACE[f];
        const side = def.tiles[0];
        tiles = [side, side, def.tiles[2], def.tiles[3], side, side] as typeof tiles;
        tiles[front] = def.tiles[4];
      }
      // Liquids sit slightly lower when nothing of the same liquid is above
      const lowerTop = liquidBlock && get(lx, y + 1, lz) !== id;

      for (let f = 0; f < 6; f++) {
        const face = FACES[f];
        const nx = lx + face.n[0], ny = y + face.n[1], nz = lz + face.n[2];
        const nid = get(nx, ny, nz);
        if (liquidBlock) {
          if (nid === id || isOccluding(nid) && !(f === 2 && lowerTop)) continue;
          if (isWater && nid === LAVA) continue;
        } else {
          if (isOccluding(nid)) continue;
          if (nid === id && def.transparent) continue; // leaves/glass: skip inner faces
        }

        const base = out.pos.length / 3;
        const [u0, v0, u1, v1] = UVS[tiles[f]];
        const lightVal = isLava ? 2 : skyLight(nx, ny, nz);
        const aos: number[] = [];
        for (let k = 0; k < 4; k++) {
          const cc = face.c[k];
          let py = y + cc[1];
          if (lowerTop && cc[1] === 1) py -= 0.125;
          out.pos.push(x0 + lx + cc[0], py, z0 + lz + cc[2]);
          out.uv.push(k === 0 || k === 3 ? u0 : u1, k < 2 ? v0 : v1);
          // Ambient occlusion from the three blocks touching this corner on the outside
          let ao = 3;
          if (!liquidBlock) {
            const t: number[] = [];
            for (let a = 0; a < 3; a++) if (face.n[a] === 0) t.push(a);
            const s1 = [0, 0, 0], s2 = [0, 0, 0];
            s1[t[0]] = cc[t[0]] ? 1 : -1;
            s2[t[1]] = cc[t[1]] ? 1 : -1;
            const o1 = isOccluding(get(nx + s1[0], ny + s1[1], nz + s1[2])) ? 1 : 0;
            const o2 = isOccluding(get(nx + s2[0], ny + s2[1], nz + s2[2])) ? 1 : 0;
            const oc = isOccluding(get(nx + s1[0] + s2[0], ny + s1[1] + s2[1], nz + s1[2] + s2[2])) ? 1 : 0;
            ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
          }
          aos.push(ao);
          out.shade.push(face.shade * AO_CURVE[ao]);
          out.light.push(lightVal);
        }
        // Flip the quad diagonal so AO gradients interpolate evenly
        if (aos[0] + aos[2] < aos[1] + aos[3]) out.index.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }

  setSectionMesh(c, sec, solid, opaqueMaterial, 0);
  setSectionMesh(c, sec, liquid, liquidMaterial, SECTIONS);
}

// Two crossed, double-sided quads
const PLANT_QUADS = [
  [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
  [[0.15, 0, 0.85], [0.85, 0, 0.15], [0.85, 1, 0.15], [0.15, 1, 0.85]],
];
function addPlant(out: MeshBuilder, x: number, y: number, z: number, tile: number, light: number) {
  const [u0, v0, u1, v1] = UVS[tile];
  for (const q of PLANT_QUADS) {
    const base = out.pos.length / 3;
    q.forEach((c, k) => {
      out.pos.push(x + c[0], y + c[1], z + c[2]);
      out.uv.push(k === 0 || k === 3 ? u0 : u1, k < 2 ? v0 : v1);
      out.shade.push(0.9);
      out.light.push(light);
    });
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    out.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

function setSectionMesh(c: Chunk, sec: number, mb: MeshBuilder, mat: THREE.Material, offset: number) {
  const slot = sec + offset;
  const old = c.meshes[slot];
  if (old) { worldGroup.remove(old); old.geometry.dispose(); c.meshes[slot] = null; }
  if (mb.empty) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(mb.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(mb.uv, 2));
  geo.setAttribute('aShade', new THREE.Float32BufferAttribute(mb.shade, 1));
  geo.setAttribute('aLight', new THREE.Float32BufferAttribute(mb.light, 1));
  geo.setIndex(mb.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(mb.index, 1) : new THREE.Uint16BufferAttribute(mb.index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  if (offset) mesh.renderOrder = 1;
  worldGroup.add(mesh);
  c.meshes[slot] = mesh;
}

function meshChunk(c: Chunk) {
  for (let s = 0; s < SECTIONS; s++) buildSection(c, s);
  c.meshed = true;
  c.dirty.clear();
}

function disposeChunk(c: Chunk) {
  for (const m of c.meshes) if (m) { worldGroup.remove(m); m.geometry.dispose(); }
  c.meshes.fill(null);
  c.meshed = false;
}

// ------------------------------------------------------------------ Streaming

let lastCenter = '';
let wanted: [number, number][] = [];

// Generates/meshes chunks around the player within a per-frame time budget, nearest first.
export function updateWorld(pos: THREE.Vector3, budgetMs = 6) {
  const pcx = Math.floor(pos.x) >> 4, pcz = Math.floor(pos.z) >> 4;
  const center = ckey(pcx, pcz);
  if (center !== lastCenter) {
    lastCenter = center;
    wanted = [];
    const R = RENDER_DIST + 1;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) wanted.push([pcx + dx, pcz + dz]);
    wanted.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
    // Unload far chunks
    for (const [key, c] of chunks) {
      if (Math.abs(c.cx - pcx) > RENDER_DIST + 3 || Math.abs(c.cz - pcz) > RENDER_DIST + 3) { disposeChunk(c); chunks.delete(key); }
    }
  }

  // Edited sections first — these must feel instant
  for (const c of chunks.values()) {
    if (c.dirty.size) { for (const s of c.dirty) buildSection(c, s); c.dirty.clear(); }
  }

  const start = performance.now();
  for (const [cx, cz] of wanted) {
    if (performance.now() - start > budgetMs) break;
    const c = chunks.get(ckey(cx, cz));
    if (!c) { ensureChunk(cx, cz); continue; }
    if (c.meshed) continue;
    if (Math.abs(cx - pcx) > RENDER_DIST || Math.abs(cz - pcz) > RENDER_DIST) continue;
    // Mesh only once all 4 neighbours exist so border faces are correct
    const ready = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => chunks.has(ckey(cx + a, cz + b)));
    if (!ready) {
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!chunks.has(ckey(cx + a, cz + b))) ensureChunk(cx + a, cz + b);
      continue;
    }
    meshChunk(c);
  }
}

// Generate the area around a point synchronously (spawn, teleport, load)
export function loadAreaNow(x: number, z: number, radius = 1) {
  const pcx = Math.floor(x) >> 4, pcz = Math.floor(z) >> 4;
  for (let dx = -radius - 1; dx <= radius + 1; dx++) for (let dz = -radius - 1; dz <= radius + 1; dz++) ensureChunk(pcx + dx, pcz + dz);
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const c = chunks.get(ckey(pcx + dx, pcz + dz))!;
    if (!c.meshed) meshChunk(c);
  }
  lastCenter = '';
}

export function findSpawn(): THREE.Vector3 {
  // Prefer grassy land; fall back to any dry land
  for (const strict of [true, false]) for (let r = 0; r < 400; r += 6) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
      const { h, biome } = columnInfo(x, z);
      if (h > SEA_LEVEL + 1 && (!strict || biome === 'plains' || biome === 'forest' || biome === 'pine')) {
        loadAreaNow(x, z, 1);
        const top = surfaceHeight(x, z);
        return new THREE.Vector3(x + 0.5, top + 1, z + 0.5);
      }
    }
  }
  loadAreaNow(0, 0, 1);
  return new THREE.Vector3(0.5, surfaceHeight(0, 0) + 1, 0.5);
}

// ------------------------------------------------------------------ Raycast (voxel DDA)

export interface RayHit { x: number; y: number; z: number; id: number; nx: number; ny: number; nz: number; dist: number; }

export function raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity, tdy = sy ? Math.abs(1 / dir.y) : Infinity, tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = getBlock(x, y, z);
    if (id !== 0 && id !== WATER && id !== LAVA && isLoaded(x, z)) return { x, y, z, id, nx, ny, nz, dist: t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

// ------------------------------------------------------------------ Save support

export function exportMods(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, m] of mods) {
    const [cx, cz] = key.split(',').map(Number);
    for (const [i, id] of m) {
      const lx = i & 15, lz = (i >> 4) & 15, y = (i >> 8) + MIN_Y;
      out[`${cx * 16 + lx},${y},${cz * 16 + lz}`] = BLOCKS[id].name;
    }
  }
  return out;
}

export function importMods(edits: Record<string, string>) {
  for (const k of Object.keys(edits)) {
    const [x, y, z] = k.split(',').map(Number);
    let id = BLOCK_ID[edits[k]];
    if (edits[k] === 'air') id = 0;
    if (id === undefined || !Number.isFinite(x + y + z) || y < MIN_Y || y > MAX_Y) continue;
    const key = ckey(x >> 4, z >> 4);
    let m = mods.get(key);
    if (!m) { m = new Map(); mods.set(key, m); }
    m.set(idx(x & 15, y, z & 15), id);
  }
}

export function chunkCount() { return chunks.size; }
