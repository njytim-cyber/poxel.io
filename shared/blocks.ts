// Central registry of blocks and items. Everything else looks up properties here.

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';

// Tier order: higher = mines faster, hits harder
export const TIERS = ['wooden', 'stone', 'iron', 'gold', 'diamond', 'moonstone', 'etherite'] as const;
export const TIER_SPEED = [2, 4, 6, 8, 10, 12, 15];
const SWORD_DAMAGE = [4, 5, 6, 7, 8, 9, 10];

// Atlas tile indices (see textures.ts, same order)
export const TILE = {
  grass_top: 0, grass_side: 1, dirt: 2, stone: 3, cobblestone: 4, log_side: 5, log_top: 6, planks: 7,
  leaves: 8, bedrock: 9, table_top: 10, table_side: 11, table_front: 12, furnace_front: 13, furnace_side: 14,
  furnace_top: 15, coal_ore: 16, iron_ore: 17, gold_ore: 18, diamond_ore: 19, moonstone_ore: 20, etherite_ore: 21,
  sand: 22, sandstone_side: 23, sandstone_top: 24, gravel: 25, snow_side: 26, snow_top: 27, water: 28,
  cactus_side: 29, cactus_top: 30, birch_side: 31, birch_top: 32, birch_leaves: 33, spruce_leaves: 34,
  lava: 35, glass: 36, clay: 37, bricks: 38, mossy_cobblestone: 39, stone_bricks: 40, pumpkin_side: 41,
  pumpkin_top: 42, pumpkin_front: 43, tall_grass: 44, dandelion: 45, poppy: 46, cornflower: 47,
  spruce_side: 48, spruce_top: 49,
} as const;
export const TILE_COUNT = 50;
export const ATLAS_COLS = 16;
export const ATLAS_ROWS = Math.ceil(TILE_COUNT / ATLAS_COLS);

// UV rect of an atlas tile: [u0, v0, u1, v1] (v measured bottom-up, as three.js expects with flipY)
export function tileUV(tile: number): [number, number, number, number] {
  const e = 0.0005;
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const u0 = col / ATLAS_COLS + e, u1 = (col + 1) / ATLAS_COLS - e;
  const v1 = 1 - row / ATLAS_ROWS - e, v0 = 1 - (row + 1) / ATLAS_ROWS + e;
  return [u0, v0, u1, v1];
}

export interface BlockDef {
  id: number;
  name: string;
  hardness: number;          // Infinity = unbreakable
  tool: ToolKind | null;     // tool that speeds up mining
  harvestTier: number;       // -1 = hand is fine, otherwise min TIERS index of `tool` to get a drop
  drop: string | null;       // item dropped when harvested
  transparent?: boolean;     // neighbours still draw faces behind it (leaves)
  liquid?: boolean;          // not solid, not targetable, drawn in the translucent pass
  plant?: boolean;           // drawn as an X of two quads, no collision
  // tiles: [right(+x), left(-x), top(+y), bottom(-y), front(+z), back(-z)]
  tiles: [number, number, number, number, number, number];
}

const all = (t: number): BlockDef['tiles'] => [t, t, t, t, t, t];
const sided = (side: number, top: number, bottom: number): BlockDef['tiles'] => [side, side, top, bottom, side, side];

