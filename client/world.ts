import * as THREE from 'three';
import { BLOCKS, BLOCK_ID, WATER, LAVA, ATLAS_COLS, ATLAS_ROWS, isFacingBlock, isLiquid } from '../shared/blocks.ts';
import { atlasTexture } from './textures';
import {
  CHUNK, MIN_Y, HEIGHT, MAX_Y, SECTIONS, SEA_LEVEL, idx, blocksSky, computeHeights, generateChunkData,
  meshSection, columnInfo as genColumnInfo, PAD_B, PAD_H, type SectionInput, type SectionOutput, type MeshArrays,
} from '../shared/worldgen.ts';

export { CHUNK, MIN_Y, HEIGHT, MAX_Y, SEA_LEVEL };
export let RENDER_DIST = 4; // chunks

const B = BLOCK_ID;
export const worldGroup = new THREE.Group();

// ------------------------------------------------------------------ Materials

export const worldUniforms = { uDaylight: { value: 1.0 } };

// Packed vertex format from shared/worldgen.ts: aPos in 1/16 blocks, aData = [tile|light|face|ao, u|v]
const vertexShader = `
attribute vec3 aPos;
attribute vec2 aData;
varying vec2 vUv;
varying vec2 vTile;
varying float vShade;
varying float vLight;
#include <fog_pars_vertex>
void main() {
  float d = aData.x;
  float tile = mod(d, 256.0); d = floor(d / 256.0);
  float light = mod(d, 8.0); d = floor(d / 8.0);
  float face = mod(d, 8.0);
  float ao = floor(d / 8.0);
  vUv = vec2(mod(aData.y, 32.0), floor(aData.y / 32.0));
  vTile = vec2(mod(tile, ${ATLAS_COLS}.0), floor(tile / ${ATLAS_COLS}.0));
  float shade = face < 1.5 ? 0.62 : face < 2.5 ? 1.0 : face < 3.5 ? 0.5 : face < 5.5 ? 0.8 : 0.9;
  float aoMul = ao < 0.5 ? 0.45 : ao < 1.5 ? 0.65 : ao < 2.5 ? 0.82 : 1.0;
  vShade = shade * aoMul;
  vLight = light < 0.5 ? 0.0 : light < 1.5 ? 0.3 : light < 2.5 ? 0.6 : light < 3.5 ? 1.0 : 2.0;
  vec4 mvPosition = modelViewMatrix * vec4(aPos / 16.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = `
uniform sampler2D map;
uniform float uDaylight;
uniform float uOpacity;
varying vec2 vUv;
varying vec2 vTile;
varying float vShade;
varying float vLight;
#include <fog_pars_fragment>
void main() {
  // Repeat the tile across merged quads (vUv is in block units)
  vec2 f = clamp(fract(vUv), 0.001, 0.999);
  vec2 uv = vec2((vTile.x + f.x) / ${ATLAS_COLS}.0, (${ATLAS_ROWS}.0 - vTile.y - 1.0 + f.y) / ${ATLAS_ROWS}.0);
  vec4 tex = texture2D(map, uv);
  if (tex.a < 0.5) discard;
  float l = vLight > 1.5 ? 1.0 : max(vLight * uDaylight, 0.07 + 0.05 * uDaylight);
  gl_FragColor = vec4(tex.rgb * vShade * l, uOpacity);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function makeMaterial(opacity: number, transparent: boolean) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: atlasTexture }, uOpacity: { value: opacity } }]),
    vertexShader, fragmentShader, fog: true, transparent, depthWrite: !transparent,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.uniforms.uDaylight = worldUniforms.uDaylight; // shared, so one write updates every material
  m.uniforms.map.value = atlasTexture;
  return m;
}
const opaqueMaterial = makeMaterial(1, false);
const liquidMaterial = makeMaterial(0.72, true);
export const worldMaterials: THREE.Material[] = [opaqueMaterial, liquidMaterial];

// ------------------------------------------------------------------ Chunk storage

class Chunk {
  heights: Int16Array;
  meshes: (THREE.Mesh | null)[] = [null, null]; // one opaque + one water mesh per chunk (2 draw calls)
  sectionOut: (SectionOutput | null)[] = new Array(SECTIONS).fill(null);
  geometryDirty = false;
  meshState: 0 | 1 | 2 = 0;               // 0 none, 1 requested from workers, 2 done
  sectionVersion = new Int32Array(SECTIONS); // bumps on edit so stale async meshes are ignored
  pendingSections = 0;
  dirty = new Set<number>();
  constructor(public cx: number, public cz: number, public data: Uint8Array) {
    this.heights = computeHeights(data);
  }
}

