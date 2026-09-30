import type { MobKind } from './protocol.ts';

// Hitbox (halfW/height) matches each client model's outer size
// damage: melee hit strength (0 = doesn't bite). burns: catches fire in daylight under the open sky.
export interface MobSpec { halfW: number; height: number; health: number; speed: number; hostile: boolean; damage?: number; burns?: boolean }

export const MOB_SPECS: Record<MobKind, MobSpec> = {
  pig: { halfW: 0.5, height: 0.9, health: 10, speed: 1.4, hostile: false },
  cow: { halfW: 0.58, height: 1.4, health: 10, speed: 1.2, hostile: false },
  chicken: { halfW: 0.25, height: 0.7, health: 4, speed: 1.3, hostile: false },
  zombie: { halfW: 0.36, height: 1.8, health: 20, speed: 2.4, hostile: true, damage: 3, burns: true },
  // Desert zombie: doesn't burn, and its hits make you hungry
  husk: { halfW: 0.36, height: 1.8, health: 20, speed: 2.5, hostile: true, damage: 3 },
  // Snowland zombie: its hits chill you (freezing damage follows)
  frostbitten: { halfW: 0.36, height: 1.8, health: 20, speed: 2.3, hostile: true, damage: 3, burns: true },
  // Fast, low, climbs walls
  spider: { halfW: 0.65, height: 0.9, health: 16, speed: 3.4, hostile: true, damage: 2 },
  // Keeps its distance and shoots arrows
  skeleton: { halfW: 0.3, height: 1.9, health: 20, speed: 2.4, hostile: true, damage: 0, burns: true },
  // Cave slimes hop about and split in two
  slime: { halfW: 0.5, height: 1.0, health: 16, speed: 2.0, hostile: true, damage: 2 },
  slimelet: { halfW: 0.25, height: 0.5, health: 4, speed: 2.4, hostile: true, damage: 1 },
  // The Robotic World: keeps its distance and fires a laser (3 hearts). Tungsten tames it.
  robot: { halfW: 0.45, height: 2.0, health: 30, speed: 2.0, hostile: true, damage: 0 },
};

export const MOB_KINDS = Object.keys(MOB_SPECS) as MobKind[];