export const BLOCKS: BlockDef[] = [
  { id: 0, name: 'air', hardness: 0, tool: null, harvestTier: -1, drop: null, tiles: all(0) },
  { id: 1, name: 'grass', hardness: 0.6, tool: 'shovel', harvestTier: -1, drop: 'dirt', tiles: sided(TILE.grass_side, TILE.grass_top, TILE.dirt) },
  { id: 2, name: 'dirt', hardness: 0.5, tool: 'shovel', harvestTier: -1, drop: 'dirt', tiles: all(TILE.dirt) },
  { id: 3, name: 'stone', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'cobblestone', tiles: all(TILE.stone) },
  { id: 4, name: 'cobblestone', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'cobblestone', tiles: all(TILE.cobblestone) },
  { id: 5, name: 'wood', hardness: 2, tool: 'axe', harvestTier: -1, drop: 'wood', tiles: sided(TILE.log_side, TILE.log_top, TILE.log_top) },
  { id: 6, name: 'planks', hardness: 2, tool: 'axe', harvestTier: -1, drop: 'planks', tiles: all(TILE.planks) },
  { id: 7, name: 'leaves', hardness: 0.2, tool: 'hoe', harvestTier: -1, drop: null, transparent: true, tiles: all(TILE.leaves) },
  { id: 8, name: 'bedrock', hardness: Infinity, tool: null, harvestTier: -1, drop: null, tiles: all(TILE.bedrock) },
  { id: 9, name: 'crafting_table', hardness: 2.5, tool: 'axe', harvestTier: -1, drop: 'crafting_table',
    tiles: [TILE.table_side, TILE.table_side, TILE.table_top, TILE.planks, TILE.table_front, TILE.table_front] },
  { id: 10, name: 'furnace', hardness: 3.5, tool: 'pickaxe', harvestTier: 0, drop: 'furnace',
    tiles: [TILE.furnace_side, TILE.furnace_side, TILE.furnace_top, TILE.furnace_top, TILE.furnace_front, TILE.furnace_side] },
  { id: 11, name: 'coal_ore', hardness: 3, tool: 'pickaxe', harvestTier: 0, drop: 'coal', tiles: all(TILE.coal_ore) },
  { id: 12, name: 'iron_ore', hardness: 3, tool: 'pickaxe', harvestTier: 1, drop: 'iron_ore', tiles: all(TILE.iron_ore) },
  { id: 13, name: 'gold_ore', hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: 'gold_ore', tiles: all(TILE.gold_ore) },
  { id: 14, name: 'diamond_ore', hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: 'diamond', tiles: all(TILE.diamond_ore) },
  { id: 15, name: 'moonstone_ore', hardness: 4, tool: 'pickaxe', harvestTier: 4, drop: 'moonstone', tiles: all(TILE.moonstone_ore) },
  { id: 16, name: 'etherite_ore', hardness: 5, tool: 'pickaxe', harvestTier: 5, drop: 'etherite', tiles: all(TILE.etherite_ore) },
  { id: 17, name: 'sand', hardness: 0.5, tool: 'shovel', harvestTier: -1, drop: 'sand', tiles: all(TILE.sand) },
  { id: 18, name: 'sandstone', hardness: 0.8, tool: 'pickaxe', harvestTier: 0, drop: 'sandstone', tiles: sided(TILE.sandstone_side, TILE.sandstone_top, TILE.sandstone_top) },
  { id: 19, name: 'gravel', hardness: 0.6, tool: 'shovel', harvestTier: -1, drop: 'gravel', tiles: all(TILE.gravel) },
  { id: 20, name: 'snowy_grass', hardness: 0.6, tool: 'shovel', harvestTier: -1, drop: 'dirt', tiles: sided(TILE.snow_side, TILE.snow_top, TILE.dirt) },
  { id: 21, name: 'water', hardness: Infinity, tool: null, harvestTier: -1, drop: null, liquid: true, transparent: true, tiles: all(TILE.water) },
  { id: 22, name: 'cactus', hardness: 0.4, tool: null, harvestTier: -1, drop: 'cactus', tiles: sided(TILE.cactus_side, TILE.cactus_top, TILE.cactus_top) },
  { id: 23, name: 'birch_wood', hardness: 2, tool: 'axe', harvestTier: -1, drop: 'birch_wood', tiles: sided(TILE.birch_side, TILE.birch_top, TILE.birch_top) },
  { id: 24, name: 'birch_leaves', hardness: 0.2, tool: 'hoe', harvestTier: -1, drop: null, transparent: true, tiles: all(TILE.birch_leaves) },
  { id: 25, name: 'spruce_leaves', hardness: 0.2, tool: 'hoe', harvestTier: -1, drop: null, transparent: true, tiles: all(TILE.spruce_leaves) },
  { id: 26, name: 'lava', hardness: Infinity, tool: null, harvestTier: -1, drop: null, liquid: true, tiles: all(TILE.lava) },
  { id: 27, name: 'glass', hardness: 0.3, tool: null, harvestTier: -1, drop: null, transparent: true, tiles: all(TILE.glass) },
  { id: 28, name: 'clay', hardness: 0.6, tool: 'shovel', harvestTier: -1, drop: 'clay_ball', tiles: all(TILE.clay) },
  { id: 29, name: 'bricks', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'bricks', tiles: all(TILE.bricks) },
  { id: 30, name: 'mossy_cobblestone', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'mossy_cobblestone', tiles: all(TILE.mossy_cobblestone) },
  { id: 31, name: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'stone_bricks', tiles: all(TILE.stone_bricks) },
  { id: 32, name: 'pumpkin', hardness: 1, tool: 'axe', harvestTier: -1, drop: 'pumpkin',
    tiles: [TILE.pumpkin_side, TILE.pumpkin_side, TILE.pumpkin_top, TILE.pumpkin_top, TILE.pumpkin_front, TILE.pumpkin_side] },
  { id: 33, name: 'tall_grass', hardness: 0, tool: null, harvestTier: -1, drop: null, transparent: true, plant: true, tiles: all(TILE.tall_grass) },
  { id: 34, name: 'dandelion', hardness: 0, tool: null, harvestTier: -1, drop: 'dandelion', transparent: true, plant: true, tiles: all(TILE.dandelion) },
  { id: 35, name: 'poppy', hardness: 0, tool: null, harvestTier: -1, drop: 'poppy', transparent: true, plant: true, tiles: all(TILE.poppy) },
  { id: 36, name: 'cornflower', hardness: 0, tool: null, harvestTier: -1, drop: 'cornflower', transparent: true, plant: true, tiles: all(TILE.cornflower) },
  { id: 37, name: 'spruce_wood', hardness: 2, tool: 'axe', harvestTier: -1, drop: 'spruce_wood', tiles: sided(TILE.spruce_side, TILE.spruce_top, TILE.spruce_top) },
];