const chunks = new Map<string, Chunk>();
const pendingGen = new Set<string>();
const MAX_UPLOADS_PER_FRAME = 2;
const ckey = (cx: number, cz: number) => cx + ',' + cz;

// Player edits: chunkKey -> (local index -> block id). Kept for chunks even while unloaded.
const mods = new Map<string, Map<number, number>>();
// Facing of furnaces/pumpkins, per chunk: chunkKey -> (local index -> 0..3)
const facingByChunk = new Map<string, Map<number, number>>();

export function setFacing(x: number, y: number, z: number, f: number) {
  if (y < MIN_Y || y > MAX_Y) return;
  const key = ckey(x >> 4, z >> 4);
  let m = facingByChunk.get(key);
  if (!m) { m = new Map(); facingByChunk.set(key, m); }
  m.set(idx(x & 15, y, z & 15), f & 3);
}

let seed = 1337;
let epoch = 0; // bumps on reset; results from an older world are dropped

export function getSeed() { return seed; }

export function resetWorld(newSeed: number) {
  for (const c of chunks.values()) disposeChunk(c);
  chunks.clear();
  pendingGen.clear();
  mods.clear();
  facingByChunk.clear();
  seed = newSeed | 0;
  epoch++;
  lastCenter = '';
}

export function setRenderDistance(d: number) {
  RENDER_DIST = Math.max(2, Math.min(10, Math.round(d)));
  lastCenter = '';
}

// ------------------------------------------------------------------ Block access

export function getBlock(x: number, y: number, z: number): number {
  if (y < MIN_Y) return B.bedrock;
  if (y > MAX_Y) return 0;
  const c = chunks.get(ckey(x >> 4, z >> 4));
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

export function setBlock(x: number, y: number, z: number, id: number, fromNetwork = false) {
  if (y < MIN_Y || y > MAX_Y || !(id >= 0 && id < BLOCKS.length)) return;
  const cx = x >> 4, cz = z >> 4;
  const key = ckey(cx, cz);
  const lx = x & 15, lz = z & 15, i = idx(lx, y, lz);

  // Always record the edit, even if that chunk isn't loaded right now
  let m = mods.get(key);
  if (!m) { m = new Map(); mods.set(key, m); }
  m.set(i, id);
  if (!isFacingBlock(id)) facingByChunk.get(key)?.delete(i);
  void fromNetwork;

  const c = chunks.get(key);
  if (!c || c.data[i] === id) return;
  c.data[i] = id;

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
    for (let s = Math.max(0, lo - 1); s <= Math.min(SECTIONS - 1, hi); s++) markDirty(c, s);
  }
  // Neighbouring chunks share faces / AO / light at the borders
  const markNeighbour = (ncx: number, ncz: number) => {
    const n = chunks.get(ckey(ncx, ncz));
    if (n) { markDirty(n, sec); markDirty(n, sec - 1); markDirty(n, sec + 1); }
  };
  if (lx <= 2) markNeighbour(cx - 1, cz);
  if (lx >= 13) markNeighbour(cx + 1, cz);
  if (lz <= 2) markNeighbour(cx, cz - 1);
  if (lz >= 13) markNeighbour(cx, cz + 1);
  if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) markNeighbour(cx + (lx ? 1 : -1), cz + (lz ? 1 : -1));
}

function markDirty(c: Chunk, sec: number) {
  if (sec < 0 || sec >= SECTIONS || c.meshState === 0) return;
  c.dirty.add(sec);
  c.sectionVersion[sec]++;
}

// ------------------------------------------------------------------ Terrain queries

export function columnInfo(x: number, z: number) {
  return genColumnInfo(x, z, seed);
}

export function biomeAt(x: number, z: number): string {
  return columnInfo(Math.floor(x), Math.floor(z)).biome;
}

