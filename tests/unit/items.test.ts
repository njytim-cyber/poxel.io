// Items: smelting, every kind of inventory click, and a random-click check that no click ever creates or
// destroys items (duplication and loss bugs). node --test tests/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newFurnace, tickFurnace, isFurnaceEmpty, SMELT_TIME, type FurnaceState } from '../../shared/furnace.ts';
import {
  newInv, newChest, applyAction, maxStack, FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT, CHEST_START, CHEST_SIZE,
  HOTBAR, MAIN_END, ARMOR_START, GRID_2, type Inv, type Screen, type Stack, type InvAction,
} from '../../shared/inventory.ts';
import { Game, creativeCodeHash, type Storage, type WorldSave, type PlayerSave } from '../../server/core/game.ts';
import { BLOCK_ID } from '../../shared/blocks.ts';
import type { ServerMsg } from '../../shared/protocol.ts';

const run = (f: FurnaceState, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) tickFurnace(f, 0.05); };
const click = (slot: number, button: 0 | 2 = 0, shift = false): InvAction => ({ a: 'click', slot, button, shift });
const furnaceScreen = (f = newFurnace()): Screen => ({ mode: 'furnace', furnace: f });
const noDrop = () => { throw new Error('nothing should be dropped'); };

// ---------------------------------------------------------------- Smelting

test('smelting: ore and fuel make ingots; one plank (7.5s) smelts one ore (5s each)', () => {
  const f = newFurnace();
  f.input = { type: 'iron_ore', count: 2 };
  f.fuel = { type: 'planks', count: 1 };
  run(f, SMELT_TIME + 0.2);
  assert.deepEqual(f.output, { type: 'iron_ingot', count: 1 });
  assert.equal(f.fuel, null, 'the plank was burned');
  run(f, 10);
  assert.deepEqual(f.output, { type: 'iron_ingot', count: 1 }, 'fuel ran out before the second ore');
  assert.equal(f.input?.count, 1);
  assert.equal(f.progress, 0, 'unfinished progress cools off without fuel');
});

test('smelting: fuel is not burned when there is nothing to smelt', () => {
  const f = newFurnace();
  f.fuel = { type: 'planks', count: 3 };
  run(f, 5);
  assert.equal(f.fuel?.count, 3);
  f.input = { type: 'dirt', count: 4 }; // not smeltable
  run(f, 5);
  assert.equal(f.fuel?.count, 3);
  assert.equal(f.output, null);
});

test('smelting: a full or different output slot stops it (nothing lost)', () => {
  const f = newFurnace();
  f.input = { type: 'iron_ore', count: 3 };
  f.fuel = { type: 'coal', count: 5 };
  f.output = { type: 'gold_ingot', count: 1 };
  run(f, 12);
  assert.equal(f.input?.count, 3, 'iron cannot land on gold');
  assert.equal(f.fuel?.count, 5, 'no fuel wasted');
  f.output = { type: 'iron_ingot', count: maxStack('iron_ingot') };
  run(f, 12);
  assert.equal(f.input?.count, 3, 'output stack full');
  f.output = null;
  run(f, SMELT_TIME * 3 + 1);
  assert.equal(f.input, null);
  assert.equal(f.output?.count, 3);
  assert.ok(!isFurnaceEmpty(f));
});

test('smelting: an empty furnace reports empty', () => {
  assert.ok(isFurnaceEmpty(newFurnace()));
});

// ---------------------------------------------------------------- Clicks

test('right click takes half a stack, and places one at a time', () => {
  const inv = newInv();
  inv.slots[0] = { type: 'dirt', count: 5 };
  const s: Screen = { mode: 'inventory', furnace: null };
  applyAction(inv, s, click(0, 2), noDrop);
  assert.deepEqual(inv.cursor, { type: 'dirt', count: 3 });
  assert.equal(inv.slots[0]?.count, 2);
  applyAction(inv, s, click(1, 2), noDrop);
  applyAction(inv, s, click(1, 2), noDrop);
  assert.equal(inv.slots[1]?.count, 2);
  assert.equal(inv.cursor?.count, 1);
  applyAction(inv, s, click(0, 2), noDrop);
  assert.equal(inv.slots[0]?.count, 3);
  assert.equal(inv.cursor, null, 'placing the last one empties the cursor');
});

