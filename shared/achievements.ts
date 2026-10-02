// Achievements: unlocked by the server (it sees what really happens), saved with each character,
// shown as a banner when earned and listed in the pause menu.

// secret: shown as "???" until earned (the Elemental World is a secret)
export interface Achievement { id: string; name: string; desc: string; secret?: boolean }

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
  { id: 'banner', name: 'Flag Bearer', desc: 'Put up a banner' },
  { id: 'claim', name: 'Home Turf', desc: 'Claim land with a claim stone' },
  { id: 'orb', name: 'Moonwalk', desc: 'Teleport with a moonstone orb' },
  { id: 'squad', name: 'Squad Leader', desc: 'Give your robots an order' },
  { id: 'frost', name: 'Elemental', desc: 'Find the Elemental World', secret: true },
  { id: 'glacite', name: 'Deep Freeze', desc: 'Get glacite', secret: true },
  { id: 'wraith', name: 'Thaw', desc: 'Defeat the Frost Wraith', secret: true },
  { id: 'colossus', name: 'Cooled Down', desc: 'Defeat the Magma Colossus', secret: true },
  { id: 'thorn', name: 'Weed Killer', desc: 'Defeat the Thorn Guardian', secret: true },
  { id: 'roc', name: 'Grounded', desc: 'Defeat the Tempest', secret: true },
  { id: 'venom', name: 'Venomous', desc: 'Make the poison sword', secret: true },
  { id: 'core', name: 'Master of the Elements', desc: 'Defeat the Elemental Core', secret: true },
];

export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map(a => a.id));

// Having one of these items (anywhere in your inventory) earns the achievement
export const ITEM_ACHIEVEMENTS: Record<string, string> = {
  crafting_table: 'table', iron_ingot: 'iron', diamond: 'diamond', etherite: 'etherite',
  tungsten_ingot: 'tungsten', obitite: 'obitite', laser_cannon: 'cannon', jetpack: 'jetpack', glacite: 'glacite', poison_sword: 'venom',
};
export function itemAchievement(type: string): string | undefined {
  return ITEM_ACHIEVEMENTS[type] ?? (type.endsWith('_pickaxe') ? 'pickaxe' : undefined);
}
