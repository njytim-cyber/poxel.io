import * as THREE from 'three';
import { TILE, BLOCKS, ITEMS, TIERS, itemDef, ATLAS_COLS, ATLAS_ROWS, tileUV } from '../shared/blocks.ts';

// ------------------------------------------------------------------ Pixel helpers

let rngState = 12345;
function rand() { rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5; return (rngState >>> 0) / 4294967296; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }

type Tile = (string | null)[]; // 256 css colors, null = transparent
const newTile = (): Tile => new Array(256).fill(null);
const at = (x: number, y: number) => ((y & 15) << 4) | (x & 15);

function noiseTile(palette: string[]): Tile {
  const t = newTile();
  for (let i = 0; i < 256; i++) t[i] = pick(palette);
  return t;
}

// Blotchy noise: pixels copy a neighbour often, giving MC-like clusters instead of pure static
function blotchTile(palette: string[], blend = 0.45): Tile {
  const t = noiseTile(palette);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (rand() < blend) t[at(x, y)] = t[at(x + (rand() < 0.5 ? -1 : 1), y + (rand() < 0.5 ? -1 : 0))];
  }
  return t;
}

function sprinkleOre(base: Tile, colors: string[], clusters: number): Tile {
  const t = base.slice();
  for (let c = 0; c < clusters; c++) {
    const cx = 2 + Math.floor(rand() * 12), cy = 2 + Math.floor(rand() * 12);
    const n = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(rand() * 3) - 1, y = cy + Math.floor(rand() * 3) - 1;
      t[at(x, y)] = colors[i === 0 ? 0 : 1 + Math.floor(rand() * (colors.length - 1))];
    }
  }
  return t;
}

const DIRT = ['#79553a', '#8b6344', '#96704e', '#6b4a32', '#8b6344', '#5d3f2a'];
const STONE = ['#7f7f7f', '#747474', '#8a8a8a', '#6b6b6b', '#7f7f7f'];
const LOG_BARK = ['#6b5230', '#5c4526', '#7a5f38', '#4f3b20'];

function sideWithTop(topPalette: string[], depthMin: number): Tile {
  const t = blotchTile(DIRT);
  for (let x = 0; x < 16; x++) {
    const depth = depthMin + Math.floor(rand() * 3) + (rand() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) t[at(x, y)] = pick(topPalette);
  }
  return t;
}

function logTop(bark: string[], light: string, dark: string): Tile {
  const t = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    t[at(x, y)] = d > 6.5 ? pick(bark) : (Math.floor(d) % 2 === 0 ? light : dark);
  }
  return t;
}

function planks(): Tile {
  const t = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const board = y >> 2;
    const seam = (board * 7 + 3) % 16;
    let c = pick(['#a8834e', '#b08a55', '#9c7845', '#a37f4a']);
    if ((y & 3) === 3 || x === seam) c = '#6e522c';
    t[at(x, y)] = c;
  }
  return t;
}

function cobblestone(): Tile {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) pts.push([rand() * 16, rand() * 16]);
  const shades = pts.map(() => pick(['#7a7a7a', '#8c8c8c', '#6e6e6e', '#838383']));
  const t = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 1e9, d2 = 1e9, idx = 0;
    pts.forEach(([px, py], i) => {
      for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
        const d = (x + 0.5 - px - ox) ** 2 + (y + 0.5 - py - oy) ** 2;
        if (d < d1) { d2 = d1; d1 = d; idx = i; } else if (d < d2) d2 = d;
      }
    });
    const edge = Math.sqrt(d2) - Math.sqrt(d1);
    t[at(x, y)] = edge < 0.9 ? '#454545' : (rand() < 0.15 ? '#9a9a9a' : shades[idx]);
  }
  return t;
}

function leaves(palette: string[], holes: number): Tile {
  const t = blotchTile(palette, 0.3);
  for (let i = 0; i < 256; i++) if (rand() < holes) t[i] = null;
  return t;
}