test('left click picks up, puts down, merges and swaps', () => {
  const inv = newInv();
  const s: Screen = { mode: 'inventory', furnace: null };
  inv.slots[0] = { type: 'dirt', count: 40 };
  inv.slots[1] = { type: 'dirt', count: 40 };
  inv.slots[2] = { type: 'stone', count: 1 };
  applyAction(inv, s, click(0), noDrop);
  applyAction(inv, s, click(1), noDrop); // merge up to 64, 16 stay on the cursor
  assert.equal(inv.slots[1]?.count, 64);
  assert.equal(inv.cursor?.count, 16);
  applyAction(inv, s, click(2), noDrop); // swap with the stone
  assert.deepEqual(inv.slots[2], { type: 'dirt', count: 16 });
  assert.deepEqual(inv.cursor, { type: 'stone', count: 1 });
});

test('shift-click in a furnace: ore to the input, fuel to the fuel slot, anything else hotbar <-> inventory', () => {
  const inv = newInv();
  const s = furnaceScreen();
  inv.slots[0] = { type: 'iron_ore', count: 10 };
  inv.slots[1] = { type: 'coal', count: 4 };
  inv.slots[2] = { type: 'dirt', count: 7 };
  applyAction(inv, s, click(0, 0, true), noDrop);
  applyAction(inv, s, click(1, 0, true), noDrop);
  applyAction(inv, s, click(2, 0, true), noDrop);
  assert.deepEqual(s.furnace!.input, { type: 'iron_ore', count: 10 });
  assert.deepEqual(s.furnace!.fuel, { type: 'coal', count: 4 });
  assert.equal(inv.slots[2], null);
  assert.ok(inv.slots.slice(HOTBAR, MAIN_END).some(x => x?.type === 'dirt' && x.count === 7), 'dirt moved into the main inventory');
  // More ore tops up the input stack
  inv.slots[0] = { type: 'iron_ore', count: 5 };
  applyAction(inv, s, click(0, 0, true), noDrop);
  assert.equal(s.furnace!.input?.count, 15);
});

test('the fuel slot only takes fuel; nothing can be put into the output', () => {
  const inv = newInv();
  const s = furnaceScreen();
  inv.cursor = { type: 'iron_ore', count: 3 };
  applyAction(inv, s, click(FURNACE_FUEL), noDrop);
  applyAction(inv, s, click(FURNACE_OUTPUT), noDrop);
  assert.equal(s.furnace!.fuel, null);
  assert.equal(s.furnace!.output, null);
  assert.equal(inv.cursor?.count, 3);
  inv.cursor = { type: 'coal', count: 2 };
  applyAction(inv, s, click(FURNACE_FUEL), noDrop);
  assert.deepEqual(s.furnace!.fuel, { type: 'coal', count: 2 });
});

test('taking smelted items: click to the cursor, merge with the cursor, shift-click into the inventory', () => {
  const inv = newInv();
  const s = furnaceScreen();
  s.furnace!.output = { type: 'iron_ingot', count: 3 };
  applyAction(inv, s, click(FURNACE_OUTPUT), noDrop);
  assert.deepEqual(inv.cursor, { type: 'iron_ingot', count: 3 });
  s.furnace!.output = { type: 'iron_ingot', count: 2 };
  applyAction(inv, s, click(FURNACE_OUTPUT), noDrop);
  assert.equal(inv.cursor?.count, 5);
  assert.equal(s.furnace!.output, null);
  s.furnace!.output = { type: 'iron_ingot', count: 4 };
  applyAction(inv, s, click(FURNACE_OUTPUT, 0, true), noDrop);
  assert.equal(s.furnace!.output, null);
  assert.ok(inv.slots.some(x => x?.type === 'iron_ingot' && x.count === 4));
});

test('shift-click moves between a chest and the inventory', () => {
  const inv = newInv();
  const chest = newChest();
  const s: Screen = { mode: 'chest', furnace: null, chest };
  inv.slots[3] = { type: 'cobblestone', count: 30 };
  applyAction(inv, s, click(3, 0, true), noDrop);
  assert.equal(inv.slots[3], null);
  assert.deepEqual(chest[0], { type: 'cobblestone', count: 30 });
  applyAction(inv, s, click(CHEST_START, 0, true), noDrop);
  assert.equal(chest[0], null);
  assert.ok(inv.slots.some(x => x?.type === 'cobblestone' && x.count === 30));
});