function addChunk(cx: number, cz: number, data: Uint8Array): Chunk {
  const m = mods.get(ckey(cx, cz));
  const borderSections = new Map<string, Set<number>>();
  if (m) for (const [i, id] of m) {
    data[i] = id;
    // Edits near this chunk's edge change faces/light of already-meshed neighbours
    const lx = i & 15, lz = (i >> 4) & 15, sec = (i >> 8) >> 4;
    const add = (dx: number, dz: number) => {
      const k = ckey(cx + dx, cz + dz);
      let set = borderSections.get(k);
      if (!set) { set = new Set(); borderSections.set(k, set); }
      set.add(sec - 1); set.add(sec); set.add(sec + 1);
    };
    if (lx <= 2) add(-1, 0);
    if (lx >= 13) add(1, 0);
    if (lz <= 2) add(0, -1);
    if (lz >= 13) add(0, 1);
  }
  const c = new Chunk(cx, cz, data);
  chunks.set(ckey(cx, cz), c);
  for (const [k, secs] of borderSections) {
    const n = chunks.get(k);
    if (n) for (const s of secs) markDirty(n, s);
  }
  return c;
}

function ensureChunkSync(cx: number, cz: number): Chunk {
  return chunks.get(ckey(cx, cz)) || addChunk(cx, cz, generateChunkData(cx, cz, seed));
}

// ------------------------------------------------------------------ Worker pool

type Job = { req: any; transfer: Transferable[]; cb: (res: any) => void };

// Runs generation/meshing on background workers. If workers are unavailable or crash, jobs run on
// the main thread instead, a few milliseconds per frame (drainSync) so the game never freezes.
class WorkerPool {
  private workers: Worker[] = [];
  private load: number[] = [];
  private jobs = new Map<number, Job & { worker: number }>();
  private queue: (Job & { id: number })[] = [];
  private syncQueue: Job[] = [];
  private nextId = 1;
  failed = false;

  constructor(count: number) {
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./worldWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = e => this.finish(i, e.data);
        w.onerror = e => { console.warn('World worker failed, falling back to main thread', e.message); this.fail(); };
        this.workers.push(w);
        this.load.push(0);
      }
    } catch (e) {
      console.warn('Web Workers unavailable, generating on the main thread', e);
      this.failed = true;
    }
  }

  get busy() { return this.jobs.size + this.queue.length + this.syncQueue.length; }

  run(req: any, transfer: Transferable[], cb: (res: any) => void) {
    if (this.failed) { this.syncQueue.push({ req, transfer, cb }); return; }
    this.queue.push({ id: this.nextId++, req, transfer, cb });
    this.pump();
  }

  // Main-thread fallback work, time-boxed per frame
  drainSync(budgetMs: number) {
    const start = performance.now();
    while (this.syncQueue.length && performance.now() - start < budgetMs) {
      const j = this.syncQueue.shift()!;
      finishJob(j, runSync(j.req));
    }
  }

  private pump() {
    while (this.queue.length) {
      let best = -1;
      for (let i = 0; i < this.workers.length; i++) if (this.load[i] < 2 && (best < 0 || this.load[i] < this.load[best])) best = i;
      if (best < 0) return;
      const job = this.queue.shift()!;
      this.load[best]++;
      this.jobs.set(job.id, { ...job, worker: best });
      this.workers[best].postMessage({ id: job.id, ...job.req }, job.transfer);
    }
  }

  private finish(worker: number, msg: any) {
    const job = this.jobs.get(msg.id);
    this.load[worker] = Math.max(0, this.load[worker] - 1);
    try {
      if (!job) return;
      this.jobs.delete(msg.id);
      finishJob(job, msg.ok ? msg : runSync(job.req)); // a job that threw in the worker is retried here once
    } finally {
      this.pump();
    }
  }

  // Worker crashed: hand everything outstanding to the main-thread queue so no chunk gets stuck
  private fail() {
    if (this.failed) return;
    this.failed = true;
    for (const w of this.workers) w.terminate();
    this.syncQueue.push(...this.jobs.values(), ...this.queue);
    this.jobs.clear();
    this.queue = [];
  }
}

function finishJob(j: Job, res: any) {
  try { j.cb(res); } catch (e) { console.error('World job callback failed', e); }
}

// Never throws: a failed chunk becomes plain stone below sea level (and a failed mesh becomes empty),
// so the player is never stuck waiting for terrain that can't be generated.
function runSync(req: any) {
  try {
    if (req.type === 'gen') return { ok: true, data: generateChunkData(req.cx, req.cz, req.seed) };
    return { ok: true, out: meshSection(req.input) };
  } catch (e) {
    console.error('World job failed', req.type, e);
    if (req.type === 'gen') {
      const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
      data.fill(B.stone, 0, (SEA_LEVEL - MIN_Y) * 256);
      return { ok: true, data };
    }
    return { ok: true, out: { solid: null, liquid: null } };
  }
}