function bordered(palette: string[], border: string): Tile {
  const t = blotchTile(palette, 0.3);
  for (let i = 0; i < 16; i++) { t[at(i, 0)] = border; t[at(i, 15)] = border; t[at(0, i)] = border; t[at(15, i)] = border; }
  return t;
}

function drawPixels(t: Tile, rows: string[], ox: number, oy: number, colors: Record<string, string>) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) t[at(ox + x, oy + y)] = colors[ch]; }));
}

function tableSide(front: boolean): Tile {
  const t = planks();
  for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) t[at(x, y)] = pick(['#5c4426', '#4f3a20']);
  const tools = front
    ? ['.gg......hh.', 'gggg....hhhh', '.gg......bb.', '.bb......bb.', '.bb......bb.', '.bb......bb.']
    : ['ggggggg.....', 'g.g.g.g.bb..', '........bb..', '.....bbbbb..', '............', '............'];
  drawPixels(t, tools, 2, 5, { g: '#9a9a9a', h: '#7a7a7a', b: '#5c3f1c' });
  return t;
}

function tableTop(): Tile {
  const t = planks();
  for (let i = 0; i < 16; i++) { t[at(i, 0)] = '#5c4426'; t[at(i, 15)] = '#5c4426'; t[at(0, i)] = '#5c4426'; t[at(15, i)] = '#5c4426'; }
  for (let i = 2; i < 14; i++) { t[at(i, 5)] = '#6e522c'; t[at(i, 10)] = '#6e522c'; t[at(5, i)] = '#6e522c'; t[at(10, i)] = '#6e522c'; }
  return t;
}

function furnaceFront(): Tile {
  const t = bordered(['#8a8a8a', '#7a7a7a', '#6e6e6e'], '#555555');
  for (let x = 3; x < 13; x++) t[at(x, 5)] = '#4a4a4a';
  for (let y = 8; y < 14; y++) for (let x = 4; x < 12; x++) t[at(x, y)] = y === 8 ? '#2a2a2a' : '#141414';
  return t;
}

function cactusSide(): Tile {
  const t = blotchTile(['#5a8a2a', '#4a7a22', '#6a9a32'], 0.4);
  for (let y = 0; y < 16; y++) { t[at(0, y)] = '#2f5415'; t[at(15, y)] = '#2f5415'; t[at(7, y)] = '#467520'; }
  for (let i = 0; i < 10; i++) t[at(1 + Math.floor(rand() * 14), Math.floor(rand() * 16))] = '#dbe8b0';
  return t;
}

function birchSide(): Tile {
  const t = noiseTile(['#d8d8d0', '#e8e8e0', '#cfcfc6']);
  for (let i = 0; i < 7; i++) {
    const y = Math.floor(rand() * 16), x = Math.floor(rand() * 13), w = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < w; k++) t[at(x + k, y)] = pick(['#2a2a2a', '#3a3a3a']);
  }
  return t;
}

function sandstoneSide(): Tile {
  const t = blotchTile(['#d8cb94', '#d1c48c', '#dccf9c']);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 3; y++) t[at(x, y)] = pick(['#e3d7a8', '#e8ddb0']);
    t[at(x, 3)] = '#c2b27a'; t[at(x, 11)] = '#c2b27a'; t[at(x, 15)] = '#b5a56e';
  }
  return t;
}

