import type { MobKind } from './protocol.ts';

// Hitbox (halfW/height) matches each client model's outer size
export interface MobSpec { halfW: number; height: number; health: number; speed: number; hostile: boolean }

export const MOB_SPECS: Record<MobKind, MobSpec> = {
  pig: { halfW: 0.5, height: 0.9, health: 10, speed: 1.4, hostile: false },
  cow: { halfW: 0.58, height: 1.4, health: 10, speed: 1.2, hostile: false },
  chicken: { halfW: 0.25, height: 0.7, health: 4, speed: 1.3, hostile: false },
  zombie: { halfW: 0.36, height: 1.8, health: 20, speed: 2.4, hostile: true },
};

export const MOB_KINDS = Object.keys(MOB_SPECS) as MobKind[];
