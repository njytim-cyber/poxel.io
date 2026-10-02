import * as THREE from 'three';
import { TILE, BLOCKS, ITEMS, TIERS, COLORS, itemDef, ATLAS_COLS, ATLAS_ROWS, tileUV } from '../shared/blocks.ts';

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
  buildNewTiles(set, SNOW, stoneBase);
  return tiles;
}

// ------------------------------------------------------------------ More blocks

// Streaks/cracks in a direction, for ice
function streaked(palette: string[], streak: string, n: number): Tile {
  const t = blotchTile(palette, 0.5);
  for (let i = 0; i < n; i++) {
    let x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    const len = 3 + Math.floor(rand() * 6);
    for (let k = 0; k < len; k++) { t[at(x, y)] = streak; x++; if (rand() < 0.5) y--; }
  }
  return t;
}

// Brick pattern over any palette (rows of 4 high, bricks 8 wide, offset every other row)
function brickTile(palette: string[], mortar: string, highlight?: string, h = 4, w = 8): Tile {
  const t = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / h), off = row % 2 ? w / 2 : 0;
    const isMortar = y % h === h - 1 || (x + off) % w === w - 1;
    t[at(x, y)] = isMortar ? mortar : (highlight && y % h === 0 ? highlight : pick(palette));
  }
  return t;
}

// Smooth slab with a bevelled border (polished stone, metal blocks)
function polished(palette: string[], light: string, dark: string): Tile {
  const t = blotchTile(palette, 0.7);
  for (let i = 0; i < 16; i++) { t[at(i, 0)] = light; t[at(0, i)] = light; t[at(i, 15)] = dark; t[at(15, i)] = dark; }
  return t;
}

// Metal/gem storage block: plated with rivets and a shine
function storageBlock(l: string, m: string, d: string): Tile {
  const t = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    t[at(x, y)] = edge ? d : (x + y < 10 && rand() < 0.5 ? l : m);
  }
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) t[at(x, y)] = l;
  for (let i = 3; i < 7; i++) t[at(i, 10 - i)] = l;
  return t;
}

function wool(base: string[], shade: string): Tile {
  const t = noiseTile(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 5 === 0 && rand() < 0.5) t[at(x, y)] = shade;
  return t;
}

function bush(leaf: string[], berry: string[], berries: number): Tile {
  const t = newTile();
  for (let y = 4; y < 16; y++) for (let x = 1; x < 15; x++) {
    const d = Math.hypot(x - 7.5, (y - 10) * 1.3);
    if (d < 6.5 && rand() < 0.85) t[at(x, y)] = pick(leaf);
  }
  for (let i = 0; i < berries; i++) { const x = 3 + Math.floor(rand() * 10), y = 6 + Math.floor(rand() * 8); t[at(x, y)] = pick(berry); }
  return t;
}

function mushroom(cap: string[], spots: string | null): Tile {
  const t = newTile();
  for (let y = 10; y < 16; y++) { t[at(7, y)] = '#e8e0d0'; t[at(8, y)] = '#d8d0c0'; }
  for (let y = 5; y < 10; y++) for (let x = 3; x < 13; x++) {
    if (Math.hypot(x - 7.5, (y - 9.5) * 1.6) < 5.5) t[at(x, y)] = pick(cap);
  }
  if (spots) for (const [x, y] of [[5, 7], [9, 6], [10, 8], [7, 8]]) t[at(x, y)] = spots;
  return t;
}

// Crop rows: stalks of a given height with optional tops (wheat heads, leafy tops)
function crop(stalk: string[], height: number, top: string[] | null, density = 0.55): Tile {
  const t = newTile();
  for (let x = 1; x < 15; x++) {
    if (rand() > density) continue;
    const h = Math.max(2, height - Math.floor(rand() * 3));
    for (let y = 15; y > 15 - h; y--) t[at(x, y)] = pick(stalk);
    if (top) { t[at(x, 15 - h)] = pick(top); if (rand() < 0.5) t[at(x, 16 - h)] = pick(top); }
  }
  return t;
}

function fern(palette: string[]): Tile {
  const t = newTile();
  for (let i = 0; i < 5; i++) {
    let x = 3 + i * 2.5, y = 15;
    const lean = (i - 2) * 0.35;
    for (let k = 0; k < 11 - Math.abs(i - 2) * 2; k++) {
      t[at(Math.round(x), y)] = pick(palette);
      if (k % 2 === 0 && k > 2) { t[at(Math.round(x) - 1, y)] = pick(palette); t[at(Math.round(x) + 1, y)] = pick(palette); }
      y--; x += lean;
    }
  }
  return t;
}

function chestFace(kind: 'front' | 'side' | 'top'): Tile {
  const t = planks();
  const band = '#4a3418', trim = '#3a2810';
  for (let i = 0; i < 16; i++) { t[at(i, 0)] = trim; t[at(i, 15)] = trim; t[at(0, i)] = trim; t[at(15, i)] = trim; }
  if (kind !== 'top') for (let x = 0; x < 16; x++) t[at(x, 5)] = band;
  if (kind === 'front') { for (let y = 4; y < 9; y++) for (let x = 6; x < 10; x++) t[at(x, y)] = y === 4 || y === 8 || x === 6 || x === 9 ? '#6a6a6a' : '#c8c8c8'; t[at(7, 7)] = t[at(8, 7)] = '#2a2a2a'; }
  return t;
}