function buildTiles(): Tile[] {
  rngState = 12345;
  const tiles: Tile[] = [];
  const GRASS = ['#5b8c3a', '#6a9e42', '#78ad4c', '#86b957', '#5f9540'];
  const set = (i: number, t: Tile) => { tiles[i] = t; };
  set(TILE.grass_top, blotchTile(GRASS));
  set(TILE.grass_side, sideWithTop(GRASS, 3));
  set(TILE.dirt, blotchTile(DIRT));
  set(TILE.stone, blotchTile(STONE, 0.55));
  set(TILE.cobblestone, cobblestone());
  const logSide = newTile();
  for (let x = 0; x < 16; x++) { const base = pick(LOG_BARK); for (let y = 0; y < 16; y++) logSide[at(x, y)] = rand() < 0.75 ? base : pick(LOG_BARK); }
  set(TILE.log_side, logSide);
  set(TILE.log_top, logTop(LOG_BARK, '#b5905a', '#9d7847'));
  set(TILE.planks, planks());
  set(TILE.leaves, leaves(['#3a7a24', '#2f6a1c', '#4a8c30', '#28601a'], 0.18));
  set(TILE.bedrock, blotchTile(['#5a5a5a', '#333333', '#1e1e1e', '#7a7a7a', '#444444'], 0.5));
  set(TILE.table_top, tableTop());
  set(TILE.table_side, tableSide(false));
  set(TILE.table_front, tableSide(true));
  set(TILE.furnace_front, furnaceFront());
  set(TILE.furnace_side, bordered(['#8a8a8a', '#7a7a7a', '#6e6e6e'], '#555555'));
  set(TILE.furnace_top, bordered(['#9a9a9a', '#8a8a8a', '#7e7e7e'], '#666666'));
  const stoneBase = blotchTile(STONE, 0.55);
  set(TILE.coal_ore, sprinkleOre(stoneBase, ['#1c1c1c', '#2b2b2b', '#454545'], 5));
  set(TILE.iron_ore, sprinkleOre(stoneBase, ['#e8c4a8', '#d8af93', '#b8906f'], 5));
  set(TILE.gold_ore, sprinkleOre(stoneBase, ['#fffba0', '#fce34a', '#d9a520'], 5));
  set(TILE.diamond_ore, sprinkleOre(stoneBase, ['#d0fffa', '#5decf5', '#2bb8c1'], 5));
  set(TILE.moonstone_ore, sprinkleOre(stoneBase, ['#ffffff', '#e6e6fa', '#b8b0e6'], 5));
  set(TILE.etherite_ore, sprinkleOre(blotchTile(['#2a2530', '#332d3a', '#221e28', '#2e2934']), ['#c9a0ff', '#9b6bd6', '#7a4fb3'], 5));
  const SAND = ['#dbcf9c', '#d4c690', '#e3d7a8', '#cbbd86'];
  set(TILE.sand, blotchTile(SAND, 0.2));
  set(TILE.sandstone_side, sandstoneSide());
  set(TILE.sandstone_top, blotchTile(['#e0d4a0', '#dccf9c', '#e6daa8'], 0.5));
  set(TILE.gravel, blotchTile(['#857f7c', '#6e6866', '#9a9391', '#5a5452', '#a8a09e'], 0.5));
  const SNOW = ['#f4f8fb', '#ffffff', '#e6eef4'];
  set(TILE.snow_side, sideWithTop(SNOW, 3));
  set(TILE.snow_top, noiseTile(SNOW));
  set(TILE.water, blotchTile(['#2f5fd6', '#3466dc', '#2a58cc', '#3a6ee0'], 0.6));
  set(TILE.cactus_side, cactusSide());
  set(TILE.cactus_top, logTop(['#2f5415'], '#6a9a32', '#5a8a2a'));
  set(TILE.birch_side, birchSide());
  set(TILE.birch_top, logTop(['#d8d8d0', '#cfcfc6'], '#d6c089', '#c2aa72'));
  set(TILE.birch_leaves, leaves(['#6a9a3a', '#5a8a30', '#7aa845', '#4f7f28'], 0.18));
  set(TILE.spruce_leaves, leaves(['#2c5a3a', '#24503a', '#3a6a48', '#1e4430'], 0.12));
  set(TILE.lava, blotchTile(['#d4400a', '#ff6a00', '#ff8c1a', '#e85a0c', '#ffb030'], 0.6));
  const glass = newTile();
  for (let i = 0; i < 16; i++) { glass[at(i, 0)] = glass[at(i, 15)] = glass[at(0, i)] = glass[at(15, i)] = '#dbeff5'; }
  for (let i = 3; i < 7; i++) glass[at(i, 10 - i)] = '#ffffff';
  glass[at(10, 11)] = glass[at(11, 10)] = '#ffffff';
  set(TILE.glass, glass);
  set(TILE.clay, blotchTile(['#a1a6b4', '#9499a8', '#aab0bd'], 0.5));
  const bricks = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    const mortar = (y & 3) === 3 || ((x + off) & 7) === 7;
    bricks[at(x, y)] = mortar ? pick(['#b8b0a8', '#a8a098']) : pick(['#9a4a3a', '#8a3e30', '#a85644', '#94443a']);
  }
  set(TILE.bricks, bricks);
  const mossy = cobblestone();
  for (let i = 0; i < 256; i++) if (mossy[i] !== '#454545' && rand() < 0.35) mossy[i] = pick(['#5a7a3a', '#4a6a2e', '#6a8a44']);
  set(TILE.mossy_cobblestone, mossy);
  const sb = blotchTile(STONE, 0.6);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const off = (y >> 3) % 2 ? 8 : 0;
    if ((y & 7) === 7 || ((x + off) & 15) === 15) sb[at(x, y)] = '#5a5a5a';
    else if ((y & 7) === 0 || ((x + off) & 15) === 0) sb[at(x, y)] = '#909090';
  }
  set(TILE.stone_bricks, sb);
  const pSide = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pSide[at(x, y)] = (x % 4 === 0) ? '#b8660f' : pick(['#e3861a', '#d67a12', '#eb9224']);
  set(TILE.pumpkin_side, pSide);
  const pTop = pSide.slice();
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) pTop[at(x, y)] = (x === 6 || y === 6) ? '#6a8a2a' : '#4a6a1a';
  set(TILE.pumpkin_top, pTop);
  const pFront = pSide.slice();
  drawPixels(pFront, ['.kk....kk.', '.kk....kk.', '..........', 'k........k', 'kkk.kk.kkk', '.kkkkkkkk.'], 3, 4, { k: '#3a1a00' });
  set(TILE.pumpkin_front, pFront);

  // Plants: transparent sprites drawn as an X
  const grassBlades = newTile();
  for (let x = 0; x < 16; x++) {
    if (rand() < 0.35) continue;
    const h = 5 + Math.floor(rand() * 10);
    for (let y = 15; y > 15 - h; y--) grassBlades[at(x + (y < 8 && rand() < 0.3 ? 1 : 0), y)] = pick(['#5b8c3a', '#6a9e42', '#4f7f32', '#78ad4c']);
  }
  set(TILE.tall_grass, grassBlades);
  const flower = (petal: string[], center: string) => {
    const t = newTile();
    for (let y = 7; y < 16; y++) t[at(7, y)] = '#3f7a24';
    t[at(6, 11)] = t[at(5, 10)] = t[at(8, 12)] = t[at(9, 11)] = '#4f8f30';
    for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [-1, 0], [1, 0], [0, 1]])
      t[at(7 + dx, 5 + dy)] = pick(petal);
    t[at(7, 5)] = center;
    return t;
  };
  set(TILE.dandelion, flower(['#ffe030', '#f8d020', '#fff060'], '#e0a010'));
  set(TILE.poppy, flower(['#e02020', '#c81818', '#f04040'], '#2a1a10'));
  set(TILE.cornflower, flower(['#4a6ae8', '#3a58d0', '#6a88ff'], '#e8e8ff'));
  const SPRUCE_BARK = ['#3a2a1a', '#2e2014', '#46321e', '#3a2816'];
  const spruceSide = newTile();
  for (let x = 0; x < 16; x++) { const base = pick(SPRUCE_BARK); for (let y = 0; y < 16; y++) spruceSide[at(x, y)] = rand() < 0.7 ? base : pick(SPRUCE_BARK); }
  set(TILE.spruce_side, spruceSide);
  set(TILE.spruce_top, logTop(SPRUCE_BARK, '#8a6a42', '#6e5232'));
  return tiles;
}