test('closing returns the crafting grid and the cursor to the inventory, and drops what does not fit', () => {
  const inv = newInv();
  const s: Screen = { mode: 'inventory', furnace: null };
  inv.slots[GRID_2[0]] = { type: 'planks', count: 2 };
  inv.cursor = { type: 'stone', count: 5 };
  applyAction(inv, s, { a: 'close' }, noDrop);
  assert.equal(inv.slots[GRID_2[0]], null);
  assert.equal(inv.cursor, null);
  assert.ok(inv.slots.some(x => x?.type === 'planks' && x.count === 2));
  assert.ok(inv.slots.some(x => x?.type === 'stone' && x.count === 5));
  // A full inventory: the leftovers are dropped, not lost
  const full = newInv();
  for (let i = 0; i < MAIN_END; i++) full.slots[i] = { type: 'dirt', count: 64 };
  full.cursor = { type: 'stone', count: 5 };
  const dropped: [string, number][] = [];
  applyAction(full, s, { a: 'close' }, (t, n) => dropped.push([t, n]));
  assert.deepEqual(dropped, [['stone', 5]]);
});

test('clicking outside drops the cursor stack (right click: just one)', () => {
  const inv = newInv();
  const s: Screen = { mode: 'inventory', furnace: null };
  inv.cursor = { type: 'dirt', count: 3 };
  const dropped: number[] = [];
  applyAction(inv, s, { a: 'outside', button: 2 }, (_t, n) => dropped.push(n));
  assert.equal(inv.cursor?.count, 2);
  applyAction(inv, s, { a: 'outside', button: 0 }, (_t, n) => dropped.push(n));
  assert.equal(inv.cursor, null);
  assert.deepEqual(dropped, [1, 2]);
});

test('armour only goes into its own slot', () => {
  const inv = newInv();
  const s: Screen = { mode: 'inventory', furnace: null };
  inv.cursor = { type: 'dirt', count: 1 };
  applyAction(inv, s, click(ARMOR_START), noDrop);
  assert.equal(inv.slots[ARMOR_START], null);
});

// ---------------------------------------------------------------- No duplication, no loss

// A small seeded random generator, so a failure can be replayed
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }
const ITEMS = ['dirt', 'stone', 'iron_ore', 'coal', 'planks', 'iron_ingot', 'wood', 'cobblestone', 'diamond', 'iron_helmet'];

function totals(inv: Inv, s: Screen, dropped: Map<string, number>) {
  const m = new Map(dropped);
  const add = (x: Stack) => { if (x) m.set(x.type, (m.get(x.type) || 0) + x.count); };
  inv.slots.forEach((x, i) => { if (i !== 54) add(x); }); // 54 is the crafting result preview, not a real item
  add(inv.cursor);
  if (s.furnace) { add(s.furnace.input); add(s.furnace.fuel); add(s.furnace.output); }
  s.chest?.forEach(add);
  return m;
}
function checkStacks(inv: Inv, s: Screen, where: string) {
  for (const x of [...inv.slots, inv.cursor, ...(s.chest || []), s.furnace?.input, s.furnace?.fuel, s.furnace?.output]) {
    if (!x) continue;
    assert.ok(Number.isInteger(x.count) && x.count > 0, `${where}: bad count ${JSON.stringify(x)}`);
    assert.ok(x.count <= maxStack(x.type), `${where}: over-full stack ${JSON.stringify(x)}`);
  }
}