export const WATER = 21;
export const LAVA = 26;
export const isPlant = (id: number) => !!BLOCKS[id]?.plant;
export const isSolid = (id: number) => id !== 0 && !BLOCKS[id].liquid && !BLOCKS[id].plant;
export const isLiquid = (id: number) => id === WATER || id === LAVA;
export const isLeaves = (id: number) => id === 7 || id === 24 || id === 25;
// Hides the face of a neighbouring block
export const isOccluding = (id: number) => id !== 0 && id !== WATER && !BLOCKS[id].transparent;
// Blocks whose +z "front" texture turns to face the player when placed
export const isFacingBlock = (id: number) => id === 10 || id === 32;

export const BLOCK_ID: Record<string, number> = {};
for (const b of BLOCKS) BLOCK_ID[b.name] = b.id;
export const AIR = 0;

// ---------------------------------------------------------------- Items

export interface ItemDef {
  name: string;            // display name
  stack: number;
  block?: number;          // placeable block id
  tool?: { kind: ToolKind; tier: number };
  armor?: { slot: 0 | 1 | 2 | 3 | 4; points: number; attack?: number }; // 0 helmet, 1 chest, 2 legs, 3 boots, 4 gauntlets
  food?: number;           // HP restored when eaten
  fuel?: number;           // seconds of furnace burn
  smelt?: string;          // furnace output
  damage?: number;
}

const title = (s: string) => s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export const ITEMS: Record<string, ItemDef> = {
  grass: { name: 'Grass Block', stack: 64, block: 1 },
  dirt: { name: 'Dirt', stack: 64, block: 2 },
  stone: { name: 'Stone', stack: 64, block: 3 },
  cobblestone: { name: 'Cobblestone', stack: 64, block: 4, smelt: 'stone' },
  wood: { name: 'Oak Log', stack: 64, block: 5, fuel: 7.5, smelt: 'charcoal' },
  planks: { name: 'Oak Planks', stack: 64, block: 6, fuel: 7.5 },
  leaves: { name: 'Oak Leaves', stack: 64, block: 7 },
  bedrock: { name: 'Bedrock', stack: 64, block: 8 },
  crafting_table: { name: 'Crafting Table', stack: 64, block: 9, fuel: 7.5 },
  furnace: { name: 'Furnace', stack: 64, block: 10 },
  coal_ore: { name: 'Coal Ore', stack: 64, block: 11 },
  iron_ore: { name: 'Iron Ore', stack: 64, block: 12, smelt: 'iron_ingot' },
  gold_ore: { name: 'Gold Ore', stack: 64, block: 13, smelt: 'gold_ingot' },
  diamond_ore: { name: 'Diamond Ore', stack: 64, block: 14 },
  moonstone_ore: { name: 'Moonstone Ore', stack: 64, block: 15 },
  etherite_ore: { name: 'Etherite Ore', stack: 64, block: 16 },
  sand: { name: 'Sand', stack: 64, block: 17, smelt: 'glass' },
  sandstone: { name: 'Sandstone', stack: 64, block: 18 },
  gravel: { name: 'Gravel', stack: 64, block: 19 },
  snowy_grass: { name: 'Snowy Grass', stack: 64, block: 20 },
  cactus: { name: 'Cactus', stack: 64, block: 22 },
  birch_wood: { name: 'Birch Log', stack: 64, block: 23, fuel: 7.5, smelt: 'charcoal' },
  birch_leaves: { name: 'Birch Leaves', stack: 64, block: 24 },
  spruce_leaves: { name: 'Spruce Leaves', stack: 64, block: 25 },
  glass: { name: 'Glass', stack: 64, block: 27 },
  clay: { name: 'Clay', stack: 64, block: 28 },
  bricks: { name: 'Bricks', stack: 64, block: 29 },
  mossy_cobblestone: { name: 'Mossy Cobblestone', stack: 64, block: 30 },
  stone_bricks: { name: 'Stone Bricks', stack: 64, block: 31 },
  pumpkin: { name: 'Pumpkin', stack: 64, block: 32 },
  tall_grass: { name: 'Grass', stack: 64, block: 33 },
  dandelion: { name: 'Dandelion', stack: 64, block: 34 },
  poppy: { name: 'Poppy', stack: 64, block: 35 },
  cornflower: { name: 'Cornflower', stack: 64, block: 36 },
  spruce_wood: { name: 'Pine Log', stack: 64, block: 37, fuel: 7.5, smelt: 'charcoal' },
  clay_ball: { name: 'Clay Ball', stack: 64, smelt: 'brick' },
  brick: { name: 'Brick', stack: 64 },
  flint: { name: 'Flint', stack: 64 },
  bone: { name: 'Bone', stack: 64 },
  pumpkin_pie: { name: 'Pumpkin Pie', stack: 64, food: 8 },

  stick: { name: 'Stick', stack: 64, fuel: 2.5 },
  coal: { name: 'Coal', stack: 64, fuel: 40 },
  charcoal: { name: 'Charcoal', stack: 64, fuel: 40 },
  iron_ingot: { name: 'Iron Ingot', stack: 64 },
  gold_ingot: { name: 'Gold Ingot', stack: 64 },
  diamond: { name: 'Diamond', stack: 64 },
  moonstone: { name: 'Moonstone', stack: 64 },
  etherite: { name: 'Etherite', stack: 64 },
  apple: { name: 'Apple', stack: 64, food: 4 },
  porkchop: { name: 'Raw Porkchop', stack: 64, food: 3, smelt: 'cooked_porkchop' },
  cooked_porkchop: { name: 'Cooked Porkchop', stack: 64, food: 8 },
  beef: { name: 'Raw Beef', stack: 64, food: 3, smelt: 'cooked_beef' },
  cooked_beef: { name: 'Steak', stack: 64, food: 8 },
  rotten_flesh: { name: 'Rotten Flesh', stack: 64, food: 2 },
  chicken: { name: 'Raw Chicken', stack: 64, food: 2, smelt: 'cooked_chicken' },
  cooked_chicken: { name: 'Cooked Chicken', stack: 64, food: 6 },
  feather: { name: 'Feather', stack: 64 },
};