// ------------------------------------------------------------------ Atlas

export { ATLAS_COLS, tileUV };
export const atlasCanvas = document.createElement('canvas');
atlasCanvas.width = ATLAS_COLS * 16;
atlasCanvas.height = ATLAS_ROWS * 16;
{
  const ctx = atlasCanvas.getContext('2d')!;
  buildTiles().forEach((tile, i) => {
    const ox = (i % ATLAS_COLS) * 16, oy = Math.floor(i / ATLAS_COLS) * 16;
    tile.forEach((c, p) => { if (c) { ctx.fillStyle = c; ctx.fillRect(ox + (p & 15), oy + (p >> 4), 1, 1); } });
  });
}

export const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.SRGBColorSpace;

// Material for small standalone block meshes (dropped items)
export const blockEntityMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, alphaTest: 0.5 });

// Box geometry whose faces use the block's atlas tiles
const blockGeoCache = new Map<number, THREE.BoxGeometry>();
export function blockGeometry(blockId: number, size = 1): THREE.BoxGeometry {
  const key = blockId * 1000 + Math.round(size * 100);
  let geo = blockGeoCache.get(key);
  if (geo) return geo;
  geo = new THREE.BoxGeometry(size, size, size);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const tiles = BLOCKS[blockId].tiles;
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = tileUV(tiles[face]);
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    }
  }
  (geo as any).__shared = true; // cached: never dispose
  blockGeoCache.set(key, geo);
  return geo;
}