function buildNewTiles(set: (i: number, t: Tile) => void, SNOW: string[], stoneBase: Tile) {
  // Snow and ice
  set(TILE.ice, streaked(['#9cc8f0', '#a8d0f5', '#90bee8', '#b4d8f8'], '#dcecfc', 5));
  set(TILE.packed_ice, streaked(['#8cb4e8', '#7fa8e0', '#98bcec'], '#c0d8f4', 3));
  set(TILE.blue_ice, streaked(['#5a8ee0', '#4f84d8', '#6a9ae8', '#4478d0'], '#a8c8f4', 4));
  const powder = noiseTile(['#f8fbfd', '#ffffff', '#eef4f8', '#f4f8fb']);
  for (let i = 0; i < 18; i++) powder[at(Math.floor(rand() * 16), Math.floor(rand() * 16))] = '#dfe9f2';
  set(TILE.powder_snow, powder);
  set(TILE.snow_bricks, brickTile(SNOW, '#c8d6e2', '#ffffff'));
  set(TILE.frost_crystal_ore, sprinkleOre(stoneBase, ['#e8fbff', '#9ee8ff', '#5ac4f0'], 5));
  // Stone family
  const GRANITE = ['#9a6a58', '#a8765f', '#8a5c4a', '#b4826c', '#7e5444'];
  const DIORITE = ['#c8c8c4', '#dcdcd8', '#b0b0ac', '#ececea', '#9c9c98'];
  const ANDESITE = ['#8a8a88', '#7c7c7a', '#969694', '#6e6e6c'];
  set(TILE.granite, blotchTile(GRANITE, 0.35));
  set(TILE.diorite, blotchTile(DIORITE, 0.3));
  set(TILE.andesite, blotchTile(ANDESITE, 0.5));
  set(TILE.polished_granite, polished(GRANITE.slice(0, 3), '#c49480', '#6e4a3c'));
  set(TILE.polished_diorite, polished(DIORITE.slice(0, 3), '#f4f4f2', '#8c8c88'));
  set(TILE.polished_andesite, polished(ANDESITE.slice(0, 3), '#a4a4a2', '#5e5e5c'));
  const SLATE = ['#4a4a52', '#40404a', '#54545c', '#3a3a42'];
  const slate = blotchTile(SLATE, 0.6);
  for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) if (rand() < 0.6) slate[at(x, y)] = '#34343c';
  set(TILE.slate, slate);
  const cs = cobblestone();
  for (let i = 0; i < 256; i++) cs[i] = cs[i] === '#454545' ? '#26262c' : pick(SLATE);
  set(TILE.cobbled_slate, cs);
  set(TILE.slate_bricks, brickTile(SLATE, '#26262c', '#5e5e66', 4, 8));
  const basalt = newTile();
  for (let x = 0; x < 16; x++) { const c = pick(['#4a4a4e', '#3e3e42', '#56565a']); for (let y = 0; y < 16; y++) basalt[at(x, y)] = rand() < 0.8 ? c : '#2e2e32'; }
  set(TILE.basalt_side, basalt);
  set(TILE.basalt_top, logTop(['#3a3a3e'], '#56565a', '#4a4a4e'));
  set(TILE.obsidian, blotchTile(['#140c20', '#1e1230', '#2a1a40', '#0c0814', '#3a2458'], 0.4));
  set(TILE.copper_ore, sprinkleOre(stoneBase, ['#f0a070', '#d87a48', '#3aa088'], 5));
  // Storage and decoration
  set(TILE.copper_block, storageBlock('#f4a878', '#d0784a', '#8a4a28'));
  set(TILE.iron_block, storageBlock('#ffffff', '#dadada', '#9a9a9a'));
  set(TILE.gold_block, storageBlock('#fffcb0', '#f6d23a', '#b8860e'));
  set(TILE.diamond_block, storageBlock('#d8fff8', '#56e8d0', '#1a9a86'));
  set(TILE.coal_block, storageBlock('#3a3a3a', '#1e1e1e', '#0a0a0a'));
  const shelf = planks();
  for (const row of [2, 9]) {
    for (let x = 1; x < 15; x++) shelf[at(x, row + 5)] = '#4a3418';
    let x = 1;
    while (x < 15) {
      const w = 1 + (rand() < 0.3 ? 1 : 0), h = 3 + Math.floor(rand() * 2), c = pick(['#8a2a2a', '#2a4a8a', '#2a6a3a', '#8a6a2a', '#5a2a6a']);
      for (let k = 0; k < w && x < 15; k++, x++) for (let y = row + 5 - h; y < row + 5; y++) shelf[at(x, y)] = c;
      x++;
    }
  }
  set(TILE.bookshelf, shelf);
  set(TILE.wool, wool(['#ececec', '#f4f4f4', '#e0e0e0'], '#d4d4d4'));
  set(TILE.red_wool, wool(['#b83030', '#c43a3a', '#a82828'], '#962020'));
  set(TILE.yellow_wool, wool(['#e8c830', '#f0d23a', '#dcbc28'], '#c8a820'));
  set(TILE.blue_wool, wool(['#3446a8', '#3c50b8', '#2c3c98'], '#243288'));
  set(TILE.green_wool, wool(['#4a7a24', '#54862c', '#40701e'], '#365e18'));
  set(TILE.black_wool, wool(['#1e1e22', '#26262a', '#18181c'], '#101014'));
  set(TILE.terracotta, blotchTile(['#9a5a42', '#a4624a', '#8e523c'], 0.7));
  const lantern = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const frame = x < 2 || x > 13 || y < 2 || y > 13 || x === 7 || x === 8;
    lantern[at(x, y)] = frame ? pick(['#3a3a3e', '#4a4a4e']) : pick(['#ffd060', '#ffe080', '#ffc040', '#fff0a0']);
  }
  set(TILE.lantern, lantern);
  const torch = newTile();
  for (let y = 6; y < 16; y++) { torch[at(7, y)] = '#8a6232'; torch[at(8, y)] = '#5c3f1c'; }
  for (const [x, y, c] of [[7, 5, '#ffd040'], [8, 5, '#ffb020'], [7, 4, '#fff0a0'], [8, 4, '#ffd040'], [7, 3, '#ffe060'], [8, 6, '#ff8020']] as [number, number, string][]) torch[at(x, y)] = c;
  set(TILE.torch, torch);
  // Plants
  set(TILE.red_mushroom, mushroom(['#c82020', '#d83030', '#b01818'], '#f4f0e8'));
  set(TILE.brown_mushroom, mushroom(['#9a7050', '#8a6444', '#a67c5a'], null));
  set(TILE.berry_bush, bush(['#2e5a2a', '#3a6a32', '#285024'], ['#d02040', '#e83050', '#b01830'], 9));
  set(TILE.snowberry_bush, bush(['#4a6a5a', '#5a7a6a', '#3e5e4e', '#e8f0f0'], ['#f0f4ff', '#c8d8ff', '#a0b8f0'], 10));
  set(TILE.frost_fern, fern(['#8ab0b8', '#a8c8d0', '#6e98a4', '#d0e4ea']));
  const melonSide = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) melonSide[at(x, y)] = x % 4 < 2 ? pick(['#6a9a2a', '#5e8e24']) : pick(['#4a7a1a', '#3e6e14']);
  set(TILE.melon_side, melonSide);
  set(TILE.melon_top, logTop(['#4a7a1a'], '#6a9a2a', '#5a8a22'));
  set(TILE.wild_carrots, crop(['#3a8a2a', '#4a9a34', '#2e7a22'], 7, ['#e87a1a', '#f08a2a']));
  set(TILE.wild_potatoes, crop(['#4a8a3a', '#3a7a2e', '#5a9a44'], 6, ['#e8e0a0', '#c8b870']));
  const jack = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) jack[at(x, y)] = (x % 4 === 0) ? '#b8660f' : pick(['#e3861a', '#d67a12', '#eb9224']);
  drawPixels(jack, ['.kk....kk.', '.kk....kk.', '..........', 'k........k', 'kkk.kk.kkk', '.kkkkkkkk.'], 3, 4, { k: '#ffe040' });
  set(TILE.jack_o_lantern, jack);
  const msb = brickTile(STONE, '#5a5a5a', '#909090', 8, 16);
  for (let i = 0; i < 256; i++) if (msb[i] !== '#5a5a5a' && rand() < 0.3) msb[i] = pick(['#5a7a3a', '#4a6a2e', '#6a8a44']);
  set(TILE.mossy_stone_bricks, msb);
  const csb = brickTile(STONE, '#5a5a5a', '#909090', 8, 16);
  let cx = 3, cy = 1;
  for (let k = 0; k < 14; k++) { csb[at(cx, cy)] = '#3a3a3a'; cy++; cx += rand() < 0.5 ? 1 : 0; }
  set(TILE.cracked_stone_bricks, csb);
  set(TILE.smooth_stone, polished(['#a4a4a4', '#9c9c9c', '#aaaaaa'], '#bcbcbc', '#7c7c7c'));
  const farm = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) farm[at(x, y)] = y % 4 === 0 ? '#3e2a18' : pick(['#5a3e26', '#4e3620', '#664830']);
  set(TILE.farmland, farm);
  // Crops
  set(TILE.wheat_0, crop(['#5aa83a', '#6ab844'], 4, null, 0.5));
  set(TILE.wheat_1, crop(['#7ab83a', '#8ac444', '#6aa834'], 9, null, 0.6));
  set(TILE.wheat_2, crop(['#c8a840', '#b89830', '#d8b850'], 13, ['#e8c860', '#a88020'], 0.7));
  set(TILE.carrot_crop, crop(['#3a8a2a', '#4a9a34'], 4, null, 0.45));
  set(TILE.potato_crop, crop(['#4a8a3a', '#5a9a44'], 4, null, 0.45));
  // Chest
  set(TILE.chest_front, chestFace('front'));
  set(TILE.chest_side, chestFace('side'));
  set(TILE.chest_top, chestFace('top'));
  // The Robotic World (appended last: every tile above keeps its random pattern)
  set(TILE.etherite_block, storageBlock('#c9a0ff', '#6a5488', '#241c30'));
  const RUST = ['#6a3a24', '#7a4428', '#5a3020', '#84502e', '#4e2a1a'];
  set(TILE.rust_rock, blotchTile(RUST, 0.45));
  const scrapTop = blotchTile(['#6e6e72', '#7c7c80', '#5e5e62', '#8a6a4a', '#666668'], 0.35);
  for (let i = 0; i < 12; i++) scrapTop[at(Math.floor(rand() * 16), Math.floor(rand() * 16))] = pick(['#b0b0b4', '#a05a2a', '#3a3a3e']);
  set(TILE.scrap_top, scrapTop);
  const scrapSide = blotchTile(RUST, 0.45);
  for (let x = 0; x < 16; x++) { const depth = 2 + Math.floor(rand() * 3); for (let y = 0; y < depth; y++) scrapSide[at(x, y)] = pick(['#6e6e72', '#7c7c80', '#5e5e62']); }
  set(TILE.scrap_side, scrapSide);
  set(TILE.tungsten_ore, sprinkleOre(blotchTile(RUST, 0.45), ['#e8ecf4', '#9aa4b8', '#5c667a'], 5));
  set(TILE.oil, blotchTile(['#1a1410', '#221a14', '#140f0b', '#2a2018', '#3a2c20'], 0.7));
  const plate = polished(['#8e949c', '#868c94', '#969ca4'], '#b8bec6', '#50565e');
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) plate[at(x, y)] = '#3a3e44'; // rivets
  set(TILE.metal_plate, plate);
  const rustyMetal = polished(['#8e949c', '#868c94'], '#b8bec6', '#50565e');
  for (let i = 0; i < 256; i++) if (rand() < 0.45) rustyMetal[i] = pick(RUST);
  set(TILE.rusty_metal, rustyMetal);
  const eye = storageBlock('#5e646c', '#4a5058', '#2a2e34');
  drawPixels(eye, ['..rrrr..', '.rRRRRr.', 'rRRwwRRr', 'rRRwwRRr', '.rRRRRr.', '..rrrr..'], 4, 5, { r: '#a01010', R: '#ff2a2a', w: '#ffe0e0' });
  set(TILE.robot_eye, eye);
  set(TILE.portal_core, storageBlock('#fff6c0', '#ffd23a', '#b06a00'));
  const altar = storageBlock('#6e747c', '#4a5058', '#23272c');
  drawPixels(altar, ['..oooo..', '.oOOOOo.', 'oOOyyOOo', 'oOOyyOOo', '.oOOOOo.', '..oooo..'], 4, 5, { o: '#a04000', O: '#ff7a1a', y: '#ffe060' });
  set(TILE.altar_core, altar);
  // More wool colours, banners and the claim stone (appended last, like the Robotic World)
  set(TILE.orange_wool, wool(['#e07a20', '#ea862a', '#d47018'], '#b85e10'));
  set(TILE.purple_wool, wool(['#7a34a8', '#8640b4', '#6e2c9c'], '#5a2084'));
  set(TILE.pink_wool, wool(['#ec90b0', '#f49cbc', '#e084a4'], '#cc6e90'));
  set(TILE.cyan_wool, wool(['#1e9aa0', '#28a6ac', '#168e94'], '#107478'));
  COLORS.forEach((c, i) => set(TILE.banner_0 + i, bannerTile(DYE_RGB[c])));
  const claimSide = brickTile(STONE, '#4a4a4a', '#9a9a9a');
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) claimSide[at(x, y)] = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 3.5 ? pick(['#9ef0ff', '#d8fbff', '#6ad8f0']) : claimSide[at(x, y)];
  set(TILE.claim_side, claimSide);
  const claimTop = polished(['#9a9a9a', '#8e8e8e', '#a4a4a4'], '#c0c0c0', '#606060');
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if (Math.abs(x - 7.5) + Math.abs(y - 7.5) < 4.5) claimTop[at(x, y)] = pick(['#9ef0ff', '#d8fbff', '#6ad8f0']);
  set(TILE.claim_top, claimTop);
  // The Frost World
  set(TILE.moonstone_block, storageBlock('#ffffff', '#ddd8f8', '#8f86c2'));
  const frame = storageBlock('#e8f8ff', '#c8d8f8', '#6a7ab8');
  for (let i = 0; i < 18; i++) frame[at(1 + Math.floor(rand() * 14), 1 + Math.floor(rand() * 14))] = pick(['#9ee8ff', '#ffffff']);
  set(TILE.elemental_frame, frame);
  // The portal: swirling blue light with gaps you can see through
  const portal = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const a = Math.atan2(y - 7.5, x - 7.5), r = Math.hypot(x - 7.5, y - 7.5);
    const swirl = Math.sin(a * 3 + r * 0.9);
    portal[at(x, y)] = swirl > 0.55 ? '#e8fcff' : swirl > -0.1 ? pick(['#5ac8f8', '#4ab8f0', '#6ad4ff']) : swirl > -0.6 ? pick(['#2a78d8', '#3a88e0']) : null;
  }
  set(TILE.elemental_portal, portal);
  const PERMAFROST = ['#5e6e7e', '#56667a', '#687888', '#4e5e70', '#7a8a9a'];
  const perm = blotchTile(PERMAFROST, 0.5);
  for (let i = 0; i < 14; i++) perm[at(Math.floor(rand() * 16), Math.floor(rand() * 16))] = pick(['#c8e4f4', '#e8f4fc']);
  set(TILE.permafrost, perm);
  set(TILE.glacite_ore, sprinkleOre(blotchTile(PERMAFROST, 0.5), ['#f0ffff', '#7af0f0', '#20b0c8'], 5));
  const shrine = storageBlock('#d8f0ff', '#88b8e8', '#2a4a88');
  drawPixels(shrine, ['..cccc..', '.cCCCCc.', 'cCCwwCCc', 'cCCwwCCc', '.cCCCCc.', '..cccc..'], 4, 5, { c: '#2a78d8', C: '#6ad4ff', w: '#ffffff' });
  set(TILE.frost_shrine, shrine);
  // The Elemental World's other biomes
  set(TILE.obitite_block, storageBlock('#ff9a7a', '#d0304a', '#4a0c1c'));
  const magma = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const crack = Math.abs(Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 1.1 - x * 0.3)) < 0.35;
    magma[at(x, y)] = crack ? pick(['#ffb030', '#ff7a1a', '#ffd060']) : pick(['#4a1a10', '#5a2214', '#3a140c']);
  }
  set(TILE.magma_block, magma);
  set(TILE.volcanic_ash, blotchTile(['#5a5458', '#4e484c', '#66605e', '#3e3a3c'], 0.4));
  const JUNGLE_BARK = ['#5a4a26', '#4e3e1e', '#66542e', '#46381a'];
  const jSide = newTile();
  for (let x = 0; x < 16; x++) { const base = pick(JUNGLE_BARK); for (let y = 0; y < 16; y++) jSide[at(x, y)] = rand() < 0.7 ? base : pick(['#3a6a2a', ...JUNGLE_BARK]); }
  set(TILE.jungle_side, jSide);
  set(TILE.jungle_top, logTop(JUNGLE_BARK, '#b8925a', '#9a7a48'));
  set(TILE.jungle_leaves, leaves(['#2a7a1a', '#348a24', '#1e6a14', '#40962c'], 0.1));
  set(TILE.moss_block, blotchTile(['#4a7a2a', '#568a32', '#3e6a22', '#62963a'], 0.5));
  set(TILE.cloud, blotchTile(['#ffffff', '#f4f8fc', '#eaf0f8', '#ffffff'], 0.6));
  const SKY = ['#d8e4f0', '#c8d8e8', '#e4ecf4', '#bccce0'];
  set(TILE.skystone, blotchTile(SKY, 0.5));
  set(TILE.skystone_bricks, brickTile(SKY, '#8c9cb8', '#f0f6fc'));
  const shrineCore = (l: string, m: string, d: string, glow: string[]) => {
    const t = storageBlock(l, m, d);
    drawPixels(t, ['..cccc..', '.cCCCCc.', 'cCCwwCCc', 'cCCwwCCc', '.cCCCCc.', '..cccc..'], 4, 5, { c: glow[0], C: glow[1], w: glow[2] });
    return t;
  };
  set(TILE.fire_shrine, shrineCore('#5a3a2a', '#3a1a10', '#1a0a04', ['#a02000', '#ff7a1a', '#ffe060']));
  set(TILE.earth_shrine, shrineCore('#7a8a5a', '#4a5a2a', '#2a3a14', ['#2a6a1a', '#6ad040', '#e0ffb0']));
  set(TILE.wind_shrine, shrineCore('#f0f6fc', '#b8c8e0', '#6a7a98', ['#6a8ab8', '#c8e0ff', '#ffffff']));
  // The Elemental Altar: dark stone set with the four elements' gems
  const altarSide = storageBlock('#5a5468', '#3a3448', '#1a1624');
  for (const [x, y, c] of [[4, 5, '#2a78e0'], [11, 5, '#ff6a10'], [4, 10, '#5a9a2a'], [11, 10, '#e8f0ff']] as [number, number, string][]) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) altarSide[at(x + dx - 1, y + dy - 1)] = c;
  set(TILE.altar_side, altarSide);
  const altarTop = storageBlock('#6a6478', '#3a3448', '#1a1624');
  drawPixels(altarTop, ['...ww...', '..wbbw..', '.wbrrbw.', 'wbrggrbw', 'wbrggrbw', '.wbrrbw.', '..wbbw..', '...ww...'], 4, 4, { w: '#e8f0ff', b: '#2a78e0', r: '#ff6a10', g: '#6ad040' });
  set(TILE.altar_top, altarTop);
  // A rail: two iron rails on wooden ties (transparent between them)
  const rail = newTile();
  for (let y = 1; y < 16; y += 4) for (let x = 1; x < 15; x++) rail[at(x, y)] = rail[at(x, y + 1)] = pick(['#7a5a32', '#6a4a28']);
  for (let y = 0; y < 16; y++) for (const x of [3, 12]) { rail[at(x, y)] = '#c8c8cc'; rail[at(x + 1, y)] = '#8a8a90'; }
  set(TILE.rail, rail);
  // A temple tower's crystal: a glowing faceted gem (its boss heals from it)
  const crystal = newTile();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    crystal[at(x, y)] = d < 3 ? '#ffffff' : d < 5.5 ? pick(['#e8f8ff', '#c8f0ff']) : d < 8 ? pick(['#9ad8ff', '#b8a8ff']) : pick(['#6a7ab8', '#8a6ad0']);
  }
  for (let i = 2; i < 14; i++) { crystal[at(i, i)] = '#ffffff'; crystal[at(15 - i, i)] = '#f0f8ff'; } // facet lines
  set(TILE.boss_crystal, crystal);
}