for (const mode of ['furnace', 'chest', 'inventory'] as const) {
  test(`5000 random clicks in the ${mode} screen never create or destroy items`, () => {
    const r = rng(mode.length * 7919);
    const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
    const inv = newInv();
    for (let i = 0; i < MAIN_END; i++) if (r() < 0.5) { const t = pick(ITEMS); inv.slots[i] = { type: t, count: 1 + Math.floor(r() * maxStack(t)) }; }
    const s: Screen = mode === 'furnace' ? furnaceScreen() : mode === 'chest' ? { mode: 'chest', furnace: null, chest: newChest() } : { mode: 'inventory', furnace: null };
    if (s.chest) for (let i = 0; i < CHEST_SIZE; i++) if (r() < 0.3) s.chest[i] = { type: 'dirt', count: 1 + Math.floor(r() * 64) };
    const dropped = new Map<string, number>();
    const drop = (t: string, n: number) => dropped.set(t, (dropped.get(t) || 0) + n);
    const before = totals(inv, s, dropped);
    const slots = [...Array(MAIN_END).keys(), ...Array.from({ length: 6 }, (_, i) => ARMOR_START + i),
      ...(mode === 'furnace' ? [FURNACE_INPUT, FURNACE_FUEL, FURNACE_OUTPUT] : []),
      ...(mode === 'chest' ? Array.from({ length: CHEST_SIZE }, (_, i) => CHEST_START + i) : [])];
    for (let i = 0; i < 5000; i++) {
      const roll = r();
      const action: InvAction = roll < 0.9 ? click(pick(slots), r() < 0.3 ? 2 : 0, r() < 0.25)
        : roll < 0.95 ? { a: 'outside', button: r() < 0.5 ? 2 : 0 } : { a: 'close' };
      applyAction(inv, s, action, drop);
      checkStacks(inv, s, `step ${i} ${JSON.stringify(action)}`);
    }
    assert.deepEqual([...totals(inv, s, dropped)].sort(), [...before].sort(), 'every item is still somewhere (or was dropped)');
  });
}

// ---------------------------------------------------------------- Through the real server

function memoryStorage(): Storage {
  let world: WorldSave | null = null; const players: Record<string, PlayerSave> = {};
  return { loadWorld: () => world, saveWorld: w => { world = w; }, loadPlayer: n => players[n] || null, savePlayer: (n, p) => { players[n] = p; } };
}

test('a furnace in the world: open it, smelt, take the ingots; breaking it drops what was inside', () => {
  const g = new Game(memoryStorage(), { creativeCode: creativeCodeHash('1234'), seed: 3 });
  const got: ServerMsg[] = [];
  const p = g.join({ send: m => { got.push(m); }, close: () => {} }, { t: 'hello', v: 4, name: 'Smith', look: {}, token: 'tok-smith' })!;
  const fx = Math.floor(p.body.pos.x) + 2, fy = Math.floor(p.body.pos.y), fz = Math.floor(p.body.pos.z);
  (g as any).setBlock(fx, fy, fz, BLOCK_ID.furnace);
  p.inv.slots[0] = { type: 'iron_ore', count: 2 };
  p.inv.slots[1] = { type: 'coal', count: 1 };
  g.handle(p, { t: 'open', x: fx, y: fy, z: fz } as any);
  assert.ok(got.some(m => m.t === 'screen' && (m as any).mode === 'furnace'), 'the furnace screen opened');
  g.handle(p, { t: 'inv', seq: 1, action: click(0, 0, true) } as any);
  g.handle(p, { t: 'inv', seq: 2, action: click(1, 0, true) } as any);
  for (let i = 0; i < 20 * (SMELT_TIME * 2 + 1); i++) g.tick(0.05);
  g.handle(p, { t: 'inv', seq: 3, action: click(FURNACE_OUTPUT, 0, true) } as any);
  assert.ok(p.inv.slots.some(x => x?.type === 'iron_ingot' && x.count === 2), 'two ingots in the inventory');
  // Put ore back in and break the furnace: the ore comes out as a dropped item
  p.inv.slots[2] = { type: 'gold_ore', count: 3 };
  g.handle(p, { t: 'inv', seq: 4, action: click(2, 0, true) } as any);
  g.handle(p, { t: 'inv', seq: 5, action: { a: 'close' } } as any);
  const itemsBefore = (g as any).items.size;
  for (let i = 0; i < 40; i++) { g.handle(p, { t: 'dig', x: fx, y: fy, z: fz } as any); g.tick(0.25); if ((g as any).world.get(fx, fy, fz) !== BLOCK_ID.furnace) break; }
  assert.notEqual((g as any).world.get(fx, fy, fz), BLOCK_ID.furnace, 'furnace broken');
  const drops = [...(g as any).items.values()].map((it: any) => `${it.type}x${it.count}`);
  assert.ok((g as any).items.size > itemsBefore && drops.includes('gold_orex3'), `gold ore dropped (${drops.join(', ')})`);
});
