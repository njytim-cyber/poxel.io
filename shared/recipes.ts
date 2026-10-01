import { COLORS, woolOf } from './blocks.ts';

type Cell = string | null;
export interface Recipe {
  shape: Cell[][];
  result: { type: string; count: number };
}

export const recipes: Recipe[] = [];
const add = (shape: Cell[][], type: string, count = 1) => recipes.push({ shape, result: { type, count } });
const _ = null;

// Basics
add([['wood']], 'planks', 4);
add([['birch_wood']], 'planks', 4);
add([['spruce_wood']], 'planks', 4);
add([['planks'], ['planks']], 'stick', 4);
add([['planks', 'planks'], ['planks', 'planks']], 'crafting_table');
const ring = (m: string): Cell[][] => [[m, m, m], [m, _, m], [m, m, m]];
add(ring('cobblestone'), 'furnace');
add([['stone', 'stone'], ['stone', 'stone']], 'stone_bricks', 4);
add([['brick', 'brick'], ['brick', 'brick']], 'bricks');
add([['clay_ball', 'clay_ball'], ['clay_ball', 'clay_ball']], 'clay');
add([['sand', 'sand'], ['sand', 'sand']], 'sandstone');
add([['cobblestone', 'leaves']], 'mossy_cobblestone');
add([['pumpkin']], 'pumpkin_pie');

// Snow and ice
const square = (m: string): Cell[][] => [[m, m], [m, m]];
add(square('snowball'), 'snow_block');
add(square('snow_block'), 'snow_bricks', 4);
add(square('ice'), 'packed_ice');
add(square('packed_ice'), 'blue_ice');
add([['frost_crystal']], 'blue_ice', 2);

// Stone family
add(square('granite'), 'polished_granite', 4);
add(square('diorite'), 'polished_diorite', 4);
add(square('andesite'), 'polished_andesite', 4);
add([['cobblestone', 'flint']], 'granite', 2);
add([['cobblestone', 'bone']], 'diorite', 2);
add([['cobblestone', 'gravel']], 'andesite', 2);
add(square('slate'), 'slate_bricks', 4);
add([['stone_bricks', 'leaves']], 'mossy_stone_bricks');

// Storage blocks (and back)
for (const [item, block] of [['copper_ingot', 'copper_block'], ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['coal', 'coal_block']]) {
  add([[item, item, item], [item, item, item], [item, item, item]], block);
  add([[block]], item, 9);
}
// Etherite blocks (4 etherite each): four around a gold block make a portal to the Robotic World
add(square('etherite'), 'etherite_block');
add([['etherite_block']], 'etherite', 4);
// Etherite ore is very rare, so it can also be made: a gold ingot and a moonstone side by side (either way round)
add([['gold_ingot', 'moonstone']], 'etherite');
add([['moonstone', 'gold_ingot']], 'etherite');
// The Robotic World: a laser cannon (tungsten and etherite), and a compass that deflects robot lasers
add([['tungsten_ingot', 'tungsten_ingot', 'tungsten_ingot'], ['etherite', 'etherite', 'tungsten_ingot']], 'laser_cannon');
add([[_, 'iron_ingot', _], ['iron_ingot', 'copper_ingot', 'iron_ingot'], [_, 'iron_ingot', _]], 'compass');
// Jetpack: obitite around the Robot Titan's laser cannon core
add([['obitite', _, 'obitite'], ['obitite', 'laser_cannon_core', 'obitite'], ['obitite', _, 'obitite']], 'jetpack');

// Light
add([['coal'], ['stick']], 'torch', 4);
add([['charcoal'], ['stick']], 'torch', 4);
add([[_, 'iron_ingot', _], ['iron_ingot', 'torch', 'iron_ingot'], [_, 'iron_ingot', _]], 'lantern', 2);
add([[_, 'copper_ingot', _], ['copper_ingot', 'torch', 'copper_ingot'], [_, 'copper_ingot', _]], 'lantern', 2);
add([['pumpkin'], ['torch']], 'jack_o_lantern');

// Wool and dyes
add(square('string'), 'wool');
add([['poppy']], 'red_dye', 2);
add([['dandelion']], 'yellow_dye', 2);
add([['cornflower']], 'blue_dye', 2);
add([['coal', 'coal']], 'black_dye', 2);
add([['bone']], 'white_dye', 3);
// Mixing two dyes (either way round) makes two of a new colour
for (const [a, b, c] of [['red', 'yellow', 'orange'], ['red', 'blue', 'purple'], ['red', 'white', 'pink'], ['blue', 'green', 'cyan']]) {
  add([[`${a}_dye`, `${b}_dye`]], `${c}_dye`, 2);
  add([[`${b}_dye`, `${a}_dye`]], `${c}_dye`, 2);
}
// Any wool and a dye of another colour: wool of that colour
for (const from of COLORS) for (const to of COLORS) if (from !== to) add([[woolOf(from), `${to}_dye`]], woolOf(to));
// Banners: six wool of one colour over a stick
for (const c of COLORS) { const w = woolOf(c); add([[w, w, w], [w, w, w], [_, 'stick', _]], `${c}_banner`); }
// Claim stone: stone bricks around an iron ingot
add([['stone_bricks', 'stone_bricks', 'stone_bricks'], ['stone_bricks', 'iron_ingot', 'stone_bricks'], ['stone_bricks', 'stone_bricks', 'stone_bricks']], 'claim_stone');
// Obitite blocks (for the Elemental World's portal)
add(square('obitite'), 'obitite_block');
add([['obitite_block']], 'obitite', 4);
// The Elemental World
add([['jungle_wood']], 'planks', 4);
add(square('skystone'), 'skystone_bricks', 4);
// Elemental armour: etherite in the usual shape, with the element's ore in the middle
const E = 'etherite';
add([[E, E, E], [E, 'water_ore', E]], 'water_helmet');
add([[E, 'lava_ore', E], [E, E, E], [E, E, E]], 'lava_chestplate');
add([[E, E, E], [E, 'earth_ore', E], [E, _, E]], 'earth_leggings');
add([[E, _, E], [E, 'wind_ore', E]], 'wind_boots');
// The poison sword: obitite and every element
add([['water_ore', 'obitite', 'lava_ore'], ['earth_ore', 'obitite', 'wind_ore'], [_, 'stick', _]], 'poison_sword');
// Moonstone blocks (4 moonstone each, and back)
add(square('moonstone'), 'moonstone_block');
add([['moonstone_block']], 'moonstone', 4);
// Moonstone orbs (teleport): moonstone around glass
add([[_, 'moonstone', _], ['moonstone', 'glass', 'moonstone'], [_, 'moonstone', _]], 'moonstone_orb', 2);