// Tools and armor for every tier
const ARMOR_BASE = [1, 3, 2, 1, 1];
const ARMOR_MULT = [1, 1, 2, 2.2, 3, 3.3, 3.6];
const ARMOR_PARTS = ['helmet', 'chestplate', 'leggings', 'boots', 'gauntlets'] as const;
const TOOL_KINDS: ToolKind[] = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'];

TIERS.forEach((tier, t) => {
  for (const kind of TOOL_KINDS) {
    const damage = kind === 'sword' ? SWORD_DAMAGE[t] : kind === 'axe' ? SWORD_DAMAGE[t] - 1 : 2 + Math.floor(t / 2);
    ITEMS[`${tier}_${kind}`] = { name: title(`${tier}_${kind}`), stack: 1, tool: { kind, tier: t }, damage,
      fuel: tier === 'wooden' ? 5 : undefined };
  }
  if (tier === 'stone') return; // no stone armor
  const prefix = tier === 'wooden' ? 'wood' : tier;
  ARMOR_PARTS.forEach((part, slot) => {
    ITEMS[`${prefix}_${part}`] = { name: title(`${tier}_${part}`), stack: 1,
      armor: { slot: slot as 0 | 1 | 2 | 3 | 4, points: Math.max(1, Math.round(ARMOR_BASE[slot] * ARMOR_MULT[t])),
        // Gauntlets also make every hit stronger
        attack: part === 'gauntlets' ? 1 + Math.floor(t / 2) : undefined } };
  });
});

export function itemDef(type: string): ItemDef {
  return ITEMS[type] || { name: title(type), stack: 64 };
}

export function isBlockItem(type: string): boolean {
  return itemDef(type).block !== undefined;
}

// Seconds to mine a block with the given held item (null = hand), and whether it drops anything.
export function miningInfo(blockId: number, held: string | null): { time: number; drops: boolean } {
  const b = BLOCKS[blockId];
  if (!b || b.hardness === Infinity) return { time: Infinity, drops: false };
  const tool = held ? ITEMS[held]?.tool : undefined;
  const rightTool = !!tool && b.tool === tool.kind;
  const canHarvest = b.harvestTier < 0 || (rightTool && tool!.tier >= b.harvestTier);
  let speed = rightTool ? TIER_SPEED[tool!.tier] : 1;
  if (tool?.kind === 'sword' && b.name === 'leaves') speed = 1.5;
  const time = b.hardness * (canHarvest ? 1.5 : 5) / speed;
  return { time: Math.max(0.05, time), drops: canHarvest };
}
