// Achievements: unlocked by the server (it sees what really happens), saved with each character,
// shown as a banner when earned and listed in the pause menu.

export interface Achievement { id: string; name: string; desc: string }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'wood', name: 'Getting Wood', desc: 'Punch a tree until a log pops out' },
  { id: 'table', name: 'Benchmark', desc: 'Make a crafting table' },
  { id: 'pickaxe', name: 'Time to Mine!', desc: 'Make a pickaxe' },
  { id: 'monster', name: 'Monster Hunter', desc: 'Defeat a hostile mob' },
  { id: 'crit', name: 'Critical Hit!', desc: 'Land a hit while falling from a jump' },
  { id: 'iron', name: 'Acquire Hardware', desc: 'Get an iron ingot' },
  { id: 'diamond', name: 'Diamonds!', desc: 'Get a diamond' },
  { id: 'etherite', name: 'Rarest of All', desc: 'Get etherite' },
  { id: 'robotic', name: 'Beep Boop', desc: 'Travel to the Robotic World' },
  { id: 'tungsten', name: 'Heavy Metal', desc: 'Get a tungsten ingot' },
  { id: 'tame', name: 'Robot Friend', desc: 'Tame a robot with tungsten' },
  { id: 'titan', name: 'Titan Slayer', desc: 'Defeat the Robot Titan' },
  { id: 'obitite', name: 'Obitite!', desc: 'Get obitite' },
  { id: 'cannon', name: 'Pew Pew', desc: 'Get a laser cannon' },
  { id: 'jetpack', name: 'Rocket Science', desc: 'Get a jetpack' },
  { id: 'fly', name: 'Lift Off', desc: 'Fly with a jetpack' },
];

export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map(a => a.id));

// Having one of these items (anywhere in your inventory) earns the achievement
export const ITEM_ACHIEVEMENTS: Record<string, string> = {
  crafting_table: 'table', iron_ingot: 'iron', diamond: 'diamond', etherite: 'etherite',
  tungsten_ingot: 'tungsten', obitite: 'obitite', laser_cannon: 'cannon', jetpack: 'jetpack',
};
export function itemAchievement(type: string): string | undefined {
  return ITEM_ACHIEVEMENTS[type] ?? (type.endsWith('_pickaxe') ? 'pickaxe' : undefined);
}
