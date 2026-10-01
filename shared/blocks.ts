// Central registry of blocks and items. Everything else looks up properties here.

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword';

// Tier order: higher = mines faster, hits harder
// (tungsten and obitite come from the Robotic World, which etherite unlocks)
export const TIERS = ['wooden', 'stone', 'iron', 'gold', 'diamond', 'moonstone', 'etherite', 'tungsten', 'obitite'] as const;
export const TIER_SPEED = [2, 4, 6, 8, 10, 12, 15, 17, 20];
const SWORD_DAMAGE = [4, 5, 6, 7, 8, 9, 10, 11, 13];

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
  ice: 50, packed_ice: 51, blue_ice: 52, powder_snow: 53, snow_bricks: 54, frost_crystal_ore: 55,
  granite: 56, diorite: 57, andesite: 58, polished_granite: 59, polished_diorite: 60, polished_andesite: 61,
  slate: 62, cobbled_slate: 63, slate_bricks: 64, basalt_side: 65, basalt_top: 66, obsidian: 67, copper_ore: 68,
  copper_block: 69, iron_block: 70, gold_block: 71, diamond_block: 72, coal_block: 73, bookshelf: 74,
  wool: 75, red_wool: 76, yellow_wool: 77, blue_wool: 78, green_wool: 79, black_wool: 80, terracotta: 81,
  lantern: 82, torch: 83, red_mushroom: 84, brown_mushroom: 85, berry_bush: 86, snowberry_bush: 87, frost_fern: 88,
  melon_side: 89, melon_top: 90, wild_carrots: 91, wild_potatoes: 92, jack_o_lantern: 93,
  mossy_stone_bricks: 94, cracked_stone_bricks: 95, smooth_stone: 96, farmland: 97,
  wheat_0: 98, wheat_1: 99, wheat_2: 100, carrot_crop: 101, potato_crop: 102,
  chest_front: 103, chest_side: 104, chest_top: 105,
  // The Robotic World
  etherite_block: 106, rust_rock: 107, scrap_top: 108, scrap_side: 109, tungsten_ore: 110, oil: 111,
  metal_plate: 112, rusty_metal: 113, robot_eye: 114, portal_core: 115, altar_core: 116,
  // More wool colours, then one banner per colour (in COLORS order), then the claim stone
  orange_wool: 117, purple_wool: 118, pink_wool: 119, cyan_wool: 120,
  banner_0: 121, claim_side: 131, claim_top: 132,
  // The Frost World (a secret: see shared/frost.ts)
  moonstone_block: 133, frost_frame: 134, frost_portal: 135, glacite_ore: 136, permafrost: 137, frost_shrine: 138,
} as const;
export const TILE_COUNT = 139;

