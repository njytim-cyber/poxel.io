type Cell = string | null;
interface Recipe {
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
