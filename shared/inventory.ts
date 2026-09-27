// Inventory rules shared by client (instant prediction) and server (authority).
// Every change goes through applyAction(), which is deterministic: the same action on the
// same state gives the same result on both sides.
import { itemDef } from './blocks.ts';
import { checkCraftingRecipe, recipes, type Recipe } from './recipes.ts';
import type { FurnaceState, Stack } from './furnace.ts';

export type { Stack };
export const INV_SIZE = 60;
// 0-8 hotbar, 9-44 main, 45-53 crafting grid, 54 craft result, 55-59 armor (helmet, chest, legs, boots, gauntlets)
export const HOTBAR = 9, MAIN_END = 45, RESULT = 54, ARMOR_START = 55;
export const GRID_2 = [45, 46, 48, 49];
export const GRID_3 = [45, 46, 47, 48, 49, 50, 51, 52, 53];
// Furnace slots are addressed as 100 (input), 101 (fuel), 102 (output)
export const FURNACE_INPUT = 100, FURNACE_FUEL = 101, FURNACE_OUTPUT = 102;

export type ScreenMode = 'inventory' | 'table' | 'furnace';

export interface Inv {
  slots: Stack[];
  cursor: Stack;
  selected: number;
}

export interface Screen {
  mode: ScreenMode;
  furnace: FurnaceState | null;
}

export type InvAction =
  | { a: 'click'; slot: number; button: 0 | 2; shift: boolean }
  | { a: 'book'; result: string; shift: boolean }
  | { a: 'outside'; button: 0 | 2 } // click outside the window: drop cursor stack (or one)
  | { a: 'close' };

export type DropFn = (type: string, count: number) => void;

export function newInv(): Inv {
  return { slots: new Array(INV_SIZE).fill(null), cursor: null, selected: 0 };
}

export const maxStack = (type: string) => itemDef(type).stack;
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, k) => a + k);
const gridOf = (s: Screen) => (s.mode === 'table' ? GRID_3 : GRID_2);

export function cloneInv(inv: Inv): Inv {
  return { slots: inv.slots.map(s => (s ? { ...s } : null)), cursor: inv.cursor ? { ...inv.cursor } : null, selected: inv.selected };
}

// Validates untrusted data (saves, network) into a clean inventory
export function sanitizeInv(data: any): Inv {
  const inv = newInv();
  const clean = (d: any): Stack => d && typeof d.type === 'string' && d.type.length < 40 && Number.isInteger(d.count) && d.count > 0
    ? { type: d.type, count: Math.min(d.count, maxStack(d.type)) } : null;
  const slots = Array.isArray(data?.slots) ? data.slots : Array.isArray(data) ? data : [];
  for (let i = 0; i < INV_SIZE; i++) inv.slots[i] = i === RESULT ? null : clean(slots[i]);
  inv.selected = Number.isInteger(data?.selected) && data.selected >= 0 && data.selected < 9 ? data.selected : 0;
  return inv;
}

// ------------------------------------------------------------------ Basic ops

// Adds to hotbar+main; returns how many didn't fit
export function addItem(inv: Inv, type: string, count: number): number {
  const max = maxStack(type);
  for (let i = 0; i < MAIN_END && count > 0; i++) {
    const it = inv.slots[i];
    if (it && it.type === type && it.count < max) { const n = Math.min(max - it.count, count); it.count += n; count -= n; }
  }
  for (let i = 0; i < MAIN_END && count > 0; i++) {
    if (!inv.slots[i]) { const n = Math.min(max, count); inv.slots[i] = { type, count: n }; count -= n; }
  }
  return count;
}

export function fits(inv: Inv, type: string, count: number): boolean {
  const max = maxStack(type);
  let room = 0;
  for (let i = 0; i < MAIN_END; i++) {
    const it = inv.slots[i];
    if (!it) room += max; else if (it.type === type) room += max - it.count;
    if (room >= count) return true;
  }
  return false;
}

