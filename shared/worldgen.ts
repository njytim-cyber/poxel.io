// Pure world generation + chunk meshing. No DOM or three.js, so it runs inside Web Workers
// (keeping the main thread free for rendering, input and networking) and on the main thread as a fallback.
import { BLOCKS, BLOCK_ID, WATER, LAVA, isOccluding, isFacingBlock } from './blocks.ts';
import { Noise, hash3 } from './noise.ts';

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

export type Biome = 'plains' | 'forest' | 'pine' | 'desert' | 'snowy' | 'mountains';

export function columnInfo(x: number, z: number, seed: number): { h: number; biome: Biome } {
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

export function generateChunkData(cx: number, cz: number, seed: number): Uint8Array {
  const { n: noise, nb: noiseB, nc: noiseC } = G(seed);
  const d = new Uint8Array(CHUNK_VOLUME);
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
    const { h, biome } = columnInfo(x, z, seed);
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
      else id = oreAt(x, y, z, h, seed);

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

  placeFeatures(d, cx, cz, seed);
  return d;
}

function oreAt(x: number, y: number, z: number, h: number, seed: number): number {
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
//   aData Uint16 x2 : [tile | light<<6 | face<<9 | ao<<12,  u | v<<5]
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
for (const b of BLOCKS) { OCCLUDES[b.id] = isOccluding(b.id) ? 1 : 0; TRANSPARENT[b.id] = b.transparent ? 1 : 0; }

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
    const d0 = BLOCKS[id].tiles[0] | (skyLight(lx, y0 + ly, lz) << 6) | (6 << 9) | (3 << 12);
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
        const liquidBlock = isWater || isLava;
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
        const light = isLava ? 4 : skyLight(nx, y0 + ny, nz);
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
        mask[cell] = 1 + (tile | (light << 6) | (lowered ? 1 << 9 : 0) | (isWater ? 1 << 10 : 0) | (aoKey << 11) | (uniform << 19));
      }

      // 2) Greedy merge: grow each face along a, then along b, while the key matches and AO is flat
      for (let b = 0; b < 16; b++) {
        let a = 0;
        while (a < 16) {
          const cell = (b << 4) | a;
          const key = mask[cell];
          if (!key) { a++; continue; }
          let w = 1, h = 1;
          if ((key - 1) & (1 << 19)) {
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
          const tile = kv & 63, light = (kv >> 6) & 7, lowered = (kv >> 9) & 1, water = (kv >> 10) & 1;
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
            out.vert(p[0] * 16, py, p[2] * 16, tile | (light << 6) | (f << 9) | (aos[k] << 12), uu | (vv << 5));
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