// ------------------------------------------------------------------ Crack overlay

function generateCrackTexture(stage: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  if (stage > 0) {
    ctx.strokeStyle = 'rgba(10, 10, 10, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const paths = [
      [[8, 8], [5, 5], [2, 7], [0, 4]],
      [[8, 8], [11, 6], [14, 9], [16, 5]],
      [[8, 8], [9, 12], [7, 15], [8, 16]],
      [[8, 8], [4, 10], [1, 13], [0, 16]],
      [[8, 8], [12, 11], [15, 14], [16, 16]],
    ];
    paths.forEach(path => {
      ctx.moveTo(path[0][0], path[0][1]);
      const target = (stage / 10) * 3;
      for (let i = 1; i < path.length; i++) {
        if (i <= target) ctx.lineTo(path[i][0], path[i][1]);
        else if (i - 1 < target) {
          const pct = target - (i - 1), p = path[i - 1], c = path[i];
          ctx.lineTo(p[0] + (c[0] - p[0]) * pct, p[1] + (c[1] - p[1]) * pct);
        }
      }
    });
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export const crackMaterials = Array.from({ length: 11 }, (_, i) =>
  new THREE.MeshBasicMaterial({ map: generateCrackTexture(i), transparent: true, alphaTest: 0.1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
);

// ------------------------------------------------------------------ Item icons

const HANDLE = { h: '#8a6232', H: '#5c3f1c' };
const TIER_PALETTE: Record<string, { l: string; m: string; d: string }> = {
  wooden: { l: '#c9a26b', m: '#a07844', d: '#5e4424' },
  wood: { l: '#c9a26b', m: '#a07844', d: '#5e4424' },
  stone: { l: '#a8a8a8', m: '#7e7e7e', d: '#4a4a4a' },
  iron: { l: '#ffffff', m: '#d8d8d8', d: '#7a7a7a' },
  gold: { l: '#fffda8', m: '#fad64a', d: '#a67c10' },
  diamond: { l: '#c8fff8', m: '#33ebcb', d: '#12806e' },
  moonstone: { l: '#ffffff', m: '#d6d0f5', d: '#7f76b8' },
  etherite: { l: '#8c7fa3', m: '#4f4660', d: '#1f1b28' },
};

const HEADS: Record<string, { top: number; rows: string[] }> = {
  pickaxe: { top: 4, rows: ['................', '.....dddddd.....', '...ddllllmmdd...', '..dmmdd..ddmmd..', '..dmd......dmmd.', '..dd........dmd.', '.............dmd', '.............dd.'] },
  axe: { top: 3, rows: ['................', '........ddd.....', '.......dlmmd....', '......dlmmd.....', '......dlmm......', '......dmm.......', '.......d........'] },
  shovel: { top: 5, rows: ['................', '...........ddd..', '..........dllmd.', '.........dlmmmd.', '.........dmmmd..', '...........dd...'] },
  hoe: { top: 3, rows: ['................', '......ddddddd...', '......dmmmlldd..'] },
};
const SWORD = ['.............ddd', '............dlld', '...........dlmd.', '..........dlmd..', '.........dlmd...', '........dlmd....', '.......dlmd.....', '......dlmd......',
  '..dd.dlmd.......', '..dmdlmd........', '...dmmd.........', '..hHdmd.........', '.hH...dd........', 'hH..............', '................', '................'];
const ARMOR: Record<string, string[]> = {
  helmet: ['', '', '', '...dddddddddd...', '..dllllllllmmd..', '..dlmmmmmmmmmd..', '..dmd......dmd..', '..dmd......dmd..', '..ddd......ddd..'],
  chestplate: ['', '..ddd......ddd..', '.dlmdd....ddmld.', '.dlmmmddddmmmld.', '.dlmmmmmmmmmmld.', '.ddlmmmmmmmmmdd.', '...dlmmmmmmmmd..', '...dlmmmmmmmmd..',
    '...dlmmmmmmmmd..', '...dlmmmmmmmmd..', '...dlmmmmmmmmd..', '...ddddddddddd..'],
  leggings: ['', '', '...ddddddddddd..', '...dlmmmmmmmmd..', '...dlmmmmmmmmd..', '...dlmmddlmmmd..', '...dlmd..dlmmd..', '...dlmd..dlmmd..', '...dlmd..dlmmd..',
    '...dlmd..dlmmd..', '...dlmd..dlmmd..', '...dlmd..dlmmd..', '...dlmd..dlmmd..', '...dddd..ddddd..'],
  gauntlets: ['', '', '', '....ddd.........', '...dlmd.ddd.....', '...dlmddlmd.....', '...dlmmdlmd.....', '...dlmmmmmdd....',
    '...dlmmmmmlmd...', '...dlmmmmmmmd...', '....dmmmmmmd....', '....dddddddd....', '....dllllllld...', '....ddddddddd...'],
  boots: ['', '', '', '', '', '', '', '', '...ddd....ddd...', '...dld....dld...', '...dmd....dmd...', '..ddmd....dmdd..', '.dlmmd....dmmld.', '.dddddd..dddddd.'],
};
const SHAPES: Record<string, string[]> = {
  ingot: ['', '', '', '', '', '......ddddddd...', '.....dlllllmd...', '....dlmmmmmmd...', '...dlmmmmmmd....', '..dlmmmmmmd.....', '..dmmmmmmd......', '..ddddddd.......'],
  gem: ['', '', '', '......dddd......', '.....dllmmd.....', '....dllmmmmd....', '...dlllmmmmmd...', '...dddddddddd...', '....dmmmmmmd....', '.....dmmmmd.....', '......dmmd......', '.......dd.......'],
  lump: ['', '', '', '', '......dddd......', '....ddmmmmdd....', '...dmllmmmmmd...', '...dlmmmmdmmd...', '..dmmmmdmmmmmd..', '..dmmmmmmmdmmd..', '...dmmdmmmmmd...', '....ddmmmmdd....', '......dddd......'],
  meat: ['', '', '', '', '.....dddddd.....', '...ddmmmmmmdd...', '..dmmllmmmmmmd..', '..dmlmmmmmmmmd..', '..dmmmmmmmmmwd..', '...dmmmmmmmwwd..', '....ddmmmmwwd...', '......ddddwwd...', '..........dd....'],
  apple: ['', '', '........h.......', '.......h........', '.....dd.dd......', '....dllmmmd.....', '...dlmmmmmmd....', '...dlmmmmmmd....', '...dmmmmmmmd....', '...dmmmmmmmd....', '....dmmmmmd.....', '.....dd.dd......'],
};
const ITEM_ART: Record<string, [string, Record<string, string>]> = {
  coal: ['lump', { l: '#4a4a4a', m: '#2b2b2b', d: '#111111' }],
  charcoal: ['lump', { l: '#5a4a3a', m: '#3a2e24', d: '#1a140f' }],
  moonstone: ['lump', { l: '#ffffff', m: '#e6e6fa', d: '#8f86c2' }],
  etherite: ['gem', TIER_PALETTE.etherite],
  diamond: ['gem', TIER_PALETTE.diamond],
  iron_ingot: ['ingot', TIER_PALETTE.iron],
  gold_ingot: ['ingot', TIER_PALETTE.gold],
  apple: ['apple', { l: '#ff6b6b', m: '#d42a2a', d: '#7a1010', h: '#5c3f1c' }],
  porkchop: ['meat', { l: '#ffb3b3', m: '#f08a8a', d: '#a04848', w: '#fff0f0' }],
  cooked_porkchop: ['meat', { l: '#d99a6a', m: '#b0703f', d: '#5e3a1c', w: '#f0d8b0' }],
  beef: ['meat', { l: '#ff7070', m: '#d63a3a', d: '#7a1a1a', w: '#ffe0e0' }],
  cooked_beef: ['meat', { l: '#a0643a', m: '#7a4420', d: '#3a2010', w: '#d8b890' }],
  rotten_flesh: ['meat', { l: '#b0a060', m: '#8a7a3a', d: '#4a4020', w: '#6a8a3a' }],
  chicken: ['meat', { l: '#fff0e0', m: '#f0d0b8', d: '#a08070', w: '#ffffff' }],
  cooked_chicken: ['meat', { l: '#e8b070', m: '#c88840', d: '#6a4018', w: '#f0d8a0' }],
  feather: ['bone', { l: '#ffffff', m: '#e8e8e8', d: '#9a9a9a' }],
  clay_ball: ['lump', { l: '#c4c8d4', m: '#a1a6b4', d: '#6a6e7a' }],
  brick: ['ingot', { l: '#c8705a', m: '#9a4a3a', d: '#5a2418' }],
  flint: ['gem', { l: '#6a6a6a', m: '#3a3a3a', d: '#141414' }],
  bone: ['bone', { l: '#ffffff', m: '#e8e4d4', d: '#a8a490' }],
  pumpkin_pie: ['pie', { l: '#f0b050', m: '#d88a2a', d: '#7a4a14', w: '#f8e0a0' }],
};
SHAPES.bone = ['', '', '...........dd...', '..........dlld..', '...........dmd..', '..........dmd...', '.........dmd....', '........dmd.....', '.......dmd......',
  '......dmd.......', '.....dmd........', '..dddmd.........', '.dlld...........', '..dd............'];
SHAPES.pie = ['', '', '', '', '', '.....dddddd.....', '...ddwwwwwwdd...', '..dwllmmmmmmwd..', '..dwmmmmmmmmwd..', '..ddwwwwwwwwdd..', '..dmddddddddmd..', '...dmmmmmmmmd...', '....dddddddd....'];

function itemPixels(type: string): Tile | null {
  const t = newTile();
  const put = (rows: string[], colors: Record<string, string>, oy = 0) => drawPixels(t, rows, 0, oy, colors);
  const parts = type.split('_');
  const kind = parts[parts.length - 1];
  const tierName = parts.slice(0, -1).join('_');
  const pal = TIER_PALETTE[tierName];
  if (type === 'stick') {
    for (let y = 3; y <= 13; y++) { t[at(15 - y, y)] = HANDLE.h; t[at(16 - y, y)] = HANDLE.H; }
    return t;
  }
  if (pal && kind === 'sword') { put(SWORD, { ...pal, ...HANDLE }); return t; }
  if (pal && HEADS[kind]) {
    const head = HEADS[kind];
    for (let y = head.top; y <= 13; y++) { t[at(14 - y, y)] = HANDLE.h; t[at(15 - y, y)] = HANDLE.H; }
    put(head.rows, pal);
    return t;
  }
  if (pal && ARMOR[kind]) { put(ARMOR[kind], pal); return t; }
  const art = ITEM_ART[type];
  if (art) { put(SHAPES[art[0]], art[1]); return t; }
  return null;
}

function tileCanvas(tile: Tile, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16 * scale;
  const ctx = c.getContext('2d')!;
  tile.forEach((col, p) => { if (col) { ctx.fillStyle = col; ctx.fillRect((p & 15) * scale, (p >> 4) * scale, scale, scale); } });
  return c;
}

// Isometric cube: top, left (front texture) and right (side texture) faces
function blockIconCanvas(blockId: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tiles = BLOCKS[blockId].tiles;
  const s = 2; // 32px layout drawn at 2x
  const k = 13 / 16, h = 6.5 / 16, v = 15 / 16;
  // Each face is drawn on its own layer so the shading only darkens that face
  const drawFace = (tile: number, m: number[], shade: number) => {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 64;
    const g = tmp.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.setTransform(m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s);
    const sx = (tile % ATLAS_COLS) * 16, sy = Math.floor(tile / ATLAS_COLS) * 16;
    g.drawImage(atlasCanvas, sx, sy, 16, 16, 0, 0, 16, 16);
    if (shade > 0) {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = `rgba(0,0,0,${shade})`;
      g.fillRect(0, 0, 16, 16);
    }
    ctx.drawImage(tmp, 0, 0);
  };
  drawFace(tiles[2], [k, h, -k, h, 16, 2], 0);        // top
  drawFace(tiles[4], [k, h, 0, v, 3, 8.5], 0.2);       // left (front face)
  drawFace(tiles[0], [k, -h, 0, v, 16, 15], 0.4);      // right (side face)
  return c;
}

const iconCanvasCache = new Map<string, HTMLCanvasElement>();
const iconUrlCache = new Map<string, string>();

export function getIconCanvas(type: string): HTMLCanvasElement {
  let c = iconCanvasCache.get(type);
  if (c) return c;
  const def = itemDef(type);
  if (def.block !== undefined && BLOCKS[def.block].plant) c = atlasTileCanvas(BLOCKS[def.block].tiles[0]);
  else if (def.block !== undefined) c = blockIconCanvas(def.block);
  else c = tileCanvas(itemPixels(type) || fallbackPixels(), 4);
  iconCanvasCache.set(type, c);
  return c;
}

export function getIconURL(type: string): string {
  let url = iconUrlCache.get(type);
  if (!url) { url = getIconCanvas(type).toDataURL(); iconUrlCache.set(type, url); }
  return url;
}

function atlasTileCanvas(tile: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlasCanvas, (tile % ATLAS_COLS) * 16, Math.floor(tile / ATLAS_COLS) * 16, 16, 16, 0, 0, 64, 64);
  return c;
}

// Items shown as flat sprites in the world/hand (everything except full cubes)
export function isFlatItem(type: string): boolean {
  const def = itemDef(type);
  return def.block === undefined || !!BLOCKS[def.block].plant;
}

function fallbackPixels(): Tile {
  const t = newTile();
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t[at(x, y)] = (x + y) % 2 ? '#ff00ff' : '#000000';
  return t;
}

// Warm up so the first inventory open doesn't stutter; also surfaces missing art in dev
export function preloadIcons() {
  for (const type of Object.keys(ITEMS)) getIconCanvas(type);
  void TIERS;
}