export function removeFromSlot(inv: Inv, index: number, count = 1): boolean {
  const it = inv.slots[index];
  if (!it || it.count < count) return false;
  it.count -= count;
  if (it.count <= 0) inv.slots[index] = null;
  return true;
}

export function held(inv: Inv): Stack { return inv.slots[inv.selected]; }

export function armorPoints(inv: Inv): number {
  let pts = 0;
  for (let i = ARMOR_START; i < INV_SIZE; i++) { const it = inv.slots[i]; if (it) pts += itemDef(it.type).armor?.points || 0; }
  return pts;
}

export function attackBonus(inv: Inv): number {
  const g = inv.slots[59];
  return g ? itemDef(g.type).armor?.attack || 0 : 0;
}

// ------------------------------------------------------------------ Crafting

export function currentRecipe(inv: Inv, screen: Screen) {
  const cols = screen.mode === 'table' ? 3 : 2;
  return checkCraftingRecipe(gridOf(screen).map(i => inv.slots[i]?.type || null), cols);
}

export function refreshCrafting(inv: Inv, screen: Screen) {
  const r = screen.mode === 'furnace' ? null : currentRecipe(inv, screen);
  inv.slots[RESULT] = r ? { type: r.type, count: r.count } : null;
}

function consumeGrid(inv: Inv, screen: Screen) {
  for (const i of gridOf(screen)) {
    const it = inv.slots[i];
    if (it) { it.count--; if (it.count <= 0) inv.slots[i] = null; }
  }
}

function craftClick(inv: Inv, screen: Screen, shift: boolean) {
  let r = currentRecipe(inv, screen);
  if (!r) return;
  if (shift) {
    for (let n = 0; n < 64 && r; n++) {
      if (!fits(inv, r.type, r.count)) break;
      consumeGrid(inv, screen);
      addItem(inv, r.type, r.count);
      r = currentRecipe(inv, screen);
    }
    return;
  }
  if (!inv.cursor) inv.cursor = { type: r.type, count: r.count };
  else if (inv.cursor.type === r.type && inv.cursor.count + r.count <= maxStack(r.type)) inv.cursor.count += r.count;
  else return;
  consumeGrid(inv, screen);
}

// Recipe book: group recipes by result
export const recipeGroups: [string, Recipe[]][] = (() => {
  const map = new Map<string, Recipe[]>();
  for (const r of recipes) { const l = map.get(r.result.type) || []; l.push(r); map.set(r.result.type, l); }
  return [...map.entries()];
})();

export function recipeNeeds(r: Recipe): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of r.shape) for (const c of row) if (c) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

export function available(inv: Inv): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of [...range(0, MAIN_END), ...GRID_3]) { const it = inv.slots[i]; if (it) m.set(it.type, (m.get(it.type) || 0) + it.count); }
  return m;
}

export const fitsGrid = (r: Recipe, screen: Screen) => {
  const n = screen.mode === 'table' ? 3 : 2;
  return r.shape.length <= n && r.shape[0].length <= n;
};

export function maxSets(r: Recipe, have: Map<string, number>) {
  let n = Infinity;
  for (const [t, c] of recipeNeeds(r)) n = Math.min(n, Math.floor((have.get(t) || 0) / c));
  return n;
}

function returnGrid(inv: Inv, drop: DropFn) {
  for (const i of GRID_3) {
    const it = inv.slots[i];
    if (it) { inv.slots[i] = null; const left = addItem(inv, it.type, it.count); if (left) drop(it.type, left); }
  }
}