const pool = new WorkerPool(Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)));

// ------------------------------------------------------------------ Meshing

const NB_OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function hasAllNeighbours(cx: number, cz: number) {
  return NB_OFFSETS.every(([a, b]) => chunks.has(ckey(cx + a, cz + b)));
}

// Copies one section plus a 1-block border (and a 3-column heightmap border) into flat arrays for the mesher
function buildSectionInput(c: Chunk, sec: number): SectionInput {
  const y0 = MIN_Y + sec * 16;
  const grid: Chunk[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) grid.push(chunks.get(ckey(c.cx + dx, c.cz + dz))!);
  const pick = (x: number, z: number) => grid[((z < 0 ? 0 : z > 15 ? 2 : 1) * 3) + (x < 0 ? 0 : x > 15 ? 2 : 1)];

  const blocks = new Uint8Array(PAD_B * PAD_B * PAD_B);
  for (let y = -1; y <= 16; y++) {
    const wy = y0 + y;
    const rowBase = (y + 1) * PAD_B;
    if (wy < MIN_Y) { blocks.fill(B.bedrock, rowBase * PAD_B, (rowBase + PAD_B) * PAD_B); continue; }
    if (wy > MAX_Y) continue;
    const yOff = (wy - MIN_Y) << 8;
    for (let z = -1; z <= 16; z++) {
      const lz = z & 15, out = (rowBase + z + 1) * PAD_B;
      const left = pick(-1, z), mid = pick(0, z), right = pick(16, z);
      blocks[out] = left.data[yOff | (lz << 4) | 15];
      const src = yOff | (lz << 4);
      blocks.set(mid.data.subarray(src, src + 16), out + 1);
      blocks[out + 17] = right.data[yOff | (lz << 4)];
    }
  }
  const heights = new Int16Array(PAD_H * PAD_H);
  for (let z = -3; z <= 18; z++) for (let x = -3; x <= 18; x++) {
    heights[(z + 3) * PAD_H + (x + 3)] = pick(x, z).heights[((z & 15) << 4) | (x & 15)];
  }
  const fac: number[] = [];
  const cf = facingByChunk.get(ckey(c.cx, c.cz));
  if (cf) {
    for (const [i, f] of cf) {
      const y = (i >> 8) + MIN_Y;
      if (y >= y0 && y < y0 + 16) fac.push(i & 15, y - y0, (i >> 4) & 15, f);
    }
  }
  return { y0, blocks, heights, facing: fac };
}

// Concatenates all section meshes of a chunk into one geometry per pass (1-2 draw calls per chunk)
function buildChunkMesh(c: Chunk, liquid: boolean): THREE.Mesh | null {
  const parts: MeshArrays[] = [];
  let verts = 0, indices = 0, minY = Infinity, maxY = -Infinity;
  c.sectionOut.forEach((o, s) => {
    const m = o && (liquid ? o.liquid : o.solid);
    if (!m) return;
    parts.push(m);
    verts += m.pos.length / 3;
    indices += m.index.length;
    minY = Math.min(minY, s * 16); maxY = Math.max(maxY, s * 16 + 16);
  });
  if (!parts.length) return null;
  const pos = new Uint16Array(verts * 3), data = new Uint16Array(verts * 2);
  const index = verts > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, i = 0;
  for (const m of parts) {
    pos.set(m.pos, v * 3);
    data.set(m.data, v * 2);
    for (let k = 0; k < m.index.length; k++) index[i + k] = m.index[k] + v;
    v += m.pos.length / 3;
    i += m.index.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('aPos', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aData', new THREE.BufferAttribute(data, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  // No 'position' attribute, so bounds are set by hand for frustum culling
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY, 16));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(geo, liquid ? liquidMaterial : opaqueMaterial);
  mesh.position.set(c.cx * CHUNK, MIN_Y, c.cz * CHUNK);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  if (liquid) mesh.renderOrder = 1;
  return mesh;
}

function rebuildChunkGeometry(c: Chunk) {
  c.geometryDirty = false;
  for (let k = 0; k < 2; k++) {
    const old = c.meshes[k];
    if (old) { worldGroup.remove(old); old.geometry.dispose(); }
    c.meshes[k] = buildChunkMesh(c, k === 1);
    if (c.meshes[k]) worldGroup.add(c.meshes[k]!);
  }
}

