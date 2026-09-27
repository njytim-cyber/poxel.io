// Authoritative block world. Terrain is regenerated from the seed on demand; only edits are stored.
import { BLOCKS, BLOCK_ID, isFacingBlock } from '../../shared/blocks.ts';
import { generateChunkData, computeHeights, idx, blocksSky, columnInfo, MIN_Y, MAX_Y, SEA_LEVEL } from '../../shared/worldgen.ts';

interface ServerChunk { data: Uint8Array; heights: Int16Array; lastUsed: number }

const ckey = (cx: number, cz: number) => cx + ',' + cz;

export class ServerWorld {
  readonly seed: number;
  private chunks = new Map<string, ServerChunk>();
  private mods = new Map<string, Map<number, number>>();
  readonly facing = new Map<string, number>();
  private now = 0;

  constructor(seed: number) {
    this.seed = seed | 0;
  }

  private chunk(cx: number, cz: number): ServerChunk {
    const key = ckey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      const data = generateChunkData(cx, cz, this.seed);
      const m = this.mods.get(key);
      if (m) for (const [i, id] of m) data[i] = id;
      c = { data, heights: computeHeights(data), lastUsed: this.now };
      this.chunks.set(key, c);
    }
    c.lastUsed = this.now;
    return c;
  }

  // Block lookup that generates terrain as needed (bound so it can be passed to shared physics)
  get = (x: number, y: number, z: number): number => {
    if (y < MIN_Y) return BLOCK_ID.bedrock;
    if (y > MAX_Y) return 0;
    return this.chunk(x >> 4, z >> 4).data[idx(x & 15, y, z & 15)];
  };

  isLoaded(x: number, z: number) { return this.chunks.has(ckey(x >> 4, z >> 4)); }

  surfaceHeight(x: number, z: number): number {
    return this.chunk(x >> 4, z >> 4).heights[((z & 15) << 4) | (x & 15)];
  }

  set(x: number, y: number, z: number, id: number, facing = -1) {
    if (y < MIN_Y || y > MAX_Y || !(id >= 0 && id < BLOCKS.length)) return;
    const key = ckey(x >> 4, z >> 4);
    const lx = x & 15, lz = z & 15, i = idx(lx, y, lz);
    let m = this.mods.get(key);
    if (!m) { m = new Map(); this.mods.set(key, m); }
    m.set(i, id);
    const fk = `${x},${y},${z}`;
    if (isFacingBlock(id) && facing >= 0) this.facing.set(fk, facing & 3);
    else this.facing.delete(fk);

    const c = this.chunk(x >> 4, z >> 4);
    c.data[i] = id;
    const col = (lz << 4) | lx;
    if (blocksSky(id) && y > c.heights[col]) c.heights[col] = y;
    else if (!blocksSky(id) && y === c.heights[col]) {
      let ny = y - 1;
      while (ny > MIN_Y && !blocksSky(c.data[idx(lx, ny, lz)])) ny--;
      c.heights[col] = ny;
    }
  }

  // Frees chunks nobody has touched recently (edits stay in `mods`)
  tick(dt: number) {
    this.now += dt;
    for (const [k, c] of this.chunks) if (this.now - c.lastUsed > 60) this.chunks.delete(k);
  }

  chunkCount() { return this.chunks.size; }

  findSpawn(): [number, number, number] {
    for (const strict of [true, false]) for (let r = 0; r < 400; r += 6) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
        const { h, biome } = columnInfo(x, z, this.seed);
        if (h > SEA_LEVEL + 1 && (!strict || biome === 'plains' || biome === 'forest' || biome === 'pine')) {
          // Stand on real ground, not on a treetop or in a ravine
          const top = this.surfaceHeight(x, z);
          const ground = this.get(x, top, z);
          if (strict && ground !== BLOCK_ID.grass && ground !== BLOCK_ID.snowy_grass && ground !== BLOCK_ID.sand) continue;
          return [x + 0.5, top + 1, z + 0.5];
        }
      }
    }
    return [0.5, this.surfaceHeight(0, 0) + 1, 0.5];
  }

  // Flat [x, y, z, id, ...] of every edit, for saves and new players
  exportEdits(): number[] {
    const out: number[] = [];
    for (const [key, m] of this.mods) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [i, id] of m) out.push(cx * 16 + (i & 15), (i >> 8) + MIN_Y, cz * 16 + ((i >> 4) & 15), id);
    }
    return out;
  }

  importEdits(flat: number[]) {
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const [x, y, z, id] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
      if (![x, y, z, id].every(Number.isInteger) || y < MIN_Y || y > MAX_Y || id < 0 || id >= BLOCKS.length) continue;
      const key = ckey(x >> 4, z >> 4);
      let m = this.mods.get(key);
      if (!m) { m = new Map(); this.mods.set(key, m); }
      m.set(idx(x & 15, y, z & 15), id);
      this.chunks.delete(key); // regenerate with the edit applied
    }
  }

  exportFacing(): number[] {
    const out: number[] = [];
    for (const [k, f] of this.facing) { const [x, y, z] = k.split(',').map(Number); out.push(x, y, z, f); }
    return out;
  }

  importFacing(flat: number[]) {
    for (let i = 0; i + 3 < flat.length; i += 4) if ([0, 1, 2, 3].every(k => Number.isInteger(flat[i + k]))) this.facing.set(`${flat[i]},${flat[i + 1]},${flat[i + 2]}`, flat[i + 3] & 3);
  }
}