// Picks a recipe from the book: lays out ingredients in the grid if you have them. Returns the recipe to
// show as a ghost when you don't.
function bookClick(inv: Inv, screen: Screen, result: string, shift: boolean, drop: DropFn): Recipe | null {
  if (inv.cursor || screen.mode === 'furnace') return null;
  const group = recipeGroups.find(g => g[0] === result)?.[1];
  if (!group) return null;
  const have = available(inv);
  const r = group.find(g => fitsGrid(g, screen) && maxSets(g, have) > 0) || group.find(g => fitsGrid(g, screen));
  if (!r) return null;
  const n = maxSets(r, have);
  if (n <= 0) return r;
  const sets = shift ? Math.min(n, ...[...recipeNeeds(r).keys()].map(maxStack)) : 1;
  returnGrid(inv, drop);
  const cols = screen.mode === 'table' ? 3 : 2;
  const grid = gridOf(screen);
  r.shape.forEach((row, y) => row.forEach((type, x) => {
    if (!type) return;
    let want = sets;
    for (let i = 0; i < MAIN_END && want > 0; i++) {
      const it = inv.slots[i];
      if (!it || it.type !== type) continue;
      const k = Math.min(want, it.count);
      it.count -= k; want -= k;
      if (it.count <= 0) inv.slots[i] = null;
    }
    if (sets - want > 0) inv.slots[grid[y * cols + x]] = { type, count: sets - want };
  }));
  return null;
}

// ------------------------------------------------------------------ Slots

function getSlot(inv: Inv, screen: Screen, slot: number): Stack {
  if (slot >= 100) {
    const f = screen.furnace;
    if (!f || screen.mode !== 'furnace') return null;
    return slot === FURNACE_INPUT ? f.input : slot === FURNACE_FUEL ? f.fuel : f.output;
  }
  return inv.slots[slot] ?? null;
}

function setSlot(inv: Inv, screen: Screen, slot: number, v: Stack) {
  if (slot >= 100) {
    const f = screen.furnace;
    if (!f) return;
    if (slot === FURNACE_INPUT) f.input = v; else if (slot === FURNACE_FUEL) f.fuel = v; else f.output = v;
    return;
  }
  inv.slots[slot] = v;
}

function slotAccepts(slot: number, type: string): boolean {
  if (slot === FURNACE_OUTPUT || slot === RESULT) return false;
  if (slot === FURNACE_FUEL) return !!itemDef(type).fuel;
  if (slot >= ARMOR_START && slot < INV_SIZE) return itemDef(type).armor?.slot === slot - ARMOR_START;
  return true;
}

function validSlot(screen: Screen, slot: number): boolean {
  if (!Number.isInteger(slot)) return false;
  if (slot >= 100) return screen.mode === 'furnace' && slot <= FURNACE_OUTPUT;
  if (!Number.isInteger(slot) || slot < 0 || slot >= INV_SIZE) return false;
  if (slot >= 45 && slot <= 53) return gridOf(screen).includes(slot) && screen.mode !== 'furnace';
  return true;
}

function quickMove(inv: Inv, screen: Screen, slot: number) {
  const it = getSlot(inv, screen, slot);
  if (!it) return;
  const armorSlot = itemDef(it.type).armor?.slot;
  if (slot < MAIN_END && armorSlot !== undefined && !inv.slots[ARMOR_START + armorSlot]) {
    inv.slots[ARMOR_START + armorSlot] = it; setSlot(inv, screen, slot, null); return;
  }
  let targets: number[];
  if (screen.mode === 'furnace' && screen.furnace && slot < MAIN_END) {
    // Smeltables go to the input, fuel to the fuel slot
    const def = itemDef(it.type);
    const target = def.smelt ? FURNACE_INPUT : def.fuel ? FURNACE_FUEL : null;
    if (target) {
      const cur = getSlot(inv, screen, target);
      if (!cur) { setSlot(inv, screen, target, it); setSlot(inv, screen, slot, null); return; }
      if (cur.type === it.type) {
        const n = Math.min(maxStack(it.type) - cur.count, it.count);
        cur.count += n; it.count -= n;
        if (it.count <= 0) setSlot(inv, screen, slot, null);
        return;
      }
    }
    targets = slot < HOTBAR ? range(HOTBAR, MAIN_END) : range(0, HOTBAR);
  } else if (slot < HOTBAR) targets = range(HOTBAR, MAIN_END);
  else if (slot < MAIN_END) targets = range(0, HOTBAR);
  else targets = [...range(HOTBAR, MAIN_END), ...range(0, HOTBAR)];

  const max = maxStack(it.type);
  for (const t of targets) {
    const d = inv.slots[t];
    if (d && d.type === it.type && d.count < max) { const n = Math.min(max - d.count, it.count); d.count += n; it.count -= n; }
    if (it.count <= 0) break;
  }
  for (const t of targets) {
    if (it.count <= 0) break;
    if (!inv.slots[t]) { inv.slots[t] = { type: it.type, count: it.count }; it.count = 0; }
  }
  if (it.count <= 0) setSlot(inv, screen, slot, null);
}