// Furniture
add(ring('planks'), 'chest');
add([['planks', 'planks', 'planks'], ['stick', 'stick', 'stick'], ['planks', 'planks', 'planks']], 'bookshelf');

// Food
add([['planks', _, 'planks'], [_, 'planks', _]], 'bowl', 4);
add([['red_mushroom'], ['brown_mushroom'], ['bowl']], 'mushroom_stew');
add([['brown_mushroom'], ['red_mushroom'], ['bowl']], 'mushroom_stew');
add([['wheat', 'wheat', 'wheat']], 'bread');
add([['wheat', 'sweet_berries', 'wheat']], 'cookie', 8);
add([['gold_ingot', 'gold_ingot', 'gold_ingot'], ['gold_ingot', 'apple', 'gold_ingot'], ['gold_ingot', 'gold_ingot', 'gold_ingot']], 'golden_apple');
add([['gold_ingot', 'gold_ingot', 'gold_ingot'], ['gold_ingot', 'carrot', 'gold_ingot'], ['gold_ingot', 'gold_ingot', 'gold_ingot']], 'golden_carrot');
add([['melon_slice', 'melon_slice', 'melon_slice'], ['melon_slice', 'melon_slice', 'melon_slice'], ['melon_slice', 'melon_slice', 'melon_slice']], 'melon');
add([['wheat']], 'seeds', 2);

// Arrows
add([['flint'], ['stick'], ['feather']], 'arrow', 4);

// Tools & armor for every material
const MATERIALS: { item: string; tier: string; armor?: string }[] = [
  { item: 'planks', tier: 'wooden', armor: 'wood' },
  { item: 'cobblestone', tier: 'stone' },
  { item: 'stone', tier: 'stone' },
  { item: 'iron_ingot', tier: 'iron', armor: 'iron' },
  { item: 'gold_ingot', tier: 'gold', armor: 'gold' },
  { item: 'diamond', tier: 'diamond', armor: 'diamond' },
  { item: 'moonstone', tier: 'moonstone', armor: 'moonstone' },
  { item: 'etherite', tier: 'etherite', armor: 'etherite' },
  { item: 'tungsten_ingot', tier: 'tungsten', armor: 'tungsten' },
  { item: 'obitite', tier: 'obitite', armor: 'obitite' },
  { item: 'glacite', tier: 'glacite' },
];
const S = 'stick';
const mirror = (shape: Cell[][]) => shape.map(row => [...row].reverse());

for (const { item: m, tier, armor } of MATERIALS) {
  add([[m, m, m], [_, S, _], [_, S, _]], `${tier}_pickaxe`);
  add([[m], [m], [S]], `${tier}_sword`);
  add([[m], [S], [S]], `${tier}_shovel`);
  const axe: Cell[][] = [[m, m], [m, S], [_, S]];
  add(axe, `${tier}_axe`); add(mirror(axe), `${tier}_axe`);
  const hoe: Cell[][] = [[m, m], [_, S], [_, S]];
  add(hoe, `${tier}_hoe`); add(mirror(hoe), `${tier}_hoe`);
  if (armor) {
    add([[m, m, m], [m, _, m]], `${armor}_helmet`);
    add([[m, _, m], [m, m, m], [m, m, m]], `${armor}_chestplate`);
    add([[m, m, m], [m, _, m], [m, _, m]], `${armor}_leggings`);
    add([[m, _, m], [m, _, m]], `${armor}_boots`);
    add([[m, _, m]], `${armor}_gauntlets`);
  }
}

// Grid is row-major; the pattern is trimmed to its bounding box so it can sit anywhere in the grid.
export function checkCraftingRecipe(gridTypes: Cell[], gridColumns: number): { type: string; count: number } | null {
  const rows = gridTypes.length / gridColumns;
  let minX = gridColumns, maxX = -1, minY = rows, maxY = -1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < gridColumns; x++) {
    if (gridTypes[y * gridColumns + x]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX === -1) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  for (const r of recipes) {
    if (r.shape.length !== h || r.shape[0].length !== w) continue;
    let ok = true;
    for (let y = 0; y < h && ok; y++) for (let x = 0; x < w; x++) {
      if (gridTypes[(minY + y) * gridColumns + minX + x] !== r.shape[y][x]) { ok = false; break; }
    }
    if (ok) return { ...r.result };
  }
  return null;
}