function applySection(c: Chunk, sec: number, out: SectionOutput) {
  c.sectionOut[sec] = out;
  c.geometryDirty = true;
}

function meshSectionNow(c: Chunk, sec: number) {
  applySection(c, sec, meshSection(buildSectionInput(c, sec)));
}

// Queue every section of a chunk on the workers; results older than the section's version are ignored
function requestChunkMesh(c: Chunk) {
  c.meshState = 1;
  c.pendingSections = SECTIONS;
  const myEpoch = epoch;
  for (let s = 0; s < SECTIONS; s++) {
    const version = c.sectionVersion[s];
    pool.run({ type: 'mesh', input: buildSectionInput(c, s) }, [], res => {
      if (epoch !== myEpoch || chunks.get(ckey(c.cx, c.cz)) !== c) return;
      if (c.sectionVersion[s] === version) c.sectionOut[s] = res.out;
      if (--c.pendingSections === 0) { c.meshState = 2; c.geometryDirty = true; } // upload the chunk once, not per section
    });
  }
}

function disposeChunk(c: Chunk) {
  for (const m of c.meshes) if (m) { worldGroup.remove(m); m.geometry.dispose(); }
  c.meshes.fill(null);
  c.sectionOut.fill(null);
  c.meshState = 0;
}

// ------------------------------------------------------------------ Streaming

let lastCenter = '';
let wanted: [number, number][] = [];
const MAX_JOBS = 12;

