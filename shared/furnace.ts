import { itemDef } from './blocks.ts';

export type Stack = { type: string; count: number } | null;

export interface FurnaceState {
  input: Stack;
  fuel: Stack;
  output: Stack;
  burnLeft: number;   // seconds of fuel left
  burnTotal: number;  // seconds the current fuel item lasts (for the flame gauge)
  progress: number;   // seconds cooked of the current item
}

export const SMELT_TIME = 5;

export function newFurnace(): FurnaceState {
  return { input: null, fuel: null, output: null, burnLeft: 0, burnTotal: 0, progress: 0 };
}

function canSmelt(f: FurnaceState): string | null {
  if (!f.input) return null;
  const out = itemDef(f.input.type).smelt;
  if (!out) return null;
  if (f.output && (f.output.type !== out || f.output.count >= itemDef(out).stack)) return null;
  return out;
}

// Advances one furnace; returns true if anything visible changed
export function tickFurnace(f: FurnaceState, dt: number): boolean {
  const out = canSmelt(f);
  let changed = false;
  if (f.burnLeft <= 0 && out && f.fuel && itemDef(f.fuel.type).fuel) {
    f.burnTotal = f.burnLeft = itemDef(f.fuel.type).fuel!;
    f.fuel.count--;
    if (f.fuel.count <= 0) f.fuel = null;
    changed = true;
  }
  if (f.burnLeft > 0) {
    f.burnLeft = Math.max(0, f.burnLeft - dt);
    changed = true;
    if (out) {
      f.progress += dt;
      if (f.progress >= SMELT_TIME) {
        f.progress = 0;
        f.input!.count--;
        if (f.input!.count <= 0) f.input = null;
        if (f.output) f.output.count++;
        else f.output = { type: out, count: 1 };
      }
    } else f.progress = 0;
  } else if (f.progress > 0) {
    f.progress = Math.max(0, f.progress - dt * 2);
    changed = true;
  }
  return changed;
}

export function isFurnaceEmpty(f: FurnaceState) {
  return !f.input && !f.fuel && !f.output && f.burnLeft <= 0;
}