function clickSlot(inv: Inv, screen: Screen, slot: number, button: 0 | 2, shift: boolean) {
  if (slot === RESULT) { craftClick(inv, screen, shift); return; }
  const cur = getSlot(inv, screen, slot);

  if (slot === FURNACE_OUTPUT) {
    if (!cur) return;
    if (shift) { const left = addItem(inv, cur.type, cur.count); setSlot(inv, screen, slot, left > 0 ? { type: cur.type, count: left } : null); }
    else if (!inv.cursor) { inv.cursor = cur; setSlot(inv, screen, slot, null); }
    else if (inv.cursor.type === cur.type) {
      const n = Math.min(maxStack(cur.type) - inv.cursor.count, cur.count);
      inv.cursor.count += n; cur.count -= n;
      if (cur.count <= 0) setSlot(inv, screen, slot, null);
    }
    return;
  }

  if (shift && cur) { quickMove(inv, screen, slot); return; }
  const c = inv.cursor;

  if (button === 2) {
    // Right click / long press: take half, or place one
    if (!c && cur) {
      const half = Math.ceil(cur.count / 2);
      inv.cursor = { type: cur.type, count: half };
      cur.count -= half;
      if (cur.count <= 0) setSlot(inv, screen, slot, null);
    } else if (c && slotAccepts(slot, c.type)) {
      if (!cur) { setSlot(inv, screen, slot, { type: c.type, count: 1 }); c.count--; }
      else if (cur.type === c.type && cur.count < maxStack(cur.type)) { cur.count++; c.count--; }
      if (c.count <= 0) inv.cursor = null;
    }
    return;
  }
  if (!c) { if (cur) { inv.cursor = cur; setSlot(inv, screen, slot, null); } }
  else if (!cur) { if (slotAccepts(slot, c.type)) { setSlot(inv, screen, slot, c); inv.cursor = null; } }
  else if (cur.type === c.type) {
    const n = Math.min(maxStack(cur.type) - cur.count, c.count);
    cur.count += n; c.count -= n;
    if (c.count <= 0) inv.cursor = null;
  } else if (slotAccepts(slot, c.type)) { setSlot(inv, screen, slot, c); inv.cursor = cur; }
}

// Puts grid items and the cursor back into the inventory (dropping what doesn't fit)
export function closeScreen(inv: Inv, drop: DropFn) {
  returnGrid(inv, drop);
  inv.slots[RESULT] = null;
  if (inv.cursor) { const left = addItem(inv, inv.cursor.type, inv.cursor.count); if (left) drop(inv.cursor.type, left); inv.cursor = null; }
}

// Returns a recipe to preview as a ghost (book clicks you can't afford yet), otherwise null
export function applyAction(inv: Inv, screen: Screen, action: InvAction, drop: DropFn): Recipe | null {
  let ghost: Recipe | null = null;
  switch (action.a) {
    case 'click':
      if (!validSlot(screen, action.slot)) return null;
      clickSlot(inv, screen, action.slot, action.button === 2 ? 2 : 0, !!action.shift);
      break;
    case 'book':
      ghost = bookClick(inv, screen, String(action.result), !!action.shift, drop);
      break;
    case 'outside':
      if (inv.cursor) {
        if (action.button === 2) { drop(inv.cursor.type, 1); inv.cursor.count--; if (inv.cursor.count <= 0) inv.cursor = null; }
        else { drop(inv.cursor.type, inv.cursor.count); inv.cursor = null; }
      }
      break;
    case 'close':
      closeScreen(inv, drop);
      break;
  }
  refreshCrafting(inv, screen);
  return ghost;
}