// Keeps the chunks around the player generated and meshed, nearest first, without blocking the frame.
export function updateWorld(pos: THREE.Vector3) {
  const pcx = Math.floor(pos.x) >> 4, pcz = Math.floor(pos.z) >> 4;
  const center = ckey(pcx, pcz);
  if (center !== lastCenter) {
    lastCenter = center;
    wanted = [];
    const R = RENDER_DIST + 1;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) wanted.push([pcx + dx, pcz + dz]);
    wanted.sort((a, b) => (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2 - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
    for (const [key, c] of chunks) {
      if (Math.abs(c.cx - pcx) > RENDER_DIST + 3 || Math.abs(c.cz - pcz) > RENDER_DIST + 3) { disposeChunk(c); chunks.delete(key); }
    }
  }

  pool.drainSync(4); // only does anything if background workers are unavailable

  // Edited sections are remeshed right away on this thread so breaking/placing feels instant.
  // Time-boxed so a flood of edits (e.g. catching up after a reconnect) spreads over several frames.
  const editStart = performance.now();
  for (const c of chunks.values()) {
    if (!c.dirty.size) continue;
    if (!hasAllNeighbours(c.cx, c.cz)) {
      // Can't mesh correctly yet: rebuild the whole chunk once its neighbours are back
      c.dirty.clear();
      c.meshState = 0;
      continue;
    }
    for (const s of c.dirty) {
      if (performance.now() - editStart > 6) break;
      meshSectionNow(c, s);
      c.dirty.delete(s);
    }
  }

  const myEpoch = epoch;
  for (const [cx, cz] of wanted) {
    if (pool.busy >= MAX_JOBS) break;
    const key = ckey(cx, cz);
    const c = chunks.get(key);
    if (!c) {
      if (pendingGen.has(key)) continue;
      pendingGen.add(key);
      pool.run({ type: 'gen', cx, cz, seed }, [], res => {
        if (epoch !== myEpoch || !pendingGen.delete(key) || chunks.has(key)) return;
        if (Math.abs(cx - (Math.floor(pos.x) >> 4)) > RENDER_DIST + 3 || Math.abs(cz - (Math.floor(pos.z) >> 4)) > RENDER_DIST + 3) return;
        addChunk(cx, cz, res.data);
      });
      continue;
    }
    if (c.meshState !== 0) continue;
    if (Math.abs(cx - pcx) > RENDER_DIST || Math.abs(cz - pcz) > RENDER_DIST) continue;
    if (!hasAllNeighbours(cx, cz)) continue;
    requestChunkMesh(c);
  }

  // Re-upload each changed chunk once per frame, however many of its sections changed. Capped per
  // frame (nearest first, so your own digging stays instant): crossing a chunk border finishes a whole
  // row of chunks at once, and uploading them all in one frame stalled the GPU for 50-150 ms.
  const dirty: Chunk[] = [];
  for (const c of chunks.values()) if (c.geometryDirty) dirty.push(c);
  if (dirty.length > MAX_UPLOADS_PER_FRAME) dirty.sort((a, b) => ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2) - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
  for (let i = 0; i < dirty.length && i < MAX_UPLOADS_PER_FRAME; i++) rebuildChunkGeometry(dirty[i]);
}

// Generate + mesh the area around a point synchronously (spawn, teleport, load) so there's ground immediately
export function loadAreaNow(x: number, z: number, radius = 1) {
  const pcx = Math.floor(x) >> 4, pcz = Math.floor(z) >> 4;
  for (let dx = -radius - 1; dx <= radius + 1; dx++) for (let dz = -radius - 1; dz <= radius + 1; dz++) {
    pendingGen.delete(ckey(pcx + dx, pcz + dz));
    ensureChunkSync(pcx + dx, pcz + dz);
  }
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const c = chunks.get(ckey(pcx + dx, pcz + dz))!;
    if (c.meshState === 2) continue;
    c.sectionVersion.forEach((_, s) => c.sectionVersion[s]++); // drop any in-flight async results
    for (let s = 0; s < SECTIONS; s++) meshSectionNow(c, s);
    c.meshState = 2;
    rebuildChunkGeometry(c);
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
        return new THREE.Vector3(x + 0.5, surfaceHeight(x, z) + 1, z + 0.5);
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
    if (id !== 0 && !isLiquid(id) && isLoaded(x, z)) return { x, y, z, id, nx, ny, nz, dist: t };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}

// ------------------------------------------------------------------ Save / network support

export function forEachMod(fn: (x: number, y: number, z: number, id: number) => void) {
  for (const [key, m] of mods) {
    const [cx, cz] = key.split(',').map(Number);
    for (const [i, id] of m) fn(cx * 16 + (i & 15), (i >> 8) + MIN_Y, cz * 16 + ((i >> 4) & 15), id);
  }
}

export function exportMods(): Record<string, string> {
  const out: Record<string, string> = {};
  forEachMod((x, y, z, id) => { out[`${x},${y},${z}`] = BLOCKS[id].name; });
  return out;
}

export function importMods(edits: Record<string, string>) {
  for (const k of Object.keys(edits)) {
    const [x, y, z] = k.split(',').map(Number);
    const id = edits[k] === 'air' ? 0 : BLOCK_ID[edits[k]];
    if (id === undefined || !Number.isFinite(x + y + z) || y < MIN_Y || y > MAX_Y) continue;
    const key = ckey(x >> 4, z >> 4);
    let m = mods.get(key);
    if (!m) { m = new Map(); mods.set(key, m); }
    m.set(idx(x & 15, y, z & 15), id);
  }
}

// Server edit list: flat [x, y, z, id, ...]. Recorded for unloaded chunks, applied to loaded ones.
export function importEditsFlat(flat: number[]) {
  for (let i = 0; i + 3 < flat.length; i += 4) setBlock(flat[i], flat[i + 1], flat[i + 2], flat[i + 3], true);
}

export function importFacingFlat(flat: number[]) {
  for (let i = 0; i + 3 < flat.length; i += 4) setFacing(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]);
}

export function chunkCount() { return chunks.size; }
export function workerStatus() { return pool.failed ? 'main thread' : 'workers'; }

// Dev benchmark: ms per chunk generation and per chunk meshing (main thread)
export function benchmarkWorld() {
  const base = 2000; // chunks at x = 32,000: normal terrain, well away from the Robotic World (x >= 70,000)
  let t = performance.now();
  for (let i = 0; i < 25; i++) ensureChunkSync(base + (i % 5), base + Math.floor(i / 5));
  const gen = (performance.now() - t) / 25;
  t = performance.now();
  for (let i = 0; i < 9; i++) {
    const c = chunks.get(ckey(base + 1 + (i % 3), base + 1 + Math.floor(i / 3)))!;
    for (let s = 0; s < SECTIONS; s++) meshSectionNow(c, s);
  }
  const mesh = (performance.now() - t) / 9;
  for (let i = 0; i < 25; i++) { const k = ckey(base + (i % 5), base + Math.floor(i / 5)); const c = chunks.get(k); if (c) { disposeChunk(c); chunks.delete(k); } }
  return { genMs: +gen.toFixed(2), meshMs: +mesh.toFixed(2) };
}