// Dye colours: [light, main, dark]
const DYE_RGB: Record<string, [string, string, string]> = {
  white: ['#ffffff', '#ececec', '#b8b8b8'], red: ['#e04848', '#b83030', '#6e1414'], yellow: ['#fff070', '#e8c830', '#8a7010'],
  blue: ['#5a70e0', '#3446a8', '#1a2468'], green: ['#78b048', '#4a7a24', '#244a10'], black: ['#4a4a4e', '#1e1e22', '#0a0a0c'],
  orange: ['#ffa850', '#e07a20', '#8a4408'], purple: ['#a866d8', '#7a34a8', '#40145e'], pink: ['#ffc0d8', '#ec90b0', '#a8506e'], cyan: ['#60d0d6', '#1e9aa0', '#0a5458'],
};

// A banner on a pole: crossbar, cloth with a border and a diamond emblem, the pole below
function bannerTile([l, m, d]: [string, string, string]): Tile {
  const t = newTile();
  for (let x = 2; x <= 13; x++) t[at(x, 0)] = '#5c3f1c';
  for (let y = 12; y < 16; y++) { t[at(7, y)] = '#8a6232'; t[at(8, y)] = '#5c3f1c'; }
  for (let y = 1; y <= 12; y++) for (let x = 3; x <= 12; x++) {
    if (y === 12 && (x === 3 || x === 12 || (x > 4 && x < 11 && x % 2))) continue; // a ragged hem
    const edge = x === 3 || x === 12 || y === 1;
    const emblem = Math.abs(x - 7.5) + Math.abs(y - 6.5) < 3;
    t[at(x, y)] = edge ? d : emblem ? (Math.abs(x - 7.5) + Math.abs(y - 6.5) < 1.5 ? d : l) : m;
  }
  return t;
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
  tungsten: { l: '#f0f4fc', m: '#a4aec2', d: '#4e586c' },
  obitite: { l: '#ff9a7a', m: '#d0304a', d: '#4a0c1c' },
  glacite: { l: '#f0ffff', m: '#6ae0ec', d: '#1a7890' },
  // Elemental armour and the poison sword
  water: { l: '#a0d8ff', m: '#2a78e0', d: '#0a2a6a' },
  lava: { l: '#ffd060', m: '#ff5a10', d: '#6a1a00' },
  earth: { l: '#a8d070', m: '#5a8a2a', d: '#2a3a10' },
  wind: { l: '#ffffff', m: '#c8e4f4', d: '#6a8aa8' },
  poison: { l: '#c8ff80', m: '#6ad020', d: '#1a4a08' },
  // Elemental tools
  blazing: { l: '#ffe080', m: '#ff6a10', d: '#6a1a00' },
  tidal: { l: '#c0e8ff', m: '#2a88e8', d: '#0a2a6a' },
  quaking: { l: '#c8e890', m: '#6a8a2a', d: '#2a3a10' },
  gale: { l: '#ffffff', m: '#d8ecfa', d: '#c89a20' },
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
  moonstone: ['crescent', { l: '#ffffff', m: '#d6d0f5', d: '#6f66a8', w: '#fff8c0' }],
  etherite: ['gem', TIER_PALETTE.etherite],
  obitite: ['crystal', TIER_PALETTE.obitite],
  laser_cannon_core: ['ball', { l: '#fff0a0', m: '#ff7a1a', d: '#7a2a00' }],
  laser_cannon: ['cannon', { l: '#c8ced8', m: '#6e747c', d: '#2a2e34', h: '#ff3030' }],
  compass: ['ball', { l: '#f0f0f0', m: '#9aa0a8', d: '#3a3e44' }],
  jetpack: ['jetpack', { l: '#ff9a7a', m: '#d0304a', d: '#4a0c1c', h: '#ffb030' }],
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
SHAPES.cannon = ['', '', '', '', '...dddddddddd...', '..dlllllllllmdd.', '.hdmmmmmmmmmmmmh', '..dmmmmmmmmmmdd.', '...dddmmdddddd..', '.....dmmd.......', '.....dmmd.......', '.....dddd.......'];
SHAPES.jetpack = ['', '..dddd....dddd..', '.dllmd....dllmd.', '.dlmmdddddlmmmd.', '.dlmmdmmmmdlmmd.', '.dlmmdmmmmdlmmd.', '.dlmmdddddlmmmd.', '.dlmmd....dlmmd.', '.dmmmd....dmmmd.', '..dddd....dddd..', '...hh......hh...', '..h..h....h..h..', '...hh......hh...'];
SHAPES.bone = ['', '', '...........dd...', '..........dlld..', '...........dmd..', '..........dmd...', '.........dmd....', '........dmd.....', '.......dmd......',
  '......dmd.......', '.....dmd........', '..dddmd.........', '.dlld...........', '..dd............'];
SHAPES.pie = ['', '', '', '', '', '.....dddddd.....', '...ddwwwwwwdd...', '..dwllmmmmmmwd..', '..dwmmmmmmmmwd..', '..ddwwwwwwwwdd..', '..dmddddddddmd..', '...dmmmmmmmmd...', '....dddddddd....'];
SHAPES.ball = ['', '', '', '', '......dddd......', '....ddllmmdd....', '...dllmmmmmmd...', '...dlmmmmmmmd...', '...dmmmmmmmmd...', '...dmmmmmmmmd...', '....ddmmmmdd....', '......dddd......'];
SHAPES.crystal = ['', '.......d........', '......dld.......', '.....dllmd......', '.....dlmmd..d...', '....dllmmmddld..', '....dlmmmmdlmd..', '..d.dlmmmmdmmd..', '.dld.dlmmd.dmd..', '.dlmddlmmd.dd...', '.dmmmddmmd......', '..dmmmmmd.......', '...dddddd.......'];
SHAPES.string = ['', '', '...ddd..........', '..d...d.........', '..d....dd.......', '...d.....d......', '....dd....d.....', '......d...d.....', '......d....d....', '.......dd...d...', '.........d..d...', '..........dd....'];
SHAPES.dye = ['', '', '', '.......dd.......', '......dwwd......', '......dwwd......', '.....dmmmmd.....', '....dmllmmmd....', '....dlmmmmmd....', '....dmmmmmmd....', '....dmmmmmmd....', '.....dmmmmd.....', '......dddd......'];
SHAPES.berries = ['', '', '', '........h.......', '.......hh.......', '......h..h......', '.....dd..dd.....', '....dlmd.dlmd...', '....dmmd.dmmd...', '.....dd.dd.dd...', '.......dlmd.....', '.......dmmd.....', '........dd......'];
SHAPES.carrot = ['', '..........hh.h..', '...........hhh..', '..........dddh..', '.........dlmd...', '........dlmmd...', '.......dlmmd....', '......dlmmd.....', '.....dlmmd......', '....dlmmd.......', '...dmmmd........', '..dmmd..........', '..dd............'];
SHAPES.potato = ['', '', '', '', '.....dddddd.....', '....dllmmmmd....', '...dlmmwmmmmd...', '...dmmmmmmwmd...', '...dmwmmmmmmd...', '....dmmmmwmd....', '.....dddddd.....'];
SHAPES.seeds = ['', '', '', '', '....d.....d.....', '...dl...d..d....', '...dm..dl.......', '.......dm...d...', '..d........dl...', '.dl...d.....dm..', '.dm..dl.........', '.....dm...d.....', '..........dm....'];
SHAPES.wheat = ['', '...l.l.l........', '..lml.lml.......', '...m.m.m.l......', '..lml.lml.lm....', '...m..m.m.m.....', '....m..m.m......', '.....m.m.m......', '......mmm.......', '.......m........', '......hhh.......', '.......m........', '.......m........'];
SHAPES.bread = ['', '', '', '', '', '....dddddddd....', '..ddllllmmmmdd..', '.dlmmwmmwmmwmmd.', '.dmmmmmmmmmmmmd.', '.ddmmmmmmmmmmdd.', '..dddddddddddd..'];
SHAPES.bowl = ['', '', '', '', '', '', '', '..dddddddddddd..', '..dllmmmmmmmmd..', '...dlmmmmmmmd...', '....dmmmmmmd....', '.....dddddd.....'];
SHAPES.stew = ['', '', '', '', '', '', '...wwhwwhwwhw...', '..dddddddddddd..', '..dllmmmmmmmmd..', '...dlmmmmmmmd...', '....dmmmmmmd....', '.....dddddd.....'];
SHAPES.slice = ['', '', '', '', '..d.............', '..dd............', '..dwd...........', '..dwmd..........', '..dwmkd.........', '..dwmmmd........', '..dwmkmmd.......', '..dwmmmkmd......', '..dddddddddd....'];
SHAPES.cookie = ['', '', '', '', '.....dddddd.....', '....dmmkmmmd....', '...dmmmmmkmmd...', '...dmkmmmmmmd...', '...dmmmmkmmmd...', '....dmmmmmkd....', '.....dddddd.....'];
SHAPES.eye = ['', '', '', '', '.....dddddd.....', '....dmmmmmmd....', '...dmmwwwwmmd...', '...dmwkkkkwmd...', '...dmwkkkkwmd...', '...dmmwwwwmmd...', '....dmmmmmmd....', '.....dddddd.....'];
SHAPES.droplet = ['', '.......d........', '......dld.......', '......dld.......', '.....dllmd......', '.....dlmmd......', '....dllmmmd.....', '....dlmmmmd.....',
  '...dlwmmmmmd....', '...dlwmmmmmd....', '...dmmmmmmmd....', '...dmmmmmmhd....', '....dmmmmhd.....', '.....dddddd.....'];
SHAPES.flame = ['........h.......', '.......hh.......', '......hlh..h....', '.....hllh.hh....', '....hlwlhhlh....', '....hlwwllh.....', '...dmlwwlmd.....',
  '..dmmmllmmmd....', '..dmmlmmmmmd....', '.dddmmmmmlddd...', '.dmmdddddddmd...', '..ddmmmlmmdd....', '....dddddd......'];
SHAPES.leafgem = ['', '..........hhh...', '.........hwwh...', '........hwwh....', '.......hhh......', '.....dddddd.....', '....dllmmmmd....', '...dllmmmmmmd...',
  '...dlmmmwmmmd...', '...dmmmwwmmmd...', '...dmmmmmmmld...', '....dmmmmmld....', '.....dmmmld.....', '......dddd......'];
SHAPES.windgem = ['', '.......dd.......', '......dlld......', '.....dmwwmd.....', '....dmwmmwmd....', '...dmwmwwmwmd...', '...dmwmmwmwmd...', '...dmmwwmmwmd...',
  '...dmmmmmwmmd...', '....dmwwwmmd....', '.....dmmmmd.....', '......dmmd......', '.......dd.......'];
SHAPES.crescent = ['', '......dddd......', '....ddllld......', '...dllmd.....w..', '..dlmmd.....www.', '..dlmd.......w..', '.dlmmd..........', '.dlmmd..........',
  '.dlmmd....w.....', '..dlmmd.........', '..dmmmmd........', '...dmmmmdd......', '....ddmmmmddd...', '......dddd......'];
SHAPES.cluster = ['', '.......d........', '......dld...d...', '.....dlwmd.dld..', '..d..dlwmd.dlmd.', '.dld.dlmmd.dlmd.', '.dlmddlmmd.dmmd.', '.dlmdlmmmd.dmd..',
  '.dmmddlmmd.dmd..', '..dmmdmmmdddd...', '...dmmdmmddmd...', '....dmmmmmmd....', '.....dddddd.....'];
SHAPES.egg = ['', '.......dd.......', '......dmmd......', '.....dmmwmd.....', '....dmlmmmmd....', '....dlmmmwmd....', '...dlmmwwmmmd...', '...dmmmmmmwmd...',
  '...dmwmmmmmmd...', '...dmwwmmwmmd...', '....dmmmmwmd....', '.....dmmmmd.....', '......dddd......'];
// Each spawn egg's colours: [shell, spots]
const EGG_COLORS: Record<string, [string, string]> = {
  pig: ['#f0a0a8', '#c05868'], cow: ['#5a3a22', '#e8e0d8'], chicken: ['#f4f4f4', '#d02020'], zombie: ['#2a8a9a', '#5a9a4a'],
  husk: ['#8a6a3a', '#c8b078'], frostbitten: ['#4a6a8a', '#a8d8f0'], spider: ['#2a2420', '#d01010'], skeleton: ['#c8c8c0', '#5a5a5a'],
  slime: ['#70c850', '#2a6a1a'], slimelet: ['#90d870', '#3a8a2a'], robot: ['#8a9098', '#ff2020'], robot_titan: ['#3a3f46', '#ff7a1a'],
  frost_wraith: ['#b8d8f0', '#2a78d8'], magma_colossus: ['#34343a', '#ff6a10'], thorn_guardian: ['#4e3e22', '#6ad040'], tempest: ['#f4f8ff', '#ffc830'],
};
SHAPES.boat = ['', '', '', '', '', '', 'd..............d', 'dd............dd', 'dlddddddddddddld', 'dlmmmmmmmmmmmmld', '.dlmmmmmmmmmmld.', '..dllllllllllld.', '...dddddddddddd.'];
SHAPES.minecart = ['', '', '', '', 'dddddddddddddddd', 'dlllllllllllllld', 'dmmmmmmmmmmmmmmd', 'dmmmmmmmmmmmmmmd', 'dmmmmmmmmmmmmmmd', '.dmmmmmmmmmmmmd.', '..dddddddddddd..', '..ww.......ww...', '.wwww.....wwww..', '..ww.......ww...'];
SHAPES.wings = ['', 'll............ll', 'lml..........lml', 'lmml........lmml', '.lmml..ww..lmml.', '.lmmml.ww.lmmml.', '..lmmmlwwlmmml..', '..lmmmdwwdmmml..', '...lmmd..dmml...', '...lmd....dml...', '....ld....dl....', '....d......d....'];
SHAPES.heart = ['', '', '', '...ddd...ddd....', '..dllmd.dlmmd...', '.dllmmmdmmmmmd..', '.dlmmmmmmmmmmd..', '.dmmmmmmmmmmmd..', '..dmmmmmmmmmd...', '...dmmmmmmmd....', '....dmmmmmd.....', '.....dmmmd......', '......dmd.......', '.......d........'];
SHAPES.arrow = ['', '............ddd.', '...........dlld.', '............dld.', '...........h.d..', '..........h.....', '.........h......', '........h.......', '.......h........', '......h.........', '..ww.h..........', '..wwh...........', '...ww...........'];
Object.assign(ITEM_ART, {
  snowball: ['ball', { l: '#ffffff', m: '#eef4f8', d: '#a8b8c8' }],
  slime_ball: ['ball', { l: '#b8f0a0', m: '#78d060', d: '#3a8a2a' }],
  frost_crystal: ['crystal', { l: '#f0fcff', m: '#8ee0ff', d: '#2a88c0' }],
  copper_ingot: ['ingot', { l: '#f8b888', m: '#d87a48', d: '#8a4a28' }],
  tungsten_ingot: ['ingot', { l: '#f0f4fc', m: '#a4aec2', d: '#4e586c' }],
  string: ['string', { d: '#e8e8e8' }],
  red_dye: ['dye', { l: '#f05050', m: '#c82828', d: '#6a1010', w: '#8a6a4a' }],
  yellow_dye: ['dye', { l: '#fff070', m: '#f0c828', d: '#8a6a10', w: '#8a6a4a' }],
  blue_dye: ['dye', { l: '#7090ff', m: '#3450d0', d: '#1a2468', w: '#8a6a4a' }],
  green_dye: ['dye', { l: '#80c050', m: '#4a8a24', d: '#244a10', w: '#8a6a4a' }],
  black_dye: ['dye', { l: '#4a4a4a', m: '#222222', d: '#0a0a0a', w: '#8a6a4a' }],
  white_dye: ['dye', { l: '#ffffff', m: '#e8e8e8', d: '#8a8a8a', w: '#8a6a4a' }],
  orange_dye: ['dye', { l: '#ffb060', m: '#e07a20', d: '#7a3a08', w: '#8a6a4a' }],
  purple_dye: ['dye', { l: '#b878e8', m: '#7a34a8', d: '#3a1050', w: '#8a6a4a' }],
  pink_dye: ['dye', { l: '#ffd0e0', m: '#ec90b0', d: '#8a3a5a', w: '#8a6a4a' }],
  cyan_dye: ['dye', { l: '#70e0e8', m: '#1e9aa0', d: '#0a4a4e', w: '#8a6a4a' }],
  moonstone_orb: ['ball', { l: '#ffffff', m: '#c8c0f8', d: '#5a4ea8' }],
  glacite: ['cluster', { l: '#f0ffff', m: '#6ae0ec', d: '#1a7890', w: '#ffffff' }],
  frost_heart: ['heart', { l: '#ffffff', m: '#7ad8ff', d: '#1a5aa8' }],
  water_ore: ['droplet', { l: '#c0e8ff', m: '#2a78e0', d: '#0a2a6a', w: '#ffffff', h: '#1a58b0' }],
  lava_ore: ['flame', { l: '#ffd040', m: '#5a2a1a', d: '#2a1008', w: '#ffffa0', h: '#ff7a10' }],
  earth_ore: ['leafgem', { l: '#c8f090', m: '#3a9a3a', d: '#14400e', w: '#e8ffd0', h: '#6a4a20' }],
  wind_ore: ['windgem', { l: '#ffd040', m: '#b8dcf4', d: '#5a7a98', w: '#ffffff' }],
  fireball: ['ball', { l: '#fff080', m: '#ff7a1a', d: '#a02000' }],
  boat: ['boat', { l: '#c9a26b', m: '#a07844', d: '#5e4424' }],
  minecart: ['minecart', { l: '#e0e0e4', m: '#8a8a90', d: '#3a3a40', w: '#2a2a2e' }],
  elemental_wings: ['wings', { l: '#ffffff', m: '#d8e8f8', d: '#7a8aa8', w: '#ffc830' }],
  sweet_berries: ['berries', { l: '#ff7080', m: '#d02040', d: '#6a0a1a', h: '#3a6a2a' }],
  snowberries: ['berries', { l: '#ffffff', m: '#c8d8ff', d: '#5a70b0', h: '#4a6a5a' }],
  melon_slice: ['slice', { d: '#2a5a14', w: '#8ac44a', m: '#e84848', k: '#1a1a1a' }],
  carrot: ['carrot', { l: '#ffb060', m: '#f07a1a', d: '#8a3a08', h: '#3a8a2a' }],
  golden_carrot: ['carrot', { l: '#fffcb0', m: '#f6d23a', d: '#a67c10', h: '#c8a820' }],
  potato: ['potato', { l: '#f0e0a0', m: '#d8c080', d: '#7a6030', w: '#a88850' }],
  baked_potato: ['potato', { l: '#f8d890', m: '#d8a050', d: '#6a4018', w: '#8a5020' }],
  seeds: ['seeds', { l: '#9ad060', m: '#5a9a2a', d: '#2a5a14' }],
  wheat: ['wheat', { l: '#f0d870', m: '#c8a840', h: '#8a6a20' }],
  bread: ['bread', { l: '#e8b870', m: '#c08040', d: '#6a3a14', w: '#f0d8a0' }],
  bowl: ['bowl', { l: '#b08a55', m: '#8a6232', d: '#4a3418' }],
  mushroom_stew: ['stew', { l: '#b08a55', m: '#8a6232', d: '#4a3418', w: '#c89868', h: '#c82020' }],
  golden_apple: ['apple', { l: '#fffcb0', m: '#f6d23a', d: '#a67c10', h: '#5c3f1c' }],
  cookie: ['cookie', { m: '#c88840', d: '#6a4018', k: '#3a2010' }],
  spider_eye: ['eye', { m: '#8a2040', d: '#3a0a18', w: '#e04060', k: '#1a0a10' }],
  arrow: ['arrow', { l: '#e0e0e0', d: '#6a6a6a', h: '#8a6232', w: '#f0f0f0' }],
} as Record<string, [string, Record<string, string>]>);

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
  if (pal && ARMOR[kind]) {
    put(ARMOR[kind], pal);
    // Elemental armour: its element's trim across the middle
    const trim = ({ water: '#9ef4ff', lava: '#ffd040', earth: '#f04080', wind: '#ffc830' } as Record<string, string>)[tierName];
    if (trim) for (let i = 0; i < 256; i++) if (t[i] === pal.m && ((i >> 4) % 3 === 0 || (i & 15) % 5 === 2)) t[i] = trim;
    return t;
  }
  const art = ITEM_ART[type];
  if (art) { put(SHAPES[art[0]], art[1]); return t; }
  // Spawn eggs: an egg in the creature's colours, with spots
  if (type.endsWith('_spawn_egg')) {
    const [base, spot] = EGG_COLORS[type.slice(0, -'_spawn_egg'.length)] ?? ['#c8c8c8', '#5a5a5a'];
    const c = new THREE.Color(base);
    put(SHAPES.egg, { m: base, w: spot, l: `#${c.clone().lerp(new THREE.Color('#ffffff'), 0.35).getHexString()}`, d: `#${c.clone().multiplyScalar(0.45).getHexString()}` });
    return t;
  }
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
  const todo = Object.keys(ITEMS);
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 30));
  const slice = () => {
    const end = performance.now() + 8;
    while (todo.length && performance.now() < end) getIconCanvas(todo.pop()!);
    if (todo.length) idle(slice);
  };
  idle(slice);
  void TIERS;
}
