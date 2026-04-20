interface Recipe {
  shape: (string | null)[][];
  result: { type: string; count: number };
}

export const recipes: Recipe[] = [
  {
    shape: [
      ['wood', 'wood'],
      ['wood', 'wood']
    ],
    result: { type: 'crafting_table', count: 1 }
  },
  {
    shape: [
      ['wood'],
      ['wood']
    ],
    result: { type: 'stick', count: 4 }
  },
  {
    shape: [
      ['wood', 'wood', 'wood'],
      [null, 'stick', null],
      [null, 'stick', null]
    ],
    result: { type: 'wooden_pickaxe', count: 1 }
  },
  { shape: [['wood'], ['wood'], ['stick']], result: { type: 'wooden_sword', count: 1 } },
  { shape: [['stone'], ['stone'], ['stick']], result: { type: 'stone_sword', count: 1 } },
  { shape: [['wood'], ['stick'], ['stick']], result: { type: 'wooden_shovel', count: 1 } },
  { shape: [['stone'], ['stick'], ['stick']], result: { type: 'stone_shovel', count: 1 } },
  { shape: [['wood', 'wood'], [null, 'stick'], [null, 'stick']], result: { type: 'wooden_hoe', count: 1 } },
  { shape: [['wood', 'wood'], ['stick', null], ['stick', null]], result: { type: 'wooden_hoe', count: 1 } },
  { shape: [['stone', 'stone'], [null, 'stick'], [null, 'stick']], result: { type: 'stone_hoe', count: 1 } },
  { shape: [['stone', 'stone'], ['stick', null], ['stick', null]], result: { type: 'stone_hoe', count: 1 } },
  { shape: [['wood', 'wood'], ['wood', 'stick'], [null, 'stick']], result: { type: 'wooden_axe', count: 1 } },
  { shape: [['wood', 'wood'], ['stick', 'wood'], ['stick', null]], result: { type: 'wooden_axe', count: 1 } },
  { shape: [['stone', 'stone'], ['stone', 'stick'], [null, 'stick']], result: { type: 'stone_axe', count: 1 } },
  { shape: [['stone', 'stone'], ['stick', 'stone'], ['stick', null]], result: { type: 'stone_axe', count: 1 } },
  { shape: [['stone', 'stone', 'stone'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'stone_pickaxe', count: 1 } },

  // Iron Tier
  { shape: [['iron_ingot'], ['iron_ingot'], ['stick']], result: { type: 'iron_sword', count: 1 } },
  { shape: [['iron_ingot'], ['stick'], ['stick']], result: { type: 'iron_shovel', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot'], [null, 'stick'], [null, 'stick']], result: { type: 'iron_hoe', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot'], ['stick', null], ['stick', null]], result: { type: 'iron_hoe', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot', 'iron_ingot'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'iron_pickaxe', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot'], ['iron_ingot', 'stick'], [null, 'stick']], result: { type: 'iron_axe', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot'], ['stick', 'iron_ingot'], ['stick', null]], result: { type: 'iron_axe', count: 1 } },

  // Armor
  { shape: [['wood', 'wood', 'wood'], ['wood', null, 'wood']], result: { type: 'wood_helmet', count: 1 } },
  { shape: [['wood', null, 'wood'], ['wood', 'wood', 'wood'], ['wood', 'wood', 'wood']], result: { type: 'wood_chestplate', count: 1 } },
  { shape: [['wood', 'wood', 'wood'], ['wood', null, 'wood'], ['wood', null, 'wood']], result: { type: 'wood_leggings', count: 1 } },
  { shape: [['wood', null, 'wood'], ['wood', null, 'wood']], result: { type: 'wood_boots', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot', 'iron_ingot'], ['iron_ingot', null, 'iron_ingot']], result: { type: 'iron_helmet', count: 1 } },
  { shape: [['iron_ingot', null, 'iron_ingot'], ['iron_ingot', 'iron_ingot', 'iron_ingot'], ['iron_ingot', 'iron_ingot', 'iron_ingot']], result: { type: 'iron_chestplate', count: 1 } },
  { shape: [['iron_ingot', 'iron_ingot', 'iron_ingot'], ['iron_ingot', null, 'iron_ingot'], ['iron_ingot', null, 'iron_ingot']], result: { type: 'iron_leggings', count: 1 } },
  { shape: [['iron_ingot', null, 'iron_ingot'], ['iron_ingot', null, 'iron_ingot']], result: { type: 'iron_boots', count: 1 } },

  // Diamond Tier
  { shape: [['diamond'], ['diamond'], ['stick']], result: { type: 'diamond_sword', count: 1 } },
  { shape: [['diamond'], ['stick'], ['stick']], result: { type: 'diamond_shovel', count: 1 } },
  { shape: [['diamond', 'diamond'], [null, 'stick'], [null, 'stick']], result: { type: 'diamond_hoe', count: 1 } },
  { shape: [['diamond', 'diamond'], ['stick', null], ['stick', null]], result: { type: 'diamond_hoe', count: 1 } },
  { shape: [['diamond', 'diamond', 'diamond'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'diamond_pickaxe', count: 1 } },
  { shape: [['diamond', 'diamond'], ['diamond', 'stick'], [null, 'stick']], result: { type: 'diamond_axe', count: 1 } },
  { shape: [['diamond', 'diamond'], ['stick', 'diamond'], ['stick', null]], result: { type: 'diamond_axe', count: 1 } },
  // Diamond Armor
  { shape: [['diamond', 'diamond', 'diamond'], ['diamond', null, 'diamond']], result: { type: 'diamond_helmet', count: 1 } },
  { shape: [['diamond', null, 'diamond'], ['diamond', 'diamond', 'diamond'], ['diamond', 'diamond', 'diamond']], result: { type: 'diamond_chestplate', count: 1 } },
  { shape: [['diamond', 'diamond', 'diamond'], ['diamond', null, 'diamond'], ['diamond', null, 'diamond']], result: { type: 'diamond_leggings', count: 1 } },
  { shape: [['diamond', null, 'diamond'], ['diamond', null, 'diamond']], result: { type: 'diamond_boots', count: 1 } },

  // Gold Tier
  { shape: [['gold_ingot'], ['gold_ingot'], ['stick']], result: { type: 'gold_sword', count: 1 } },
  { shape: [['gold_ingot'], ['stick'], ['stick']], result: { type: 'gold_shovel', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot'], [null, 'stick'], [null, 'stick']], result: { type: 'gold_hoe', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot'], ['stick', null], ['stick', null]], result: { type: 'gold_hoe', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot', 'gold_ingot'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'gold_pickaxe', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot'], ['gold_ingot', 'stick'], [null, 'stick']], result: { type: 'gold_axe', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot'], ['stick', 'gold_ingot'], ['stick', null]], result: { type: 'gold_axe', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot', 'gold_ingot'], ['gold_ingot', null, 'gold_ingot']], result: { type: 'gold_helmet', count: 1 } },
  { shape: [['gold_ingot', null, 'gold_ingot'], ['gold_ingot', 'gold_ingot', 'gold_ingot'], ['gold_ingot', 'gold_ingot', 'gold_ingot']], result: { type: 'gold_chestplate', count: 1 } },
  { shape: [['gold_ingot', 'gold_ingot', 'gold_ingot'], ['gold_ingot', null, 'gold_ingot'], ['gold_ingot', null, 'gold_ingot']], result: { type: 'gold_leggings', count: 1 } },
  { shape: [['gold_ingot', null, 'gold_ingot'], ['gold_ingot', null, 'gold_ingot']], result: { type: 'gold_boots', count: 1 } },

  // Moonstone Tier
  { shape: [['moonstone'], ['moonstone'], ['stick']], result: { type: 'moonstone_sword', count: 1 } },
  { shape: [['moonstone'], ['stick'], ['stick']], result: { type: 'moonstone_shovel', count: 1 } },
  { shape: [['moonstone', 'moonstone'], [null, 'stick'], [null, 'stick']], result: { type: 'moonstone_hoe', count: 1 } },
  { shape: [['moonstone', 'moonstone'], ['stick', null], ['stick', null]], result: { type: 'moonstone_hoe', count: 1 } },
  { shape: [['moonstone', 'moonstone', 'moonstone'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'moonstone_pickaxe', count: 1 } },
  { shape: [['moonstone', 'moonstone'], ['moonstone', 'stick'], [null, 'stick']], result: { type: 'moonstone_axe', count: 1 } },
  { shape: [['moonstone', 'moonstone'], ['stick', 'moonstone'], ['stick', null]], result: { type: 'moonstone_axe', count: 1 } },
  { shape: [['moonstone', 'moonstone', 'moonstone'], ['moonstone', null, 'moonstone']], result: { type: 'moonstone_helmet', count: 1 } },
  { shape: [['moonstone', null, 'moonstone'], ['moonstone', 'moonstone', 'moonstone'], ['moonstone', 'moonstone', 'moonstone']], result: { type: 'moonstone_chestplate', count: 1 } },
  { shape: [['moonstone', 'moonstone', 'moonstone'], ['moonstone', null, 'moonstone'], ['moonstone', null, 'moonstone']], result: { type: 'moonstone_leggings', count: 1 } },
  { shape: [['moonstone', null, 'moonstone'], ['moonstone', null, 'moonstone']], result: { type: 'moonstone_boots', count: 1 } },

  // Etherite Tier
  { shape: [['etherite'], ['etherite'], ['stick']], result: { type: 'etherite_sword', count: 1 } },
  { shape: [['etherite'], ['stick'], ['stick']], result: { type: 'etherite_shovel', count: 1 } },
  { shape: [['etherite', 'etherite'], [null, 'stick'], [null, 'stick']], result: { type: 'etherite_hoe', count: 1 } },
  { shape: [['etherite', 'etherite'], ['stick', null], ['stick', null]], result: { type: 'etherite_hoe', count: 1 } },
  { shape: [['etherite', 'etherite', 'etherite'], [null, 'stick', null], [null, 'stick', null]], result: { type: 'etherite_pickaxe', count: 1 } },
  { shape: [['etherite', 'etherite'], ['etherite', 'stick'], [null, 'stick']], result: { type: 'etherite_axe', count: 1 } },
  { shape: [['etherite', 'etherite'], ['stick', 'etherite'], ['stick', null]], result: { type: 'etherite_axe', count: 1 } },
  { shape: [['etherite', 'etherite', 'etherite'], ['etherite', null, 'etherite']], result: { type: 'etherite_helmet', count: 1 } },
  { shape: [['etherite', null, 'etherite'], ['etherite', 'etherite', 'etherite'], ['etherite', 'etherite', 'etherite']], result: { type: 'etherite_chestplate', count: 1 } },
  { shape: [['etherite', 'etherite', 'etherite'], ['etherite', null, 'etherite'], ['etherite', null, 'etherite']], result: { type: 'etherite_leggings', count: 1 } },
  { shape: [['etherite', null, 'etherite'], ['etherite', null, 'etherite']], result: { type: 'etherite_boots', count: 1 } }
];

export function checkCraftingRecipe(gridTypes: (string | null)[], gridColumns: number): { type: string, count: number } | null {
   const rows = gridTypes.length / gridColumns;
   let minX = gridColumns, maxX = -1, minY = rows, maxY = -1;
   const grid2D: (string | null)[][] = [];
   
   for(let y=0; y<rows; y++) {
       const row = [];
       for(let x=0; x<gridColumns; x++) {
           const type = gridTypes[y * gridColumns + x];
           row.push(type);
           if (type) {
               if (x < minX) minX = x;
               if (x > maxX) maxX = x;
               if (y < minY) minY = y;
               if (y > maxY) maxY = y;
           }
       }
       grid2D.push(row);
   }

   if (maxX === -1) return null; // Empty grid

   const patternWidth = maxX - minX + 1;
   const patternHeight = maxY - minY + 1;

   for (const recipe of recipes) {
       const recipeHeight = recipe.shape.length;
       const recipeWidth = recipe.shape[0].length;
       
       if (patternWidth !== recipeWidth || patternHeight !== recipeHeight) continue;
       
       let matched = true;
       for(let rY = 0; rY < recipeHeight; rY++) {
           for(let rX = 0; rX < recipeWidth; rX++) {
               if (grid2D[minY + rY][minX + rX] !== recipe.shape[rY][rX]) {
                   matched = false;
                   break;
               }
           }
           if (!matched) break;
       }
       if (matched) return { ...recipe.result };
   }
   
   return null;
}