// Dye colours, in the order banners use them. White wool is plain "wool".
export const COLORS = ['white', 'red', 'yellow', 'blue', 'green', 'black', 'orange', 'purple', 'pink', 'cyan'] as const;
export const woolOf = (c: string) => (c === 'white' ? 'wool' : `${c}_wool`);
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
  plantOn?: 'soil' | 'any' | 'farmland'; // what a plant can stand on (default soil: grass/dirt/snowy grass)
  soft?: boolean;            // a full cube you sink into (powder snow): no collision, but targetable
  slippery?: number;         // ice: how much of its speed a body keeps each step when sliding (0..1)
  glow?: boolean;            // always drawn fully lit (torches, lanterns)
  banner?: boolean;          // a plant drawn as one flat cloth, turned to face whoever placed it
  sturdy?: boolean;          // a plant that placing a block next to it doesn't replace (torches, banners)
  dropCount?: [number, number]; // min/max count of `drop` (default 1)
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
  // Snow and ice
  { id: 38, name: 'snow_block', hardness: 0.3, tool: 'shovel', harvestTier: -1, drop: 'snowball', dropCount: [4, 4], tiles: all(TILE.snow_top) },
  { id: 39, name: 'ice', hardness: 0.5, tool: 'pickaxe', harvestTier: -1, drop: null, transparent: true, slippery: 0.98, tiles: all(TILE.ice) },
  { id: 40, name: 'packed_ice', hardness: 0.5, tool: 'pickaxe', harvestTier: -1, drop: 'packed_ice', slippery: 0.98, tiles: all(TILE.packed_ice) },
  { id: 41, name: 'blue_ice', hardness: 2.8, tool: 'pickaxe', harvestTier: -1, drop: 'blue_ice', slippery: 0.99, tiles: all(TILE.blue_ice) },
  { id: 42, name: 'powder_snow', hardness: 0.25, tool: 'shovel', harvestTier: -1, drop: 'powder_snow', soft: true, tiles: all(TILE.powder_snow) },
  { id: 43, name: 'snow_bricks', hardness: 1, tool: 'pickaxe', harvestTier: -1, drop: 'snow_bricks', tiles: all(TILE.snow_bricks) },
  { id: 44, name: 'frost_crystal_ore', hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: 'frost_crystal', dropCount: [1, 2], tiles: all(TILE.frost_crystal_ore) },
  // Stone family
  { id: 45, name: 'granite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'granite', tiles: all(TILE.granite) },
  { id: 46, name: 'diorite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'diorite', tiles: all(TILE.diorite) },
  { id: 47, name: 'andesite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'andesite', tiles: all(TILE.andesite) },
  { id: 48, name: 'polished_granite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'polished_granite', tiles: all(TILE.polished_granite) },
  { id: 49, name: 'polished_diorite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'polished_diorite', tiles: all(TILE.polished_diorite) },
  { id: 50, name: 'polished_andesite', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'polished_andesite', tiles: all(TILE.polished_andesite) },
  { id: 51, name: 'slate', hardness: 3, tool: 'pickaxe', harvestTier: 0, drop: 'cobbled_slate', tiles: all(TILE.slate) },
  { id: 52, name: 'cobbled_slate', hardness: 3.5, tool: 'pickaxe', harvestTier: 0, drop: 'cobbled_slate', tiles: all(TILE.cobbled_slate) },
  { id: 53, name: 'slate_bricks', hardness: 3.5, tool: 'pickaxe', harvestTier: 0, drop: 'slate_bricks', tiles: all(TILE.slate_bricks) },
  { id: 54, name: 'basalt', hardness: 1.25, tool: 'pickaxe', harvestTier: 0, drop: 'basalt', tiles: sided(TILE.basalt_side, TILE.basalt_top, TILE.basalt_top) },
  { id: 55, name: 'obsidian', hardness: 25, tool: 'pickaxe', harvestTier: 4, drop: 'obsidian', tiles: all(TILE.obsidian) },
  { id: 56, name: 'copper_ore', hardness: 3, tool: 'pickaxe', harvestTier: 1, drop: 'copper_ore', tiles: all(TILE.copper_ore) },
  // Storage and decoration
  { id: 57, name: 'copper_block', hardness: 3, tool: 'pickaxe', harvestTier: 1, drop: 'copper_block', tiles: all(TILE.copper_block) },
  { id: 58, name: 'iron_block', hardness: 5, tool: 'pickaxe', harvestTier: 1, drop: 'iron_block', tiles: all(TILE.iron_block) },
  { id: 59, name: 'gold_block', hardness: 3, tool: 'pickaxe', harvestTier: 2, drop: 'gold_block', tiles: all(TILE.gold_block) },
  { id: 60, name: 'diamond_block', hardness: 5, tool: 'pickaxe', harvestTier: 2, drop: 'diamond_block', tiles: all(TILE.diamond_block) },
  { id: 61, name: 'coal_block', hardness: 5, tool: 'pickaxe', harvestTier: 0, drop: 'coal_block', tiles: all(TILE.coal_block) },
  { id: 62, name: 'bookshelf', hardness: 1.5, tool: 'axe', harvestTier: -1, drop: 'bookshelf', tiles: sided(TILE.bookshelf, TILE.planks, TILE.planks) },
  { id: 63, name: 'wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'wool', tiles: all(TILE.wool) },
  { id: 64, name: 'red_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'red_wool', tiles: all(TILE.red_wool) },
  { id: 65, name: 'yellow_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'yellow_wool', tiles: all(TILE.yellow_wool) },
  { id: 66, name: 'blue_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'blue_wool', tiles: all(TILE.blue_wool) },
  { id: 67, name: 'green_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'green_wool', tiles: all(TILE.green_wool) },
  { id: 68, name: 'black_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'black_wool', tiles: all(TILE.black_wool) },
  { id: 69, name: 'terracotta', hardness: 1.25, tool: 'pickaxe', harvestTier: 0, drop: 'terracotta', tiles: all(TILE.terracotta) },
  { id: 70, name: 'lantern', hardness: 1, tool: 'pickaxe', harvestTier: -1, drop: 'lantern', glow: true, tiles: all(TILE.lantern) },
  { id: 71, name: 'torch', hardness: 0, tool: null, harvestTier: -1, drop: 'torch', plant: true, plantOn: 'any', glow: true, transparent: true, sturdy: true, tiles: all(TILE.torch) },
  // Plants and food sources
  { id: 72, name: 'red_mushroom', hardness: 0, tool: null, harvestTier: -1, drop: 'red_mushroom', plant: true, plantOn: 'any', transparent: true, tiles: all(TILE.red_mushroom) },
  { id: 73, name: 'brown_mushroom', hardness: 0, tool: null, harvestTier: -1, drop: 'brown_mushroom', plant: true, plantOn: 'any', transparent: true, tiles: all(TILE.brown_mushroom) },
  { id: 74, name: 'berry_bush', hardness: 0, tool: null, harvestTier: -1, drop: 'sweet_berries', dropCount: [1, 3], plant: true, transparent: true, tiles: all(TILE.berry_bush) },
  { id: 75, name: 'snowberry_bush', hardness: 0, tool: null, harvestTier: -1, drop: 'snowberries', dropCount: [1, 3], plant: true, transparent: true, tiles: all(TILE.snowberry_bush) },
  { id: 76, name: 'frost_fern', hardness: 0, tool: null, harvestTier: -1, drop: null, plant: true, transparent: true, tiles: all(TILE.frost_fern) },
  { id: 77, name: 'melon', hardness: 1, tool: 'axe', harvestTier: -1, drop: 'melon_slice', dropCount: [3, 6], tiles: sided(TILE.melon_side, TILE.melon_top, TILE.melon_top) },
  { id: 78, name: 'wild_carrots', hardness: 0, tool: null, harvestTier: -1, drop: 'carrot', dropCount: [2, 4], plant: true, transparent: true, tiles: all(TILE.wild_carrots) },
  { id: 79, name: 'wild_potatoes', hardness: 0, tool: null, harvestTier: -1, drop: 'potato', dropCount: [2, 4], plant: true, transparent: true, tiles: all(TILE.wild_potatoes) },
  { id: 80, name: 'jack_o_lantern', hardness: 1, tool: 'axe', harvestTier: -1, drop: 'jack_o_lantern', glow: true,
    tiles: [TILE.pumpkin_side, TILE.pumpkin_side, TILE.pumpkin_top, TILE.pumpkin_top, TILE.jack_o_lantern, TILE.pumpkin_side] },
  { id: 81, name: 'mossy_stone_bricks', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'mossy_stone_bricks', tiles: all(TILE.mossy_stone_bricks) },
  { id: 82, name: 'cracked_stone_bricks', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'cracked_stone_bricks', tiles: all(TILE.cracked_stone_bricks) },
  { id: 83, name: 'smooth_stone', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'smooth_stone', tiles: all(TILE.smooth_stone) },
  // Farming: crops grow on farmland (dirt tilled with a hoe)
  { id: 84, name: 'farmland', hardness: 0.6, tool: 'shovel', harvestTier: -1, drop: 'dirt', tiles: sided(TILE.dirt, TILE.farmland, TILE.dirt) },
  { id: 85, name: 'wheat_0', hardness: 0, tool: null, harvestTier: -1, drop: 'seeds', plant: true, plantOn: 'farmland', transparent: true, tiles: all(TILE.wheat_0) },
  { id: 86, name: 'wheat_1', hardness: 0, tool: null, harvestTier: -1, drop: 'seeds', plant: true, plantOn: 'farmland', transparent: true, tiles: all(TILE.wheat_1) },
  { id: 87, name: 'wheat_2', hardness: 0, tool: null, harvestTier: -1, drop: 'wheat', plant: true, plantOn: 'farmland', transparent: true, tiles: all(TILE.wheat_2) },
  { id: 88, name: 'carrot_crop', hardness: 0, tool: null, harvestTier: -1, drop: 'carrot', plant: true, plantOn: 'farmland', transparent: true, tiles: all(TILE.carrot_crop) },
  { id: 89, name: 'potato_crop', hardness: 0, tool: null, harvestTier: -1, drop: 'potato', plant: true, plantOn: 'farmland', transparent: true, tiles: all(TILE.potato_crop) },
  // Storage
  { id: 90, name: 'chest', hardness: 2.5, tool: 'axe', harvestTier: -1, drop: 'chest',
    tiles: [TILE.chest_side, TILE.chest_side, TILE.chest_top, TILE.chest_top, TILE.chest_front, TILE.chest_side] },
  // The Robotic World (see shared/robotic.ts). A plus of etherite blocks around a gold block is a portal there.
  { id: 91, name: 'etherite_block', hardness: 8, tool: 'pickaxe', harvestTier: 4, drop: 'etherite_block', tiles: all(TILE.etherite_block) },
  { id: 92, name: 'rust_rock', hardness: 1.5, tool: 'pickaxe', harvestTier: 0, drop: 'rust_rock', tiles: all(TILE.rust_rock) },
  { id: 93, name: 'scrap_ground', hardness: 0.7, tool: 'shovel', harvestTier: -1, drop: 'scrap_ground', tiles: sided(TILE.scrap_side, TILE.scrap_top, TILE.rust_rock) },
  { id: 94, name: 'tungsten_ore', hardness: 4, tool: 'pickaxe', harvestTier: 2, drop: 'tungsten_ore', tiles: all(TILE.tungsten_ore) },
  { id: 95, name: 'oil', hardness: Infinity, tool: null, harvestTier: -1, drop: null, liquid: true, tiles: all(TILE.oil) },
  { id: 96, name: 'metal_plate', hardness: 5, tool: 'pickaxe', harvestTier: 1, drop: 'metal_plate', tiles: all(TILE.metal_plate) },
  { id: 97, name: 'rusty_metal', hardness: 3, tool: 'pickaxe', harvestTier: 0, drop: 'rusty_metal', tiles: all(TILE.rusty_metal) },
  { id: 98, name: 'robot_eye', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'robot_eye', glow: true, tiles: all(TILE.robot_eye) },
  // The return portals the game builds on arrival: they can be mined away but drop nothing (or travelling would make free etherite and gold)
  { id: 99, name: 'portal_frame', hardness: 5, tool: 'pickaxe', harvestTier: 0, drop: null, glow: true, tiles: all(TILE.etherite_block) },
  { id: 100, name: 'portal_core', hardness: 5, tool: 'pickaxe', harvestTier: 0, drop: null, glow: true, tiles: all(TILE.portal_core) },
  // The Robot Titan's altar (it wakes here); can't be mined, so the boss always has a home
  { id: 101, name: 'altar_core', hardness: Infinity, tool: null, harvestTier: -1, drop: null, glow: true, tiles: all(TILE.altar_core) },
  { id: 102, name: 'orange_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'orange_wool', tiles: all(TILE.orange_wool) },
  { id: 103, name: 'purple_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'purple_wool', tiles: all(TILE.purple_wool) },
  { id: 104, name: 'pink_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'pink_wool', tiles: all(TILE.pink_wool) },
  { id: 105, name: 'cyan_wool', hardness: 0.8, tool: null, harvestTier: -1, drop: 'cyan_wool', tiles: all(TILE.cyan_wool) },
  // Banners 106-115 (one per colour) are added below
];
// Banners: stand on any solid block, face whoever placed them
COLORS.forEach((c, i) => BLOCKS.push({ id: 106 + i, name: `${c}_banner`, hardness: 0.5, tool: 'axe', harvestTier: -1, drop: `${c}_banner`,
  plant: true, plantOn: 'any', transparent: true, banner: true, sturdy: true, tiles: all(TILE.banner_0 + i) }));
// The claim stone protects the land around it (see server/core/game.ts claims)
BLOCKS.push({ id: 116, name: 'claim_stone', hardness: 4, tool: 'pickaxe', harvestTier: -1, drop: 'claim_stone', glow: true,
  tiles: sided(TILE.claim_side, TILE.claim_top, TILE.claim_top) });
// The Frost World. Its portal: an upright frame of moonstone blocks with a 2x3 hole, filled with robot eyes.
BLOCKS.push(
  { id: 117, name: 'moonstone_block', hardness: 5, tool: 'pickaxe', harvestTier: 2, drop: 'moonstone_block', tiles: all(TILE.moonstone_block) },
  // The return portal's frame, built on arrival: it drops nothing (travelling mustn't make free moonstone)
  { id: 118, name: 'frost_frame', hardness: 5, tool: 'pickaxe', harvestTier: 0, drop: null, glow: true, tiles: all(TILE.frost_frame) },
  // The portal itself: walk into it. It can't be mined; breaking the frame puts it out.
  { id: 119, name: 'frost_portal', hardness: Infinity, tool: null, harvestTier: -1, drop: null, soft: true, transparent: true, glow: true, tiles: all(TILE.frost_portal) },
  { id: 120, name: 'glacite_ore', hardness: 4, tool: 'pickaxe', harvestTier: 4, drop: 'glacite', tiles: all(TILE.glacite_ore) },
  { id: 121, name: 'permafrost', hardness: 2, tool: 'pickaxe', harvestTier: 0, drop: 'permafrost', tiles: all(TILE.permafrost) },
  // The Frost Wraith's shrine (it wakes here); can't be mined
  { id: 122, name: 'frost_shrine', hardness: Infinity, tool: null, harvestTier: -1, drop: null, glow: true, tiles: all(TILE.frost_shrine) },
);
export const FROST_PORTAL = 119;

export const WATER = 21;
export const LAVA = 26;
export const OIL = 95;
export const isPlant = (id: number) => !!BLOCKS[id]?.plant;
// Placing a block where this stands replaces it (grass, flowers), unless it's a torch or a banner
export const isReplaceable = (id: number) => isPlant(id) && !BLOCKS[id].sturdy;
export const isBanner = (id: number) => !!BLOCKS[id]?.banner;
export const CLAIM_STONE = 116;
export const isSolid = (id: number) => id !== 0 && !BLOCKS[id].liquid && !BLOCKS[id].plant && !BLOCKS[id].soft;
export const POWDER_SNOW = 42;
export const CHEST = 90;
export const isLiquid = (id: number) => id === WATER || id === LAVA || id === OIL;
export const isLeaves = (id: number) => id === 7 || id === 24 || id === 25;
// Hides the face of a neighbouring block
// (not surface liquids: their tops sit lower, so the land beside them must still draw its side)
export const isOccluding = (id: number) => id !== 0 && id !== WATER && id !== OIL && !BLOCKS[id].transparent;
// Blocks whose +z "front" texture turns to face the player when placed
export const isFacingBlock = (id: number) => id === 10 || id === 32 || id === 80 || id === 90 || (id >= 106 && id <= 115);
// Where a plant may stand: crops need farmland, torches/mushrooms any solid block, others soil
export function plantCanStand(plant: number, below: number): boolean {
  const on = BLOCKS[plant].plantOn || 'soil';
  if (on === 'farmland') return below === 84;
  if (on === 'any') return isSolid(below);
  return below === 1 || below === 2 || below === 20;
}

// Crops: what each stage grows into (the ripe carrot/potato stage is the same block as the wild plant)
export const CROP_NEXT: Record<number, number> = { 85: 86, 86: 87, 88: 78, 89: 79 };
export const CROP_GROW_SECONDS = 90; // average per stage, randomised on the server

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
  plants?: string;         // using it on farmland plants this block (seeds, carrots, potatoes)
  chill?: boolean;         // glacite weapons: a hit slows the target down for a while
  returns?: string;        // item left in hand after eating (stew -> bowl)
}

const title = (s: string) => s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

export const ITEMS: Record<string, ItemDef> = {
  grass: { name: 'Grass Block', stack: 64, block: 1 },
  dirt: { name: 'Dirt', stack: 64, block: 2 },
  stone: { name: 'Stone', stack: 64, block: 3, smelt: 'smooth_stone' },
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
  cactus: { name: 'Cactus', stack: 64, block: 22, smelt: 'green_dye' },
  birch_wood: { name: 'Birch Log', stack: 64, block: 23, fuel: 7.5, smelt: 'charcoal' },
  birch_leaves: { name: 'Birch Leaves', stack: 64, block: 24 },
  spruce_leaves: { name: 'Spruce Leaves', stack: 64, block: 25 },
  glass: { name: 'Glass', stack: 64, block: 27 },
  clay: { name: 'Clay', stack: 64, block: 28, smelt: 'terracotta' },
  bricks: { name: 'Bricks', stack: 64, block: 29 },
  mossy_cobblestone: { name: 'Mossy Cobblestone', stack: 64, block: 30 },
  stone_bricks: { name: 'Stone Bricks', stack: 64, block: 31, smelt: 'cracked_stone_bricks' },
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

  // Snow and ice
  snow_block: { name: 'Snow Block', stack: 64, block: 38 },
  ice: { name: 'Ice', stack: 64, block: 39 },
  packed_ice: { name: 'Packed Ice', stack: 64, block: 40 },
  blue_ice: { name: 'Blue Ice', stack: 64, block: 41 },
  powder_snow: { name: 'Powder Snow', stack: 64, block: 42 },
  snow_bricks: { name: 'Snow Bricks', stack: 64, block: 43 },
  frost_crystal_ore: { name: 'Frost Crystal Ore', stack: 64, block: 44 },
  snowball: { name: 'Snowball', stack: 16 },
  frost_crystal: { name: 'Frost Crystal', stack: 64 },
  // Stone family
  granite: { name: 'Granite', stack: 64, block: 45 },
  diorite: { name: 'Diorite', stack: 64, block: 46 },
  andesite: { name: 'Andesite', stack: 64, block: 47 },
  polished_granite: { name: 'Polished Granite', stack: 64, block: 48 },
  polished_diorite: { name: 'Polished Diorite', stack: 64, block: 49 },
  polished_andesite: { name: 'Polished Andesite', stack: 64, block: 50 },
  slate: { name: 'Slate', stack: 64, block: 51 },
  cobbled_slate: { name: 'Cobbled Slate', stack: 64, block: 52, smelt: 'slate' },
  slate_bricks: { name: 'Slate Bricks', stack: 64, block: 53 },
  basalt: { name: 'Basalt', stack: 64, block: 54 },
  obsidian: { name: 'Obsidian', stack: 64, block: 55 },
  copper_ore: { name: 'Copper Ore', stack: 64, block: 56, smelt: 'copper_ingot' },
  copper_ingot: { name: 'Copper Ingot', stack: 64 },
  mossy_stone_bricks: { name: 'Mossy Stone Bricks', stack: 64, block: 81 },
  cracked_stone_bricks: { name: 'Cracked Stone Bricks', stack: 64, block: 82 },
  smooth_stone: { name: 'Smooth Stone', stack: 64, block: 83 },
  // Storage and decoration
  copper_block: { name: 'Block of Copper', stack: 64, block: 57 },
  iron_block: { name: 'Block of Iron', stack: 64, block: 58 },
  gold_block: { name: 'Block of Gold', stack: 64, block: 59 },
  diamond_block: { name: 'Block of Diamond', stack: 64, block: 60 },
  coal_block: { name: 'Block of Coal', stack: 64, block: 61, fuel: 400 },
  bookshelf: { name: 'Bookshelf', stack: 64, block: 62, fuel: 15 },
  wool: { name: 'White Wool', stack: 64, block: 63, fuel: 5 },
  red_wool: { name: 'Red Wool', stack: 64, block: 64, fuel: 5 },
  yellow_wool: { name: 'Yellow Wool', stack: 64, block: 65, fuel: 5 },
  blue_wool: { name: 'Blue Wool', stack: 64, block: 66, fuel: 5 },
  green_wool: { name: 'Green Wool', stack: 64, block: 67, fuel: 5 },
  black_wool: { name: 'Black Wool', stack: 64, block: 68, fuel: 5 },
  terracotta: { name: 'Terracotta', stack: 64, block: 69 },
  lantern: { name: 'Lantern', stack: 64, block: 70 },
  torch: { name: 'Torch', stack: 64, block: 71 },
  jack_o_lantern: { name: 'Jack o’Lantern', stack: 64, block: 80 },
  chest: { name: 'Chest', stack: 64, block: 90, fuel: 15 },
  // The Robotic World
  etherite_block: { name: 'Block of Etherite', stack: 64, block: 91 },
  rust_rock: { name: 'Rust Rock', stack: 64, block: 92 },
  scrap_ground: { name: 'Scrap Ground', stack: 64, block: 93 },
  tungsten_ore: { name: 'Tungsten Ore', stack: 64, block: 94, smelt: 'tungsten_ingot' },
  tungsten_ingot: { name: 'Tungsten Ingot', stack: 64 },
  metal_plate: { name: 'Metal Plate', stack: 64, block: 96 },
  rusty_metal: { name: 'Rusty Metal', stack: 64, block: 97 },
  robot_eye: { name: 'Robot Eye', stack: 64, block: 98 },
  obitite: { name: 'Obitite', stack: 64 },                 // dropped by the Robot Titan
  laser_cannon_core: { name: 'Laser Cannon Core', stack: 1 }, // the Titan's heart (a jetpack needs one)
  laser_cannon: { name: 'Laser Cannon', stack: 1 },       // right-click: a laser (3 hearts); works from the offhand too
  jetpack: { name: 'Jetpack', stack: 1, armor: { slot: 1, points: 3 } }, // worn in the chest slot; hold jump in the air to fly (oil fuel)
  compass: { name: 'Compass', stack: 1 },                 // held (or in the offhand): deflects robot lasers, points to the nearest altar
  string: { name: 'String', stack: 64 },
  red_dye: { name: 'Red Dye', stack: 64 },
  yellow_dye: { name: 'Yellow Dye', stack: 64 },
  blue_dye: { name: 'Blue Dye', stack: 64 },
  green_dye: { name: 'Green Dye', stack: 64 },
  black_dye: { name: 'Black Dye', stack: 64 },
  white_dye: { name: 'White Dye', stack: 64 },
  orange_dye: { name: 'Orange Dye', stack: 64 },
  purple_dye: { name: 'Purple Dye', stack: 64 },
  pink_dye: { name: 'Pink Dye', stack: 64 },
  cyan_dye: { name: 'Cyan Dye', stack: 64 },
  orange_wool: { name: 'Orange Wool', stack: 64, block: 102, fuel: 5 },
  purple_wool: { name: 'Purple Wool', stack: 64, block: 103, fuel: 5 },
  pink_wool: { name: 'Pink Wool', stack: 64, block: 104, fuel: 5 },
  cyan_wool: { name: 'Cyan Wool', stack: 64, block: 105, fuel: 5 },
  claim_stone: { name: 'Claim Stone', stack: 16, block: 116 },  // protects the land around it for you and friends you trust
  moonstone_orb: { name: 'Moonstone Orb', stack: 16 },          // use it to teleport to a friend, a home, or where you last died
  moonstone_block: { name: 'Block of Moonstone', stack: 64, block: 117 },
  glacite_ore: { name: 'Glacite Ore', stack: 64, block: 120 },
  permafrost: { name: 'Permafrost', stack: 64, block: 121 },
  glacite: { name: 'Glacite', stack: 64 },                       // the Frost World's gem: tools that chill what they hit
  frost_heart: { name: 'Frost Heart', stack: 1 },                // the Frost Wraith's heart: held (or in the offhand), cold can't touch you
  // Plants
  red_mushroom: { name: 'Red Mushroom', stack: 64, block: 72 },
  brown_mushroom: { name: 'Brown Mushroom', stack: 64, block: 73 },
  frost_fern: { name: 'Frost Fern', stack: 64, block: 76 },
  melon: { name: 'Melon', stack: 64, block: 77 },
  // Food (food = hunger points; on Easy, where there's no hunger, health instead)
  sweet_berries: { name: 'Sweet Berries', stack: 64, food: 2 },
  snowberries: { name: 'Snowberries', stack: 64, food: 3 },
  melon_slice: { name: 'Melon Slice', stack: 64, food: 2 },
  carrot: { name: 'Carrot', stack: 64, food: 3, plants: 'carrot_crop' },
  potato: { name: 'Potato', stack: 64, food: 1, plants: 'potato_crop', smelt: 'baked_potato' },
  baked_potato: { name: 'Baked Potato', stack: 64, food: 5 },
  seeds: { name: 'Seeds', stack: 64, plants: 'wheat_0' },
  wheat: { name: 'Wheat', stack: 64 },
  bread: { name: 'Bread', stack: 64, food: 5 },
  bowl: { name: 'Bowl', stack: 64, fuel: 2.5 },
  mushroom_stew: { name: 'Mushroom Stew', stack: 1, food: 6, returns: 'bowl' },
  golden_apple: { name: 'Golden Apple', stack: 64, food: 4 },
  golden_carrot: { name: 'Golden Carrot', stack: 64, food: 6 },
  cookie: { name: 'Cookie', stack: 64, food: 2 },
  spider_eye: { name: 'Spider Eye', stack: 64, food: 2 },
  slime_ball: { name: 'Slime Ball', stack: 64 },
  arrow: { name: 'Arrow', stack: 64 },
};

COLORS.forEach((c, i) => { ITEMS[`${c}_banner`] = { name: `${title(c)} Banner`, stack: 16, block: 106 + i, fuel: 5 }; });

// Tools and armor for every tier
const ARMOR_BASE = [1, 3, 2, 1, 1];
const ARMOR_MULT = [1, 1, 2, 2.2, 3, 3.3, 3.6, 3.9, 4.4];
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

// Glacite tools (the Frost World): as strong as etherite, and every hit chills (slows) the target
for (const kind of TOOL_KINDS) {
  const t = 6;
  ITEMS[`glacite_${kind}`] = { name: title(`glacite_${kind}`), stack: 1, tool: { kind, tier: t }, chill: true,
    damage: kind === 'sword' ? SWORD_DAMAGE[t] : kind === 'axe' ? SWORD_DAMAGE[t] - 1 : 2 + Math.floor(t / 2) };
}

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
